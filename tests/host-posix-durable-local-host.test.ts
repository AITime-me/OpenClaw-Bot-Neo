/* eslint-disable @typescript-eslint/require-await -- test loaders return Promises without await */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../src/core/domain/index.js';
import type { MemoryPort } from '../src/core/ports/index.js';
import { createLocalHost } from '../src/host/create-local-host.js';
import { LOCAL_HOST_DIAGNOSTICS } from '../src/host/diagnostics.js';
import { createExplicitAllowMemoryPolicy } from '../src/host/in-memory/memory-policy.js';
import {
  createPosixDurableLocalHost,
  createPosixDurableLocalHostWithTestHooks,
  type CreatePosixDurableLocalHostInput,
  type PosixDurableLocalHostTestHooks,
} from '../src/host/durable/create-posix-durable-local-host.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';
import { DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS } from '../src/host/durable/durable-local-host-owner-diagnostics.js';
import { createDurableLocalHostOwner } from '../src/host/durable/create-durable-local-host-owner.js';
import type { StorageFailure } from '../src/host/storage/storage-failure.js';
import { asRecordId, authenticatedAccess, fixedClock, writeCommand } from './support/fixtures.js';

const OWNER_KEYS = ['host', 'diagnostics', 'close'] as const;
const LOCAL_HOST_KEYS = [
  'diagnostics',
  'writeMemory',
  'readMemory',
  'seedLocalApprovalGrant',
] as const;

const modelRouting = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    modelIdentifiersConfirmed: false,
    defaultProviderMode: 'subscription-oauth-only',
    apiFallbackEnabled: false,
    paidFallbackEnabled: false,
    routes: Object.freeze([
      Object.freeze({
        risk: 'low',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-low-risk',
        approval: 'policy-dependent',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'medium',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-restricted-tools',
        approval: 'required-for-external-or-write',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'high',
        capabilityTier: 'validated-high-assurance-tier',
        toolProfile: 'high-risk-no-elevated-tools',
        approval: 'owner-required',
        fallbackToWeakerTier: false,
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'untrusted-input',
        capabilityTier: 'validated-untrusted-content-tier',
        toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
        approval: 'owner-required-for-any-tool-expansion',
        onUnavailable: 'fail-closed',
      }),
    ]),
    onUnavailable: 'fail-closed',
  });

const memoryNamespaces = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultAccess: 'deny',
    namespaces: Object.freeze([
      'tvoe-vremya',
      'ai-my-time',
      'personal',
      'shared-public',
      'security-restricted',
    ]),
    activeNamespaceRequired: true,
    crossNamespaceAccess: false,
    crossProjectAccessRequiresOwnerApproval: true,
    securityRestrictedIsolated: true,
    personalIsolatedFromProjects: true,
    requiredMetadata: Object.freeze([
      'source',
      'observedAt',
      'confidence',
      'classification',
      'retentionClass',
    ]),
    embedding: Object.freeze({ mode: 'none', externalProviderEnabled: false }),
  });

const memoryClassification = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultClassification: 'security-restricted',
    classes: Object.freeze({
      public: Object.freeze({ externalProcessingAllowed: 'policy-dependent' }),
      internal: Object.freeze({ externalProcessingAllowed: false }),
      confidential: Object.freeze({ externalProcessingAllowed: false }),
      'commercial-secret': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
      'security-restricted': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
    }),
    sensitiveDataScan: Object.freeze({ required: true, failureEffect: 'deny' }),
  });

const securityPolicy = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultEffect: 'deny',
    readOnlyFirst: true,
    paymentActionsAllowed: false,
    externalWritesAllowed: false,
    ownerApproval: Object.freeze({
      required: true,
      bindToTargetAndPayload: true,
      expires: true,
      replayAllowed: false,
    }),
    sensitiveDataScanner: Object.freeze({
      requiredBeforeAllSinks: true,
      deterministic: true,
      failureEffect: 'deny',
    }),
    reverseTrustAllowed: false,
  });

const validConfig = () => ({
  modelRouting: modelRouting(),
  memoryNamespaces: memoryNamespaces(),
  memoryClassification: memoryClassification(),
  securityPolicy: securityPolicy(),
});

const validStorageBinding = () => ({
  platform: 'posix',
  storageRoot: '/var/lib/openclaw-neo/storage',
});

const validStoragePolicy = () => ({
  expectedUid: 1000,
  allowedModeBits: 0o700,
  repositoryRoot: '/opt/openclaw-neo',
});

const validInput = (): CreatePosixDurableLocalHostInput => ({
  config: validConfig(),
  host: { clock: fixedClock(), policy: createExplicitAllowMemoryPolicy() },
  storageBinding: validStorageBinding(),
  storagePolicy: validStoragePolicy(),
});

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

const hostileOkGetter = (): unknown => {
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, 'ok', {
    get(): never {
      throw new Error('secret-hostile-ok');
    },
    enumerable: true,
  });
  return value;
};

