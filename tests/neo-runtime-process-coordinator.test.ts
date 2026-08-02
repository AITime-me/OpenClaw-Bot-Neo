import { describe, expect, it, vi } from 'vitest';
import { runNeoProcess } from '../src/neo-runtime/cli/run-neo-process.js';
import { createNeoExitDisposition } from '../src/neo-runtime/coordination/exit-disposition.js';
import { closeRuntimeWithRetry } from '../src/neo-runtime/coordination/shutdown-close-retry.js';
import {
  NEO_RUNTIME_EXIT_CONFIG_FAILURE,
  NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD,
  NEO_RUNTIME_EXIT_RUNTIME_FATAL,
  NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT,
  NEO_RUNTIME_EXIT_STARTUP_FAILURE,
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
  createRunNeoProcessDeps,
  createSuccessfulMockRuntime,
  deferred,
  NEO_TEST_PATHS,
  validRunArgv,
} from './support/neo-runtime-fixtures.js';

describe('neo runtime process coordinator', () => {
  it('help exits 0 without config read or runtime creation', async () => {
    const createRuntime = vi.fn();
    const { deps } = createRunNeoProcessDeps({ argv: ['--help'], createRuntime });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('invalid CLI maps to configuration exit 2', async () => {
    const { deps, log } = createRunNeoProcessDeps({ argv: ['--config', 'relative.json'] });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_CONFIG_FAILURE);
    expect(log.events.some((event) => event.event === 'neo.config.invalid')).toBe(true);
  });

  it('invalid bootstrap maps to configuration exit 2', async () => {
    const { deps } = createRunNeoProcessDeps({ configFiles: {} });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_CONFIG_FAILURE);
  });

  it('successful start publishes readiness once after runtime ready', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { deps, readiness, log, signals } = createRunNeoProcessDeps({ createRuntime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(readiness.state.published?.runtimeReady).toBe(true);
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(true);
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
  });

  it('removes stale readiness before startup', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.removed).toBeGreaterThan(0);
    });
    signals.emitSignal('SIGINT');
    await runPromise;
  });

  it('signal during startup prevents ready publication', async () => {
    const gate = deferred();
    let closedDuringStart = false;
    let startEntered = false;
    const runtime = {
      diagnostics: NEO_RUNTIME_DIAGNOSTICS,
      getHealth: () =>
        Object.freeze({
          lifecycle: closedDuringStart ? ('stopped' as const) : ('starting' as const),
          runtimeReady: false,
          durableHostOpened: false,
          stopping: closedDuringStart,
          failed: false,
        }),
      start: async () => {
        startEntered = true;
        await gate.promise;
        if (closedDuringStart) {
          return failNeoRuntime(
            'NEO_RUNTIME_START_IN_PROGRESS',
            'START_IN_PROGRESS',
            'Startup aborted during close.',
          );
        }
        return okNeoRuntime();
      },
      close: () => {
        closedDuringStart = true;
        gate.resolve();
        return Promise.resolve(okNeoRuntimeClose());
      },
    };
    const { deps, readiness, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(startEntered).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(readiness.state.published).toBeNull();
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
  });

  it('maps process-lock-held startup failure to exit 10', async () => {
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
    const { deps } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD);
  });

  it('maps generic startup failure to exit 11', async () => {
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
    const { deps, readiness } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const result = await runNeoProcess(deps);
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_STARTUP_FAILURE);
    expect(readiness.state.published).toBeNull();
  });

  it('uncaughtException maps to fatal exit 12 even when cleanup succeeds', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    signals.emitFatal('uncaughtException');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
  });

  it('unhandledRejection maps to fatal exit 12', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    signals.emitFatal('unhandledRejection');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
  });

  it('repeated fatal events do not duplicate close', async () => {
    const { runtime, getCloseCalls } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    signals.emitFatal('uncaughtException');
    signals.emitFatal('unhandledRejection');
    await runPromise;
    expect(getCloseCalls()).toBe(1);
  });

  it('close-pending retries same runtime without busy loop', async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];
    const close = () => {
      attempts += 1;
      if (attempts < 2) {
        return Promise.resolve(
          failNeoRuntimeClose('NEO_RUNTIME_CLOSE_INCOMPLETE', 'SHUTDOWN_TIMEOUT', 'close pending'),
        );
      }
      return Promise.resolve(okNeoRuntimeClose());
    };
    const result = await closeRuntimeWithRetry({
      close,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        await Promise.resolve();
      },
      maxAttempts: 3,
      retryDelayMs: 25,
    });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(sleepCalls).toEqual([25]);
  });

  it('close-pending exhaustion maps to shutdown timeout exit 13', async () => {
    const { runtime } = createSuccessfulMockRuntime({
      closeBehavior: () =>
        failNeoRuntimeClose('NEO_RUNTIME_CLOSE_INCOMPLETE', 'SHUTDOWN_TIMEOUT', 'still stopping'),
    });
    const { deps, readiness, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT);
    expect(log.events.some((event) => event.event === 'neo.runtime.shutdown_timeout')).toBe(true);
  });

  it('removes signal listeners after completion', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    signals.emitSignal('SIGTERM');
    await runPromise;
    expect(signals.hasHandlers()).toBe(false);
  });

  it('exit disposition preserves fatal over graceful stop', () => {
    const exit = createNeoExitDisposition();
    exit.recordGracefulStop();
    exit.recordFailure('RUNTIME_FATAL');
    expect(exit.snapshot().exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
  });

  it('exit disposition preserves shutdown timeout over startup', () => {
    const exit = createNeoExitDisposition();
    exit.recordFailure('STARTUP');
    exit.recordFailure('SHUTDOWN_TIMEOUT');
    expect(exit.snapshot().exitCode).toBe(NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT);
  });

  it('valid argv contract includes all required absolute paths', () => {
    expect(validRunArgv()).toEqual([
      '--config',
      NEO_TEST_PATHS.config,
      '--storage-binding',
      NEO_TEST_PATHS.storageBinding,
      '--storage-policy',
      NEO_TEST_PATHS.storagePolicy,
      '--execution-root',
      NEO_TEST_PATHS.executionRoot,
    ]);
  });
});
