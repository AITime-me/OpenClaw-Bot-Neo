import {
  SQLITE_COMMUNICATION_BUSY_TIMEOUT_MS,
  SQLITE_COMMUNICATION_SCHEMA_VERSION,
} from './sqlite-communication-constants.js';
import type { SqliteDatabase } from '../better-sqlite3-driver.js';

export const COMMUNICATION_META_TABLE = 'communication_meta';
export const TURN_DEDUP_TABLE = 'turn_dedup';
export const TURNS_TABLE = 'turns';
export const SEQUENCE_COUNTERS_TABLE = 'sequence_counters';
export const FACTUAL_HISTORY_TABLE = 'factual_history';
export const CONVERSATION_SNAPSHOTS_TABLE = 'conversation_snapshots';
export const CHECKPOINT_OPS_TABLE = 'checkpoint_ops';
export const AUDIT_START_TABLE = 'audit_start';
export const AUDIT_COMPLETION_TABLE = 'audit_completion';
export const OUTBOX_ENTRIES_TABLE = 'outbox_entries';
export const OUTBOX_OUTCOMES_TABLE = 'outbox_outcomes';
export const OUTBOX_RECONCILE_OPS_TABLE = 'outbox_reconcile_ops';

export const TURNS_RECOVERY_INDEX = 'turns_recovery_idx';
export const TURNS_OWNER_CONVERSATION_INDEX = 'turns_owner_conversation_idx';
export const OUTBOX_EXPIRES_INDEX = 'outbox_expires_idx';

const CREATE_META = `
CREATE TABLE communication_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL
) STRICT;
`;

