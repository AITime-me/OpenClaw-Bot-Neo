import {
  SQLITE_MEMORY_SCHEMA_VERSION,
  SQLITE_MEMORY_BUSY_TIMEOUT_MS,
} from './sqlite-memory-constants.js';
import type { SqliteDatabase } from './better-sqlite3-driver.js';

export const MEMORY_META_TABLE = 'memory_meta';
export const MEMORY_RECORDS_TABLE = 'memory_records';
export const MEMORY_RECORDS_QUERY_INDEX = 'memory_records_query_idx';

const CREATE_META = `
CREATE TABLE memory_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL
) STRICT;
`;

const CREATE_RECORDS = `
CREATE TABLE memory_records (
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
) STRICT;
`;

const CREATE_QUERY_INDEX = `
CREATE INDEX memory_records_query_idx
  ON memory_records (owner_id, namespace, insertion_ordinal);
`;

export type SqlitePragmaSnapshot = {
  readonly foreignKeys: number;
  readonly busyTimeout: number;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly trustedSchema: number | null;
};

export const applySqliteMemoryPragmas = (db: SqliteDatabase): SqlitePragmaSnapshot => {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = ' + String(SQLITE_MEMORY_BUSY_TIMEOUT_MS));
  db.pragma('journal_mode = WAL');
  // NORMAL balances durability with fsync cost for a single-owner local agent DB.
  db.pragma('synchronous = NORMAL');
  let trustedSchema: number | null;
  try {
    db.pragma('trusted_schema = OFF');
    const value = db.pragma('trusted_schema', { simple: true });
    trustedSchema = typeof value === 'number' ? value : Number(value);
  } catch {
    trustedSchema = null;
  }

  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true }));
  const busyTimeout = Number(db.pragma('busy_timeout', { simple: true }));
  const journalMode = String(db.pragma('journal_mode', { simple: true })).toLowerCase();
  const synchronous = Number(db.pragma('synchronous', { simple: true }));

  return Object.freeze({
    foreignKeys,
    busyTimeout,
    journalMode,
    synchronous,
    trustedSchema,
  });
};

export const verifySqliteMemoryPragmas = (
  snapshot: SqlitePragmaSnapshot,
): { ok: true } | { ok: false; reason: string } => {
  if (snapshot.foreignKeys !== 1) return { ok: false, reason: 'foreign_keys' };
  if (snapshot.busyTimeout !== SQLITE_MEMORY_BUSY_TIMEOUT_MS)
    return { ok: false, reason: 'busy_timeout' };
  if (snapshot.journalMode !== 'wal') return { ok: false, reason: 'journal_mode' };
  // NORMAL == 1 in SQLite
  if (snapshot.synchronous !== 1) return { ok: false, reason: 'synchronous' };
  if (snapshot.trustedSchema !== null && snapshot.trustedSchema !== 0)
    return { ok: false, reason: 'trusted_schema' };
  return { ok: true };
};

/**
 * Bounded integrity check. Every returned row must be the exact success token `ok`.
 * Partial success (first row ok + later errors) is rejected.
 */
export const runSqliteQuickCheck = (
  db: SqliteDatabase,
): { ok: true } | { ok: false; reason: string } => {
  let rows: unknown;
  try {
    rows = db.pragma('quick_check');
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'empty' };

  for (const row of rows) {
    if (row === null || typeof row !== 'object') return { ok: false, reason: 'malformed' };
    const values = Object.values(row as Record<string, unknown>);
    if (values.length !== 1) return { ok: false, reason: 'malformed' };
    if (values[0] !== 'ok') return { ok: false, reason: 'failed' };
  }
  return { ok: true };
};

export const isSqliteDatabaseEmpty = (db: SqliteDatabase): boolean => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')`,
    )
    .get() as { n: number } | undefined;
  return row !== undefined && row.n === 0;
};

export const bootstrapSqliteMemorySchemaV1 = (db: SqliteDatabase): void => {
  const tx = db.transaction(() => {
    db.exec(CREATE_META);
    db.exec(CREATE_RECORDS);
    db.exec(CREATE_QUERY_INDEX);
    db.prepare(`INSERT INTO memory_meta (id, schema_version) VALUES (1, ?)`).run(
      SQLITE_MEMORY_SCHEMA_VERSION,
    );
  });
  tx();
};

type ColumnInfo = {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
  readonly pk: number;
};

type MasterObject = {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
};

type IndexListEntry = {
  readonly seq: number;
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
};

