import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryNamespace, MemoryQueryRequest } from '../src/core/domain/index.js';
import * as publicApi from '../src/index.js';
import {
  createLocalStoragePlan,
  createSqliteMemoryPort,
  SQLITE_MEMORY_DATABASE_FILENAME,
} from '../src/host/index.js';
import { openPosixStorageRootWithSystem } from '../src/host/storage/runtime/open-posix-storage-root.js';
import type { OpenedPosixStorageRoot } from '../src/host/storage/runtime/open-posix-storage-root.js';
import type {
  PosixDirectoryHandle,
  PosixPathIdentity,
  PosixStorageSystem,
} from '../src/host/storage/runtime/posix-storage-system.js';
import { acquireOpenedPosixStorageRootLease } from '../src/host/storage/runtime/posix-storage-root-lease.internal.js';
import {
  createSqliteMemoryPortWithTestHooks,
  isSqliteMemoryPortOwnershipError,
} from '../src/host/storage/sqlite/create-sqlite-memory-port.js';
import {
  asOwner,
  asRecordId,
  authenticatedAccess,
  verifiedMemoryWriteForTests,
} from './support/fixtures.js';

const REPO_ROOT = '/opt/openclaw-bot-neo-b3a';
const SERVICE_UID = 1001;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root === undefined) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

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

const createTempStorageRoot = (): string => {
  const base = mkdtempSync(join(tmpdir(), 'openclaw-b3a-'));
  tempRoots.push(base);
  const posixRoot =
    '/openclaw-neo-b3a-' +
    String(process.pid) +
    '-' +
    String(Date.now()) +
    '-' +
    Math.random().toString(16).slice(2);
  mkdirSync(posixRoot, { recursive: true });
  tempRoots.push(posixRoot);
  return posixRoot;
};

type FakeSystem = PosixStorageSystem & { readonly closeDirectoryCalls: number[] };

const createFakeSystem = (storageRoot: string): FakeSystem => {
  const nodes: Record<string, { identity: PosixPathIdentity }> = {
    [storageRoot]: { identity: dirIdentity({ ino: '12' }) },
    [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
  };
  const parts = storageRoot.split('/').filter((part) => part.length > 0);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    if (segment === undefined) continue;
    current = current + '/' + segment;
    nodes[current] = { identity: dirIdentity({ ino: String(20 + index), uid: 0, mode: 0o755 }) };
  }

  let openCount = 0;
  const closeDirectoryCalls: number[] = [];
  return Object.freeze({
    closeDirectoryCalls,
    getRuntimeOsFamily: () => 'linux' as const,
    getCurrentUid: () => SERVICE_UID,
    lstat: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: node.identity };
    },
    realpath: (absolutePath: string) => {
      if (!nodes[absolutePath])
        return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: absolutePath };
    },
    openDirectory: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      openCount += 1;
      const handle = Object.freeze({
        __brand: 'PosixDirectoryHandle' as const,
        id: openCount,
      }) as PosixDirectoryHandle & { id: number };
      return { ok: true as const, value: handle };
    },
    fstat: (handle: PosixDirectoryHandle) => {
      void handle;
      const identity = nodes[storageRoot]?.identity;
      if (identity === undefined) return { ok: false as const, error: { code: 'IO' as const } };
      return { ok: true as const, value: identity };
    },
    closeDirectory: (handle: PosixDirectoryHandle) => {
      const id = (handle as PosixDirectoryHandle & { id?: number }).id;
      closeDirectoryCalls.push(id ?? -1);
      return { ok: true as const, value: undefined };
    },
  });
};

