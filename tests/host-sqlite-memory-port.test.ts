import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MemoryNamespace,
  MemoryQueryRequest,
  VerifiedMemoryWrite,
} from '../src/core/domain/index.js';
import {
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
} from '../src/core/domain/sanitized.internal.js';
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
import {
  asOwner,
  asRecordId,
  authenticatedAccess,
  iso,
  NOW,
  ownerSource,
  retentionPolicy,
} from './support/fixtures.js';

const REPO_ROOT = '/opt/openclaw-bot-neo-b2';
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

/**
 * Creates a unique OS-temp directory and a POSIX absolute path string for the storage plan.
 * On Windows, Node accepts `/…` paths as current-drive rooted paths.
 */
const createTempStorageRoot = (): string => {
  const base = mkdtempSync(join(tmpdir(), 'openclaw-b2-'));
  tempRoots.push(base);
  // Prefer a POSIX absolute path that Node can mkdir on this host.
  const posixRoot =
    '/openclaw-neo-b2-' +
    String(process.pid) +
    '-' +
    String(Date.now()) +
    '-' +
    Math.random().toString(16).slice(2);
  mkdirSync(posixRoot, { recursive: true });
  tempRoots.push(posixRoot);
  return posixRoot;
};

const createFakeSystem = (storageRoot: string): PosixStorageSystem => {
  const nodes: Record<string, { identity: PosixPathIdentity }> = {
    [storageRoot]: { identity: dirIdentity({ ino: '12' }) },
    [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
  };
  // Parent components for multi-segment roots.
  const parts = storageRoot.split('/').filter((part) => part.length > 0);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    if (segment === undefined) continue;
    current = current + '/' + segment;
    nodes[current] = { identity: dirIdentity({ ino: String(20 + index), uid: 0, mode: 0o755 }) };
  }

  let openCount = 0;
  return Object.freeze({
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
    closeDirectory: () => ({ ok: true as const, value: undefined }),
  });
};

const openGenuineRoot = (storageRoot: string): OpenedPosixStorageRoot => {
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
    createFakeSystem(storageRoot),
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('open');
  return opened.value;
};

const verifiedWrite = (overrides: {
  readonly recordId?: string;
  readonly ownerId?: string;
  readonly namespace?: MemoryNamespace;
  readonly content?: string;
  readonly updatedAt?: string;
}): VerifiedMemoryWrite => {
  const write = sealVerifiedMemoryWrite({
    recordId: asRecordId(overrides.recordId ?? 'record-1'),
    ownerId: asOwner(overrides.ownerId ?? 'owner-1'),
    namespace: overrides.namespace ?? 'personal',
    content: sealSanitizedText(overrides.content ?? 'note-body', 'allow'),
    metadata: sealSanitizedMetadata({ origin: 'test' }, 'allow'),
    source: ownerSource(),
    provenance: {
      capturedAt: iso(NOW),
      initiatedBy: asOwner(overrides.ownerId ?? 'owner-1'),
      transformation: 'owner-stated',
      ownerApproved: false,
      crossProjectAccess: false,
    },
    privacyClassification: 'confidential',
    trustLevel: 'owner-stated',
    retentionPolicy: retentionPolicy(),
    approvalId: null,
    createdAt: iso(NOW),
    updatedAt: iso(overrides.updatedAt ?? NOW),
  });
  if (write === null) throw new Error('failed to seal verified write');
  return write;
};

const queryRequest = (
  overrides: Partial<MemoryQueryRequest> & { readonly limit: number },
): MemoryQueryRequest => ({
  query: "'; DROP TABLE memory_records; --",
  targetNamespace: 'personal',
  expectedOwnerId: asOwner(),
  ...overrides,
});

const dbPathFor = (storageRoot: string): string =>
  `${storageRoot}/${SQLITE_MEMORY_DATABASE_FILENAME}`;

