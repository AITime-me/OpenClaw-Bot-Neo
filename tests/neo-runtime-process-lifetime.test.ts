import { describe, expect, it, vi } from 'vitest';
import { runNeoProcess } from '../src/neo-runtime/cli/run-neo-process.js';
import { createTrackingNeoProcessKeepAlivePort } from '../src/neo-runtime/coordination/neo-process-keep-alive.js';
import { createProcessLifetimeBarrier } from '../src/neo-runtime/coordination/process-lifetime-coordinator.js';
import {
  NEO_RUNTIME_EXIT_RUNTIME_FATAL,
  NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT,
  NEO_RUNTIME_EXIT_SUCCESS,
} from '../src/neo-runtime/neo-runtime-exit-codes.js';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import {
  failNeoRuntime,
  failNeoRuntimeClose,
  okNeoRuntime,
  okNeoRuntimeClose,
} from '../src/neo-runtime/neo-runtime-failures.js';
import {
  createNeoRuntimeLogSink,
  createProductionNeoRuntimeLogSink,
  serializeNeoRuntimeLogEvent,
  type NeoRuntimeLogEventName,
} from '../src/neo-runtime/logging/neo-runtime-log.js';
import { redactNeoRuntimeLogText } from '../src/neo-runtime/logging/neo-runtime-log-redaction.js';
import type { NeoProcessOutputPort } from '../src/neo-runtime/ports/neo-process-ports.js';
import {
  createRunNeoProcessDeps,
  createSuccessfulMockRuntime,
  deferred,
} from './support/neo-runtime-fixtures.js';

const createCapturingOutputPort = (): NeoProcessOutputPort & {
  readonly stdout: string[];
  readonly stderr: string[];
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeStdoutLine: (line: string) => {
      stdout.push(line);
    },
    writeStderrLine: (line: string) => {
      stderr.push(line);
    },
  };
};