const openGenuineRoot = (
  storageRoot: string,
  system?: FakeSystem,
): { readonly root: OpenedPosixStorageRoot; readonly system: FakeSystem } => {
  const fake = system ?? createFakeSystem(storageRoot);
  const plan = createLocalStoragePlan({ platform: 'posix', storageRoot });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  const opened = openPosixStorageRootWithSystem(
    plan.value,
    {
      expectedUid: SERVICE_UID,
      allowedModeBits: 0o700,
      repositoryRoot: REPO_ROOT,
    },
    fake,
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('open');
  return { root: opened.value, system: fake };
};

const verifiedWrite = (overrides: {
  readonly recordId?: string;
  readonly ownerId?: string;
  readonly namespace?: MemoryNamespace;
  readonly content?: string;
}) =>
  verifiedMemoryWriteForTests({
    recordId: asRecordId(overrides.recordId ?? 'record-1'),
    ownerId: asOwner(overrides.ownerId ?? 'owner-1'),
    namespace: overrides.namespace ?? 'personal',
    content: overrides.content ?? 'note-body',
  });

const queryRequest = (
  overrides: Partial<MemoryQueryRequest> & { readonly limit: number },
): MemoryQueryRequest => ({
  query: '',
  targetNamespace: 'personal',
  expectedOwnerId: asOwner(),
  ...overrides,
});

const dbPathFor = (storageRoot: string): string =>
  `${storageRoot}/${SQLITE_MEMORY_DATABASE_FILENAME}`;

const redactedBusy = (result: { ok: false; error: { code: string; reason: string } }): void => {
  expect(result.error.code).toBe('STORAGE_ROOT_CLOSE_BUSY');
  expect(result.error.reason).toMatch(/in use|adapter/i);
  const serialized = JSON.stringify(result.error);
  expect(serialized).not.toMatch(/leaseCount|activeLease|neo-memory|\.sqlite|fd\b/i);
  expect(serialized).not.toContain(String(SERVICE_UID));
};

describe('B3A lease authenticity', () => {
  it('acquires a genuine root lease and rejects forgeries without trap/getter execution', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);

    const genuine = acquireOpenedPosixStorageRootLease(root);
    expect(genuine.ok).toBe(true);
    if (!genuine.ok) return;
    expect(genuine.value.storageRootPath).toBe(storageRoot);
    genuine.value.release();

    let getterHits = 0;
    const getterFake = {
      get plan() {
        getterHits += 1;
        return root.plan;
      },
      get close() {
        getterHits += 1;
        return root.close;
      },
    };

    const forged = Object.freeze({
      plan: root.plan,
      policy: root.policy,
      diagnostics: root.diagnostics,
      close: root.close,
    });
    const cloned = { ...root };
    const spread = Object.assign({}, root);
    const proxied = new Proxy(root, {
      get() {
        throw new Error('proxy-trap-must-not-run');
      },
    });
    const { proxy: revokedProxy, revoke } = Proxy.revocable(root, {
      get() {
        throw new Error('revoked-trap-must-not-run');
      },
    });
    revoke();

    for (const fake of [forged, cloned, spread, proxied, revokedProxy, getterFake, null, 'x', 1]) {
      const result = acquireOpenedPosixStorageRootLease(fake);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('STORAGE_ROOT_CAPABILITY_INVALID');
    }
    expect(getterHits).toBe(0);

    for (const fake of [forged, cloned, proxied, revokedProxy, getterFake]) {
      const opened = createSqliteMemoryPort(fake);
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.error.code).toBe('STORAGE_ROOT_CAPABILITY_INVALID');
    }
    expect(existsSync(dbPathFor(storageRoot))).toBe(false);
    expect(root.close().ok).toBe(true);
  });
});

