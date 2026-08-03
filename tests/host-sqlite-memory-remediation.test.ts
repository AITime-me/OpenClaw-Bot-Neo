import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryPort } from '../src/core/ports/index.js';
import type { MemoryNamespace, MemoryQueryRequest } from '../src/core/domain/index.js';
import {
  createInMemoryMemoryStore,
  createLocalStoragePlan,
  createSqliteMemoryPort,
  SQLITE_MEMORY_DATABASE_FILENAME,
} from '../src/host/index.js';
import { createSqliteMemoryPortWithTestHooks } from '../src/host/storage/sqlite/create-sqlite-memory-port.js';
import type { SqliteDatabase } from '../src/host/storage/sqlite/better-sqlite3-driver.js';
import {
  listSqliteUserSchemaInventory,
  runSqliteQuickCheck,
} from '../src/host/storage/sqlite/sqlite-memory-schema.js';
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
  verifiedMemoryWriteForTests,
} from './support/fixtures.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const REPO_ROOT = '/opt/openclaw-neo-b2-remediation';
const SERVICE_UID = 1001;
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root === undefined) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
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
  const base = mkdtempSync(join(tmpdir(), 'openclaw-b2r-'));
  tempRoots.push(base);
  const posixRoot =
    '/openclaw-neo-b2r-' +
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
    fstat: () => {
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
    { expectedUid: SERVICE_UID, allowedModeBits: 0o700, repositoryRoot: REPO_ROOT },
    createFakeSystem(storageRoot),
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('open');
  return opened.value;
};

const dbPathFor = (storageRoot: string): string =>
  `${storageRoot}/${SQLITE_MEMORY_DATABASE_FILENAME}`;

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
  query: 'ignored',
  targetNamespace: 'personal',
  expectedOwnerId: asOwner(),
  ...overrides,
});

const runOwnerIdentityParity = async (memory: MemoryPort): Promise<void> => {
  const ownerA = authenticatedAccess({ ownerId: 'owner-a' });
  const ownerB = authenticatedAccess({ ownerId: 'owner-b' });
  await memory.write(
    verifiedWrite({ recordId: 'shared-id', ownerId: 'owner-a', content: 'from-A' }),
    ownerA,
  );
  await memory.write(
    verifiedWrite({ recordId: 'shared-id', ownerId: 'owner-b', content: 'from-B' }),
    ownerB,
  );

  const readA = await memory.read(
    {
      recordId: asRecordId('shared-id'),
      expectedOwnerId: asOwner('owner-a'),
      expectedNamespace: 'personal',
    },
    ownerA,
  );
  const readB = await memory.read(
    {
      recordId: asRecordId('shared-id'),
      expectedOwnerId: asOwner('owner-b'),
      expectedNamespace: 'personal',
    },
    ownerB,
  );
  expect(readA.ok && readA.value.content).toBe('from-A');
  expect(readB.ok && readB.value.content).toBe('from-B');

  const queryA = await memory.query(
    queryRequest({ limit: 10, expectedOwnerId: asOwner('owner-a') }),
    ownerA,
  );
  const queryB = await memory.query(
    queryRequest({ limit: 10, expectedOwnerId: asOwner('owner-b') }),
    ownerB,
  );
  expect(queryA.ok && queryA.value.map((row) => row.content)).toEqual(['from-A']);
  expect(queryB.ok && queryB.value.map((row) => row.content)).toEqual(['from-B']);

  await memory.write(
    verifiedWrite({ recordId: 'shared-id', ownerId: 'owner-a', content: 'from-A-2' }),
    ownerA,
  );
  const queryBAfterOverwrite = await memory.query(
    queryRequest({ limit: 10, expectedOwnerId: asOwner('owner-b') }),
    ownerB,
  );
  expect(queryBAfterOverwrite.ok && queryBAfterOverwrite.value.map((row) => row.content)).toEqual([
    'from-B',
  ]);

  const deleted = await memory.delete(
    {
      recordId: asRecordId('shared-id'),
      expectedOwnerId: asOwner('owner-a'),
      expectedNamespace: 'personal',
      reason: 'parity',
    },
    ownerA,
  );
  expect(deleted.ok).toBe(true);
  const stillB = await memory.read(
    {
      recordId: asRecordId('shared-id'),
      expectedOwnerId: asOwner('owner-b'),
      expectedNamespace: 'personal',
    },
    ownerB,
  );
  expect(stillB.ok && stillB.value.content).toBe('from-B');
};

describe('F3 owner identity parity (in-memory + SQLite)', () => {
  it('keeps independent (owner, namespace, recordId) rows side-by-side', async () => {
    await runOwnerIdentityParity(createInMemoryMemoryStore());

    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await runOwnerIdentityParity(opened.value.memory);
    expect(opened.value.close().ok).toBe(true);
    root.close();
  });
});

