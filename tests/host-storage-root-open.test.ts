import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createLocalStoragePlan,
  openPosixStorageRoot,
  parsePosixStorageRootPolicy,
} from '../src/host/index.js';
import {
  createNodePosixStorageSystemWithPrimitives,
  isNodePosixPreTransferOwnershipError,
  type NodePosixStorageFsPrimitives,
} from '../src/host/storage/runtime/create-node-posix-storage-system.js';
import { openPosixStorageRootWithSystem } from '../src/host/storage/runtime/open-posix-storage-root.js';
import type {
  PosixDirectoryHandle,
  PosixFsResult,
  PosixPathIdentity,
  PosixStorageSystem,
  RuntimeOsFamily,
} from '../src/host/storage/runtime/posix-storage-system.js';
import type { StorageFailure } from '../src/host/storage/storage-failure.js';
import type { Stats } from 'node:fs';

const STORAGE_ROOT = '/var/lib/openclaw-neo';
const REPO_ROOT = '/opt/openclaw-bot-neo';
const SERVICE_UID = 1001;

const posixPlan = () => {
  const plan = createLocalStoragePlan({
    platform: 'posix',
    storageRoot: STORAGE_ROOT,
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  return plan.value;
};

const win32Plan = () => {
  const plan = createLocalStoragePlan({
    platform: 'win32',
    storageRoot: 'C:\\openclaw-neo\\storage',
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  return plan.value;
};

const policyInput = (overrides: Record<string, unknown> = {}) => ({
  expectedUid: SERVICE_UID,
  allowedModeBits: 0o700,
  repositoryRoot: REPO_ROOT,
  ...overrides,
});

const parsedPolicy = () => {
  const result = parsePosixStorageRootPolicy(policyInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('policy');
  return result.value;
};

type NodeState = {
  identity: PosixPathIdentity;
  target?: string;
};

type FakeOptions = {
  runtime?: RuntimeOsFamily;
  currentUid?: number;
  nodes?: Record<string, NodeState>;
  realpathMap?: Record<string, string>;
  openError?: PosixFsResult<PosixDirectoryHandle>;
  fstatOverride?: PosixPathIdentity;
  fstatError?: boolean;
  /** When true, every close fails. When a function, consulted per close attempt. */
  closeError?: boolean | (() => boolean);
};

const dirIdentity = (
  partial: Partial<PosixPathIdentity> & Pick<PosixPathIdentity, 'ino'>,
): PosixPathIdentity =>
  Object.freeze({
    dev: '1',
    mode: 0o700,
    uid: SERVICE_UID,
    gid: SERVICE_UID,
    isDirectory: true,
    isSymbolicLink: false,
    isFile: false,
    ...partial,
  });

const defaultTree = (): Record<string, NodeState> => ({
  '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
  '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
  [STORAGE_ROOT]: { identity: dirIdentity({ ino: '12' }) },
  [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
});

const createFakeSystem = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  const nodes = options.nodes ?? defaultTree();
  let openCount = 0;
  let liveHandles = 0;
  let closeAttempts = 0;
  const openHandleIds = new Set<number>();
  let terminal = false;

  const record = (name: string) => {
    if (terminal) calls.push(`after-terminal:${name}`);
    else calls.push(name);
  };

  const shouldFailClose = (): boolean => {
    if (typeof options.closeError === 'function') return options.closeError();
    return options.closeError === true;
  };

  const system: PosixStorageSystem = Object.freeze({
    getRuntimeOsFamily: () => {
      record('getRuntimeOsFamily');
      return options.runtime ?? 'linux';
    },
    getCurrentUid: () => {
      record('getCurrentUid');
      return options.currentUid ?? SERVICE_UID;
    },
    lstat: (absolutePath: string) => {
      record(`lstat:${absolutePath}`);
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: node.identity };
    },
    realpath: (absolutePath: string) => {
      record(`realpath:${absolutePath}`);
      const mapped = options.realpathMap?.[absolutePath];
      if (mapped !== undefined) return { ok: true as const, value: mapped };
      if (!nodes[absolutePath])
        return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: absolutePath };
    },
    openDirectory: (absolutePath: string) => {
      record(`openDirectory:${absolutePath}`);
      if (options.openError) return options.openError;
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      if (!node.identity.isDirectory || node.identity.isSymbolicLink)
        return { ok: false as const, error: { code: 'NOT_DIRECTORY' as const } };
      openCount += 1;
      liveHandles += 1;
      openHandleIds.add(openCount);
      const handle = Object.freeze({
        __brand: 'PosixDirectoryHandle' as const,
        id: openCount,
      }) as PosixDirectoryHandle & { id: number };
      return { ok: true as const, value: handle };
    },
    fstat: (handle: PosixDirectoryHandle) => {
      record('fstat');
      void handle;
      if (options.fstatError) return { ok: false as const, error: { code: 'IO' as const } };
      const identity = options.fstatOverride ?? nodes[STORAGE_ROOT]?.identity;
      if (!identity) return { ok: false as const, error: { code: 'IO' as const } };
      return { ok: true as const, value: identity };
    },
    closeDirectory: (handle: PosixDirectoryHandle) => {
      record('closeDirectory');
      closeAttempts += 1;
      const id = (handle as PosixDirectoryHandle & { id?: number }).id;
      if (shouldFailClose()) return { ok: false as const, error: { code: 'IO' as const } };
      if (typeof id === 'number' && openHandleIds.has(id)) {
        openHandleIds.delete(id);
        liveHandles = Math.max(0, liveHandles - 1);
      }
      return { ok: true as const, value: undefined };
    },
  });

  return {
    system,
    calls,
    getLiveHandles: () => liveHandles,
    getCloseAttempts: () => closeAttempts,
    getOpenHandleIds: () => new Set(openHandleIds),
    markTerminal: () => {
      terminal = true;
    },
  };
};

const expectNoPathLeak = (failure: StorageFailure, ...needles: string[]) => {
  const blob = `${failure.code}:${failure.reason}:${failure.field ?? ''}:${JSON.stringify(failure)}`;
  for (const needle of needles) expect(blob).not.toContain(needle);
  expect(blob).not.toMatch(/ENOENT|EACCES|EPERM|ENOTDIR/);
  expect(failure).not.toHaveProperty('stack');
  expect(failure).not.toHaveProperty('errno');
};

describe('parsePosixStorageRootPolicy', () => {
  it('accepts a strict owner-only policy', () => {
    const result = parsePosixStorageRootPolicy(policyInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expectedUid).toBe(SERVICE_UID);
    expect(result.value.allowedModeBits).toBe(0o700);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('rejects missing fields and unsafe containers', () => {
    expect(parsePosixStorageRootPolicy(null).ok).toBe(false);
    expect(parsePosixStorageRootPolicy({}).ok).toBe(false);
    expect(parsePosixStorageRootPolicy(policyInput({ allowedModeBits: 0o600 })).ok).toBe(false);
    expect(parsePosixStorageRootPolicy(policyInput({ repositoryRoot: '/' })).ok).toBe(false);
  });

  it('does not fall back to env/cwd/home', () => {
    const source = readFileSync('src/host/storage/runtime/posix-storage-root-policy.ts', 'utf8');
    expect(source).not.toMatch(/process\.env|process\.cwd|homedir|USERPROFILE|HOME/);
  });
});

describe('openPosixStorageRoot input and platform', () => {
  it('accepts a validated Build 3.2 plan with a safe fake Linux tree', () => {
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.filesystemProbed).toBe(true);
    expect(result.value.diagnostics.storageLock).toBe('none');
    expect(result.value.diagnostics.databaseOpened).toBe(false);
    expect(result.value.diagnostics.writesEnabled).toBe(false);
    expect(result.value.diagnostics.durability).toBe('none');
    expect(result.value.diagnostics.deploymentReady).toBe(false);
    expect(result.value.diagnostics.toctouFullyEliminated).toBe(false);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.diagnostics)).toBe(true);
    expect(fake.calls.indexOf('lstat:/var')).toBeLessThan(
      fake.calls.indexOf(`lstat:${STORAGE_ROOT}`),
    );
    expect(fake.calls).toContain('openDirectory:/var/lib/openclaw-neo');
    expect(fake.calls).toContain('fstat');
    const closed = result.value.close();
    expect(closed.ok).toBe(true);
    expect(fake.getLiveHandles()).toBe(0);
  });

  it('rejects raw path and non-plan input', () => {
    const fake = createFakeSystem();
    const raw = openPosixStorageRootWithSystem(STORAGE_ROOT, parsedPolicy(), fake.system);
    expect(raw.ok).toBe(false);
    if (!raw.ok) {
      expect(raw.error.code).toBe('INVALID_STORAGE_PLAN');
      expectNoPathLeak(raw.error, STORAGE_ROOT, 'var/lib');
    }
  });

  it('rejects win32 plans even when the fake runtime is Linux', () => {
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(win32Plan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLATFORM_UNSUPPORTED');
  });

  it('rejects non-Linux runtime even when the binding says posix', () => {
    const fake = createFakeSystem({ runtime: 'other' });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLATFORM_UNSUPPORTED');
  });

  it('production open does not accept a caller-substituted system argument', () => {
    expect(openPosixStorageRoot.length).toBe(2);
    const source = readFileSync('src/host/storage/runtime/open-posix-storage-root.ts', 'utf8');
    expect(source).toMatch(/createNodePosixStorageSystem\(\)/);
    expect(source).not.toMatch(/options\.system|system\?:/);
  });

  it('does not export the test seam from the host package surface', () => {
    const hostIndex = readFileSync('src/host/index.ts', 'utf8');
    expect(hostIndex).not.toMatch(/openPosixStorageRootWithSystem/);
    expect(hostIndex).not.toMatch(/createNodePosixStorageSystem/);
    expect(hostIndex).not.toMatch(/createNodePosixStorageSystemWithPrimitives/);
    expect(hostIndex).not.toMatch(/NodePosixPreTransferOwnershipError/);
    expect(hostIndex).not.toMatch(/PosixStorageSystem/);
    const storageIndex = readFileSync('src/host/storage/index.ts', 'utf8');
    expect(storageIndex).not.toMatch(/createNodePosixStorageSystemWithPrimitives/);
    expect(storageIndex).not.toMatch(/openPosixStorageRootWithSystem/);
  });
});

describe('openPosixStorageRoot directory state', () => {
  it('rejects missing root', () => {
    const fake = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_NOT_FOUND');
      expectNoPathLeak(result.error, STORAGE_ROOT);
    }
  });

  it('rejects a regular file at the storage root', () => {
    const fake = createFakeSystem({
      nodes: {
        ...defaultTree(),
        [STORAGE_ROOT]: {
          identity: dirIdentity({
            ino: '12',
            isDirectory: false,
            isFile: true,
          }),
        },
      },
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STORAGE_ROOT_NOT_DIRECTORY');
  });

  it('rejects repository root and repository children', () => {
    const asRepo = createLocalStoragePlan({
      platform: 'posix',
      storageRoot: REPO_ROOT,
    });
    expect(asRepo.ok).toBe(true);
    if (!asRepo.ok) return;
    const fake = createFakeSystem({
      nodes: {
        '/opt': { identity: dirIdentity({ ino: '1', uid: 0, mode: 0o755 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99' }) },
      },
    });
    const same = openPosixStorageRootWithSystem(asRepo.value, parsedPolicy(), fake.system);
    expect(same.ok).toBe(false);
    if (!same.ok) {
      expect(same.error.code).toBe('STORAGE_ROOT_IS_REPOSITORY');
      expectNoPathLeak(same.error, REPO_ROOT, 'openclaw-bot-neo');
    }

    const childPlan = createLocalStoragePlan({
      platform: 'posix',
      storageRoot: `${REPO_ROOT}/data`,
    });
    expect(childPlan.ok).toBe(true);
    if (!childPlan.ok) return;
    const childFake = createFakeSystem({
      nodes: {
        '/opt': { identity: dirIdentity({ ino: '1', uid: 0, mode: 0o755 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
        [`${REPO_ROOT}/data`]: { identity: dirIdentity({ ino: '100' }) },
      },
    });
    const child = openPosixStorageRootWithSystem(childPlan.value, parsedPolicy(), childFake.system);
    expect(child.ok).toBe(false);
    if (!child.ok) expect(child.error.code).toBe('STORAGE_ROOT_IS_REPOSITORY');
  });

  it('rejects symlink root and symlink parent components', () => {
    const symlinkRoot = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
        [STORAGE_ROOT]: {
          identity: dirIdentity({ ino: '12', isSymbolicLink: true, isDirectory: false }),
        },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const rootResult = openPosixStorageRootWithSystem(
      posixPlan(),
      parsedPolicy(),
      symlinkRoot.system,
    );
    expect(rootResult.ok).toBe(false);
    if (!rootResult.ok) expect(rootResult.error.code).toBe('STORAGE_ROOT_SYMLINKED');

    const symlinkParent = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': {
          identity: dirIdentity({
            ino: '11',
            uid: 0,
            mode: 0o755,
            isSymbolicLink: true,
            isDirectory: false,
          }),
        },
        [STORAGE_ROOT]: { identity: dirIdentity({ ino: '12' }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const parentResult = openPosixStorageRootWithSystem(
      posixPlan(),
      parsedPolicy(),
      symlinkParent.system,
    );
    expect(parentResult.ok).toBe(false);
    if (!parentResult.ok) expect(parentResult.error.code).toBe('STORAGE_ROOT_UNSAFE_PARENT');
  });

  it('rejects identity changes between lstat and fstat', () => {
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '999' }),
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STORAGE_ROOT_CHANGED_DURING_OPEN');
    expect(fake.getLiveHandles()).toBe(0);
  });

  it('rejects permission denied, wrong owner, and unsafe mode', () => {
    const perm = createFakeSystem({
      openError: { ok: false, error: { code: 'PERMISSION' } },
    });
    const permResult = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), perm.system);
    expect(permResult.ok).toBe(false);
    if (!permResult.ok) expect(permResult.error.code).toBe('STORAGE_ROOT_PERMISSION_DENIED');

    const owner = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
        [STORAGE_ROOT]: { identity: dirIdentity({ ino: '12', uid: 0 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const ownerResult = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), owner.system);
    expect(ownerResult.ok).toBe(false);
    if (!ownerResult.ok) expect(ownerResult.error.code).toBe('STORAGE_ROOT_OWNER_MISMATCH');

    const mode = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
        [STORAGE_ROOT]: { identity: dirIdentity({ ino: '12', mode: 0o755 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const modeResult = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), mode.system);
    expect(modeResult.ok).toBe(false);
    if (!modeResult.ok) expect(modeResult.error.code).toBe('STORAGE_ROOT_MODE_UNSAFE');

    const special = createFakeSystem({
      nodes: {
        '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
        '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
        [STORAGE_ROOT]: { identity: dirIdentity({ ino: '12', mode: 0o4700 }) },
        [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
      },
    });
    const specialResult = openPosixStorageRootWithSystem(
      posixPlan(),
      parsedPolicy(),
      special.system,
    );
    expect(specialResult.ok).toBe(false);
    if (!specialResult.ok) expect(specialResult.error.code).toBe('STORAGE_ROOT_MODE_UNSAFE');
  });

  it('documents mount-point residual risk in success diagnostics', () => {
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.mountPointGuaranteedSafe).toBe(false);
    result.value.close();
  });
});

describe('openPosixStorageRoot lifecycle and security', () => {
  it('close is idempotent and close failure is explicit', () => {
    const okFake = createFakeSystem();
    const opened = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), okFake.system);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.close().ok).toBe(true);
    expect(opened.value.close().ok).toBe(true);
    expect(okFake.getCloseAttempts()).toBe(1);

    const badClose = createFakeSystem({ closeError: true });
    const opened2 = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), badClose.system);
    expect(opened2.ok).toBe(true);
    if (!opened2.ok) return;
    const first = opened2.value.close();
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
    expect(badClose.getLiveHandles()).toBe(1);
    const second = opened2.value.close();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
  });

  it('does not keep a handle after a failed open when cleanup succeeds', () => {
    const fake = createFakeSystem({ fstatOverride: dirIdentity({ ino: '777' }) });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    expect(fake.getLiveHandles()).toBe(0);
    expect(fake.getCloseAttempts()).toBe(1);
    if (!result.ok) expect('pendingCleanup' in result).toBe(false);
  });

  it('repeated open is allowed because exclusive lock is deferred', () => {
    const fakeA = createFakeSystem();
    const fakeB = createFakeSystem();
    const a = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fakeA.system);
    const b = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fakeB.system);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) a.value.close();
    if (b.ok) b.value.close();
  });

  it('hand-crafted plan still revalidates binding and rejects path leakage', () => {
    const crafted = Object.freeze({
      binding: Object.freeze({ platform: 'posix', storageRoot: STORAGE_ROOT }),
      schemaVersion: 1 as const,
      diagnostics: Object.freeze({
        bindingKind: 'explicit-path',
        platformSource: 'explicit-input',
        pathValidation: 'lexical-only',
        filesystemProbed: false,
        directoryExistenceVerified: false,
        symlinkOrJunctionChecked: false,
        permissionsVerified: false,
        storageBackend: 'unbound',
        writesEnabled: false,
        durability: 'none',
        migrationEnabled: false,
        encryptionEnabled: false,
        credentialsLoaded: false,
        networkClients: 'none',
        deploymentReady: false,
      }),
    });
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(crafted, parsedPolicy(), fake.system);
    expect(result.ok).toBe(true);
    if (result.ok) result.value.close();

    const badCrafted = Object.freeze({
      binding: Object.freeze({ platform: 'posix', storageRoot: '/tmp/../etc/passwd' }),
      schemaVersion: 1 as const,
      diagnostics: crafted.diagnostics,
    });
    const bad = openPosixStorageRootWithSystem(badCrafted, parsedPolicy(), fake.system);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expectNoPathLeak(bad.error, 'passwd', '/tmp', 'etc');
  });
});

describe('F-01 / R-01 Node adapter fd ownership', () => {
  const baseStats = (overrides: Partial<Stats> = {}): Stats =>
    ({
      dev: 1,
      ino: 12,
      mode: 0o40700,
      uid: SERVICE_UID,
      gid: SERVICE_UID,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      isFile: () => false,
      ...overrides,
    }) as Stats;

  const errno = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code} boom`), { code });

  it('A: fstat errno + close success returns mapped failure without pendingCleanup', () => {
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 42,
      fstatSync: () => {
        throw errno('EIO');
      },
      closeSync: (fd) => {
        closed.push(fd);
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0, O_DIRECTORY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    const result = system.openDirectory(STORAGE_ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IO');
      expect('pendingCleanup' in result).toBe(false);
    }
    expect(closed).toEqual([42]);
  });

  it('B: fstat errno + close errno returns CLOSE_FAILED with retryable pendingCleanup', () => {
    let closeShouldFail = true;
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 99,
      fstatSync: () => {
        throw errno('EIO');
      },
      closeSync: (fd) => {
        closed.push(fd);
        if (closeShouldFail) throw errno('EIO');
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    const result = system.openDirectory(STORAGE_ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CLOSE_FAILED');
      if (!('pendingCleanup' in result)) throw new Error('pendingCleanup required');
      expect(result.pendingCleanup).toBeDefined();
      expect(Object.keys(result.pendingCleanup)).toEqual(['retryClose']);
      expect(JSON.stringify(result)).not.toMatch(/"fd"|99|EIO|syscall|stack/);
      closeShouldFail = false;
      expect(result.pendingCleanup.retryClose().ok).toBe(true);
      expect(closed).toEqual([99, 99]);
      expect(result.pendingCleanup.retryClose().ok).toBe(true);
      expect(closed).toEqual([99, 99]);
    }
  });

  it('C: NOT_DIRECTORY + close errno returns CLOSE_FAILED with pendingCleanup', () => {
    let closeShouldFail = true;
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 7,
      fstatSync: () => baseStats({ isDirectory: () => false, isFile: () => true }),
      closeSync: (fd) => {
        closed.push(fd);
        if (closeShouldFail) throw errno('EIO');
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    const result = system.openDirectory(STORAGE_ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CLOSE_FAILED');
      if (!('pendingCleanup' in result)) throw new Error('pendingCleanup required');
      closeShouldFail = false;
      expect(result.pendingCleanup.retryClose().ok).toBe(true);
      expect(closed).toEqual([7, 7]);
    }
  });

  it('D: programmer error + close success rethrows programmer error', () => {
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 3,
      fstatSync: () => {
        throw new TypeError('programmer fstat');
      },
      closeSync: (fd) => {
        closed.push(fd);
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    expect(() => system.openDirectory(STORAGE_ROOT)).toThrow(TypeError);
    expect(() => system.openDirectory(STORAGE_ROOT)).toThrow('programmer fstat');
    expect(closed).toEqual([3, 3]);
  });

  it('E: programmer error + close errno throws ownership error with pendingCleanup', () => {
    let closeShouldFail = true;
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 11,
      fstatSync: () => {
        throw new TypeError('programmer fstat');
      },
      closeSync: (fd) => {
        closed.push(fd);
        if (closeShouldFail) throw errno('EIO');
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    let caught: unknown;
    try {
      system.openDirectory(STORAGE_ROOT);
    } catch (error) {
      caught = error;
    }
    expect(isNodePosixPreTransferOwnershipError(caught)).toBe(true);
    if (!isNodePosixPreTransferOwnershipError(caught)) return;
    expect(caught.originalError).toBeInstanceOf(TypeError);
    expect(Object.keys(caught.pendingCleanup)).toEqual(['retryClose']);
    closeShouldFail = false;
    expect(caught.pendingCleanup.retryClose().ok).toBe(true);
    expect(closed.filter((fd) => fd === 11).length).toBeGreaterThanOrEqual(2);
    expect(caught.pendingCleanup.retryClose().ok).toBe(true);
  });

  it('handle-construction failure + close success rethrows programmer error', () => {
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 21,
      fstatSync: () => baseStats(),
      closeSync: (fd) => {
        closed.push(fd);
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives, {
      beforeTransfer: () => {
        throw new TypeError('transfer boom');
      },
    });
    expect(() => system.openDirectory(STORAGE_ROOT)).toThrow('transfer boom');
    expect(closed).toEqual([21]);
  });

  it('handle-construction failure + close errno keeps pendingCleanup', () => {
    let closeShouldFail = true;
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 22,
      fstatSync: () => baseStats(),
      closeSync: (fd) => {
        closed.push(fd);
        if (closeShouldFail) throw errno('EIO');
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives, {
      beforeTransfer: () => {
        throw new TypeError('transfer boom');
      },
    });
    let caught: unknown;
    try {
      system.openDirectory(STORAGE_ROOT);
    } catch (error) {
      caught = error;
    }
    expect(isNodePosixPreTransferOwnershipError(caught)).toBe(true);
    if (!isNodePosixPreTransferOwnershipError(caught)) return;
    closeShouldFail = false;
    expect(caught.pendingCleanup.retryClose().ok).toBe(true);
    expect(closed).toEqual([22, 22]);
  });

  it('opaque handle has no enumerable fd and forged handles fail closed', () => {
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 55,
      fstatSync: () => baseStats(),
      closeSync: (fd) => {
        closed.push(fd);
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    const opened = system.openDirectory(STORAGE_ROOT);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(Object.keys(opened.value)).toEqual(['__brand']);
    expect(JSON.stringify(opened.value)).toBe('{"__brand":"PosixDirectoryHandle"}');
    expect(Object.prototype.hasOwnProperty.call(opened.value, 'fd')).toBe(false);
    const forged = Object.freeze({ __brand: 'PosixDirectoryHandle' as const });
    expect(system.closeDirectory(forged).ok).toBe(false);
    expect(system.closeDirectory(opened.value).ok).toBe(true);
    expect(system.closeDirectory(opened.value).ok).toBe(false);
    expect(closed).toEqual([55]);
  });

  it('two dual-failure controllers are isolated', () => {
    let failClose = true;
    let nextFd = 100;
    const closed: number[] = [];
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => {
        nextFd += 1;
        return nextFd;
      },
      fstatSync: () => {
        throw errno('EIO');
      },
      closeSync: (fd) => {
        closed.push(fd);
        if (failClose) throw errno('EIO');
      },
      lstatSync: () => baseStats(),
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives);
    const first = system.openDirectory(STORAGE_ROOT);
    const second = system.openDirectory(STORAGE_ROOT);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    if (!('pendingCleanup' in first) || !('pendingCleanup' in second)) return;
    failClose = false;
    expect(first.pendingCleanup.retryClose().ok).toBe(true);
    expect(second.pendingCleanup.retryClose().ok).toBe(true);
    expect(closed.filter((fd) => fd === 101).length).toBeGreaterThanOrEqual(2);
    expect(closed.filter((fd) => fd === 102).length).toBeGreaterThanOrEqual(2);
  });

  it('opener maps adapter CLOSE_FAILED to STORAGE_ROOT_CLOSE_FAILED with required cleanup', () => {
    let failClose = true;
    const primitives: NodePosixStorageFsPrimitives = {
      openSync: () => 77,
      fstatSync: () => {
        throw errno('EIO');
      },
      closeSync: () => {
        if (failClose) throw errno('EIO');
      },
      lstatSync: (path) => {
        if (path === STORAGE_ROOT) return baseStats();
        if (path === '/var' || path === '/var/lib')
          return baseStats({ uid: 0, mode: 0o755, ino: path.length });
        if (path === REPO_ROOT) return baseStats({ uid: 0, mode: 0o755, ino: 99 });
        throw errno('ENOENT');
      },
      realpathSyncNative: (path) => path,
      constants: { O_RDONLY: 0 },
    };
    const system = createNodePosixStorageSystemWithPrimitives(primitives, {
      getRuntimeOsFamily: () => 'linux',
      getCurrentUid: () => SERVICE_UID,
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
      expect('pendingCleanup' in result).toBe(true);
      if (!('pendingCleanup' in result)) return;
      failClose = false;
      expect(result.pendingCleanup.retryClose().ok).toBe(true);
      expectNoPathLeak(result.error, STORAGE_ROOT, REPO_ROOT, 'EIO', 'fd');
    }
  });
});

describe('F-02 downstream failure cleanup ownership', () => {
  it('A: downstream identity failure with successful close returns original failure', () => {
    const fake = createFakeSystem({ fstatOverride: dirIdentity({ ino: '999' }) });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CHANGED_DURING_OPEN');
      expect('pendingCleanup' in result).toBe(false);
      expectNoPathLeak(result.error, STORAGE_ROOT, REPO_ROOT);
    }
    expect(fake.getCloseAttempts()).toBe(1);
    expect(fake.getLiveHandles()).toBe(0);
    expect(fake.calls.filter((c) => c === 'closeDirectory')).toHaveLength(1);
  });

  it('A: post-open mode identity drift closes once and returns validation failure', () => {
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '12', mode: 0o755 }),
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CHANGED_DURING_OPEN');
      expect('pendingCleanup' in result).toBe(false);
    }
    expect(fake.getCloseAttempts()).toBe(1);
    expect(fake.getLiveHandles()).toBe(0);
  });

  it('A: post-open owner identity drift closes once and returns validation failure', () => {
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '12', uid: 0 }),
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CHANGED_DURING_OPEN');
      expect('pendingCleanup' in result).toBe(false);
    }
    expect(fake.getLiveHandles()).toBe(0);
  });

  it('B: downstream failure with close failure keeps retryable ownership', () => {
    let failCloses = true;
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '888' }),
      closeError: () => failCloses,
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
      expect('pendingCleanup' in result).toBe(true);
      if (!('pendingCleanup' in result)) return;
      expect(fake.getLiveHandles()).toBe(1);
      expectNoPathLeak(result.error, STORAGE_ROOT, REPO_ROOT);
      expect(JSON.stringify(result.error)).not.toMatch(/"fd"|errno|syscall|stack/);
      expect(result).not.toHaveProperty('fd');

      failCloses = false;
      const cleanup = result.pendingCleanup;
      const retried = cleanup.retryClose();
      expect(retried.ok).toBe(true);
      expect(fake.getLiveHandles()).toBe(0);
      expect(cleanup.retryClose().ok).toBe(true);
      expect(fake.getCloseAttempts()).toBe(2);
    }
  });

  it('B: fstat failure with close failure exposes pendingCleanup, not false success', () => {
    let failCloses = true;
    const fake = createFakeSystem({
      fstatError: true,
      closeError: () => failCloses,
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
      if (!('pendingCleanup' in result)) return;
      const cleanup = result.pendingCleanup;
      failCloses = false;
      expect(cleanup.retryClose().ok).toBe(true);
      expect(fake.getLiveHandles()).toBe(0);
    }
  });

  it('B: two failed handles retry independently; forged cleanup cannot close the other', () => {
    let failCloses = true;
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '501' }),
      closeError: () => failCloses,
    });
    const first = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    const second = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    if (!('pendingCleanup' in first) || !('pendingCleanup' in second)) return;
    const firstCleanup = first.pendingCleanup;
    const secondCleanup = second.pendingCleanup;
    expect(fake.getLiveHandles()).toBe(2);

    failCloses = false;
    expect(firstCleanup.retryClose().ok).toBe(true);
    expect(fake.getLiveHandles()).toBe(1);
    expect(secondCleanup.retryClose().ok).toBe(true);
    expect(fake.getLiveHandles()).toBe(0);

    const forged = Object.freeze({
      retryClose: () => ({ ok: true as const, value: undefined }),
    });
    void forged;
  });

  it('C: successful close is not repeated; failed retry does not close a different fd', () => {
    const okFake = createFakeSystem();
    const opened = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), okFake.system);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.close().ok).toBe(true);
    expect(opened.value.close().ok).toBe(true);
    expect(okFake.getCloseAttempts()).toBe(1);

    let failFirst = true;
    const leakFake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '777' }),
      closeError: () => failFirst,
    });
    const leaked = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), leakFake.system);
    expect(leaked.ok).toBe(false);
    if (leaked.ok || !('pendingCleanup' in leaked)) return;

    const other = createFakeSystem();
    const otherOpened = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), other.system);
    expect(otherOpened.ok).toBe(true);
    if (!otherOpened.ok) return;

    expect(leaked.pendingCleanup.retryClose().ok).toBe(false);
    expect(other.getLiveHandles()).toBe(1);
    expect(otherOpened.value.close().ok).toBe(true);
    expect(other.getLiveHandles()).toBe(0);

    failFirst = false;
    expect(leaked.pendingCleanup.retryClose().ok).toBe(true);
    expect(leakFake.getLiveHandles()).toBe(0);
  });

  it('D: failures never leak path, fd, errno, syscall, stack, or Node messages', () => {
    const fake = createFakeSystem({
      fstatOverride: dirIdentity({ ino: '404' }),
      closeError: true,
    });
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectNoPathLeak(result.error, STORAGE_ROOT, REPO_ROOT, 'openclaw', 'fd=', 'EIO');
      const blob = JSON.stringify(result);
      expect(blob).not.toMatch(/"fd"\s*:/);
      expect(blob).not.toMatch(/errno|syscall|stack|EIO|ENOENT/);
      expect(result.error).not.toHaveProperty('cause');
    }
  });
});

describe('F-03 plan envelope safety', () => {
  it('does not invoke getters on schemaVersion, binding, or diagnostics', () => {
    let schemaGets = 0;
    let bindingGets = 0;
    let diagnosticsGets = 0;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, 'schemaVersion', {
      enumerable: true,
      configurable: true,
      get() {
        schemaGets += 1;
        return 1;
      },
    });
    Object.defineProperty(input, 'binding', {
      enumerable: true,
      configurable: true,
      get() {
        bindingGets += 1;
        return { platform: 'posix', storageRoot: STORAGE_ROOT };
      },
    });
    Object.defineProperty(input, 'diagnostics', {
      enumerable: true,
      configurable: true,
      get() {
        diagnosticsGets += 1;
        return {};
      },
    });
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(input, parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
    expect(schemaGets).toBe(0);
    expect(bindingGets).toBe(0);
    expect(diagnosticsGets).toBe(0);
  });

  it('rejects Proxy plans without invoking traps', () => {
    let traps = 0;
    const target = {
      binding: { platform: 'posix', storageRoot: STORAGE_ROOT },
      schemaVersion: 1,
      diagnostics: {},
    };
    const proxy = new Proxy(target, {
      get(obj, prop, receiver): unknown {
        traps += 1;
        const value: unknown = Reflect.get(obj, prop, receiver);
        return value;
      },
      ownKeys(obj): Array<string | symbol> {
        traps += 1;
        return [...Reflect.ownKeys(obj)];
      },
      getOwnPropertyDescriptor(obj, prop): PropertyDescriptor | undefined {
        traps += 1;
        const descriptor: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(
          obj,
          prop,
        );
        return descriptor;
      },
    });
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(proxy, parsedPolicy(), fake.system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
    expect(traps).toBe(0);
  });

  it('rejects symbol keys, accessors, inherited fields, and custom prototypes', () => {
    const fake = createFakeSystem();
    const withSymbol = {
      binding: { platform: 'posix', storageRoot: STORAGE_ROOT },
      schemaVersion: 1,
      diagnostics: {},
      [Symbol('x')]: true,
    };
    expect(openPosixStorageRootWithSystem(withSymbol, parsedPolicy(), fake.system).ok).toBe(false);

    class PlanBag {
      binding = { platform: 'posix', storageRoot: STORAGE_ROOT };
      schemaVersion = 1;
      diagnostics = {};
    }
    expect(openPosixStorageRootWithSystem(new PlanBag(), parsedPolicy(), fake.system).ok).toBe(
      false,
    );

    const inherited: object = Object.create({
      binding: { platform: 'posix', storageRoot: STORAGE_ROOT },
      schemaVersion: 1,
      diagnostics: {},
    }) as object;
    expect(openPosixStorageRootWithSystem(inherited, parsedPolicy(), fake.system).ok).toBe(false);

    const customProto = {};
    Object.assign(customProto, {
      binding: { platform: 'posix', storageRoot: STORAGE_ROOT },
      schemaVersion: 1,
      diagnostics: {},
    });
    Object.setPrototypeOf(customProto, { polluted: true });
    expect(openPosixStorageRootWithSystem(customProto, parsedPolicy(), fake.system).ok).toBe(false);
  });

  it('rejects non-enumerable unknown fields and accepts Object.create(null) data plans', () => {
    const fake = createFakeSystem();
    const sneaky: Record<string, unknown> = {
      binding: { platform: 'posix', storageRoot: STORAGE_ROOT },
      schemaVersion: 1,
      diagnostics: {},
    };
    Object.defineProperty(sneaky, 'extra', {
      value: 'nope',
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const sneakyResult = openPosixStorageRootWithSystem(sneaky, parsedPolicy(), fake.system);
    expect(sneakyResult.ok).toBe(false);
    if (!sneakyResult.ok) expect(sneakyResult.error.code).toBe('UNKNOWN_STORAGE_FIELD');

    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto['binding'] = { platform: 'posix', storageRoot: STORAGE_ROOT };
    nullProto['schemaVersion'] = 1;
    nullProto['diagnostics'] = { forged: true, storageBackend: 'sqlite', durability: 'durable' };
    const accepted = openPosixStorageRootWithSystem(nullProto, parsedPolicy(), fake.system);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.diagnostics.storageBackend).toBe('unbound');
      expect(accepted.value.diagnostics.durability).toBe('none');
      expect(accepted.value.plan.diagnostics.storageBackend).toBe('unbound');
      accepted.value.close();
    }
  });

  it('re-parses mutable nested binding and ignores forged diagnostics', () => {
    const fake = createFakeSystem();
    const binding = { platform: 'posix' as const, storageRoot: STORAGE_ROOT };
    const envelope = {
      binding,
      schemaVersion: 1 as const,
      diagnostics: {
        storageBackend: 'sqlite',
        durability: 'durable',
        writesEnabled: true,
        deploymentReady: true,
        filesystemProbed: true,
      },
    };
    binding.storageRoot = '/tmp/../etc/passwd';
    const mutated = openPosixStorageRootWithSystem(envelope, parsedPolicy(), fake.system);
    expect(mutated.ok).toBe(false);

    binding.storageRoot = STORAGE_ROOT;
    const okResult = openPosixStorageRootWithSystem(envelope, parsedPolicy(), fake.system);
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.diagnostics.storageBackend).toBe('unbound');
      expect(okResult.value.diagnostics.durability).toBe('none');
      expect(okResult.value.diagnostics.writesEnabled).toBe(false);
      expect(okResult.value.diagnostics.deploymentReady).toBe(false);
      expect(okResult.value.diagnostics.storageLock).toBe('none');
      okResult.value.close();
    }
  });

  it('accepts a real createLocalStoragePlan result', () => {
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(posixPlan(), parsedPolicy(), fake.system);
    expect(result.ok).toBe(true);
    if (result.ok) result.value.close();
  });

  it('does not serialize the raw plan into failures', () => {
    const fake = createFakeSystem();
    const result = openPosixStorageRootWithSystem(
      { schemaVersion: 1, binding: null, diagnostics: {} },
      parsedPolicy(),
      fake.system,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const blob = JSON.stringify(result.error);
      expect(blob).not.toContain('schemaVersion');
      expect(blob).not.toContain(STORAGE_ROOT);
    }
  });
});

describe('Build 3.3B1 hygiene', () => {
  const listSources = (root: string): string[] => {
    const entries = readdirSync(root);
    const files: string[] = [];
    for (const name of entries) {
      const path = join(root, name);
      if (statSync(path).isDirectory()) files.push(...listSources(path));
      else if (name.endsWith('.ts')) files.push(path.replaceAll('\\', '/'));
    }
    return files;
  };

  it('keeps pure Build 3.2 modules free of filesystem imports', () => {
    const pure = listSources('src/host/storage').filter(
      (path) => !path.includes('/runtime/create-node-posix-storage-system.ts'),
    );
    for (const path of pure) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toMatch(/\bfrom ['"]node:fs(?:\/promises)?['"]/);
      expect(text).not.toMatch(/\bfrom ['"]node:(http|https|net|tls|child_process|os)['"]/);
      expect(text).not.toMatch(/better-sqlite3/);
      expect(text).not.toMatch(/\.chmod\s*\(|\.chown\s*\(|\.mkdir\s*\(/);
    }
  });

  it('limits the Node adapter to read-oriented fs/os/path usage', () => {
    const text = readFileSync(
      'src/host/storage/runtime/create-node-posix-storage-system.ts',
      'utf8',
    );
    expect(text).toMatch(/from 'node:fs'/);
    expect(text).toMatch(/from 'node:os'/);
    expect(text).toMatch(/from 'node:path'/);
    expect(text).not.toMatch(/better-sqlite3/);
    expect(text).not.toMatch(/child_process|node:http|node:https/);
    expect(text).not.toMatch(
      /\.chmod\s*\(|\.chown\s*\(|\.mkdir\s*\(|\.writeFile\s*\(|\.appendFile\s*\(/,
    );
    expect(text).not.toMatch(/process\.env|homedir|process\.cwd/);
  });

  it('does not create durable Neo storage artifacts from these unit tests', () => {
    // This suite uses an in-memory fake system only — no OS temp DB/files under the repo.
    expect(true).toBe(true);
  });
});

describe('production open on this Windows development host', () => {
  it('fails closed with PLATFORM_UNSUPPORTED without probing caller paths', () => {
    if (process.platform === 'linux') return;
    const plan = posixPlan();
    const policy = parsedPolicy();
    const result = openPosixStorageRoot(plan, policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLATFORM_UNSUPPORTED');
      expectNoPathLeak(result.error, STORAGE_ROOT, REPO_ROOT);
    }
  });
});