const hostileOkProxy = (): unknown =>
  new Proxy(
    {},
    {
      get(): never {
        throw new Error('secret-proxy-ok');
      },
    },
  );

const revokedOkProxy = (): unknown => {
  const { proxy, revoke } = Proxy.revocable({ ok: true }, {});
  revoke();
  return proxy;
};

type Sequence = string[];

const fakeMemoryPort = (): MemoryPort => ({
  query: () => Promise.resolve(ok([])),
  read: () => Promise.resolve(err({ code: 'VALIDATION_FAILED', reason: 'missing' })),
  write: () => Promise.resolve(ok(asRecordId('record-sqlite-1'))),
  delete: () => Promise.resolve(ok(undefined)),
});

const okStorage = <T>(value: T): Result<T, StorageFailure> => ok(value);
const failStorage = (code: StorageFailure['code'], reason: string): Result<never, StorageFailure> =>
  err({ code, reason });

const createFakeRoot = (sequence: Sequence, closeImpl?: () => Result<void, StorageFailure>) => {
  let closed = false;
  return {
    plan: Object.freeze({}),
    policy: Object.freeze({}),
    diagnostics: Object.freeze({}),
    close: (): Result<void, StorageFailure> => {
      if (closeImpl) return closeImpl();
      sequence.push('root-close');
      if (closed) return okStorage(undefined);
      closed = true;
      return okStorage(undefined);
    },
  };
};

const createFakeLock = (sequence: Sequence, releaseImpl?: () => Result<void, StorageFailure>) => {
  let released = false;
  return {
    diagnostics: Object.freeze({}),
    release: (): Result<void, StorageFailure> => {
      if (releaseImpl) return releaseImpl();
      sequence.push('lock-release');
      if (released) return okStorage(undefined);
      released = true;
      return okStorage(undefined);
    },
  };
};

const createFakeSqlite = (
  sequence: Sequence,
  closeImpl?: () => Result<void, StorageFailure>,
  memory: MemoryPort = fakeMemoryPort(),
) => {
  let closed = false;
  return {
    memory,
    diagnostics: Object.freeze({}),
    close: (): Result<void, StorageFailure> => {
      if (closeImpl) return closeImpl();
      sequence.push('sqlite-close');
      if (closed) return okStorage(undefined);
      closed = true;
      return okStorage(undefined);
    },
  };
};

const successHooks = (sequence: Sequence = []): PosixDurableLocalHostTestHooks => {
  const root = createFakeRoot(sequence);
  const lock = createFakeLock(sequence);
  const sqlite = createFakeSqlite(sequence);
  return {
    getPlatform: () => 'linux',
    loadRootFactory: async () => {
      sequence.push('load-root');
      return {
        openPosixStorageRoot: () => {
          sequence.push('open-root');
          return okStorage(root);
        },
      };
    },
    loadProcessLockFactory: async () => {
      sequence.push('load-lock');
      return {
        acquirePosixProcessLock: () => {
          sequence.push('acquire-lock');
          return okStorage(lock);
        },
      };
    },
    loadSqliteFactory: async () => {
      sequence.push('load-sqlite');
      return {
        createSqliteMemoryPort: () => {
          sequence.push('open-sqlite');
          return okStorage(sqlite);
        },
      };
    },
  };
};

