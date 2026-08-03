import {
  err,
  ok,
  readMemoryQueryLimit,
  type AuthenticatedMemoryAccessContext,
  type DomainError,
  type MemoryDeleteRequest,
  type MemoryOperationKind,
  type MemoryQueryRequest,
  type MemoryReadRequest,
  type MemoryRecord,
  type MemoryRecordId,
  type MemoryNamespace,
  type OwnerId,
  type Result,
  type VerifiedMemoryWrite,
} from '../../../core/domain/index.js';
import { authorizeMemoryAccess } from '../../../core/policy/namespace-isolation.js';
import { verifiedMemoryWriteHasSecretBoundaryClearance } from '../../../core/domain/verified-memory-write-guard.js';
import type { MemoryPort } from '../../../core/ports/index.js';
import { memoryRecordNotFound } from '../../memory-port-errors.js';
import type { SqliteDatabase, SqliteStatement } from './better-sqlite3-driver.js';
import {
  encodeVerifiedWriteForStorage,
  rowToMemoryRecord,
  type StoredMemoryRow,
} from './sqlite-memory-serialization.js';

const authorizationDenied = (code: string, reason: string): DomainError => ({
  code: 'POLICY_DENIED',
  reason: `${code}: ${reason}`,
});

const requireAuthorized = (
  access: AuthenticatedMemoryAccessContext | null | undefined,
  operation: MemoryOperationKind,
  ownerId: OwnerId,
  namespace: MemoryNamespace,
): DomainError | null => {
  const decision = authorizeMemoryAccess(access, operation, { ownerId, namespace });
  if (!decision.allowed) return authorizationDenied(decision.code, decision.reason);
  return null;
};

type PreparedStatements = {
  readonly selectOne: SqliteStatement;
  readonly insertOrReplace: SqliteStatement;
  readonly updateExisting: SqliteStatement;
  readonly selectOrdinal: SqliteStatement;
  readonly deleteOne: SqliteStatement;
  readonly queryPage: SqliteStatement;
};