describe('neo runtime process lifetime keep-alive', () => {
  it('bare lifetime barrier alone does not retain an event-loop handle', () => {
    const barrier = createProcessLifetimeBarrier();
    expect(barrier.isRequested()).toBe(false);
    barrier.requestShutdown();
    expect(barrier.isRequested()).toBe(true);
  });

  it('acquires keep-alive for a running process and releases after completion', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(keepAlive.acquireCount()).toBe(1);
    expect(keepAlive.releaseCount()).toBe(1);
    expect(keepAlive.isActive()).toBe(false);
  });

  it('keeps lease active after requestShutdown until orchestration returns', async () => {
    const gate = deferred();
    const keepAliveRef = createTrackingNeoProcessKeepAlivePort();
    let leaseActiveDuringClose = false;
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () =>
        Object.freeze({
          lifecycle: 'running' as const,
          runtimeReady: true,
          durableHostOpened: true,
          stopping: false,
          failed: false,
        }),
      start: () => Promise.resolve(okNeoRuntime()),
      close: async () => {
        leaseActiveDuringClose = keepAliveRef.isActive();
        await gate.promise;
        return okNeoRuntimeClose();
      },
    };
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      keepAlive: keepAliveRef,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAliveRef.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    await vi.waitFor(() => {
      expect(leaseActiveDuringClose).toBe(true);
    });
    gate.resolve();
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(keepAliveRef.isActive()).toBe(false);
  });

  it('keeps lease active during close-pending retry sleep', async () => {
    let closeCalls = 0;
    let leaseActiveDuringSleep = false;
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () =>
        Object.freeze({
          lifecycle: 'running' as const,
          runtimeReady: true,
          durableHostOpened: true,
          stopping: false,
          failed: false,
        }),
      start: () => Promise.resolve(okNeoRuntime()),
      close: () => {
        closeCalls += 1;
        if (closeCalls < 3) {
          return Promise.resolve(
            failNeoRuntimeClose(
              'NEO_RUNTIME_CLOSE_INCOMPLETE',
              'SHUTDOWN_TIMEOUT',
              'close pending',
            ),
          );
        }
        return Promise.resolve(okNeoRuntimeClose());
      },
    };
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      sleep: {
        sleep: async () => {
          leaseActiveDuringSleep = keepAlive.isActive();
          await Promise.resolve();
        },
      },
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(leaseActiveDuringSleep).toBe(true);
    expect(keepAlive.isActive()).toBe(false);
  });

  it('releases keep-alive after shutdown-timeout result', async () => {
    const { runtime } = createSuccessfulMockRuntime({
      closeBehavior: () =>
        failNeoRuntimeClose('NEO_RUNTIME_CLOSE_INCOMPLETE', 'SHUTDOWN_TIMEOUT', 'still stopping'),
    });
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT);
    expect(keepAlive.releaseCount()).toBe(1);
    expect(keepAlive.isActive()).toBe(false);
  });

  it('releases keep-alive after startup failure', async () => {
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () => ({
        lifecycle: 'failed' as const,
        runtimeReady: false,
        durableHostOpened: false,
        stopping: false,
        failed: true,
        failureClass: 'STARTUP' as const,
      }),
      start: () =>
        Promise.resolve(failNeoRuntime('NEO_RUNTIME_STARTUP_FAILED', 'STARTUP', 'Startup failed.')),
      close: () => Promise.resolve(okNeoRuntimeClose()),
    };
    const { deps, keepAlive } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    await runNeoProcess(deps);
    expect(keepAlive.releaseCount()).toBe(1);
    expect(keepAlive.isActive()).toBe(false);
  });

  it('releases keep-alive after process-lock-held result', async () => {
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () => ({
        lifecycle: 'failed' as const,
        runtimeReady: false,
        durableHostOpened: false,
        stopping: false,
        failed: true,
        failureClass: 'PROCESS_LOCK_HELD' as const,
      }),
      start: () =>
        Promise.resolve(
          failNeoRuntime('NEO_RUNTIME_LOCK_HELD', 'PROCESS_LOCK_HELD', 'Process lock held.'),
        ),
      close: () => Promise.resolve(okNeoRuntimeClose()),
    };
    const { deps, keepAlive } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    await runNeoProcess(deps);
    expect(keepAlive.releaseCount()).toBe(1);
  });

  it('releases keep-alive after runtime fatal', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitFatal('uncaughtException');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
    expect(keepAlive.releaseCount()).toBe(1);
  });

  it('does not acquire keep-alive for help', async () => {
    const keepAlive = createTrackingNeoProcessKeepAlivePort();
    const { deps } = createRunNeoProcessDeps({ argv: ['--help'], keepAlive });
    await runNeoProcess(deps);
    expect(keepAlive.acquireCount()).toBe(0);
  });

  it('does not acquire keep-alive for invalid CLI', async () => {
    const keepAlive = createTrackingNeoProcessKeepAlivePort();
    const { deps } = createRunNeoProcessDeps({ argv: ['--config', 'relative.json'], keepAlive });
    await runNeoProcess(deps);
    expect(keepAlive.acquireCount()).toBe(0);
  });

  it('maps keep-alive acquire failure to runtime fatal', async () => {
    const keepAlive = {
      acquire: () => {
        throw new Error('keep-alive unavailable');
      },
    };
    const { deps, log } = createRunNeoProcessDeps({ keepAlive });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
    expect(log.events.some((event) => event.event === 'neo.runtime.failed')).toBe(true);
  });

  it('repeated signals do not acquire additional leases', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    signals.emitSignal('SIGINT');
    await runPromise;
    expect(keepAlive.acquireCount()).toBe(1);
  });

  it('SIGHUP does not release keep-alive before shutdown', async () => {
    const gate = deferred();
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () =>
        Object.freeze({
          lifecycle: 'running' as const,
          runtimeReady: true,
          durableHostOpened: true,
          stopping: false,
          failed: false,
        }),
      start: () => Promise.resolve(okNeoRuntime()),
      close: async () => {
        await gate.promise;
        return okNeoRuntimeClose();
      },
    };
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGHUP');
    expect(keepAlive.isActive()).toBe(true);
    signals.emitSignal('SIGTERM');
    gate.resolve();
    await runPromise;
    expect(keepAlive.isActive()).toBe(false);
  });

  it('retains keep-alive through signal during startup rollback', async () => {
    const gate = deferred();
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () =>
        Object.freeze({
          lifecycle: 'starting' as const,
          runtimeReady: false,
          durableHostOpened: false,
          stopping: false,
          failed: false,
        }),
      start: async () => {
        await gate.promise;
        return okNeoRuntime();
      },
      close: () => {
        gate.resolve();
        return Promise.resolve(okNeoRuntimeClose());
      },
    };
    const { deps, signals, keepAlive } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(keepAlive.isActive()).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    await runPromise;
    expect(keepAlive.releaseCount()).toBe(1);
  });
});