describe('POSIX durable LocalHost composition — platform and loading', () => {
  it('fail-closed on non-Linux without invoking resource loaders', async () => {
    const sequence: Sequence = [];
    const loadRoot = vi.fn(async () => {
      sequence.push('load-root');
      return { openPosixStorageRoot: () => okStorage(createFakeRoot(sequence)) };
    });
    const loadLock = vi.fn(async () => {
      sequence.push('load-lock');
      return { acquirePosixProcessLock: () => okStorage(createFakeLock(sequence)) };
    });
    const loadSqlite = vi.fn(async () => {
      sequence.push('load-sqlite');
      return { createSqliteMemoryPort: () => okStorage(createFakeSqlite(sequence)) };
    });
    const assemble = vi.fn();
    const createOwner = vi.fn();

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'win32',
      loadRootFactory: loadRoot,
      loadProcessLockFactory: loadLock,
      loadSqliteFactory: loadSqlite,
      assembleLocalHost: assemble,
      createOwner,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_UNAVAILABLE');
    expect(loadRoot).not.toHaveBeenCalled();
    expect(loadLock).not.toHaveBeenCalled();
    expect(loadSqlite).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
    expect(createOwner).not.toHaveBeenCalled();
    expect(sequence).toEqual([]);
    assertNoResourceLeak(result.error);
  });

  it('loads factories in exact Linux order: root → lock → SQLite', async () => {
    const sequence: Sequence = [];
    const result = await createPosixDurableLocalHostWithTestHooks(
      validInput(),
      successHooks(sequence),
    );
    expect(result.ok).toBe(true);
    expect(sequence).toEqual([
      'load-root',
      'open-root',
      'load-lock',
      'acquire-lock',
      'load-sqlite',
      'open-sqlite',
    ]);
  });

  it('does not call SQLite loader when lock is held', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const loadSqlite = vi.fn(async () => {
      sequence.push('load-sqlite');
      return { createSqliteMemoryPort: () => okStorage(createFakeSqlite(sequence)) };
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => {
        sequence.push('load-root');
        return {
          openPosixStorageRoot: () => {
            sequence.push('open-root');
            return okStorage(root);
          },
        };
      },
      loadProcessLockFactory: async () => {
        sequence.push('load-lock');
        return {
          acquirePosixProcessLock: () => {
            sequence.push('acquire-lock');
            return err({
              code: 'STORAGE_LOCK_HELD',
              reason: 'Exclusive process lock is already held.',
            });
          },
        };
      },
      loadSqliteFactory: loadSqlite,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_LOCK_HELD');
    expect(loadSqlite).not.toHaveBeenCalled();
    expect(sequence).toEqual(['load-root', 'open-root', 'load-lock', 'acquire-lock', 'root-close']);
  });
});

describe('POSIX durable LocalHost composition — pure validation', () => {
  it('rejects invalid config without loaders', async () => {
    const loadRoot = vi.fn();
    const result = await createPosixDurableLocalHostWithTestHooks(
      { ...validInput(), config: { nope: true } },
      { getPlatform: () => 'linux', loadRootFactory: loadRoot },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_UNAVAILABLE');
    expect(loadRoot).not.toHaveBeenCalled();
  });

  it('rejects invalid host input without loaders', async () => {
    const loadRoot = vi.fn();
    const result = await createPosixDurableLocalHostWithTestHooks(
      { ...validInput(), host: { clock: null as never } },
      { getPlatform: () => 'linux', loadRootFactory: loadRoot },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_UNAVAILABLE');
    expect(loadRoot).not.toHaveBeenCalled();
  });
});

describe('POSIX durable LocalHost composition — startup success', () => {
  it('returns frozen owner with durable host and composition diagnostics', async () => {
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), successHooks());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const owner = result.value;
    expect(Object.keys(owner)).toEqual([...OWNER_KEYS]);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.diagnostics)).toBe(true);
    expect(Object.isFrozen(owner.host)).toBe(true);
    expect(Object.keys(owner.host)).toEqual([...LOCAL_HOST_KEYS]);
    expect(owner.diagnostics).toEqual(POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS);
    expect(owner.host.diagnostics.storage).toBe('sqlite-local');
    expect(owner).not.toHaveProperty('root');
    expect(owner).not.toHaveProperty('lock');
    expect(owner).not.toHaveProperty('sqlite');
  });

  it('delegates durable memory write to injected SQLite MemoryPort', async () => {
    const sequence: Sequence = [];
    const memory = fakeMemoryPort();
    const writeSpy = vi.spyOn(memory, 'write');
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence, undefined, memory);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.value.host.writeMemory(
      authenticatedAccess(),
      writeCommand({ recordId: 'record-sqlite-1' }),
    );
    expect(writeSpy).toHaveBeenCalled();
  });

  it('closes owner resources in exact order SQLite → lock → root', async () => {
    const sequence: Sequence = [];
    const result = await createPosixDurableLocalHostWithTestHooks(
      validInput(),
      successHooks(sequence),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.close().ok).toBe(true);
    expect(sequence.filter((s) => s.endsWith('close') || s.endsWith('release'))).toEqual([
      'sqlite-close',
      'lock-release',
      'root-close',
    ]);
  });
});