const CREATE_TURNS = `
CREATE TABLE turns (
  turn_id TEXT PRIMARY KEY,
  transport_instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  turn_revision INTEGER NOT NULL,
  conversation_sequence INTEGER,
  owner_id TEXT,
  conversation_id TEXT,
  correlation_id TEXT,
  delivery_status TEXT NOT NULL,
  checkpoint_status TEXT NOT NULL,
  audit_start_status TEXT NOT NULL,
  audit_completion_status TEXT NOT NULL,
  llm_outcome TEXT,
  error_code TEXT,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

const CREATE_TURN_DEDUP = `
CREATE TABLE turn_dedup (
  idempotency_key TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(turn_id)
) STRICT;
`;

const CREATE_SEQUENCE_COUNTERS = `
CREATE TABLE sequence_counters (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  next_sequence INTEGER NOT NULL,
  PRIMARY KEY (owner_id, conversation_id)
) STRICT;
`;

const CREATE_FACTUAL_HISTORY = `
CREATE TABLE factual_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  llm_outcome TEXT,
  delivery_status TEXT NOT NULL,
  checkpoint_status TEXT NOT NULL,
  audit_start_status TEXT NOT NULL,
  audit_completion_status TEXT NOT NULL,
  error_code TEXT,
  turn_revision INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(turn_id)
) STRICT;
`;

const CREATE_CONVERSATION_SNAPSHOTS = `
CREATE TABLE conversation_snapshots (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  pause_state TEXT NOT NULL,
  checkpoint_status TEXT NOT NULL,
  checkpoint_revision INTEGER NOT NULL,
  active_context_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, conversation_id)
) STRICT;
`;

const CREATE_CHECKPOINT_OPS = `
CREATE TABLE checkpoint_ops (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  op_kind TEXT NOT NULL,
  fingerprint TEXT,
  revision_after INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, conversation_id, idempotency_key)
) STRICT;
`;

const CREATE_AUDIT_START = `
CREATE TABLE audit_start (
  idempotency_key TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata_json TEXT NOT NULL
) STRICT;
`;

const CREATE_AUDIT_COMPLETION = `
CREATE TABLE audit_completion (
  idempotency_key TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  checkpoint_status TEXT NOT NULL,
  audit_start_status TEXT NOT NULL,
  audit_completion_status TEXT NOT NULL,
  error_code TEXT,
  metadata_json TEXT NOT NULL
) STRICT;
`;

const CREATE_OUTBOX_ENTRIES = `
CREATE TABLE outbox_entries (
  turn_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  output_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sealed_binding_version TEXT NOT NULL,
  plaintext_payload TEXT,
  scrubbed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (turn_id, correlation_id, output_digest)
) STRICT;
`;

const CREATE_OUTBOX_OUTCOMES = `
CREATE TABLE outbox_outcomes (
  turn_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (turn_id, correlation_id)
) STRICT;
`;

const CREATE_OUTBOX_RECONCILE_OPS = `
CREATE TABLE outbox_reconcile_ops (
  idempotency_key TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;

const CREATE_TURNS_RECOVERY_INDEX = `
CREATE INDEX turns_recovery_idx
  ON turns (updated_at, observed_at, turn_id);
`;

const CREATE_TURNS_OWNER_CONVERSATION_INDEX = `
CREATE INDEX turns_owner_conversation_idx
  ON turns (owner_id, conversation_id, state);
`;

const CREATE_OUTBOX_EXPIRES_INDEX = `
CREATE INDEX outbox_expires_idx
  ON outbox_entries (expires_at, scrubbed);
`;

export type SqlitePragmaSnapshot = {
  readonly foreignKeys: number;
  readonly busyTimeout: number;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly trustedSchema: number | null;
};

export const applySqliteCommunicationPragmas = (db: SqliteDatabase): SqlitePragmaSnapshot => {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = ' + String(SQLITE_COMMUNICATION_BUSY_TIMEOUT_MS));
  db.pragma('journal_mode = WAL');
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

export const verifySqliteCommunicationPragmas = (
  snapshot: SqlitePragmaSnapshot,
): { ok: true } | { ok: false; reason: string } => {
  if (snapshot.foreignKeys !== 1) return { ok: false, reason: 'foreign_keys' };
  if (snapshot.busyTimeout !== SQLITE_COMMUNICATION_BUSY_TIMEOUT_MS)
    return { ok: false, reason: 'busy_timeout' };
  if (snapshot.journalMode !== 'wal') return { ok: false, reason: 'journal_mode' };
  if (snapshot.synchronous !== 1) return { ok: false, reason: 'synchronous' };
  if (snapshot.trustedSchema !== null && snapshot.trustedSchema !== 0)
    return { ok: false, reason: 'trusted_schema' };
  return { ok: true };
};

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

/**
 * Migration 0 → 1: create the full v1 inventory and meta row in one atomic transaction.
 * Rolls back with no partial publication on any failure.
 */
export const migrateCommunicationSchema0To1 = (db: SqliteDatabase): void => {
  const tx = db.transaction(() => {
    db.exec(CREATE_META);
    db.exec(CREATE_TURNS);
    db.exec(CREATE_TURN_DEDUP);
    db.exec(CREATE_SEQUENCE_COUNTERS);
    db.exec(CREATE_FACTUAL_HISTORY);
    db.exec(CREATE_CONVERSATION_SNAPSHOTS);
    db.exec(CREATE_CHECKPOINT_OPS);
    db.exec(CREATE_AUDIT_START);
    db.exec(CREATE_AUDIT_COMPLETION);
    db.exec(CREATE_OUTBOX_ENTRIES);
    db.exec(CREATE_OUTBOX_OUTCOMES);
    db.exec(CREATE_OUTBOX_RECONCILE_OPS);
    db.exec(CREATE_TURNS_RECOVERY_INDEX);
    db.exec(CREATE_TURNS_OWNER_CONVERSATION_INDEX);
    db.exec(CREATE_OUTBOX_EXPIRES_INDEX);
    db.prepare(`INSERT INTO communication_meta (id, schema_version) VALUES (1, ?)`).run(
      SQLITE_COMMUNICATION_SCHEMA_VERSION,
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

type ExpectedColumn = {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly pk: number;
  readonly dflt: null;
};

const col = (name: string, type: string, notnull: number, pk: number): ExpectedColumn =>
  Object.freeze({ name, type, notnull, pk, dflt: null });

const META_COLUMNS = Object.freeze([
  col('id', 'INTEGER', 0, 1),
  col('schema_version', 'INTEGER', 1, 0),
]);

const TURNS_COLUMNS = Object.freeze([
  col('turn_id', 'TEXT', 1, 1),
  col('transport_instance_id', 'TEXT', 1, 0),
  col('idempotency_key', 'TEXT', 1, 0),
  col('state', 'TEXT', 1, 0),
  col('turn_revision', 'INTEGER', 1, 0),
  col('conversation_sequence', 'INTEGER', 0, 0),
  col('owner_id', 'TEXT', 0, 0),
  col('conversation_id', 'TEXT', 0, 0),
  col('correlation_id', 'TEXT', 0, 0),
  col('delivery_status', 'TEXT', 1, 0),
  col('checkpoint_status', 'TEXT', 1, 0),
  col('audit_start_status', 'TEXT', 1, 0),
  col('audit_completion_status', 'TEXT', 1, 0),
  col('llm_outcome', 'TEXT', 0, 0),
  col('error_code', 'TEXT', 0, 0),
  col('observed_at', 'TEXT', 1, 0),
  col('updated_at', 'TEXT', 1, 0),
]);

const TURN_DEDUP_COLUMNS = Object.freeze([
  col('idempotency_key', 'TEXT', 1, 1),
  col('turn_id', 'TEXT', 1, 0),
  col('created_at', 'TEXT', 1, 0),
]);

const SEQUENCE_COUNTERS_COLUMNS = Object.freeze([
  col('owner_id', 'TEXT', 1, 1),
  col('conversation_id', 'TEXT', 1, 2),
  col('next_sequence', 'INTEGER', 1, 0),
]);

const FACTUAL_HISTORY_COLUMNS = Object.freeze([
  col('id', 'INTEGER', 0, 1),
  col('turn_id', 'TEXT', 1, 0),
  col('recorded_at', 'TEXT', 1, 0),
  col('llm_outcome', 'TEXT', 0, 0),
  col('delivery_status', 'TEXT', 1, 0),
  col('checkpoint_status', 'TEXT', 1, 0),
  col('audit_start_status', 'TEXT', 1, 0),
  col('audit_completion_status', 'TEXT', 1, 0),
  col('error_code', 'TEXT', 0, 0),
  col('turn_revision', 'INTEGER', 1, 0),
]);

const CONVERSATION_SNAPSHOTS_COLUMNS = Object.freeze([
  col('owner_id', 'TEXT', 1, 1),
  col('conversation_id', 'TEXT', 1, 2),
  col('revision', 'INTEGER', 1, 0),
  col('pause_state', 'TEXT', 1, 0),
  col('checkpoint_status', 'TEXT', 1, 0),
  col('checkpoint_revision', 'INTEGER', 1, 0),
  col('active_context_json', 'TEXT', 1, 0),
  col('summary_json', 'TEXT', 1, 0),
  col('fingerprint', 'TEXT', 1, 0),
  col('updated_at', 'TEXT', 1, 0),
]);

const CHECKPOINT_OPS_COLUMNS = Object.freeze([
  col('owner_id', 'TEXT', 1, 1),
  col('conversation_id', 'TEXT', 1, 2),
  col('idempotency_key', 'TEXT', 1, 3),
  col('op_kind', 'TEXT', 1, 0),
  col('fingerprint', 'TEXT', 0, 0),
  col('revision_after', 'INTEGER', 0, 0),
  col('created_at', 'TEXT', 1, 0),
]);

const AUDIT_START_COLUMNS = Object.freeze([
  col('idempotency_key', 'TEXT', 1, 1),
  col('turn_id', 'TEXT', 1, 0),
  col('correlation_id', 'TEXT', 1, 0),
  col('owner_id', 'TEXT', 1, 0),
  col('conversation_id', 'TEXT', 1, 0),
  col('operation_kind', 'TEXT', 1, 0),
  col('policy_version', 'TEXT', 1, 0),
  col('timestamp', 'TEXT', 1, 0),
  col('metadata_json', 'TEXT', 1, 0),
]);

const AUDIT_COMPLETION_COLUMNS = Object.freeze([
  col('idempotency_key', 'TEXT', 1, 1),
  col('turn_id', 'TEXT', 1, 0),
  col('correlation_id', 'TEXT', 1, 0),
  col('owner_id', 'TEXT', 1, 0),
  col('conversation_id', 'TEXT', 1, 0),
  col('operation_kind', 'TEXT', 1, 0),
  col('policy_version', 'TEXT', 1, 0),
  col('timestamp', 'TEXT', 1, 0),
  col('delivery_status', 'TEXT', 1, 0),
  col('checkpoint_status', 'TEXT', 1, 0),
  col('audit_start_status', 'TEXT', 1, 0),
  col('audit_completion_status', 'TEXT', 1, 0),
  col('error_code', 'TEXT', 0, 0),
  col('metadata_json', 'TEXT', 1, 0),
]);

const OUTBOX_ENTRIES_COLUMNS = Object.freeze([
  col('turn_id', 'TEXT', 1, 1),
  col('correlation_id', 'TEXT', 1, 2),
  col('output_digest', 'TEXT', 1, 3),
  col('expires_at', 'TEXT', 1, 0),
  col('sealed_binding_version', 'TEXT', 1, 0),
  col('plaintext_payload', 'TEXT', 0, 0),
  col('scrubbed', 'INTEGER', 1, 0),
  col('created_at', 'TEXT', 1, 0),
]);

const OUTBOX_OUTCOMES_COLUMNS = Object.freeze([
  col('turn_id', 'TEXT', 1, 1),
  col('correlation_id', 'TEXT', 1, 2),
  col('idempotency_key', 'TEXT', 1, 0),
  col('outcome', 'TEXT', 1, 0),
  col('recorded_at', 'TEXT', 1, 0),
]);

const OUTBOX_RECONCILE_OPS_COLUMNS = Object.freeze([
  col('idempotency_key', 'TEXT', 1, 1),
  col('turn_id', 'TEXT', 1, 0),
  col('correlation_id', 'TEXT', 1, 0),
  col('created_at', 'TEXT', 1, 0),
]);

const EXPECTED_TABLES = Object.freeze([
  COMMUNICATION_META_TABLE,
  TURNS_TABLE,
  TURN_DEDUP_TABLE,
  SEQUENCE_COUNTERS_TABLE,
  FACTUAL_HISTORY_TABLE,
  CONVERSATION_SNAPSHOTS_TABLE,
  CHECKPOINT_OPS_TABLE,
  AUDIT_START_TABLE,
  AUDIT_COMPLETION_TABLE,
  OUTBOX_ENTRIES_TABLE,
  OUTBOX_OUTCOMES_TABLE,
  OUTBOX_RECONCILE_OPS_TABLE,
] as const);

const EXPECTED_INDEXES = Object.freeze([
  TURNS_RECOVERY_INDEX,
  TURNS_OWNER_CONVERSATION_INDEX,
  OUTBOX_EXPIRES_INDEX,
] as const);

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
  expected: readonly ExpectedColumn[],
): { ok: true } | { ok: false; reason: string } => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  if (columns.length !== expected.length) return fail(`${table}_column_count`);
  for (let index = 0; index < expected.length; index += 1) {
    const actual = columns[index];
    const want = expected[index];
    if (actual === undefined || want === undefined) return fail(`${table}_column_order`);
    if (actual.cid !== index) return fail(`${table}_column_order`);
    if (actual.name !== want.name) return fail(`${table}_column_name`);
    if (actual.type.toUpperCase() !== want.type) return fail(`${table}_column_type`);
    if (actual.notnull !== want.notnull)
      return fail(`${table}_column_notnull:${want.name}:${String(actual.notnull)}`);
    if (actual.pk !== want.pk) return fail(`${table}_column_pk:${want.name}:${String(actual.pk)}`);
    if (actual.dflt_value !== want.dflt) return fail(`${table}_column_default`);
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

const requireStrictTable = (
  object: MasterObject | undefined,
  label: string,
): { ok: true } | { ok: false; reason: string } => {
  if (object === undefined) return fail(`missing_${label}`);
  if (object.type !== 'table') return fail('object_kind');
  const sql = typeof object.sql === 'string' ? normalizeSql(object.sql) : '';
  if (!sql.includes('STRICT')) return fail(`${label}_strict`);
  return { ok: true };
};

/**
 * Exact v1 schema verification. Fail-closed on unexpected objects, wrong columns,
 * wrong indexes, triggers/views, or malformed/future metadata. Does not mutate.
 */
export const verifyCommunicationSchemaV1 = (
  db: SqliteDatabase,
): { ok: true } | { ok: false; reason: string } => {
  const objects = readUserObjects(db);
  const byName = new Map<string, MasterObject>();
  for (const object of objects) {
    if (byName.has(object.name)) return fail('duplicate_object');
    byName.set(object.name, object);
  }

  for (const table of EXPECTED_TABLES) {
    if (!byName.has(table)) return fail('partial_schema');
  }
  for (const index of EXPECTED_INDEXES) {
    if (!byName.has(index)) return fail('missing_index');
  }

  for (const object of objects) {
    if (object.type === 'trigger' || object.type === 'view') return fail('unexpected_object');
    if (object.type === 'table') {
      if (!(EXPECTED_TABLES as readonly string[]).includes(object.name))
        return fail('unexpected_table');
    } else if (object.type === 'index') {
      if (!(EXPECTED_INDEXES as readonly string[]).includes(object.name))
        return fail('unexpected_index');
    } else {
      return fail('unexpected_object');
    }
  }

  const meta = byName.get(COMMUNICATION_META_TABLE);
  const metaStrict = requireStrictTable(meta, 'meta');
  if (!metaStrict.ok) return metaStrict;
  const metaSql = typeof meta?.sql === 'string' ? normalizeSql(meta.sql) : '';
  if (!metaSql.includes('CHECK (ID = 1)') && !metaSql.includes('CHECK(ID = 1)'))
    return fail('meta_check');

  for (const table of EXPECTED_TABLES) {
    if (table === COMMUNICATION_META_TABLE) continue;
    const object = byName.get(table);
    const strict = requireStrictTable(object, table);
    if (!strict.ok) return strict;
  }

  const columnChecks: Array<readonly [string, readonly ExpectedColumn[]]> = [
    [COMMUNICATION_META_TABLE, META_COLUMNS],
    [TURNS_TABLE, TURNS_COLUMNS],
    [TURN_DEDUP_TABLE, TURN_DEDUP_COLUMNS],
    [SEQUENCE_COUNTERS_TABLE, SEQUENCE_COUNTERS_COLUMNS],
    [FACTUAL_HISTORY_TABLE, FACTUAL_HISTORY_COLUMNS],
    [CONVERSATION_SNAPSHOTS_TABLE, CONVERSATION_SNAPSHOTS_COLUMNS],
    [CHECKPOINT_OPS_TABLE, CHECKPOINT_OPS_COLUMNS],
    [AUDIT_START_TABLE, AUDIT_START_COLUMNS],
    [AUDIT_COMPLETION_TABLE, AUDIT_COMPLETION_COLUMNS],
    [OUTBOX_ENTRIES_TABLE, OUTBOX_ENTRIES_COLUMNS],
    [OUTBOX_OUTCOMES_TABLE, OUTBOX_OUTCOMES_COLUMNS],
    [OUTBOX_RECONCILE_OPS_TABLE, OUTBOX_RECONCILE_OPS_COLUMNS],
  ];
  for (const [table, columns] of columnChecks) {
    const verified = verifyColumns(db, table, columns);
    if (!verified.ok) return verified;
  }

  const factual = byName.get(FACTUAL_HISTORY_TABLE);
  const factualSql = typeof factual?.sql === 'string' ? normalizeSql(factual.sql) : '';
  if (!factualSql.includes('AUTOINCREMENT')) return fail('missing_autoincrement');

  const recoveryCols = verifyIndexColumns(db, TURNS_RECOVERY_INDEX, [
    'updated_at',
    'observed_at',
    'turn_id',
  ]);
  if (!recoveryCols.ok) return recoveryCols;
  const ownerCols = verifyIndexColumns(db, TURNS_OWNER_CONVERSATION_INDEX, [
    'owner_id',
    'conversation_id',
    'state',
  ]);
  if (!ownerCols.ok) return ownerCols;
  const expiresCols = verifyIndexColumns(db, OUTBOX_EXPIRES_INDEX, ['expires_at', 'scrubbed']);
  if (!expiresCols.ok) return expiresCols;

  const turnsIndexes = db.prepare(`PRAGMA index_list(${TURNS_TABLE})`).all() as IndexListEntry[];
  const namedTurnsIndexes = turnsIndexes.filter(
    (entry) => !entry.name.startsWith('sqlite_autoindex_'),
  );
  if (namedTurnsIndexes.length !== 2) return fail('unexpected_index');

  const metaRows = db
    .prepare(`SELECT id, schema_version FROM ${COMMUNICATION_META_TABLE}`)
    .all() as Array<{ id: unknown; schema_version: unknown }>;
  if (metaRows.length !== 1) return fail('meta_row_count');
  const metaRow = metaRows[0];
  if (metaRow === undefined) return fail('missing_meta_row');
  if (metaRow.id !== 1) return fail('meta_id');
  if (typeof metaRow.schema_version !== 'number' || !Number.isInteger(metaRow.schema_version))
    return fail('malformed_meta');
  if (metaRow.schema_version !== SQLITE_COMMUNICATION_SCHEMA_VERSION) {
    if (metaRow.schema_version > SQLITE_COMMUNICATION_SCHEMA_VERSION) return fail('future_version');
    return fail('unsupported_version');
  }

  return { ok: true };
};

/**
 * Reads schema version. Empty DB → 0. Missing/partial meta on non-empty DB → fail.
 */
export const readCommunicationSchemaVersion = (
  db: SqliteDatabase,
): { ok: true; version: number } | { ok: false; reason: string } => {
  if (isSqliteDatabaseEmpty(db)) return { ok: true, version: 0 };

  const objects = readUserObjects(db);
  const meta = objects.find((object) => object.name === COMMUNICATION_META_TABLE);
  if (meta === undefined || meta.type !== 'table') return fail('partial_schema');

  let rows: Array<{ id: unknown; schema_version: unknown }>;
  try {
    rows = db.prepare(`SELECT id, schema_version FROM ${COMMUNICATION_META_TABLE}`).all() as Array<{
      id: unknown;
      schema_version: unknown;
    }>;
  } catch {
    return fail('malformed_meta');
  }
  if (rows.length !== 1) return fail('meta_row_count');
  const row = rows[0];
  if (row === undefined || row.id !== 1) return fail('meta_id');
  if (typeof row.schema_version !== 'number' || !Number.isInteger(row.schema_version))
    return fail('malformed_meta');
  if (!Number.isSafeInteger(row.schema_version)) return fail('malformed_meta');
  if (row.schema_version < 0) return fail('unsupported_version');
  return { ok: true, version: row.schema_version };
};

export const listSqliteUserSchemaInventory = (
  db: SqliteDatabase,
): readonly { readonly type: string; readonly name: string; readonly sql: string | null }[] =>
  Object.freeze(
    readUserObjects(db).map((object) =>
      Object.freeze({ type: object.type, name: object.name, sql: object.sql }),
    ),
  );
