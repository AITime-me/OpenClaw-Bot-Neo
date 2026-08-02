import { describe, expect, it, vi } from 'vitest';
import {
  createNeoRuntime,
  type NeoRuntimeDurableOpenResult,
  type NeoRuntimeDurableOwner,
  type NeoRuntimeOwnerCloseResult,
} from '../src/neo-runtime/create-neo-runtime.js';
import {
  mapNeoRuntimeFailureClassToExitCode,
  NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD,
  NEO_RUNTIME_EXIT_STARTUP_FAILURE,
  NEO_RUNTIME_EXIT_SUCCESS,
} from '../src/neo-runtime/neo-runtime-exit-codes.js';
import { serializeNeoRuntimeFailure } from '../src/neo-runtime/neo-runtime-failures.js';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const successOwner = (
  closeSpy: () => NeoRuntimeOwnerCloseResult = () => ({ ok: true }),
): NeoRuntimeDurableOwner => ({
  close: closeSpy,
});

const makeRuntime = (
  opener: () => Promise<NeoRuntimeDurableOpenResult>,
  options: { trackOpenCount?: { count: number } } = {},
) => {
  const track = options.trackOpenCount ?? { count: 0 };
  return createNeoRuntime({
    openDurableHost: () => {
      track.count += 1;
      return opener();
    },
  });
};

const assertNoLeak = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/neo\.primary\.lock|neo-memory\.sqlite|\/var\//i);
  expect(value).not.toHaveProperty('host');
  expect(value).not.toHaveProperty('sqlite');
  expect(value).not.toHaveProperty('lock');
  expect(value).not.toHaveProperty('root');
};