describe('POSIX durable LocalHost composition — diagnostics honesty', () => {
  it('sets real wiring flags true and records B3C4 Linux validation without deployment claims', async () => {
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), successHooks());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.value.diagnostics;
    expect(d.realPosixRootWired).toBe(true);
    expect(d.realProcessLockWired).toBe(true);
    expect(d.realSqliteMemoryWired).toBe(true);
    expect(d.durableMemoryActive).toBe(true);
    expect(d.processLockWiredToDurableComposition).toBe(true);
    expect(d.cooperativeSecondInstanceProtectionActiveForDurableHost).toBe(true);
    expect(d.processLockWiredToNeo).toBe(false);
    expect(d.neoSecondInstanceProtectionActive).toBe(false);
    expect(d.linuxIntegrationValidatedForCompleteDurableComposition).toBe(true);
    expect(d.systemdLayerConfigured).toBe(false);
    expect(d.durableApprovalPort).toBe(false);
    expect(d.durableAuditPort).toBe(false);
    expect(d.deploymentReady).toBe(false);
    expect(d.securityApprovalComplete).toBe(false);
  });

  it('keeps deployment and security approval false on the frozen composition diagnostics constant', () => {
    const d = POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS;
    expect(d.linuxIntegrationValidatedForCompleteDurableComposition).toBe(true);
    expect(d.deploymentReady).toBe(false);
    expect(d.securityApprovalComplete).toBe(false);
    expect(d.systemdLayerConfigured).toBe(false);
    expect(d.processLockWiredToNeo).toBe(false);
    expect(d.neoSecondInstanceProtectionActive).toBe(false);
    expect(d.durableApprovalPort).toBe(false);
    expect(d.durableAuditPort).toBe(false);
    expect(d.secretProviderConfigured).toBe(false);
    expect(d.encryptionEnabled).toBe(false);
    expect(d.crossPortTransactions).toBe(false);
  });

  it('does not inflate B3C1 fake owner diagnostics', () => {
    expect(DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS.realPosixRootWired).toBe(false);
    expect(DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS.realProcessLockWired).toBe(false);
    expect(DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS.realSqliteMemoryWired).toBe(false);
    expect(DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS.durableMemoryActive).toBe(false);
  });

  it('ignores caller attempts to replace composition diagnostics via hooks', async () => {
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      ...successHooks(),
      createOwner: (input) => {
        const owner = createDurableLocalHostOwner(input);
        return Object.freeze({
          ...owner,
          diagnostics: {
            ...DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS,
            deploymentReady: true as false,
            processLockWiredToNeo: true as false,
          },
        });
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.deploymentReady).toBe(false);
    expect(result.value.diagnostics.processLockWiredToNeo).toBe(false);
    expect(result.value.diagnostics).toBe(POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS);
  });
});