describe('createSqliteMemoryPort capability gate', () => {
  it('accepts a genuine open capability and creates the compile-time database child', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.diagnostics.storageBackend).toBe('sqlite');
    expect(opened.value.diagnostics.localHostWired).toBe(false);
    expect(opened.value.diagnostics.journalMode).toBe('wal');
    expect(opened.value.diagnostics.storageRootLeaseCoordinated).toBe(true);
    expect(existsSync(dbPathFor(storageRoot))).toBe(true);
    expect(JSON.stringify(opened.value.diagnostics)).not.toContain(storageRoot);
    await opened.value.memory.write(verifiedWrite({}), authenticatedAccess());
    expect(opened.value.close().ok).toBe(true);
    root.close();
  });

  it('rejects forged, cloned, and Proxy capabilities before creating a database', () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const forged = Object.freeze({
      plan: root.plan,
      policy: root.policy,
      diagnostics: root.diagnostics,
      close: root.close,
    });
    const cloned = { ...root };
    const proxied = new Proxy(root, {});
    for (const fake of [forged, cloned, proxied]) {
      const result = createSqliteMemoryPort(fake);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('STORAGE_ROOT_CAPABILITY_INVALID');
    }
    expect(existsSync(dbPathFor(storageRoot))).toBe(false);
    root.close();
  });

  it('rejects retired/closed capabilities', () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    expect(root.close().ok).toBe(true);
    const result = createSqliteMemoryPort(root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STORAGE_ROOT_CAPABILITY_UNAVAILABLE');
    expect(existsSync(dbPathFor(storageRoot))).toBe(false);
  });
});

describe('createSqliteMemoryPort bootstrap and schema', () => {
  it('bootstraps empty DB, persists across reopen, and rejects future schema', async () => {
    const storageRoot = createTempStorageRoot();
    const root1 = openGenuineRoot(storageRoot);
    const first = createSqliteMemoryPort(root1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await first.value.memory.write(
      verifiedWrite({ recordId: 'persist-1', content: 'durable-note' }),
      authenticatedAccess(),
    );
    expect(first.value.close().ok).toBe(true);
    root1.close();

    const root2 = openGenuineRoot(storageRoot);
    const second = createSqliteMemoryPort(root2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const read = await second.value.memory.read(
      {
        recordId: asRecordId('persist-1'),
        expectedOwnerId: asOwner(),
        expectedNamespace: 'personal',
      },
      authenticatedAccess(),
    );
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.content).toBe('durable-note');
    expect(second.value.close().ok).toBe(true);
    root2.close();

    // Corrupt meta to future version.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPathFor(storageRoot));
    db.prepare('UPDATE memory_meta SET schema_version = 99 WHERE id = 1').run();
    db.close();

    const root3 = openGenuineRoot(storageRoot);
    const future = createSqliteMemoryPort(root3);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error.code).toBe('SQLITE_SCHEMA_MISMATCH');
    root3.close();
  });

  it('rejects non-SQLite file and does not reset', () => {
    const storageRoot = createTempStorageRoot();
    writeFileSync(dbPathFor(storageRoot), 'not-a-sqlite-database', 'utf8');
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(['SQLITE_OPEN_FAILED', 'SQLITE_INTEGRITY_FAILED', 'SQLITE_SCHEMA_MISMATCH']).toContain(
        opened.error.code,
      );
      expect(JSON.stringify(opened.error)).not.toContain(storageRoot);
    }
    const still = readFileSync(dbPathFor(storageRoot), 'utf8');
    expect(still).toBe('not-a-sqlite-database');
    root.close();
  });
});