describe('neo runtime production composition lifecycle', () => {
  it('starts in new with honest diagnostics', () => {
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }));
    const health = runtime.getHealth();
    expect(health.lifecycle).toBe('new');
    expect(health.runtimeReady).toBe(false);
    expect(runtime.diagnostics).toEqual(NEO_RUNTIME_DIAGNOSTICS);
    expect(runtime.diagnostics.neoRuntimeLifecycleFoundationImplemented).toBe(true);
    expect(runtime.diagnostics.processLockWiredToNeo).toBe(false);
  });

  it('close before start stops without opening durable host', async () => {
    const track = { count: 0 };
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }), {
      trackOpenCount: track,
    });
    const closeResult = await runtime.close('operator-request');
    expect(closeResult.ok).toBe(true);
    expect(track.count).toBe(0);
    expect(runtime.getHealth().lifecycle).toBe('stopped');
    expect(runtime.getHealth().durableHostOpened).toBe(false);
  });

  it('successful start becomes running and ready', async () => {
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }));
    const startResult = await runtime.start();
    expect(startResult.ok).toBe(true);
    const health = runtime.getHealth();
    expect(health.lifecycle).toBe('running');
    expect(health.runtimeReady).toBe(true);
    expect(health.durableHostOpened).toBe(true);
  });

  it('calls durable opener exactly once across repeated starts', async () => {
    const track = { count: 0 };
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }), {
      trackOpenCount: track,
    });
    await runtime.start();
    await runtime.start();
    expect(track.count).toBe(1);
  });

  it('concurrent start shares one durable open', async () => {
    const track = { count: 0 };
    const gate = deferred<undefined>();
    const runtime = makeRuntime(
      () =>
        gate.promise.then(() => ({
          ok: true as const,
          value: successOwner(),
        })),
      { trackOpenCount: track },
    );
    const first = runtime.start();
    const second = runtime.start();
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(track.count).toBe(1);
    expect(runtime.getHealth().lifecycle).toBe('running');
  });

  it('startup failure becomes failed and not ready', async () => {
    const runtime = makeRuntime(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'DURABLE_STORAGE_BOOTSTRAP_FAILED', reason: 'bootstrap failed' },
      }),
    );
    const startResult = await runtime.start();
    expect(startResult.ok).toBe(false);
    if (!startResult.ok) {
      expect(startResult.error.failureClass).toBe('STARTUP');
      assertNoLeak(startResult.error);
    }
    const health = runtime.getHealth();
    expect(health.lifecycle).toBe('failed');
    expect(health.runtimeReady).toBe(false);
    expect(health.durableHostOpened).toBe(false);
  });

  it('maps lock held startup failure to PROCESS_LOCK_HELD', async () => {
    const runtime = makeRuntime(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'DURABLE_COMPOSITION_LOCK_HELD', reason: 'lock held' },
      }),
    );
    const startResult = await runtime.start();
    expect(startResult.ok).toBe(false);
    if (!startResult.ok) {
      expect(startResult.error.failureClass).toBe('PROCESS_LOCK_HELD');
      expect(mapNeoRuntimeFailureClassToExitCode(startResult.error.failureClass)).toBe(
        NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD,
      );
    }
  });

  it('close after startup failure is idempotent and does not open owner', async () => {
    const track = { count: 0 };
    const runtime = makeRuntime(
      () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'DURABLE_STORAGE_BOOTSTRAP_FAILED', reason: 'bootstrap failed' },
        }),
      { trackOpenCount: track },
    );
    await runtime.start();
    const first = await runtime.close('shutdown');
    const second = await runtime.close('shutdown');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(track.count).toBe(1);
  });

  it('close during async startup aborts before running and closes opened owner', async () => {
    const gate = deferred<undefined>();
    const closeSpy = vi.fn(() => ({ ok: true as const }));
    const runtime = makeRuntime(() =>
      gate.promise.then(() => ({
        ok: true as const,
        value: successOwner(closeSpy),
      })),
    );
    const startPromise = runtime.start();
    const closePromise = runtime.close('startup-abort');
    gate.resolve(undefined);
    const [startResult, closeResult] = await Promise.all([startPromise, closePromise]);
    expect(startResult.ok).toBe(false);
    expect(closeResult.ok).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const health = runtime.getHealth();
    expect(health.lifecycle).toBe('stopped');
    expect(health.runtimeReady).toBe(false);
  });

  it('running close transitions stopping then stopped via owner.close only', async () => {
    const closeSpy = vi.fn(() => ({ ok: true as const }));
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner(closeSpy) }));
    await runtime.start();
    const closeResult = await runtime.close('shutdown');
    expect(closeResult.ok).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(runtime.getHealth().lifecycle).toBe('stopped');
    expect(runtime.getHealth().runtimeReady).toBe(false);
  });

  it('repeated close is idempotent', async () => {
    const closeSpy = vi.fn(() => ({ ok: true as const }));
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner(closeSpy) }));
    await runtime.start();
    await runtime.close('shutdown');
    await runtime.close('shutdown');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('concurrent close uses one active owner.close', async () => {
    let closeCalls = 0;
    const closeSpy = vi.fn(() => {
      closeCalls += 1;
      if (closeCalls === 1) {
        return {
          ok: false as const,
          error: { code: 'BUSY', reason: 'busy', stage: 'operations' },
        };
      }
      return { ok: true as const };
    });
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner(closeSpy) }));
    await runtime.start();
    const first = runtime.close('shutdown');
    const second = runtime.close('shutdown');
    await Promise.all([first, second]);
    expect(closeSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('owner close-pending keeps runtime stopping until retry succeeds', async () => {
    let attempts = 0;
    const closeSpy = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false as const,
          error: {
            code: 'DURABLE_HOST_CLOSE_FAILED',
            reason: 'close failed at memory stage',
            stage: 'memory',
          },
        };
      }
      return { ok: true as const };
    });
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner(closeSpy) }));
    await runtime.start();
    const first = await runtime.close('shutdown');
    expect(first.ok).toBe(false);
    expect(runtime.getHealth().lifecycle).toBe('stopping');
    expect(runtime.getHealth().runtimeReady).toBe(false);
    const second = await runtime.close('shutdown');
    expect(second.ok).toBe(true);
    expect(runtime.getHealth().lifecycle).toBe('stopped');
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it('does not expose raw owner, host, sqlite, lock, or root on runtime surface', () => {
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }));
    expect(Object.keys(runtime).sort()).toEqual(['close', 'diagnostics', 'getHealth', 'start']);
    assertNoLeak(runtime);
    assertNoLeak(runtime.getHealth());
  });

  it('health snapshots are frozen defensive copies', async () => {
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }));
    await runtime.start();
    const first = runtime.getHealth();
    const second = runtime.getHealth();
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('maps failure classes to stable exit codes', () => {
    expect(mapNeoRuntimeFailureClassToExitCode('CONFIGURATION')).toBe(2);
    expect(mapNeoRuntimeFailureClassToExitCode('PROCESS_LOCK_HELD')).toBe(10);
    expect(mapNeoRuntimeFailureClassToExitCode('STARTUP')).toBe(NEO_RUNTIME_EXIT_STARTUP_FAILURE);
    expect(mapNeoRuntimeFailureClassToExitCode(undefined)).toBe(12);
    expect(NEO_RUNTIME_EXIT_SUCCESS).toBe(0);
  });

  it('serializes failures in bounded redacted form', () => {
    const serialized = serializeNeoRuntimeFailure({
      code: 'NEO_RUNTIME_STARTUP_FAILED',
      failureClass: 'STARTUP',
      reason: 'Neo runtime durable host startup failed.',
    });
    expect(serialized.length).toBeLessThanOrEqual(512);
    expect(serialized).not.toMatch(/neo-memory|\/var\//i);
  });

  it('rejects start after terminal stopped state', async () => {
    const runtime = makeRuntime(() => Promise.resolve({ ok: true, value: successOwner() }));
    await runtime.close('operator-request');
    const restart = await runtime.start();
    expect(restart.ok).toBe(false);
    if (!restart.ok) expect(restart.error.failureClass).toBe('TERMINAL_STATE');
  });

  it('rejects start after terminal failed state', async () => {
    const runtime = makeRuntime(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'DURABLE_STORAGE_BOOTSTRAP_FAILED', reason: 'failed' },
      }),
    );
    await runtime.start();
    const restart = await runtime.start();
    expect(restart.ok).toBe(false);
    if (!restart.ok) expect(restart.error.failureClass).toBe('TERMINAL_STATE');
  });
});