describe('B3A busy root close', () => {
  it('keeps capability open and skips directory close while an adapter lease is held', async () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.diagnostics.storageRootLeaseCoordinated).toBe(true);
    expect(opened.value.diagnostics.exclusiveProcessLock).toBe(false);
    expect(opened.value.diagnostics.secondInstanceProtection).toBe(false);

    const beforeCloses = system.closeDirectoryCalls.length;
    const busy = root.close();
    expect(busy.ok).toBe(false);
    if (!busy.ok) redactedBusy(busy);
    expect(system.closeDirectoryCalls.length).toBe(beforeCloses);

    const access = authenticatedAccess();
    await opened.value.memory.write(verifiedWrite({ content: 'still-alive' }), access);
    const read = await opened.value.memory.query(queryRequest({ limit: 5 }), access);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toHaveLength(1);

    const busyAgain = root.close();
    expect(busyAgain.ok).toBe(false);
    if (!busyAgain.ok) redactedBusy(busyAgain);

    expect(opened.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
    expect(system.closeDirectoryCalls.length).toBe(beforeCloses + 1);

    const afterRetired = createSqliteMemoryPort(root);
    expect(afterRetired.ok).toBe(false);
    if (!afterRetired.ok)
      expect(afterRetired.error.code).toBe('STORAGE_ROOT_CAPABILITY_UNAVAILABLE');
  });
});