describe('POSIX durable LocalHost composition — startup failures and rollback', () => {
  it('maps root open ordinary failure without cleanup controller', async () => {
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({
        openPosixStorageRoot: () =>
          err({ code: 'STORAGE_ROOT_MISSING', reason: 'Storage root is missing.' }),
      }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () => {
          throw new Error('lock must not run');
        },
      }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw new Error('sqlite must not run');
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(result).not.toHaveProperty('pendingCleanup');
  });

  it('lock held closes root and never opens SQLite', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const loadSqlite = vi.fn(async () => ({
      createSqliteMemoryPort: () => okStorage(createFakeSqlite(sequence)),
    }));
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () =>
          err({ code: 'STORAGE_LOCK_HELD', reason: 'Exclusive process lock is already held.' }),
      }),
      loadSqliteFactory: loadSqlite,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_LOCK_HELD');
    expect(loadSqlite).not.toHaveBeenCalled();
    expect(sequence).toContain('root-close');
  });

  it('lock failure + root close failure preserves BOOTSTRAP_FAILED after terminal cleanup', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts === 1)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () =>
          err({ code: 'STORAGE_LOCK_UNAVAILABLE', reason: 'lock unavailable' }),
      }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw new Error('sqlite must not run');
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED');
    const copied = result.pendingCleanup.retry;
    const terminal = copied.call({ fake: true });
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(rootAttempts).toBe(2);
    const again = result.pendingCleanup.retry();
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(again).not.toHaveProperty('pendingCleanup');
  });

  it('lock-held + deferred root cleanup preserves LOCK_HELD after terminal cleanup', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts === 1)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    });
    const loadSqlite = vi.fn(async () => ({
      createSqliteMemoryPort: () => okStorage(createFakeSqlite(sequence)),
    }));

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () =>
          err({ code: 'STORAGE_LOCK_HELD', reason: 'Exclusive process lock is already held.' }),
      }),
      loadSqliteFactory: loadSqlite,
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED');
    expect(Object.isFrozen(result.pendingCleanup)).toBe(true);
    expect(loadSqlite).not.toHaveBeenCalled();
    expect(rootAttempts).toBe(1);

    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_COMPOSITION_LOCK_HELD');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(loadSqlite).not.toHaveBeenCalled();
    expect(rootAttempts).toBe(2);
    assertNoResourceLeak(terminal.error);

    const again = result.pendingCleanup.retry();
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('DURABLE_COMPOSITION_LOCK_HELD');
    expect(again).not.toHaveProperty('pendingCleanup');
    expect(rootAttempts).toBe(2);
  });

  it('lock acquisition OwnershipError retains pending cleanup before root close', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    let lockCleanupAttempts = 0;
    const pendingRetry = (): Result<void, StorageFailure> => {
      lockCleanupAttempts += 1;
      sequence.push('lock-pending');
      if (lockCleanupAttempts < 2)
        return failStorage(
          'STORAGE_LOCK_RELEASE_FAILED',
          'Failed to release exclusive process lock.',
        );
      return okStorage(undefined);
    };

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () => {
          throw Object.assign(new Error('ownership'), {
            pendingCleanup: { retryRelease: pendingRetry },
          });
        },
      }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw new Error('sqlite must not run');
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(sequence).not.toContain('root-close');
    const first = result.pendingCleanup.retry();
    expect(first.ok).toBe(false);
    expect('pendingCleanup' in first).toBe(true);
    expect(sequence).not.toContain('root-close');
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence).toContain('root-close');
  });

  it('SQLite ordinary failure releases lock then closes root', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () =>
          err({ code: 'SQLITE_OPEN_FAILED', reason: 'SQLite database open failed.' }),
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(sequence).toEqual(['lock-release', 'root-close']);
  });

  it('SQLite ownership failure retains sqlite/lock/root until cleanup succeeds', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    let sqliteCleanupAttempts = 0;
    const pendingRetry = (): Result<void, StorageFailure> => {
      sqliteCleanupAttempts += 1;
      sequence.push('sqlite-pending');
      if (sqliteCleanupAttempts < 2)
        return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite memory database.');
      return okStorage(undefined);
    };

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw Object.assign(new Error('ownership'), {
            pendingCleanup: { retryClose: pendingRetry },
          });
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(sequence).not.toContain('lock-release');
    const first = result.pendingCleanup.retry();
    expect(first.ok).toBe(false);
    expect('pendingCleanup' in first).toBe(true);
    expect(sequence).not.toContain('lock-release');
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence).toEqual(['sqlite-pending', 'sqlite-pending', 'lock-release', 'root-close']);
    const again = result.pendingCleanup.retry();
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
  });

  it('SQLite cleanup retry failure then success preserves order', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    let sqliteCloseAttempts = 0;
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteCloseAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteCloseAttempts === 1)
        return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite memory database.');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly boom');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(0);
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_COMPOSITION_ASSEMBLY_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(
      sequence.filter((s) => s === 'sqlite-close' || s === 'lock-release' || s === 'root-close'),
    ).toEqual(['sqlite-close', 'sqlite-close', 'lock-release', 'root-close']);
  });

  it('lock rollback failure then retry does not close root early', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    let lockReleaseAttempts = 0;
    const lock = createFakeLock(sequence, () => {
      lockReleaseAttempts += 1;
      sequence.push('lock-release');
      if (lockReleaseAttempts === 1)
        return failStorage(
          'STORAGE_LOCK_RELEASE_FAILED',
          'Failed to release exclusive process lock.',
        );
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () =>
          err({ code: 'SQLITE_OPEN_FAILED', reason: 'SQLite database open failed.' }),
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(sequence).not.toContain('root-close');
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence.filter((s) => s === 'lock-release' || s === 'root-close')).toEqual([
      'lock-release',
      'lock-release',
      'root-close',
    ]);
  });

  it('root rollback failure then retry is idempotent after success', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts === 1)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    });
    const lock = createFakeLock(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () =>
          err({ code: 'SQLITE_OPEN_FAILED', reason: 'SQLite database open failed.' }),
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    const again = result.pendingCleanup.retry();
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('DURABLE_STORAGE_BOOTSTRAP_FAILED');
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(2);
  });

  it('host assembly throw rolls back SQLite → lock → root', async () => {
    const sequence: Sequence = [];
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      ...successHooks(sequence),
      assembleLocalHost: () => {
        throw new Error('assemble failed');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_ASSEMBLY_FAILED');
    expect(sequence.filter((s) => s.endsWith('close') || s.endsWith('release'))).toEqual([
      'sqlite-close',
      'lock-release',
      'root-close',
    ]);
  });

  it('owner construction throw rolls back all resources', async () => {
    const sequence: Sequence = [];
    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      ...successHooks(sequence),
      createOwner: () => {
        throw new Error('owner boom');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DURABLE_COMPOSITION_ASSEMBLY_FAILED');
    expect(sequence.filter((s) => s.endsWith('close') || s.endsWith('release'))).toEqual([
      'sqlite-close',
      'lock-release',
      'root-close',
    ]);
  });

  it('dual cleanup failures retry exact failed stage without repeating success', async () => {
    const sequence: Sequence = [];
    let sqliteAttempts = 0;
    let lockAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence, () => {
      lockAttempts += 1;
      sequence.push('lock-release');
      if (lockAttempts === 1)
        return failStorage(
          'STORAGE_LOCK_RELEASE_FAILED',
          'Failed to release exclusive process lock.',
        );
      return okStorage(undefined);
    });
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteAttempts === 1)
        return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite memory database.');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assemble failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
    const mid = result.pendingCleanup.retry();
    expect(mid.ok).toBe(false);
    expect('pendingCleanup' in mid).toBe(true);
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(2);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(0);
    const terminal = result.pendingCleanup.retry();
    expect(terminal.ok).toBe(false);
    expect(terminal.error.code).toBe('DURABLE_COMPOSITION_ASSEMBLY_FAILED');
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(2);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(2);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(1);
  });
});

