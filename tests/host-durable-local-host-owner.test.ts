import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../src/core/domain/index.js';
import type { MemoryWriteFailure, MemoryWriteOutcome } from '../src/core/application/index.js';
import { createLocalHost, type LocalHost } from '../src/host/create-local-host.js';
import { LOCAL_HOST_DIAGNOSTICS } from '../src/host/diagnostics.js';
import {
  createDurableLocalHostOwner,
  type DurableLocalHostOwner,
} from '../src/host/durable/create-durable-local-host-owner.js';
import { DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS } from '../src/host/durable/durable-local-host-owner-diagnostics.js';
import {
  failResourceClose,
  okResourceClose,
  type DurableResourceCloseResult,
} from '../src/host/durable/durable-local-host-owner-failures.js';
import {
  asRecordId,
  authenticatedAccess,
  fixedClock,
  grantForCommand,
  writeCommand,
} from './support/fixtures.js';

const LOCAL_HOST_KEYS = [
  'diagnostics',
  'writeMemory',
  'readMemory',
  'seedLocalApprovalGrant',
] as const;

const OWNER_KEYS = ['host', 'diagnostics', 'close'] as const;

type Sequence = string[];

const okWriteOutcome = (): MemoryWriteOutcome => ({
  recordId: asRecordId('record-durable-1'),
  scanDecision: 'allow',
  approvalId: null,
});