describe('B3A adapter close success and failure', () => {
  it('releases lease exactly once after successful DB close', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(root.close().ok).toBe(false);
    expect(opened.value.close().ok).toBe(true);
    expect(opened.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('retains lease across failed close retries until DB close succeeds', async () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    let failRemaining = 2;
    const opened = createSqliteMemoryPortWithTestHooks(root, {
      wrapDatabase: (db) => {
        const originalClose = db.close.bind(db);
        db.close = () => {
          if (failRemaining > 0) {
            failRemaining -= 1;
            throw new Error('injected-close-failure');
          }
          return originalClose();
        };
        return db;
      },
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const access = authenticatedAccess();
    await opened.value.memory.write(verifiedWrite({ recordId: 'alive' }), access);

    expect(opened.value.close().ok).toBe(false);
    const denied = await opened.value.memory.read(
      {
        recordId: asRecordId('alive'),
        expectedOwnerId: access.ownerId,
        expectedNamespace: 'personal',
      },
      access,
    );
    expect(denied.ok).toBe(false);

    const busy = root.close();
    expect(busy.ok).toBe(false);
    if (!busy.ok) redactedBusy(busy);
    expect(system.closeDirectoryCalls).toHaveLength(0);

    expect(opened.value.close().ok).toBe(false);
    expect(root.close().ok).toBe(false);

    expect(opened.value.close().ok).toBe(true);
    expect(opened.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });
});

describe('B3A bootstrap failure cleanup', () => {
  it('releases lease when open fails before a live connection', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    rmSync(storageRoot, { recursive: true, force: true });
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe('SQLITE_OPEN_FAILED');
    expect(root.close().ok).toBe(true);
  });

  it('releases lease when bootstrap fails and DB close succeeds', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPortWithTestHooks(root, {
      wrapDatabase: (db) => {
        const failingPragma = (): never => {
          throw Object.assign(new Error('pragma-errno'), { code: 'SQLITE_ERROR' });
        };
        db.pragma = failingPragma;
        return db;
      },
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.code).toBe('SQLITE_OPEN_FAILED');
      expect('pendingCleanup' in opened).toBe(false);
    }
    expect(root.close().ok).toBe(true);
  });

  it('keeps root busy when bootstrap close fails until pendingCleanup succeeds', () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    let failCloseRemaining = 2;
    let thrown = false;
    try {
      createSqliteMemoryPortWithTestHooks(root, {
        wrapDatabase: (db) => {
          const originalClose = db.close.bind(db);
          db.close = () => {
            if (failCloseRemaining > 0) {
              failCloseRemaining -= 1;
              throw new Error('bootstrap-close-fail');
            }
            return originalClose();
          };
          throw new TypeError('programmer-bootstrap-fault');
        },
      });
    } catch (error) {
      thrown = true;
      expect(isSqliteMemoryPortOwnershipError(error)).toBe(true);
      if (!isSqliteMemoryPortOwnershipError(error)) return;

      const busy = root.close();
      expect(busy.ok).toBe(false);
      if (!busy.ok) redactedBusy(busy);
      expect(system.closeDirectoryCalls).toHaveLength(0);

      expect(error.pendingCleanup.retryClose().ok).toBe(false);
      expect(root.close().ok).toBe(false);

      expect(error.pendingCleanup.retryClose().ok).toBe(true);
      expect(error.pendingCleanup.retryClose().ok).toBe(true);
      expect(root.close().ok).toBe(true);
    }
    expect(thrown).toBe(true);
  });
});

describe('B3A multiple adapters and two-root isolation', () => {
  it('requires all same-root adapters to close before root.close succeeds', async () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    const a = createSqliteMemoryPort(root);
    const b = createSqliteMemoryPort(root);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(root.close().ok).toBe(false);
    expect(a.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(false);
    expect(system.closeDirectoryCalls).toHaveLength(0);

    const access = authenticatedAccess();
    await b.value.memory.write(verifiedWrite({ content: 'b-only' }), access);

    expect(b.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
    expect(system.closeDirectoryCalls).toHaveLength(1);
  });

  it('failed close on one adapter retains only that lease', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    let failOnce = true;
    const a = createSqliteMemoryPortWithTestHooks(root, {
      wrapDatabase: (db) => {
        const originalClose = db.close.bind(db);
        db.close = () => {
          if (failOnce) {
            failOnce = false;
            throw new Error('a-close-fail');
          }
          return originalClose();
        };
        return db;
      },
    });
    const b = createSqliteMemoryPort(root);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.value.close().ok).toBe(false);
    expect(b.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(false);
    expect(a.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('isolates lease counters across independent roots', () => {
    const aPath = createTempStorageRoot();
    const bPath = createTempStorageRoot();
    const { root: aRoot } = openGenuineRoot(aPath);
    const { root: bRoot } = openGenuineRoot(bPath);
    const a = createSqliteMemoryPort(aRoot);
    const b = createSqliteMemoryPort(bRoot);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(aRoot.close().ok).toBe(false);
    expect(b.value.close().ok).toBe(true);
    expect(bRoot.close().ok).toBe(true);
    expect(aRoot.close().ok).toBe(false);
    expect(a.value.close().ok).toBe(true);
    expect(aRoot.close().ok).toBe(true);
  });

  it('allows a second adapter after busy root.close while first remains open', async () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const first = createSqliteMemoryPort(root);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(root.close().ok).toBe(false);
    const second = createSqliteMemoryPort(root);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const access = authenticatedAccess();
    await first.value.memory.write(verifiedWrite({ recordId: 'from-1' }), access);
    await second.value.memory.write(verifiedWrite({ recordId: 'from-2' }), access);

    expect(first.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(false);
    expect(second.value.close().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });
});

describe('B3A public export containment', () => {
  it('keeps lease API out of barrels and package root', () => {
    const runtimeIndex = readFileSync('src/host/storage/runtime/index.ts', 'utf8');
    const storageIndex = readFileSync('src/host/storage/index.ts', 'utf8');
    const hostIndex = readFileSync('src/host/index.ts', 'utf8');
    const packageRoot = readFileSync('src/index.ts', 'utf8');
    const pkg = readFileSync('package.json', 'utf8');

    for (const source of [runtimeIndex, storageIndex, hostIndex, packageRoot, pkg]) {
      expect(source).not.toMatch(/posix-storage-root-lease|acquireOpenedPosixStorageRootLease/);
    }

    expect(publicApi).not.toHaveProperty('acquireOpenedPosixStorageRootLease');
    expect(Object.keys(publicApi).join(',')).not.toMatch(/Lease|lease/);

    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(Object.keys(opened.value).sort()).toEqual(['close', 'diagnostics', 'memory']);
    expect(JSON.stringify(opened.value.diagnostics)).not.toMatch(/leaseCount|activeLease|path/i);
    opened.value.close();
    root.close();
  });
});