describe('neo runtime production structured logging', () => {
  it('emits valid JSONL for required events', () => {
    const output = createCapturingOutputPort();
    const sink = createProductionNeoRuntimeLogSink(42, () => '2026-08-02T12:00:00.000Z', output);
    const required: NeoRuntimeLogEventName[] = [
      'neo.runtime.starting',
      'neo.runtime.ready',
      'neo.signal.received',
      'neo.signal.sighup_ignored',
      'neo.runtime.stopping',
      'neo.runtime.stopped',
      'neo.runtime.failed',
      'neo.runtime.shutdown_timeout',
      'neo.config.invalid',
    ];
    for (const event of required) {
      sink.emit({
        event,
        pid: 42,
        atUtc: '2026-08-02T12:00:00.000Z',
        ...(event === 'neo.signal.received' ? { signal: 'SIGTERM' as const } : {}),
        ...(event === 'neo.runtime.failed' ||
        event === 'neo.runtime.shutdown_timeout' ||
        event === 'neo.config.invalid'
          ? { failureClass: 'STARTUP' as const }
          : {}),
      });
    }
    for (const line of [...output.stdout, ...output.stderr]) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
    expect(output.stderr.some((line) => line.includes('neo.runtime.failed'))).toBe(true);
    expect(output.stdout.some((line) => line.includes('neo.runtime.ready'))).toBe(true);
  });

  it('redacts paths secrets and stacks from serialized output', () => {
    const serialized = serializeNeoRuntimeLogEvent({
      event: 'neo.runtime.failed',
      pid: 1,
      atUtc: '2026-08-02T12:00:00.000Z',
      failureClass: 'STARTUP',
    });
    const redacted = redactNeoRuntimeLogText(
      '{"reason":"failed at /var/lib/openclaw token=abc","stack":"Error\\n at /home/neo"}',
    );
    expect(redacted).not.toContain('/var/lib/openclaw');
    expect(redacted).not.toMatch(/token=abc/i);
    expect(serialized).not.toContain('stack');
  });

  it('does not crash when output port throws', () => {
    const sink = createProductionNeoRuntimeLogSink(1, () => '2026-08-02T12:00:00.000Z', {
      writeStdoutLine: () => {
        throw new Error('broken stdout');
      },
      writeStderrLine: () => {
        throw new Error('broken stderr');
      },
    });
    expect(() => {
      sink.emit({
        event: 'neo.runtime.ready',
        pid: 1,
        atUtc: '2026-08-02T12:00:00.000Z',
      });
    }).not.toThrow();
    expect(sink.events).toHaveLength(1);
  });
});

describe('neo runtime in-memory log sink', () => {
  it('retains events for tests without writing output', () => {
    const sink = createNeoRuntimeLogSink(7, () => '2026-08-02T12:00:00.000Z');
    sink.emit({ event: 'neo.runtime.starting', pid: 7, atUtc: '2026-08-02T12:00:00.000Z' });
    expect(sink.events).toHaveLength(1);
  });
});