const trackingResources = (
  sequence: Sequence,
  overrides: {
    memory?: () => DurableResourceCloseResult;
    lock?: () => DurableResourceCloseResult;
    root?: () => DurableResourceCloseResult;
  } = {},
) => ({
  closeMemory: (): DurableResourceCloseResult => {
    sequence.push('memory');
    return overrides.memory ? overrides.memory() : okResourceClose();
  },
  releaseProcessLock: (): DurableResourceCloseResult => {
    sequence.push('process-lock');
    return overrides.lock ? overrides.lock() : okResourceClose();
  },
  closeStorageRoot: (): DurableResourceCloseResult => {
    sequence.push('storage-root');
    return overrides.root ? overrides.root() : okResourceClose();
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const defaultWriteMemory: LocalHost['writeMemory'] = () => Promise.resolve(ok(okWriteOutcome()));
const defaultReadMemory: LocalHost['readMemory'] = () =>
  Promise.resolve(err({ code: 'VALIDATION_FAILED', reason: 'not found' }));
const defaultSeed: LocalHost['seedLocalApprovalGrant'] = () => undefined;

const fakeHost = (
  spies: {
    writeMemory?: LocalHost['writeMemory'];
    readMemory?: LocalHost['readMemory'];
    seedLocalApprovalGrant?: LocalHost['seedLocalApprovalGrant'];
  } = {},
): LocalHost =>
  Object.freeze({
    diagnostics: LOCAL_HOST_DIAGNOSTICS,
    writeMemory: spies.writeMemory ?? defaultWriteMemory,
    readMemory: spies.readMemory ?? defaultReadMemory,
    seedLocalApprovalGrant: spies.seedLocalApprovalGrant ?? defaultSeed,
  });

const createOwner = (
  host: LocalHost = fakeHost(),
  resources = trackingResources([]),
): DurableLocalHostOwner => createDurableLocalHostOwner({ host, resources });

const assertNoResourceLeak = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /neo\.primary\.lock|neo-memory\.sqlite|openclaw-neo|better-sqlite3|fs-ext|errno|syscall|stack|fd\b|WAL|SHM/i,
  );
  expect(serialized).not.toMatch(/\/var\/|\\\\|C:\\\\/i);
  expect(value).not.toHaveProperty('path');
  expect(value).not.toHaveProperty('fd');
  expect(value).not.toHaveProperty('database');
  expect(value).not.toHaveProperty('cause');
  expect(value).not.toHaveProperty('stack');
  expect(value).not.toHaveProperty('errno');
};

describe('durable local host owner surface', () => {
  it('exposes exact frozen owner keys and frozen nested surfaces', () => {
    const owner = createOwner();
    expect(Object.keys(owner)).toEqual([...OWNER_KEYS]);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.diagnostics)).toBe(true);
    expect(Object.isFrozen(owner.host)).toBe(true);
    expect(Object.keys(owner.host)).toEqual([...LOCAL_HOST_KEYS]);
    expect(owner).not.toHaveProperty('closeMemory');
    expect(owner).not.toHaveProperty('releaseProcessLock');
    expect(owner).not.toHaveProperty('closeStorageRoot');
    expect(owner).not.toHaveProperty('root');
    expect(owner).not.toHaveProperty('path');
    expect(owner).not.toHaveProperty('fd');
    expect(owner).not.toHaveProperty('db');
    expect(owner).not.toHaveProperty('lock');
    expect(owner).not.toHaveProperty('pendingCleanup');
  });

  it('keeps copied close bound to original controller state', () => {
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost(), trackingResources(sequence));
    const copied = owner.close;
    const first = copied();
    expect(first.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    sequence.length = 0;
    const second = copied();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual([]);
  });

  it('close.call(fake) does not transfer ownership or change shutdown target', () => {
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost(), trackingResources(sequence));
    const fakeThis = {
      closeMemory: vi.fn(() => okResourceClose()),
      releaseProcessLock: vi.fn(() => okResourceClose()),
      closeStorageRoot: vi.fn(() => okResourceClose()),
    };
    const result = owner.close.call(fakeThis);
    expect(result.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    expect(fakeThis.closeMemory).not.toHaveBeenCalled();
    expect(fakeThis.releaseProcessLock).not.toHaveBeenCalled();
    expect(fakeThis.closeStorageRoot).not.toHaveBeenCalled();
  });

  it('diagnostics claim lifecycle only and deny real wiring', () => {
    const owner = createOwner();
    expect(owner.diagnostics).toEqual(DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS);
    expect(owner.diagnostics.ownerLifecycleImplemented).toBe(true);
    expect(owner.diagnostics.operationGateImplemented).toBe(true);
    expect(owner.diagnostics.orderedShutdownImplemented).toBe(true);
    expect(owner.diagnostics.retryableCloseImplemented).toBe(true);
    expect(owner.diagnostics.realPosixRootWired).toBe(false);
    expect(owner.diagnostics.realProcessLockWired).toBe(false);
    expect(owner.diagnostics.realSqliteMemoryWired).toBe(false);
    expect(owner.diagnostics.durableMemoryActive).toBe(false);
    expect(owner.diagnostics.cooperativeSecondInstanceProtectionActiveForDurableHost).toBe(false);
    expect(owner.diagnostics.processLockWiredToNeo).toBe(false);
    expect(owner.diagnostics.localHostProductionWired).toBe(false);
    expect(owner.diagnostics.systemdLayerConfigured).toBe(false);
    expect(owner.diagnostics.durableApprovalPort).toBe(false);
    expect(owner.diagnostics.durableAuditPort).toBe(false);
    expect(owner.diagnostics.secretProviderConfigured).toBe(false);
    expect(owner.diagnostics.encryptionEnabled).toBe(false);
    expect(owner.diagnostics.distributedFilesystemSupported).toBe(false);
    expect(owner.diagnostics.deploymentReady).toBe(false);
  });

  it('is not exported from public package or host barrel', () => {
    const indexSrc = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const hostBarrel = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8');
    const storageBarrel = readFileSync(
      new URL('../src/host/storage/index.ts', import.meta.url),
      'utf8',
    );
    expect(indexSrc).not.toMatch(/durable|createDurableLocalHostOwner/);
    expect(hostBarrel).not.toMatch(/durable|createDurableLocalHostOwner/);
    expect(storageBarrel).not.toMatch(/durable|createDurableLocalHostOwner/);
  });
});