describe('F6 not-found parity', () => {
  it('returns identical missing-record code and reason', async () => {
    const inMemory = createInMemoryMemoryStore();
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const access = authenticatedAccess();
    const request = {
      recordId: asRecordId('missing-x'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal' as const,
    };
    const memRead = await inMemory.read(request, access);
    const sqlRead = await opened.value.memory.read(request, access);
    expect(memRead.ok).toBe(false);
    expect(sqlRead.ok).toBe(false);
    if (memRead.ok || sqlRead.ok) return;
    expect(memRead.error).toEqual(sqlRead.error);
    expect(memRead.error.code).toBe('VALIDATION_FAILED');
    if (memRead.error.code === 'VALIDATION_FAILED') {
      expect(memRead.error.reason).toBe('Memory record not found in ephemeral local store.');
    }

    const memDel = await inMemory.delete({ ...request, reason: 'x' }, access);
    const sqlDel = await opened.value.memory.delete({ ...request, reason: 'x' }, access);
    expect(memDel.ok).toBe(false);
    expect(sqlDel.ok).toBe(false);
    if (memDel.ok || sqlDel.ok) return;
    expect(memDel.error).toEqual(sqlDel.error);

    opened.value.close();
    root.close();
  });
});

describe('F1 exact schema verification', () => {
  const openAgainstExistingDb = (storageRoot: string) => {
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    return { root, opened };
  };

  const invent = (storageRoot: string) => {
    const db = new Database(dbPathFor(storageRoot));
    const inventory = listSqliteUserSchemaInventory(db);
    db.close();
    return inventory;
  };

  it.each([
    [
      'nullable owner_id',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'UNIQUE without owner',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'wrong UNIQUE order',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (record_id, namespace, owner_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'wrong query index columns',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (namespace, owner_id, insertion_ordinal);`,
        );
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'owner-mutating trigger',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.exec(`CREATE TRIGGER mutate_owner AFTER INSERT ON memory_records
          BEGIN UPDATE memory_records SET owner_id = 'evil' WHERE rowid = NEW.rowid; END;`);
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'unexpected view',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.exec(`CREATE VIEW memory_leak AS SELECT * FROM memory_records;`);
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'unexpected table',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.exec(`CREATE TABLE secrets (token TEXT);`);
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'text schema version',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version TEXT NOT NULL
        );`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.prepare(`INSERT INTO memory_meta (id, schema_version) VALUES (1, '1')`).run();
      },
    ],
    [
      'partial memory table',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 1)').run();
      },
    ],
    [
      'future version',
      (db: SqliteDatabase) => {
        db.exec(`CREATE TABLE memory_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;`);
        db.exec(`CREATE TABLE memory_records (
          insertion_ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          privacy_classification TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          retention_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_id, namespace, record_id)
        ) STRICT;`);
        db.exec(
          `CREATE INDEX memory_records_query_idx ON memory_records (owner_id, namespace, insertion_ordinal);`,
        );
        db.prepare('INSERT INTO memory_meta (id, schema_version) VALUES (1, 99)').run();
      },
    ],
  ])('rejects %s without mutating inventory', (_label, build) => {
    const storageRoot = createTempStorageRoot();
    const db = new Database(dbPathFor(storageRoot));
    build(db);
    const before = listSqliteUserSchemaInventory(db);
    db.close();

    const { root, opened } = openAgainstExistingDb(storageRoot);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.code).toBe('SQLITE_SCHEMA_MISMATCH');
    expect(JSON.stringify(opened.error)).not.toMatch(/CREATE|SELECT|owner-a|\\|C:\\\\/i);

    const after = invent(storageRoot);
    expect(after).toEqual(before);

    const reopen = createSqliteMemoryPort(root);
    expect(reopen.ok).toBe(false);
    if (!reopen.ok) expect(reopen.error.code).toBe('SQLITE_SCHEMA_MISMATCH');
    expect(invent(storageRoot)).toEqual(before);
    root.close();
  });
});

describe('F2 close-pending lifecycle', () => {
  it('blocks operations after failed close and retries deterministically', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
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

    const firstClose = opened.value.close();
    expect(firstClose.ok).toBe(false);
    if (firstClose.ok) return;
    expect(firstClose.error.code).toBe('SQLITE_CLOSE_FAILED');

    const afterFail = await opened.value.memory.read(
      {
        recordId: asRecordId('alive'),
        expectedOwnerId: access.ownerId,
        expectedNamespace: 'personal',
      },
      access,
    );
    expect(afterFail.ok).toBe(false);
    if (!afterFail.ok && afterFail.error.code === 'VALIDATION_FAILED')
      expect(afterFail.error.reason).toMatch(/closed/i);

    const writeDenied = await opened.value.memory.write(
      verifiedWrite({ recordId: 'after-close' }),
      access,
    );
    expect(writeDenied.ok).toBe(false);

    const secondClose = opened.value.close();
    expect(secondClose.ok).toBe(false);

    const thirdClose = opened.value.close();
    expect(thirdClose.ok).toBe(true);
    expect(opened.value.close().ok).toBe(true);

    const copied = opened.value.close;
    expect(copied.call({} as never).ok).toBe(true);

    expect(Object.keys(opened.value)).toEqual(['memory', 'diagnostics', 'close']);
    expect(opened.value).not.toHaveProperty('db');
    expect(opened.value).not.toHaveProperty('statements');

    root.close();
  });
});