const prepareStatements = (db: SqliteDatabase): PreparedStatements =>
  Object.freeze({
    selectOne: db.prepare(
      `SELECT owner_id, namespace, record_id, content, source_json, provenance_json,
              privacy_classification, trust_level, retention_json, created_at, updated_at
         FROM memory_records
        WHERE owner_id = ? AND namespace = ? AND record_id = ?
        LIMIT 1`,
    ),
    selectOrdinal: db.prepare(
      `SELECT insertion_ordinal AS ordinal
         FROM memory_records
        WHERE owner_id = ? AND namespace = ? AND record_id = ?
        LIMIT 1`,
    ),
    // Overwrite preserves insertion_ordinal by UPDATE; INSERT only when absent.
    updateExisting: db.prepare(
      `UPDATE memory_records
          SET content = ?,
              source_json = ?,
              provenance_json = ?,
              privacy_classification = ?,
              trust_level = ?,
              retention_json = ?,
              created_at = ?,
              updated_at = ?
        WHERE owner_id = ? AND namespace = ? AND record_id = ?`,
    ),
    insertOrReplace: db.prepare(
      `INSERT INTO memory_records (
          owner_id, namespace, record_id, content, source_json, provenance_json,
          privacy_classification, trust_level, retention_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    deleteOne: db.prepare(
      `DELETE FROM memory_records
        WHERE owner_id = ? AND namespace = ? AND record_id = ?`,
    ),
    queryPage: db.prepare(
      `SELECT owner_id, namespace, record_id, content, source_json, provenance_json,
              privacy_classification, trust_level, retention_json, created_at, updated_at
         FROM memory_records
        WHERE owner_id = ? AND namespace = ?
        ORDER BY insertion_ordinal ASC
        LIMIT ?`,
    ),
  });

export type SqliteMemoryPortConnection = {
  readonly db: SqliteDatabase;
  readonly statements: PreparedStatements;
  assertOpen: () => DomainError | null;
};

export const createSqliteMemoryPortConnection = (
  db: SqliteDatabase,
  assertOpen: () => DomainError | null,
): { readonly memory: MemoryPort; readonly statements: PreparedStatements } => {
  const statements = prepareStatements(db);

  const writeRow = (row: {
    readonly owner_id: string;
    readonly namespace: string;
    readonly record_id: string;
    readonly content: string;
    readonly source_json: string;
    readonly provenance_json: string;
    readonly privacy_classification: string;
    readonly trust_level: string;
    readonly retention_json: string;
    readonly created_at: string;
    readonly updated_at: string;
  }): void => {
    const existing = statements.selectOrdinal.get(row.owner_id, row.namespace, row.record_id) as
      { ordinal: number } | undefined;
    if (existing !== undefined) {
      statements.updateExisting.run(
        row.content,
        row.source_json,
        row.provenance_json,
        row.privacy_classification,
        row.trust_level,
        row.retention_json,
        row.created_at,
        row.updated_at,
        row.owner_id,
        row.namespace,
        row.record_id,
      );
      return;
    }
    statements.insertOrReplace.run(
      row.owner_id,
      row.namespace,
      row.record_id,
      row.content,
      row.source_json,
      row.provenance_json,
      row.privacy_classification,
      row.trust_level,
      row.retention_json,
      row.created_at,
      row.updated_at,
    );
  };

  const memory: MemoryPort = {
    query(
      request: MemoryQueryRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<readonly MemoryRecord[], DomainError>> {
      const closed = assertOpen();
      if (closed !== null) return Promise.resolve(err(closed));

      const denied = requireAuthorized(
        access,
        'query',
        request.expectedOwnerId,
        request.targetNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const limitResult = readMemoryQueryLimit(request);
      if (!limitResult.ok) return Promise.resolve(limitResult);
      const limit = limitResult.value;

      const rows = statements.queryPage.all(
        request.expectedOwnerId,
        request.targetNamespace,
        limit,
      ) as StoredMemoryRow[];

      const matches: MemoryRecord[] = [];
      for (const row of rows) {
        if (row.owner_id !== access.ownerId) continue;
        if (row.owner_id !== request.expectedOwnerId) continue;
        if (row.namespace !== request.targetNamespace) continue;
        const record = rowToMemoryRecord(row);
        if (record === null)
          return Promise.resolve(
            err({ code: 'VALIDATION_FAILED', reason: 'Stored memory record is corrupt.' }),
          );
        matches.push(record);
      }
      return Promise.resolve(ok(Object.freeze(matches)));
    },

    read(
      request: MemoryReadRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<MemoryRecord, DomainError>> {
      const closed = assertOpen();
      if (closed !== null) return Promise.resolve(err(closed));

      const denied = requireAuthorized(
        access,
        'read',
        request.expectedOwnerId,
        request.expectedNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const row = statements.selectOne.get(
        request.expectedOwnerId,
        request.expectedNamespace,
        request.recordId,
      ) as StoredMemoryRow | undefined;
      if (row === undefined) return Promise.resolve(err(memoryRecordNotFound()));
      if (row.owner_id !== access.ownerId || row.owner_id !== request.expectedOwnerId)
        return Promise.resolve(err(memoryRecordNotFound()));
      if (row.namespace !== request.expectedNamespace)
        return Promise.resolve(err(memoryRecordNotFound()));
      const record = rowToMemoryRecord(row);
      if (record === null)
        return Promise.resolve(
          err({ code: 'VALIDATION_FAILED', reason: 'Stored memory record is corrupt.' }),
        );
      return Promise.resolve(ok(record));
    },

    write(
      write: VerifiedMemoryWrite,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<MemoryRecordId, DomainError>> {
      const closed = assertOpen();
      if (closed !== null) return Promise.resolve(err(closed));

      const denied = requireAuthorized(access, 'write', write.ownerId, write.namespace);
      if (denied !== null) return Promise.resolve(err(denied));
      if (write.ownerId !== access.ownerId)
        return Promise.resolve(err(authorizationDenied('OWNER_MISMATCH', 'Write owner mismatch.')));
      if (!verifiedMemoryWriteHasSecretBoundaryClearance(write))
        return Promise.resolve(
          err({
            code: 'VALIDATION_FAILED',
            reason: 'Memory write lacks secret boundary clearance.',
          }),
        );

      const encoded = encodeVerifiedWriteForStorage(write);
      if (!encoded.ok)
        return Promise.resolve(
          err({ code: 'VALIDATION_FAILED', reason: 'Memory write payload is invalid.' }),
        );

      try {
        const tx = db.transaction(() => {
          writeRow(encoded.row);
        });
        tx();
      } catch {
        return Promise.resolve(
          err({ code: 'EXTERNAL_FAILURE', operation: 'memory.write', retryable: true }),
        );
      }
      return Promise.resolve(ok(write.recordId));
    },

    delete(
      request: MemoryDeleteRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<void, DomainError>> {
      const closed = assertOpen();
      if (closed !== null) return Promise.resolve(err(closed));

      const denied = requireAuthorized(
        access,
        'delete',
        request.expectedOwnerId,
        request.expectedNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const row = statements.selectOne.get(
        request.expectedOwnerId,
        request.expectedNamespace,
        request.recordId,
      ) as StoredMemoryRow | undefined;
      if (row === undefined) return Promise.resolve(err(memoryRecordNotFound()));
      if (row.owner_id !== access.ownerId || row.owner_id !== request.expectedOwnerId)
        return Promise.resolve(err(memoryRecordNotFound()));
      if (row.namespace !== request.expectedNamespace)
        return Promise.resolve(err(memoryRecordNotFound()));

      try {
        const tx = db.transaction(() => {
          statements.deleteOne.run(
            request.expectedOwnerId,
            request.expectedNamespace,
            request.recordId,
          );
        });
        tx();
      } catch {
        return Promise.resolve(
          err({ code: 'EXTERNAL_FAILURE', operation: 'memory.delete', retryable: true }),
        );
      }
      return Promise.resolve(ok(undefined));
    },
  };

  return { memory, statements };
};