describe('durable local host owner operation gate', () => {
  it('delegates sync seed while open and decrements before close can proceed', () => {
    const seed = vi.fn<LocalHost['seedLocalApprovalGrant']>(() => undefined);
    const sequence: Sequence = [];
    const owner = createOwner(
      fakeHost({ seedLocalApprovalGrant: seed }),
      trackingResources(sequence),
    );
    const access = authenticatedAccess();
    const grant = grantForCommand(writeCommand(), access);
    owner.host.seedLocalApprovalGrant(grant);
    expect(seed).toHaveBeenCalledTimes(1);
    const closed = owner.close();
    expect(closed.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('propagates sync delegate throw and still decrements active count', () => {
    const seed = vi.fn<LocalHost['seedLocalApprovalGrant']>(() => {
      throw new Error('seed boom');
    });
    const sequence: Sequence = [];
    const owner = createOwner(
      fakeHost({ seedLocalApprovalGrant: seed }),
      trackingResources(sequence),
    );
    expect(() => {
      owner.host.seedLocalApprovalGrant(grantForCommand(writeCommand(), authenticatedAccess()));
    }).toThrow(/seed boom/);
    const closed = owner.close();
    expect(closed.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('rejects new sync operations after close starts without calling delegate', () => {
    const seed = vi.fn<LocalHost['seedLocalApprovalGrant']>(() => undefined);
    const owner = createOwner(fakeHost({ seedLocalApprovalGrant: seed }));
    expect(owner.close().ok).toBe(true);
    expect(() => {
      owner.host.seedLocalApprovalGrant(grantForCommand(writeCommand(), authenticatedAccess()));
    }).toThrow(/closed/i);
    expect(seed).not.toHaveBeenCalled();
  });

  it('keeps active count for pending async ops and returns close-busy without resource closes', async () => {
    const pending = deferred<Result<MemoryWriteOutcome, MemoryWriteFailure>>();
    const writeMemory = vi.fn<LocalHost['writeMemory']>(() => pending.promise);
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));

    const inFlight = owner.host.writeMemory(authenticatedAccess(), writeCommand());
    const busy = owner.close();
    expect(busy.ok).toBe(false);
    if (busy.ok) return;
    expect(busy.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
    expect(busy.error.stage).toBe('operations');
    assertNoResourceLeak(busy.error);
    expect(sequence).toEqual([]);
    expect(writeMemory).toHaveBeenCalledTimes(1);

    const blocked = await owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('MEMORY_UNAVAILABLE');
    expect(writeMemory).toHaveBeenCalledTimes(1);

    pending.resolve(ok(okWriteOutcome()));
    await inFlight;

    const closed = owner.close();
    expect(closed.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('decrements on async rejection then allows retry close', async () => {
    const pending = deferred<Result<MemoryWriteOutcome, MemoryWriteFailure>>();
    const writeMemory = vi.fn<LocalHost['writeMemory']>(() => pending.promise);
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));

    const inFlight = owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(owner.close().ok).toBe(false);
    expect(sequence).toEqual([]);

    pending.reject(new Error('write failed'));
    await expect(inFlight).rejects.toThrow(/write failed/);

    const closed = owner.close();
    expect(closed.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('handles synchronous thenable.then throw without double decrement', () => {
    // PromiseLike edge case: then() throws synchronously before settle handlers attach.
    // @ts-expect-error intentional non-Promise thenable for gate decrement accounting
    const writeMemory: LocalHost['writeMemory'] = () => ({
      then: () => {
        throw new Error('then boom');
      },
    });
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));

    expect(() => {
      void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    }).toThrow(/then boom/);
    const closed = owner.close();
    expect(closed.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('rejects readMemory after close without increasing delegate call count', async () => {
    const readMemory = vi.fn<LocalHost['readMemory']>(() =>
      Promise.resolve(err({ code: 'VALIDATION_FAILED', reason: 'absent' })),
    );
    const owner = createOwner(fakeHost({ readMemory }));
    expect(owner.close().ok).toBe(true);
    const access = authenticatedAccess();
    const result = await owner.host.readMemory(access, {
      recordId: asRecordId('record-closed-read'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error).toMatchObject({ reason: 'Durable local host is closed.' });
    }
    expect(readMemory).not.toHaveBeenCalled();
  });
});

describe('durable local host owner shutdown order', () => {
  it('closes memory then process-lock then storage-root exactly once', () => {
    const sequence: Sequence = [];
    const owner = createOwner(fakeHost(), trackingResources(sequence));
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('memory failure blocks later stages and retries memory', async () => {
    const sequence: Sequence = [];
    let memoryFails = true;
    const owner = createOwner(
      fakeHost(),
      trackingResources(sequence, {
        memory: () => (memoryFails ? failResourceClose('memory busy') : okResourceClose()),
      }),
    );

    const first = owner.close();
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
      expect(first.error.stage).toBe('memory');
      assertNoResourceLeak(first.error);
    }
    expect(sequence).toEqual(['memory']);

    const blockedWrite = await owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(blockedWrite.ok).toBe(false);

    memoryFails = false;
    const second = owner.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'memory', 'process-lock', 'storage-root']);
  });

  it('lock failure after memory success retries lock without repeating memory', () => {
    const sequence: Sequence = [];
    let lockFails = true;
    const owner = createOwner(
      fakeHost(),
      trackingResources(sequence, {
        lock: () => (lockFails ? failResourceClose('lock busy') : okResourceClose()),
      }),
    );

    const first = owner.close();
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.stage).toBe('process-lock');
    expect(sequence).toEqual(['memory', 'process-lock']);

    lockFails = false;
    const second = owner.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'process-lock', 'storage-root']);
  });

  it('root failure after prior success retries only root', () => {
    const sequence: Sequence = [];
    let rootFails = true;
    const owner = createOwner(
      fakeHost(),
      trackingResources(sequence, {
        root: () => (rootFails ? failResourceClose('root busy') : okResourceClose()),
      }),
    );

    const first = owner.close();
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.stage).toBe('storage-root');
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);

    rootFails = false;
    const second = owner.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root', 'storage-root']);
  });

  it('maps thrown closers to stage failure without leaking raw cause and keeps retry', () => {
    const sequence: Sequence = [];
    let shouldThrow = true;
    const owner = createOwner(
      fakeHost(),
      trackingResources(sequence, {
        memory: () => {
          if (shouldThrow) throw new Error('ENOENT /var/lib/secret-db errno=2');
          return okResourceClose();
        },
      }),
    );

    const first = owner.close();
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
      expect(first.error.stage).toBe('memory');
      assertNoResourceLeak(first.error);
      expect(JSON.stringify(first.error)).not.toMatch(/ENOENT|secret-db|errno/i);
    }
    expect(sequence).toEqual(['memory']);

    shouldThrow = false;
    const second = owner.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'memory', 'process-lock', 'storage-root']);
  });

  it('never returns lifecycle to open after close starts', async () => {
    const sequence: Sequence = [];
    let memoryFails = true;
    const writeMemory = vi.fn<LocalHost['writeMemory']>(() =>
      Promise.resolve(ok(okWriteOutcome())),
    );
    const owner = createOwner(
      fakeHost({ writeMemory }),
      trackingResources(sequence, {
        memory: () => (memoryFails ? failResourceClose('fail') : okResourceClose()),
      }),
    );

    expect(owner.close().ok).toBe(false);
    const blocked = await owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(blocked.ok).toBe(false);
    expect(writeMemory).not.toHaveBeenCalled();

    memoryFails = false;
    expect(owner.close().ok).toBe(true);
    const stillBlocked = await owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(stillBlocked.ok).toBe(false);
    expect(writeMemory).not.toHaveBeenCalled();
  });
});

describe('durable local host owner non-reentrant shutdown', () => {
  const bindOwner = (
    build: (getOwner: () => DurableLocalHostOwner) => DurableLocalHostOwner,
  ): DurableLocalHostOwner => {
    const cell: { current?: DurableLocalHostOwner } = {};
    const created = build(() => {
      if (cell.current === undefined) throw new TypeError('owner not initialized');
      return cell.current;
    });
    cell.current = created;
    return created;
  };

  it('memory closer nested close is busy and each stage runs once', () => {
    const sequence: Sequence = [];
    let nested: Awaited<ReturnType<DurableLocalHostOwner['close']>> | undefined;
    const owner = bindOwner((getOwner) =>
      createDurableLocalHostOwner({
        host: fakeHost(),
        resources: {
          closeMemory: () => {
            sequence.push('memory');
            nested = getOwner().close();
            return okResourceClose();
          },
          releaseProcessLock: () => {
            sequence.push('process-lock');
            return okResourceClose();
          },
          closeStorageRoot: () => {
            sequence.push('storage-root');
            return okResourceClose();
          },
        },
      }),
    );

    const outer = owner.close();
    expect(outer.ok).toBe(true);
    expect(nested?.ok).toBe(false);
    if (nested && !nested.ok) {
      expect(nested.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
      expect(nested.error.stage).toBe('operations');
      assertNoResourceLeak(nested.error);
    }
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('process-lock closer nested close is busy and does not re-run lock or later stages alone', () => {
    const sequence: Sequence = [];
    let nested: Awaited<ReturnType<DurableLocalHostOwner['close']>> | undefined;
    const owner = bindOwner((getOwner) =>
      createDurableLocalHostOwner({
        host: fakeHost(),
        resources: {
          closeMemory: () => {
            sequence.push('memory');
            return okResourceClose();
          },
          releaseProcessLock: () => {
            sequence.push('process-lock');
            nested = getOwner().close();
            return okResourceClose();
          },
          closeStorageRoot: () => {
            sequence.push('storage-root');
            return okResourceClose();
          },
        },
      }),
    );

    expect(owner.close().ok).toBe(true);
    expect(nested?.ok).toBe(false);
    if (nested && !nested.ok) expect(nested.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('storage-root closer nested close is busy and root runs once', () => {
    const sequence: Sequence = [];
    let nested: Awaited<ReturnType<DurableLocalHostOwner['close']>> | undefined;
    const owner = bindOwner((getOwner) =>
      createDurableLocalHostOwner({
        host: fakeHost(),
        resources: {
          closeMemory: () => {
            sequence.push('memory');
            return okResourceClose();
          },
          releaseProcessLock: () => {
            sequence.push('process-lock');
            return okResourceClose();
          },
          closeStorageRoot: () => {
            sequence.push('storage-root');
            nested = getOwner().close();
            return okResourceClose();
          },
        },
      }),
    );

    expect(owner.close().ok).toBe(true);
    expect(nested?.ok).toBe(false);
    if (nested && !nested.ok) expect(nested.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('nested close then stage failure preserves cursor and retries only failed stage', () => {
    const sequence: Sequence = [];
    let nested: Awaited<ReturnType<DurableLocalHostOwner['close']>> | undefined;
    let shouldFail = true;
    const owner = bindOwner((getOwner) =>
      createDurableLocalHostOwner({
        host: fakeHost(),
        resources: {
          closeMemory: () => {
            sequence.push('memory');
            nested = getOwner().close();
            if (shouldFail) return failResourceClose('memory still busy');
            return okResourceClose();
          },
          releaseProcessLock: () => {
            sequence.push('process-lock');
            return okResourceClose();
          },
          closeStorageRoot: () => {
            sequence.push('storage-root');
            return okResourceClose();
          },
        },
      }),
    );

    const first = owner.close();
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
      expect(first.error.stage).toBe('memory');
    }
    expect(nested?.ok).toBe(false);
    if (nested && !nested.ok) expect(nested.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
    expect(sequence).toEqual(['memory']);

    shouldFail = false;
    const second = owner.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['memory', 'memory', 'process-lock', 'storage-root']);
  });

  it('copied close reentrancy during lock still yields busy without double lock', () => {
    const sequence: Sequence = [];
    let nested: Awaited<ReturnType<DurableLocalHostOwner['close']>> | undefined;
    const owner = bindOwner((getOwner) =>
      createDurableLocalHostOwner({
        host: fakeHost(),
        resources: {
          closeMemory: () => {
            sequence.push('memory');
            return okResourceClose();
          },
          releaseProcessLock: () => {
            sequence.push('process-lock');
            const copiedClose = getOwner().close;
            nested = copiedClose();
            return okResourceClose();
          },
          closeStorageRoot: () => {
            sequence.push('storage-root');
            return okResourceClose();
          },
        },
      }),
    );
    const copied = owner.close;
    expect(copied().ok).toBe(true);
    expect(nested && !nested.ok && nested.error.code === 'DURABLE_HOST_CLOSE_BUSY').toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });
});

describe('durable local host owner snapshotted closers', () => {
  it('ignores resources mutation after creation', () => {
    const sequence: Sequence = [];
    const replacement = {
      closeMemory: vi.fn(() => {
        sequence.push('replaced-memory');
        return okResourceClose();
      }),
      releaseProcessLock: vi.fn(() => {
        sequence.push('replaced-lock');
        return okResourceClose();
      }),
      closeStorageRoot: vi.fn(() => {
        sequence.push('replaced-root');
        return okResourceClose();
      }),
    };
    const resources = trackingResources(sequence);
    const owner = createDurableLocalHostOwner({ host: fakeHost(), resources });
    resources.closeMemory = replacement.closeMemory;
    resources.releaseProcessLock = replacement.releaseProcessLock;
    resources.closeStorageRoot = replacement.closeStorageRoot;

    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    expect(replacement.closeMemory).not.toHaveBeenCalled();
    expect(replacement.releaseProcessLock).not.toHaveBeenCalled();
    expect(replacement.closeStorageRoot).not.toHaveBeenCalled();
  });

  it('ignores resources mutation after close-busy while async op is active', async () => {
    const sequence: Sequence = [];
    const pending = deferred<Result<MemoryWriteOutcome, MemoryWriteFailure>>();
    const writeMemory = vi.fn<LocalHost['writeMemory']>(() => pending.promise);
    const replacementMemory = vi.fn(() => {
      sequence.push('replaced-memory');
      return okResourceClose();
    });
    const resources = trackingResources(sequence);
    const owner = createDurableLocalHostOwner({
      host: fakeHost({ writeMemory }),
      resources,
    });

    const inFlight = owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(owner.close().ok).toBe(false);
    resources.closeMemory = replacementMemory;
    resources.releaseProcessLock = () => {
      sequence.push('replaced-lock');
      return okResourceClose();
    };
    resources.closeStorageRoot = () => {
      sequence.push('replaced-root');
      return okResourceClose();
    };

    pending.resolve(ok(okWriteOutcome()));
    await inFlight;
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
    expect(replacementMemory).not.toHaveBeenCalled();
  });

  it('ignores resources mutation between stage failure and retry', () => {
    const sequence: Sequence = [];
    let lockFails = true;
    const resources = trackingResources(sequence, {
      lock: () => (lockFails ? failResourceClose('lock busy') : okResourceClose()),
    });
    const owner = createDurableLocalHostOwner({ host: fakeHost(), resources });
    expect(owner.close().ok).toBe(false);
    expect(sequence).toEqual(['memory', 'process-lock']);

    const replacedLock = vi.fn(() => {
      sequence.push('replaced-lock');
      return okResourceClose();
    });
    resources.releaseProcessLock = replacedLock;
    resources.closeMemory = () => {
      sequence.push('replaced-memory');
      return okResourceClose();
    };

    lockFails = false;
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'process-lock', 'storage-root']);
    expect(replacedLock).not.toHaveBeenCalled();
  });
});

describe('durable local host owner immutable failures', () => {
  it('freezes busy and stage failure payloads against field mutation', async () => {
    const pending = deferred<Result<MemoryWriteOutcome, MemoryWriteFailure>>();
    const owner = createOwner(fakeHost({ writeMemory: () => pending.promise }));
    void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    const busy = owner.close();
    expect(busy.ok).toBe(false);
    if (!busy.ok) {
      expect(Object.isFrozen(busy.error)).toBe(true);
      expect(busy.error).toEqual({
        code: 'DURABLE_HOST_CLOSE_BUSY',
        reason: 'Durable local host close is waiting for active operations.',
        stage: 'operations',
      });
      assertNoResourceLeak(busy.error);
      try {
        (busy.error as { code: string }).code = 'MUTATED';
        (busy.error as { stage: string }).stage = 'memory';
        (busy.error as { reason: string }).reason = 'leaked';
      } catch {
        // strict freeze may throw; either way values must remain original
      }
      expect(busy.error.code).toBe('DURABLE_HOST_CLOSE_BUSY');
      expect(busy.error.stage).toBe('operations');
      expect(busy.error.reason).toBe('Durable local host close is waiting for active operations.');
    }
    pending.resolve(ok(okWriteOutcome()));
    await Promise.resolve();

    const failing = createOwner(
      fakeHost(),
      trackingResources([], { memory: () => failResourceClose('x') }),
    );
    const failed = failing.close();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(Object.isFrozen(failed.error)).toBe(true);
      expect(failed.error).toEqual({
        code: 'DURABLE_HOST_CLOSE_FAILED',
        reason: 'Durable local host close failed at memory stage.',
        stage: 'memory',
      });
      assertNoResourceLeak(failed.error);
      try {
        (failed.error as { reason: string }).reason = '/var/lib/secret';
      } catch {
        // ignore
      }
      expect(failed.error.reason).toBe('Durable local host close failed at memory stage.');
    }
  });
});

describe('durable local host owner hostile thenables', () => {
  it('decrements once when then getter throws', () => {
    const sequence: Sequence = [];
    const writeMemory = (() => {
      const value = {};
      Object.defineProperty(value, 'then', {
        get(): never {
          throw new Error('then getter boom');
        },
      });
      return value;
    }) as unknown as LocalHost['writeMemory'];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));
    expect(() => {
      void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    }).toThrow(/then getter boom/);
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('decrements once when thenable resolves twice', () => {
    const sequence: Sequence = [];
    const writeMemory = (() => ({
      then: (onFulfilled?: ((value: unknown) => unknown) | null) => {
        onFulfilled?.(ok(okWriteOutcome()));
        onFulfilled?.(ok(okWriteOutcome()));
        return undefined;
      },
    })) as unknown as LocalHost['writeMemory'];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));
    void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('decrements once when thenable resolves then rejects', () => {
    const sequence: Sequence = [];
    const writeMemory = (() => ({
      then: (
        onFulfilled?: ((value: unknown) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => {
        onFulfilled?.(ok(okWriteOutcome()));
        try {
          onRejected?.(new Error('late reject'));
        } catch {
          // rejection handler may throw the reason; count must stay non-negative
        }
        return undefined;
      },
    })) as unknown as LocalHost['writeMemory'];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));
    void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });

  it('decrements once when thenable calls callback then throws', () => {
    const sequence: Sequence = [];
    const writeMemory = (() => ({
      then: (onFulfilled?: ((value: unknown) => unknown) | null) => {
        onFulfilled?.(ok(okWriteOutcome()));
        throw new Error('then after fulfill');
      },
    })) as unknown as LocalHost['writeMemory'];
    const owner = createOwner(fakeHost({ writeMemory }), trackingResources(sequence));
    expect(() => {
      void owner.host.writeMemory(authenticatedAccess(), writeCommand());
    }).toThrow(/then after fulfill/);
    expect(owner.close().ok).toBe(true);
    expect(sequence).toEqual(['memory', 'process-lock', 'storage-root']);
  });
});

describe('existing createLocalHost remains in-memory without durable side effects', () => {
  it('preserves LocalHost keys, diagnostics, and no close field', () => {
    const host = createLocalHost({ clock: fixedClock() });
    expect(Object.keys(host)).toEqual([...LOCAL_HOST_KEYS]);
    expect(host).not.toHaveProperty('close');
    expect(host.diagnostics).toEqual(LOCAL_HOST_DIAGNOSTICS);
    expect(Object.isFrozen(host)).toBe(true);
  });

  it('does not import native storage packages from durable owner module', () => {
    const ownerSrc = readFileSync(
      new URL('../src/host/durable/create-durable-local-host-owner.ts', import.meta.url),
      'utf8',
    );
    const failuresSrc = readFileSync(
      new URL('../src/host/durable/durable-local-host-owner-failures.ts', import.meta.url),
      'utf8',
    );
    const diagnosticsSrc = readFileSync(
      new URL('../src/host/durable/durable-local-host-owner-diagnostics.ts', import.meta.url),
      'utf8',
    );
    for (const src of [ownerSrc, failuresSrc, diagnosticsSrc]) {
      expect(src).not.toMatch(
        /better-sqlite3|fs-ext-extra-prebuilt|acquire-posix-process-lock|open-posix-storage-root|create-sqlite-memory-port/,
      );
      expect(src).not.toContain("from 'node:fs'");
      expect(src).not.toContain('from "node:fs"');
    }
  });
});