describe('POSIX durable LocalHost composition — startup cleanup reentrancy', () => {
  type PendingCleanup =
    import('../src/host/durable/posix-durable-local-host-composition-failures.js').PosixDurableCompositionPendingCleanup;

  it('nested sqlite cleanup retry is stable and does not double sqlite or advance stages', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    let sqliteCloseCalls = 0;
    const nestedResults: unknown[] = [];
    const pendingCell: { current?: PendingCleanup } = {};
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteCloseCalls += 1;
      sequence.push('sqlite-close');
      if (pendingCell.current !== undefined) {
        nestedResults.push(pendingCell.current.retry());
        nestedResults.push(pendingCell.current.retry());
      }
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    pendingCell.current = result.pendingCleanup;
    const outer = result.pendingCleanup.retry();
    expect(outer).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(outer).not.toHaveProperty('pendingCleanup');
    expect(sqliteCloseCalls).toBe(1);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(1);
    for (const nested of nestedResults) {
      expect(nested).toMatchObject({
        ok: false,
        error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'sqlite' },
      });
    }
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
  });

  it('nested process-lock cleanup retry does not double lock or invoke root', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    let lockReleaseCalls = 0;
    const nestedResults: unknown[] = [];
    const pendingCell: { current?: PendingCleanup } = {};
    const lock = createFakeLock(sequence, () => {
      lockReleaseCalls += 1;
      sequence.push('lock-release');
      if (pendingCell.current !== undefined) nestedResults.push(pendingCell.current.retry());
      return okStorage(undefined);
    });
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    pendingCell.current = result.pendingCleanup;
    const outer = result.pendingCleanup.retry();
    expect(outer).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(lockReleaseCalls).toBe(1);
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(1);
    for (const nested of nestedResults) {
      expect(nested).toMatchObject({
        ok: false,
        error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'process-lock' },
      });
    }
  });

  it('nested storage-root cleanup retry does not double root and returns terminal only outer', async () => {
    const sequence: Sequence = [];
    let rootCloseCalls = 0;
    const nestedResults: unknown[] = [];
    const pendingCell: { current?: PendingCleanup } = {};
    const root = createFakeRoot(sequence, () => {
      rootCloseCalls += 1;
      sequence.push('root-close');
      if (pendingCell.current !== undefined) nestedResults.push(pendingCell.current.retry());
      return okStorage(undefined);
    });
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    pendingCell.current = result.pendingCleanup;
    const outer = result.pendingCleanup.retry();
    expect(outer).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(rootCloseCalls).toBe(1);
    for (const nested of nestedResults) {
      expect(nested).toMatchObject({
        ok: false,
        error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'storage-root' },
      });
    }
    const again = result.pendingCleanup.retry();
    expect(again).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(rootCloseCalls).toBe(1);
  });

  it('nested retry during sqlite cleanup failure preserves stage and primary failure', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    let sqliteCleanupAttempts = 0;
    const pendingCell: { current?: PendingCleanup } = {};
    const pendingRetry = (): Result<void, StorageFailure> => {
      sqliteCleanupAttempts += 1;
      sequence.push('sqlite-pending');
      if (sqliteCleanupAttempts === 1 && pendingCell.current !== undefined) {
        pendingCell.current.retry();
      }
      if (sqliteCleanupAttempts === 1) return null as unknown as Result<void, StorageFailure>;
      return okStorage(undefined);
    };

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw Object.assign(new Error('ownership'), {
            pendingCleanup: { retryClose: pendingRetry },
          });
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    pendingCell.current = result.pendingCleanup;
    expect(sequence).not.toContain('lock-release');
    const first = result.pendingCleanup.retry();
    expect(first.ok).toBe(false);
    expect('pendingCleanup' in first).toBe(true);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(0);
    expect(sqliteCleanupAttempts).toBe(1);

    const terminal = result.pendingCleanup.retry();
    expect(terminal).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_STORAGE_BOOTSTRAP_FAILED' },
    });
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence).toEqual(['sqlite-pending', 'sqlite-pending', 'lock-release', 'root-close']);
  });
});

