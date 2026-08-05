import { err, ok } from '../../../../core/domain/result.js';
import type { DomainError } from '../../../../core/domain/errors.js';
import type { OperationContext } from '../../../../core/domain/operation-context.js';
import type { SensitiveDataScannerPort } from '../../../../core/ports/sensitive-data-scanner.port.js';
import {
  communicationError,
  type CommunicationError,
} from '../../../../core/communication/domain/communication-errors.js';
import type {
  CommunicationAuditCompletionEvent,
  CommunicationAuditPort,
  CommunicationAuditRecordOutcome,
  CommunicationAuditStartEvent,
} from '../../../../core/communication/ports/communication-audit.port.js';
import type { SqliteDatabase, SqliteStatement } from '../better-sqlite3-driver.js';
import { encodeAuditMetadata } from './sqlite-communication-serialization.js';
import {
  isSqliteBusyOrLocked,
  isSqliteUniqueConstraint,
  runImmediate,
} from './sqlite-communication-errors.js';

type Prepared = {
  readonly selectStartByKey: SqliteStatement;
  readonly selectStartByTurn: SqliteStatement;
  readonly insertStart: SqliteStatement;
  readonly selectCompletionByKey: SqliteStatement;
  readonly insertCompletion: SqliteStatement;
};

const closedError = (): CommunicationError =>
  communicationError('AUDIT_START_FAILED', 'Communication audit port is closed.');

const prepare = (db: SqliteDatabase): Prepared =>
  Object.freeze({
    selectStartByKey: db.prepare(
      `SELECT idempotency_key FROM audit_start WHERE idempotency_key = ? LIMIT 1`,
    ),
    selectStartByTurn: db.prepare(
      `SELECT idempotency_key FROM audit_start WHERE turn_id = ? LIMIT 1`,
    ),
    insertStart: db.prepare(
      `INSERT INTO audit_start (
          idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
          operation_kind, policy_version, timestamp, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectCompletionByKey: db.prepare(
      `SELECT idempotency_key FROM audit_completion WHERE idempotency_key = ? LIMIT 1`,
    ),
    insertCompletion: db.prepare(
      `INSERT INTO audit_completion (
          idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
          operation_kind, policy_version, timestamp, delivery_status, checkpoint_status,
          audit_start_status, audit_completion_status, error_code, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  });

const scanMetadataFailClosed = async (
  scanner: SensitiveDataScannerPort,
  metadata: Readonly<Record<string, string>>,
  operationContext: OperationContext,
): Promise<CommunicationError | null> => {
  const scanned = await scanner.scanMetadata(metadata, operationContext);
  if (!scanned.ok)
    return communicationError('SECRET_SCAN_UNAVAILABLE', 'Sensitive data scanner unavailable.');
  if (scanned.value.decision !== 'allow' || scanned.value.findings.length > 0)
    return communicationError('AUDIT_START_FAILED', 'Audit metadata failed sensitive-data scan.');
  return null;
};

export const createSqliteCommunicationAuditPort = (
  db: SqliteDatabase,
  assertOpen: () => DomainError | null,
  scanner: SensitiveDataScannerPort,
): CommunicationAuditPort => {
  const statements = prepare(db);

  const requireOpen = (): CommunicationError | null => {
    if (assertOpen() !== null) return closedError();
    return null;
  };

  return {
    async recordStart(event: CommunicationAuditStartEvent, operationContext) {
      const closed = requireOpen();
      if (closed) return err(closed);

      const scanError = await scanMetadataFailClosed(
        scanner,
        event.redactedMetadata,
        operationContext,
      );
      if (scanError) return err(scanError);

      const encoded = encodeAuditMetadata(event.redactedMetadata);
      if (!encoded.ok) return ok({ kind: 'rejected', reason: 'Audit metadata encoding rejected.' });

      try {
        const outcome = runImmediate(db, (): CommunicationAuditRecordOutcome => {
          const existing = statements.selectStartByKey.get(event.idempotencyKey) as
            { idempotency_key: string } | undefined;
          if (existing !== undefined) return { kind: 'already-recorded' };
          try {
            statements.insertStart.run(
              event.idempotencyKey,
              event.turnId,
              event.correlationId,
              event.ownerId,
              event.conversationId,
              event.operationKind,
              event.policyVersion,
              event.timestamp,
              encoded.json,
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'already-recorded' };
            throw error;
          }
          return { kind: 'recorded' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Audit start persistence failed.' });
      }
    },

    async recordCompletion(event: CommunicationAuditCompletionEvent, operationContext) {
      const closed = requireOpen();
      if (closed)
        return err(
          communicationError('AUDIT_COMPLETION_FAILED', 'Communication audit port is closed.'),
        );

      const scanError = await scanMetadataFailClosed(
        scanner,
        event.redactedMetadata,
        operationContext,
      );
      if (scanError)
        return err(
          communicationError('SECRET_SCAN_UNAVAILABLE', 'Sensitive data scanner unavailable.'),
        );

      const encoded = encodeAuditMetadata(event.redactedMetadata);
      if (!encoded.ok) return ok({ kind: 'rejected', reason: 'Audit metadata encoding rejected.' });

      try {
        const outcome = runImmediate(db, (): CommunicationAuditRecordOutcome => {
          const start = statements.selectStartByTurn.get(event.turnId) as
            { idempotency_key: string } | undefined;
          if (start === undefined)
            return {
              kind: 'rejected',
              reason: 'Completion requires a durable audit start for the turn.',
            };

          const existing = statements.selectCompletionByKey.get(event.idempotencyKey) as
            { idempotency_key: string } | undefined;
          if (existing !== undefined) return { kind: 'already-recorded' };

          try {
            statements.insertCompletion.run(
              event.idempotencyKey,
              event.turnId,
              event.correlationId,
              event.ownerId,
              event.conversationId,
              event.operationKind,
              event.policyVersion,
              event.timestamp,
              event.deliveryStatus,
              event.checkpointStatus,
              event.auditStartStatus,
              event.auditCompletionStatus,
              event.errorCode,
              encoded.json,
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'already-recorded' };
            throw error;
          }
          return { kind: 'recorded' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Audit completion persistence failed.' });
      }
    },
  };
};