describe('F7 quick_check completeness', () => {
  it('rejects empty, malformed, and partial multi-row results', () => {
    const fake = {
      pragma: (name: string) => {
        if (name !== 'quick_check') throw new Error('unexpected');
        return [{ quick_check: 'ok' }, { quick_check: 'row error' }];
      },
    } as unknown as SqliteDatabase;
    expect(runSqliteQuickCheck(fake).ok).toBe(false);

    const empty = { pragma: () => [] } as unknown as SqliteDatabase;
    expect(runSqliteQuickCheck(empty).ok).toBe(false);

    const malformed = { pragma: () => [{ a: 'ok', b: 'x' }] } as unknown as SqliteDatabase;
    expect(runSqliteQuickCheck(malformed).ok).toBe(false);

    const okOnly = { pragma: () => [{ quick_check: 'ok' }] } as unknown as SqliteDatabase;
    expect(runSqliteQuickCheck(okOnly).ok).toBe(true);
  });
});

describe('foreign-volume query ceiling', () => {
  it('does not let foreign-owner rows consume LIMIT (in-memory and SQLite)', async () => {
    const run = async (memory: MemoryPort) => {
      const own = authenticatedAccess({ ownerId: 'owner-own' });
      for (let index = 0; index < 100; index += 1) {
        const foreign = authenticatedAccess({ ownerId: `owner-f${String(index)}` });
        await memory.write(
          verifiedWrite({
            recordId: `foreign-${String(index)}`,
            ownerId: `owner-f${String(index)}`,
            content: `f-${String(index)}`,
          }),
          foreign,
        );
      }
      await memory.write(
        verifiedWrite({ recordId: 'own-1', ownerId: 'owner-own', content: 'o1' }),
        own,
      );
      await memory.write(
        verifiedWrite({ recordId: 'own-2', ownerId: 'owner-own', content: 'o2' }),
        own,
      );
      await memory.write(
        verifiedWrite({ recordId: 'own-3', ownerId: 'owner-own', content: 'o3' }),
        own,
      );
      const result = await memory.query(
        queryRequest({ limit: 2, expectedOwnerId: asOwner('owner-own') }),
        own,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((row) => row.content)).toEqual(['o1', 'o2']);
    };

    await run(createInMemoryMemoryStore());

    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createSqliteMemoryPort(root);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await run(opened.value.memory);
    opened.value.close();
    root.close();
  });
});

describe('same-root two adapters', () => {
  it('keeps two adapters independent without claiming lock protection', async () => {
    const storageRoot = createTempStorageRoot();
    const rootA = openGenuineRoot(storageRoot);
    const rootB = openGenuineRoot(storageRoot);
    const a = createSqliteMemoryPort(rootA);
    const b = createSqliteMemoryPort(rootB);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.value.diagnostics.exclusiveProcessLock).toBe(false);
    expect(a.value.diagnostics.secondInstanceProtection).toBe(false);

    await a.value.memory.write(
      verifiedWrite({ recordId: 'shared-root', content: 'via-a' }),
      authenticatedAccess(),
    );
    const readB = await b.value.memory.read(
      {
        recordId: asRecordId('shared-root'),
        expectedOwnerId: asOwner(),
        expectedNamespace: 'personal',
      },
      authenticatedAccess(),
    );
    expect(readB.ok && readB.value.content).toBe('via-a');

    expect(a.value.close().ok).toBe(true);
    const stillB = await b.value.memory.read(
      {
        recordId: asRecordId('shared-root'),
        expectedOwnerId: asOwner(),
        expectedNamespace: 'personal',
      },
      authenticatedAccess(),
    );
    expect(stillB.ok && stillB.value.content).toBe('via-a');
    expect(b.value.close().ok).toBe(true);
    rootA.close();
    rootB.close();
  });
});

describe('repository hygiene after SQLite tests', () => {
  it('leaves no sqlite artifacts under the repository tree', () => {
    const walk = (root: string): string[] => {
      const found: string[] = [];
      for (const name of readdirSync(root)) {
        if (name === 'node_modules' || name === '.git') continue;
        const path = join(root, name);
        const st = statSync(path);
        if (st.isDirectory()) found.push(...walk(path));
        else if (/\.(sqlite3?|db)$/i.test(name) || /-(wal|shm)$/i.test(name)) found.push(path);
      }
      return found;
    };
    expect(walk(process.cwd()).filter((path) => !path.includes('openclaw-neo-b2'))).toEqual([]);
  });
});