describe('POSIX durable LocalHost composition — startup cleanup hostile results', () => {
  it('sqlite hostile cleanup returns ownership-required without throw and preserves stage', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    let sqliteCleanupAttempts = 0;
    const pendingRetry = (): Result<void, StorageFailure> => {
      sqliteCleanupAttempts += 1;
      sequence.push('sqlite-pending');
      if (sqliteCleanupAttempts === 1) return hostileOkGetter() as Result<void, StorageFailure>;
      return okStorage(undefined);
    };

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw Object.assign(new Error('ownership'), {
            pendingCleanup: { retryClose: pendingRetry },
          });
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const first = result.pendingCleanup.retry();
    expect(() => first).not.toThrow();
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'sqlite' },
    });
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(0);
    assertNoResourceLeak(first);

    const terminal = result.pendingCleanup.retry();
    expect(terminal).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_STORAGE_BOOTSTRAP_FAILED' },
    });
    expect(terminal).not.toHaveProperty('pendingCleanup');
    expect(sequence).toEqual(['sqlite-pending', 'sqlite-pending', 'lock-release', 'root-close']);
  });

  it('process-lock hostile cleanup returns ownership-required without advancing to root', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    let lockHostilePasses = 2;
    const lock = createFakeLock(sequence, () => {
      sequence.push('lock-release');
      if (lockHostilePasses > 0) {
        lockHostilePasses -= 1;
        return hostileOkProxy() as Result<void, StorageFailure>;
      }
      return okStorage(undefined);
    });
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const first = result.pendingCleanup.retry();
    expect(() => first).not.toThrow();
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'process-lock' },
    });
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(0);

    const terminal = result.pendingCleanup.retry();
    expect(terminal).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(1);
  });

  it('storage-root hostile cleanup returns ownership-required and retries same stage', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts <= 2) return revokedOkProxy() as Result<void, StorageFailure>;
      return okStorage(undefined);
    });
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const first = result.pendingCleanup.retry();
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'storage-root' },
    });
    expect(rootAttempts).toBe(2);

    const terminal = result.pendingCleanup.retry();
    expect(terminal).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(rootAttempts).toBe(3);
  });

  it('preserves stage order across hostile sqlite then hostile lock before terminal cleanup', async () => {
    const sequence: Sequence = [];
    const root = createFakeRoot(sequence);
    let sqliteAttempts = 0;
    let lockAttempts = 0;
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteAttempts === 1) return hostileOkGetter() as Result<void, StorageFailure>;
      return okStorage(undefined);
    });
    const lock = createFakeLock(sequence, () => {
      lockAttempts += 1;
      sequence.push('lock-release');
      if (lockAttempts === 1) return hostileOkProxy() as Result<void, StorageFailure>;
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
      assembleLocalHost: () => {
        throw new Error('assembly failed');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const sqliteRetry = result.pendingCleanup.retry();
    expect(sqliteRetry).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED', stage: 'process-lock' },
    });
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(2);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(0);

    const lockRetry = result.pendingCleanup.retry();
    expect(lockRetry).toMatchObject({
      ok: false,
      error: { code: 'DURABLE_COMPOSITION_ASSEMBLY_FAILED' },
    });
    expect(lockRetry).not.toHaveProperty('pendingCleanup');
    expect(sequence).toEqual([
      'sqlite-close',
      'sqlite-close',
      'lock-release',
      'lock-release',
      'root-close',
    ]);
  });
});

describe('POSIX durable LocalHost composition — terminal failure immutability', () => {
  it('freezes stored terminal ordinary failure against mutation and idempotent retry', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts === 1)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({
        acquirePosixProcessLock: () =>
          err({ code: 'STORAGE_LOCK_UNAVAILABLE', reason: 'lock unavailable' }),
      }),
      loadSqliteFactory: async () => ({
        createSqliteMemoryPort: () => {
          throw new Error('sqlite must not run');
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || !('pendingCleanup' in result)) return;
    const copiedRetry = result.pendingCleanup.retry;
    const terminal = copiedRetry.call({ fake: true });
    expect(terminal.ok).toBe(false);
    expect(Object.isFrozen(terminal)).toBe(true);
    expect(Object.isFrozen((terminal as { error: object }).error)).toBe(true);
    const terminalError = (terminal as { error: { code: string; reason: string } }).error;
    const originalCode = terminalError.code;
    const originalReason = terminalError.reason;
    try {
      (terminalError as { code: string }).code = 'MUTATED';
      (terminalError as { reason: string }).reason = 'leaked /var/lib/secret';
      (terminalError as { stage?: string }).stage = 'sqlite';
    } catch {
      // strict freeze may throw
    }
    expect(terminalError.code).toBe(originalCode);
    expect(terminalError.reason).toBe(originalReason);
    assertNoResourceLeak(terminalError);

    const again = result.pendingCleanup.retry();
    expect(again).toEqual(terminal);
    expect(again).not.toHaveProperty('pendingCleanup');
  });
});