describe('createSqliteMemoryPort MemoryPort parity', () => {
  it('covers write/read/overwrite order/delete+reinsert/query limits/isolation', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const { memory } = opened.value;
    const access = authenticatedAccess();

    await memory.write(verifiedWrite({ recordId: 'a', content: 'one' }), access);
    await memory.write(verifiedWrite({ recordId: 'b', content: 'two' }), access);
    await memory.write(verifiedWrite({ recordId: 'c', content: 'three' }), access);
    await memory.write(
      verifiedWrite({
        recordId: 'b',
        content: 'two-updated',
        updatedAt: '2026-07-02T12:00:00.000Z',
      }),
      access,
    );

    const page = await memory.query(queryRequest({ limit: 10 }), access);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.map((record) => record.id)).toEqual(['a', 'b', 'c']);
    expect(page.value[1]?.content).toBe('two-updated');
    expect(Object.isFrozen(page.value)).toBe(true);
    expect(Object.isFrozen(page.value[0])).toBe(true);

    await memory.delete(
      {
        recordId: asRecordId('a'),
        expectedOwnerId: asOwner(),
        expectedNamespace: 'personal',
        reason: 'test',
      },
      access,
    );
    await memory.write(verifiedWrite({ recordId: 'a', content: 'reinserted' }), access);
    const after = await memory.query(queryRequest({ limit: 10 }), access);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.map((record) => String(record.id))).toEqual(['b', 'c', 'a']);

    const limited = await memory.query(queryRequest({ limit: 1 }), access);
    expect(limited.ok).toBe(true);
    if (limited.ok) expect(limited.value).toHaveLength(1);

    // Foreign owner records do not appear.
    await memory.write(
      verifiedWrite({ recordId: 'foreign', ownerId: 'owner-2', content: 'secret' }),
      authenticatedAccess({ ownerId: 'owner-2' }),
    );
    const own = await memory.query(queryRequest({ limit: 100 }), access);
    expect(own.ok).toBe(true);
    if (own.ok) expect(own.value.every((record) => record.content !== 'secret')).toBe(true);

    // Same record id, different owner — independent rows (stronger than Map key).
    const otherRead = await memory.read(
      {
        recordId: asRecordId('b'),
        expectedOwnerId: asOwner('owner-2'),
        expectedNamespace: 'personal',
      },
      authenticatedAccess({ ownerId: 'owner-2' }),
    );
    expect(otherRead.ok).toBe(false);

    expect(opened.value.close().ok).toBe(true);
    const afterClose = await memory.query(queryRequest({ limit: 1 }), access);
    expect(afterClose.ok).toBe(false);
    root.close();
  });

  it('keeps SQL injection payloads as data and binds LIMIT', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const evilId = "rec'; DROP TABLE memory_records; --";
    // record id must pass core parser — use a safe id with quote-heavy content instead.
    await opened.value.memory.write(
      verifiedWrite({
        recordId: 'safe-id',
        content: "hello'; DROP TABLE memory_records; --",
      }),
      authenticatedAccess(),
    );
    const page = await opened.value.memory.query(
      queryRequest({ limit: 5, query: evilId }),
      authenticatedAccess(),
    );
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.value).toHaveLength(1);
      expect(page.value[0]?.content).toContain('DROP TABLE');
    }
    opened.value.close();
    root.close();
    void evilId;
  });
});

describe('createSqliteMemoryPort lifecycle and hygiene', () => {
  it('supports idempotent close and independent adapters', async () => {
    const aRootPath = createTempStorageRoot();
    const bRootPath = createTempStorageRoot();
    const aRoot = openGenuineRoot(aRootPath);
    const bRoot = openGenuineRoot(bRootPath);
    const a = createSqliteMemoryPort(aRoot);
    const b = createSqliteMemoryPort(bRoot);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await a.value.memory.write(verifiedWrite({ content: 'only-a' }), authenticatedAccess());
    const bRead = await b.value.memory.query(queryRequest({ limit: 10 }), authenticatedAccess());
    expect(bRead.ok).toBe(true);
    if (bRead.ok) expect(bRead.value).toHaveLength(0);
    expect(a.value.close().ok).toBe(true);
    expect(a.value.close().ok).toBe(true);
    expect(b.value.close().ok).toBe(true);
    aRoot.close();
    bRoot.close();
  });

  it('does not leave DB artifacts under the repository and keeps exports narrow', () => {
    const hostIndex = readFileSync('src/host/index.ts', 'utf8');
    expect(hostIndex).toMatch(/createSqliteMemoryPort/);
    expect(hostIndex).not.toMatch(/openSqliteDatabaseFile|better-sqlite3-driver|WithPrimitives/);
    expect(hostIndex).not.toMatch(
      /posix-storage-root-capability|posix-storage-root-resolve|posix-storage-root-lease/,
    );

    const repoDb = listRepoSqliteArtifacts('src');
    expect(repoDb).toEqual([]);
  });
});

const listRepoSqliteArtifacts = (root: string): string[] => {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) found.push(...listRepoSqliteArtifacts(path));
    else if (
      name.endsWith('.sqlite') ||
      name.endsWith('.sqlite-wal') ||
      name.endsWith('.sqlite-shm')
    )
      found.push(path.replaceAll('\\', '/'));
  }
  return found;
};