type IndexInfoEntry = {
  readonly seqno: number;
  readonly cid: number;
  readonly name: string;
};

const META_COLUMNS = Object.freeze([
  Object.freeze({ name: 'id', type: 'INTEGER', notnull: 0, pk: 1, dflt: null }),
  Object.freeze({ name: 'schema_version', type: 'INTEGER', notnull: 1, pk: 0, dflt: null }),
]);

const RECORD_COLUMNS = Object.freeze([
  Object.freeze({ name: 'insertion_ordinal', type: 'INTEGER', notnull: 0, pk: 1, dflt: null }),
  Object.freeze({ name: 'owner_id', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'namespace', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'record_id', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'content', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'source_json', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'provenance_json', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({
    name: 'privacy_classification',
    type: 'TEXT',
    notnull: 1,
    pk: 0,
    dflt: null,
  }),
  Object.freeze({ name: 'trust_level', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'retention_json', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'created_at', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
  Object.freeze({ name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0, dflt: null }),
]);

const UNIQUE_COLUMNS = Object.freeze(['owner_id', 'namespace', 'record_id'] as const);
const QUERY_INDEX_COLUMNS = Object.freeze(['owner_id', 'namespace', 'insertion_ordinal'] as const);

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim().toUpperCase();

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const readUserObjects = (db: SqliteDatabase): MasterObject[] =>
  db
    .prepare(
      `SELECT type, name, tbl_name, sql
         FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name`,
    )
    .all() as MasterObject[];

const verifyColumns = (
  db: SqliteDatabase,
  table: string,
  expected: readonly {
    readonly name: string;
    readonly type: string;
    readonly notnull: number;
    readonly pk: number;
    readonly dflt: null;
  }[],
): { ok: true } | { ok: false; reason: string } => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  if (columns.length !== expected.length) return fail('column_count');
  for (let index = 0; index < expected.length; index += 1) {
    const actual = columns[index];
    const want = expected[index];
    if (actual === undefined || want === undefined) return fail('column_order');
    if (actual.cid !== index) return fail('column_order');
    if (actual.name !== want.name) return fail('column_name');
    if (actual.type.toUpperCase() !== want.type) return fail('column_type');
    if (actual.notnull !== want.notnull) return fail('column_notnull');
    if (actual.pk !== want.pk) return fail('column_pk');
    if (actual.dflt_value !== want.dflt) return fail('column_default');
  }
  return { ok: true };
};

const verifyIndexColumns = (
  db: SqliteDatabase,
  indexName: string,
  expected: readonly string[],
): { ok: true } | { ok: false; reason: string } => {
  const info = db.prepare(`PRAGMA index_info(${indexName})`).all() as IndexInfoEntry[];
  if (info.length !== expected.length) return fail('index_columns');
  for (let index = 0; index < expected.length; index += 1) {
    const entry = info[index];
    if (entry === undefined || entry.seqno !== index || entry.name !== expected[index])
      return fail('index_columns');
  }
  return { ok: true };
};

/**
 * Exact v1 schema verification. Fail-closed on unexpected objects, wrong columns,
 * wrong UNIQUE composition/order, wrong indexes, triggers/views, or malformed metadata.
 * Does not repair, drop, recreate, or mutate the database.
 */
export const verifySqliteMemorySchemaV1 = (
  db: SqliteDatabase,
): { ok: true } | { ok: false; reason: string } => {
  const objects = readUserObjects(db);

  const byName = new Map<string, MasterObject>();
  for (const object of objects) {
    if (byName.has(object.name)) return fail('duplicate_object');
    byName.set(object.name, object);
  }

  const meta = byName.get(MEMORY_META_TABLE);
  const records = byName.get(MEMORY_RECORDS_TABLE);
  const queryIndex = byName.get(MEMORY_RECORDS_QUERY_INDEX);

  if (meta === undefined && records === undefined) return fail('missing_schema');
  if (meta === undefined || records === undefined) return fail('partial_schema');
  if (meta.type !== 'table' || records.type !== 'table') return fail('object_kind');
  if (queryIndex === undefined) return fail('missing_index');
  if (queryIndex.type !== 'index') return fail('object_kind');
  if (queryIndex.tbl_name !== MEMORY_RECORDS_TABLE) return fail('index_table');

  // Unique constraint creates exactly one sqlite_autoindex_* for memory_records.
  const autoIndexes = objects.filter(
    (object) =>
      object.type === 'index' &&
      object.tbl_name === MEMORY_RECORDS_TABLE &&
      object.name.startsWith('sqlite_autoindex_memory_records_'),
  );
  // Note: sqlite_autoindex_* is named with sqlite_ prefix and filtered out of readUserObjects.
  // Discover via PRAGMA index_list instead.
  void autoIndexes;

  for (const object of objects) {
    if (object.type === 'trigger' || object.type === 'view') return fail('unexpected_object');
    if (object.type === 'table') {
      if (object.name !== MEMORY_META_TABLE && object.name !== MEMORY_RECORDS_TABLE)
        return fail('unexpected_table');
    } else if (object.type === 'index') {
      if (object.name !== MEMORY_RECORDS_QUERY_INDEX) return fail('unexpected_index');
    } else {
      return fail('unexpected_object');
    }
  }

  const metaColumns = verifyColumns(db, MEMORY_META_TABLE, META_COLUMNS);
  if (!metaColumns.ok) return metaColumns;

  const recordColumns = verifyColumns(db, MEMORY_RECORDS_TABLE, RECORD_COLUMNS);
  if (!recordColumns.ok) return recordColumns;

  const metaSql = typeof meta.sql === 'string' ? normalizeSql(meta.sql) : '';
  if (!metaSql.includes('CHECK (ID = 1)') && !metaSql.includes('CHECK(ID = 1)'))
    return fail('meta_check');
  if (!metaSql.includes('STRICT')) return fail('meta_strict');

  const recordsSql = typeof records.sql === 'string' ? normalizeSql(records.sql) : '';
  if (!recordsSql.includes('AUTOINCREMENT')) return fail('missing_autoincrement');
  if (!recordsSql.includes('STRICT')) return fail('records_strict');
  if (!recordsSql.includes('UNIQUE (OWNER_ID, NAMESPACE, RECORD_ID)')) return fail('unique_ddl');

  const indexList = db
    .prepare(`PRAGMA index_list(${MEMORY_RECORDS_TABLE})`)
    .all() as IndexListEntry[];
  const uniqueIndexes = indexList.filter((entry) => entry.unique === 1);
  if (uniqueIndexes.length !== 1) return fail('unique_count');
  const uniqueIndex = uniqueIndexes[0];
  if (uniqueIndex === undefined || uniqueIndex.partial !== 0) return fail('unique_partial');
  const uniqueCols = verifyIndexColumns(db, uniqueIndex.name, UNIQUE_COLUMNS);
  if (!uniqueCols.ok) return fail('unique_columns');

  const queryEntry = indexList.find((entry) => entry.name === MEMORY_RECORDS_QUERY_INDEX);
  if (queryEntry === undefined) return fail('missing_index');
  if (queryEntry.unique !== 0) return fail('query_index_unique');
  if (queryEntry.partial !== 0) return fail('query_index_partial');
  const queryCols = verifyIndexColumns(db, MEMORY_RECORDS_QUERY_INDEX, QUERY_INDEX_COLUMNS);
  if (!queryCols.ok) return queryCols;

  // Reject any extra indexes on memory_records beyond UNIQUE autoindex + query index.
  if (indexList.length !== 2) return fail('unexpected_index');

  const metaRows = db
    .prepare(`SELECT id, schema_version FROM ${MEMORY_META_TABLE}`)
    .all() as Array<{
    id: unknown;
    schema_version: unknown;
  }>;
  if (metaRows.length !== 1) return fail('meta_row_count');
  const metaRow = metaRows[0];
  if (metaRow === undefined) return fail('missing_meta_row');
  if (metaRow.id !== 1) return fail('meta_id');
  if (typeof metaRow.schema_version !== 'number') return fail('malformed_meta');
  if (!Number.isInteger(metaRow.schema_version)) return fail('malformed_meta');
  if (metaRow.schema_version !== SQLITE_MEMORY_SCHEMA_VERSION) {
    if (metaRow.schema_version > SQLITE_MEMORY_SCHEMA_VERSION) return fail('future_version');
    return fail('unsupported_version');
  }

  return { ok: true };
};

/** Snapshot of user-visible schema objects for tamper detection in tests. */
export const listSqliteUserSchemaInventory = (
  db: SqliteDatabase,
): readonly { readonly type: string; readonly name: string; readonly sql: string | null }[] =>
  Object.freeze(
    readUserObjects(db).map((object) =>
      Object.freeze({ type: object.type, name: object.name, sql: object.sql }),
    ),
  );