describe('POSIX durable LocalHost composition — owner.close adapter retries', () => {
  it('retries SQLite closer before lock/root and is idempotent after success', async () => {
    const sequence: Sequence = [];
    let sqliteAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteAttempts === 1)
        return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite memory database.');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
    expect(first.error.stage).toBe('memory');
    expect(sequence).toEqual(['sqlite-close']);

    const second = result.value.close();
    expect(second.ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'sqlite-close', 'lock-release', 'root-close']);

    expect(result.value.close().ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'sqlite-close', 'lock-release', 'root-close']);
  });

  it('retries process-lock release without repeating SQLite close', async () => {
    const sequence: Sequence = [];
    let lockAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence, () => {
      lockAttempts += 1;
      sequence.push('lock-release');
      if (lockAttempts === 1)
        return failStorage(
          'STORAGE_LOCK_RELEASE_FAILED',
          'Failed to release exclusive process lock.',
        );
      return okStorage(undefined);
    });
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.stage).toBe('process-lock');
    expect(sequence).toEqual(['sqlite-close', 'lock-release']);

    expect(result.value.close().ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'lock-release', 'lock-release', 'root-close']);
    expect(result.value.close().ok).toBe(true);
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
  });

  it('retries root close without repeating SQLite or lock', async () => {
    const sequence: Sequence = [];
    let rootAttempts = 0;
    const root = createFakeRoot(sequence, () => {
      rootAttempts += 1;
      sequence.push('root-close');
      if (rootAttempts === 1)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    });
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.stage).toBe('storage-root');
    expect(sequence).toEqual(['sqlite-close', 'lock-release', 'root-close']);

    expect(result.value.close().ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'lock-release', 'root-close', 'root-close']);
    expect(result.value.close().ok).toBe(true);
    expect(sequence.filter((s) => s === 'sqlite-close')).toHaveLength(1);
    expect(sequence.filter((s) => s === 'lock-release')).toHaveLength(1);
  });

  it('maps thrown handle close to redacted stage failure and retries same stage', async () => {
    const sequence: Sequence = [];
    let sqliteAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteAttempts === 1) throw new Error('raw fd errno EIO /var/lib/openclaw-neo');
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
    expect(first.error.stage).toBe('memory');
    assertNoResourceLeak(first.error);
    expect(sequence).toEqual(['sqlite-close']);

    expect(result.value.close().ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'sqlite-close', 'lock-release', 'root-close']);
  });

  it('maps hostile sqlite handle close to stage failure without releasing lock or root', async () => {
    const sequence: Sequence = [];
    let sqliteAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence);
    const sqlite = createFakeSqlite(sequence, () => {
      sqliteAttempts += 1;
      sequence.push('sqlite-close');
      if (sqliteAttempts === 1) return hostileOkGetter() as Result<void, StorageFailure>;
      return okStorage(undefined);
    });

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(() => first).not.toThrow();
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('DURABLE_HOST_CLOSE_FAILED');
      expect(first.error.stage).toBe('memory');
      assertNoResourceLeak(first.error);
      expect(JSON.stringify(first.error)).not.toMatch(/secret-hostile/i);
    }
    expect(sequence).toEqual(['sqlite-close']);

    expect(result.value.close().ok).toBe(true);
    expect(sequence).toEqual(['sqlite-close', 'sqlite-close', 'lock-release', 'root-close']);
  });

  it('maps hostile lock release to stage failure without closing root', async () => {
    const sequence: Sequence = [];
    let lockAttempts = 0;
    const root = createFakeRoot(sequence);
    const lock = createFakeLock(sequence, () => {
      lockAttempts += 1;
      sequence.push('lock-release');
      if (lockAttempts === 1) return hostileOkProxy() as Result<void, StorageFailure>;
      return okStorage(undefined);
    });
    const sqlite = createFakeSqlite(sequence);

    const result = await createPosixDurableLocalHostWithTestHooks(validInput(), {
      getPlatform: () => 'linux',
      loadRootFactory: async () => ({ openPosixStorageRoot: () => okStorage(root) }),
      loadProcessLockFactory: async () => ({ acquirePosixProcessLock: () => okStorage(lock) }),
      loadSqliteFactory: async () => ({ createSqliteMemoryPort: () => okStorage(sqlite) }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.value.close();
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.stage).toBe('process-lock');
    expect(sequence).toEqual(['sqlite-close', 'lock-release']);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(0);

    expect(result.value.close().ok).toBe(true);
    expect(sequence.filter((s) => s === 'root-close')).toHaveLength(1);
  });
});

describe('POSIX durable LocalHost composition — LocalHost regression', () => {
  it('keeps createLocalHost in-memory with unchanged keys and diagnostics', () => {
    const host = createLocalHost({ clock: fixedClock() });
    expect(Object.keys(host)).toEqual([...LOCAL_HOST_KEYS]);
    expect(host.diagnostics).toEqual(LOCAL_HOST_DIAGNOSTICS);
    expect(host).not.toHaveProperty('close');
  });
});

describe('POSIX durable LocalHost composition — public containment', () => {
  it('is absent from public barrels and package root', () => {
    const indexSrc = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const hostBarrel = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8');
    const storageBarrel = readFileSync(
      new URL('../src/host/storage/index.ts', import.meta.url),
      'utf8',
    );
    expect(indexSrc).not.toMatch(/createPosixDurableLocalHost|posix-durable/);
    expect(hostBarrel).not.toMatch(/createPosixDurableLocalHost|posix-durable/);
    expect(storageBarrel).not.toMatch(/createPosixDurableLocalHost|posix-durable/);
  });

  it('production entry does not accept hooks argument', () => {
    expect(createPosixDurableLocalHost.length).toBe(1);
    expect(createPosixDurableLocalHostWithTestHooks.length).toBe(2);
  });
});
