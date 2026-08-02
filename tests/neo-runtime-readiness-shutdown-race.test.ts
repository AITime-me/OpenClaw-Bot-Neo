import { describe, expect, it, vi } from 'vitest';
import { runNeoProcess } from '../src/neo-runtime/cli/run-neo-process.js';
import {
  NEO_RUNTIME_EXIT_RUNTIME_FATAL,
  NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT,
  NEO_RUNTIME_EXIT_STARTUP_FAILURE,
  NEO_RUNTIME_EXIT_SUCCESS,
} from '../src/neo-runtime/neo-runtime-exit-codes.js';
import { failNeoRuntimeClose } from '../src/neo-runtime/neo-runtime-failures.js';
import {
  createDeferredNeoRuntimeReadinessPort,
  createRunNeoProcessDeps,
  createSuccessfulMockRuntime,
  deferred,
} from './support/neo-runtime-fixtures.js';

const eventNames = (log: { events: readonly { event: string }[] }): string[] =>
  log.events.map((entry) => entry.event);

const waitForPublishEntered = async (
  readiness: ReturnType<typeof createDeferredNeoRuntimeReadinessPort>,
): Promise<void> => {
  await vi.waitFor(() => {
    expect(readiness.state.publishEntered).toBeGreaterThan(0);
  });
};

const completeDeferredPublish = (
  readiness: ReturnType<typeof createDeferredNeoRuntimeReadinessPort>,
): void => {
  readiness.admitPublish();
  readiness.releasePublish();
};

describe('neo runtime readiness shutdown race', () => {
  it('normal startup publishes readiness and emits ready once', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, log, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    expect(log.events.filter((event) => event.event === 'neo.runtime.ready')).toHaveLength(1);
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
  });

  it('shutdown latched before publication prevents publication through existing pre-check', async () => {
    const startGate = deferred();
    const { runtime } = createSuccessfulMockRuntime({ startGate });
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(log.events.some((event) => event.event === 'neo.runtime.starting')).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    startGate.resolve();
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.publishEntered).toBe(0);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });

  it('SIGTERM while publication promise is pending suppresses ready and clears readiness', async () => {
    const { runtime, getCloseCalls } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
    expect(getCloseCalls()).toBe(1);
  });

  it('SIGINT while publication promise is pending suppresses ready and clears readiness', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGINT');
    completeDeferredPublish(readiness);
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });

  it('fatal event while publication promise is pending suppresses ready and exits 12', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitFatal('uncaughtException');
    completeDeferredPublish(readiness);
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_RUNTIME_FATAL);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
    expect(log.events.some((event) => event.event === 'neo.runtime.failed')).toBe(true);
  });

  it('signal after simulated commit but before publish resolves suppresses ready', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    readiness.admitPublish();
    await vi.waitFor(() => {
      expect(readiness.state.committed).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    readiness.releasePublish();
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });

  it('post-publication check observes latched shutdown and reconciles readiness', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    readiness.admitPublish();
    await vi.waitFor(() => {
      expect(readiness.state.committed).toBe(true);
    });
    readiness.releasePublish();
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(readiness.state.published).toBeNull();
  });

  it('race path removes final readiness that would survive without post-check reconciliation', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    readiness.admitPublish();
    await vi.waitFor(() => {
      expect(readiness.state.committed).toBe(true);
    });
    expect(readiness.state.published).not.toBeNull();
    readiness.releasePublish();
    await runPromise;
    expect(readiness.state.published).toBeNull();
    expect(readiness.state.removed).toBeGreaterThanOrEqual(2);
  });

  it('race path emits no neo.runtime.ready', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });

  it('race path calls runtime close exactly once', async () => {
    const { runtime, getCloseCalls } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(getCloseCalls()).toBe(1);
  });

  it('race path starts only one coordinated shutdown', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(log.events.filter((event) => event.event === 'neo.runtime.stopping')).toHaveLength(1);
    expect(log.events.filter((event) => event.event === 'neo.runtime.stopped')).toHaveLength(1);
  });

  it('repeated SIGTERM and SIGINT during publication cause no duplicate close', async () => {
    const { runtime, getCloseCalls } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    signals.emitSignal('SIGINT');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(getCloseCalls()).toBe(1);
  });

  it('readiness removal is safe when called by both shutdown and post-publish reconciliation', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(readiness.state.removed).toBeGreaterThanOrEqual(2);
    expect(readiness.state.published).toBeNull();
  });

  it('SIGHUP during publication does not latch shutdown', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGHUP');
    completeDeferredPublish(readiness);
    await vi.waitFor(() => {
      expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    expect(log.events.some((event) => event.event === 'neo.signal.sighup_ignored')).toBe(true);
    expect(log.events.filter((event) => event.event === 'neo.runtime.stopping')).toHaveLength(1);
  });

  it('SIGHUP path eventually emits ready normally', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGHUP');
    completeDeferredPublish(readiness);
    await vi.waitFor(() => {
      expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    await runPromise;
    expect(log.events.filter((event) => event.event === 'neo.runtime.ready')).toHaveLength(1);
  });

  it('publish failure retains existing exit 11 behavior', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    readiness.setPublishResult({ ok: false, reason: 'Readiness publish failed.' });
    const { deps, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    readiness.admitPublish();
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_STARTUP_FAILURE);
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
    expect(readiness.state.published).toBeNull();
  });

  it('normal ready-then-SIGTERM preserves ready, signal, stopping, stopped and exit 0', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
    });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(true);
    });
    signals.emitSignal('SIGTERM');
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SUCCESS);
    const names = eventNames(log);
    const readyIndex = names.indexOf('neo.runtime.ready');
    const signalIndex = names.indexOf('neo.signal.received');
    const stoppingIndex = names.indexOf('neo.runtime.stopping');
    const stoppedIndex = names.indexOf('neo.runtime.stopped');
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(signalIndex).toBeGreaterThan(readyIndex);
    expect(stoppingIndex).toBeGreaterThan(signalIndex);
    expect(stoppedIndex).toBeGreaterThan(stoppingIndex);
  });

  it('no readiness remains after shutdown-race process return', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(readiness.state.published).toBeNull();
    expect(readiness.state.committed).toBe(false);
  });

  it('shutdown timeout classification remains unchanged during publication race', async () => {
    const { runtime } = createSuccessfulMockRuntime({
      closeBehavior: () =>
        failNeoRuntimeClose('NEO_RUNTIME_CLOSE_INCOMPLETE', 'SHUTDOWN_TIMEOUT', 'still stopping'),
    });
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    const result = await runPromise;
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT);
    expect(log.events.some((event) => event.event === 'neo.runtime.shutdown_timeout')).toBe(true);
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });

  it('diagnostics remain unchanged on the production runtime path', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const readiness = createDeferredNeoRuntimeReadinessPort();
    const { deps, signals } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      readiness,
    });
    const runPromise = runNeoProcess(deps);
    await waitForPublishEntered(readiness);
    signals.emitSignal('SIGTERM');
    completeDeferredPublish(readiness);
    await runPromise;
    expect(runtime.diagnostics).toBeDefined();
  });
});
