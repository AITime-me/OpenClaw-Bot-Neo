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
  readonly insertStart: SqliteStatement;
  readonly selectCompletionByKey: SqliteStatement;
  readonly insertCompletion: SqliteStatement;
};

type AuditStartRow = {
  readonly idempotency_key: string;
  readonly turn_id: string;
  readonly correlation_id: string;
  readonly owner_id: string;
  readonly conversation_id: string;
  readonly operation_kind: string;
  readonly policy_version: string;
  readonly metadata_json: string;
};

type AuditCompletionRow = {
  readonly idempotency_key: string;
  readonly turn_id: string;
  readonly correlation_id: string;
  readonly owner_id: string;
  readonly conversation_id: string;
  readonly operation_kind: string;
  readonly policy_version: string;
  readonly delivery_status: string;
  readonly checkpoint_status: string;
  readonly audit_start_status: string;
  readonly audit_completion_status: string;
  readonly error_code: string | null;
  readonly metadata_json: string;
};

const CANONICAL_AUDIT_START_METADATA = Object.freeze({ phase: 'start' });

const closedError = (): CommunicationError =>
  communicationError('AUDIT_START_FAILED', 'Communication audit port is closed.');

const prepare = (db: SqliteDatabase): Prepared =>
  Object.freeze({
    selectStartByKey: db.prepare(
      `SELECT idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
              operation_kind, policy_version, metadata_json
         FROM audit_start WHERE idempotency_key = ? LIMIT 1`,
    ),
    insertStart: db.prepare(
      `INSERT INTO audit_start (
          idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
          operation_kind, policy_version, timestamp, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectCompletionByKey: db.prepare(
      `SELECT idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
              operation_kind, policy_version, delivery_status, checkpoint_status,
              audit_start_status, audit_completion_status, error_code, metadata_json
         FROM audit_completion WHERE idempotency_key = ? LIMIT 1`,
    ),
    insertCompletion: db.prepare(
      `INSERT INTO audit_completion (
          idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
          operation_kind, policy_version, timestamp, delivery_status, checkpoint_status,
          audit_start_status, audit_completion_status, error_code, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  });

const startRowMatchesExpected = (
  existing: AuditStartRow,
  event: CommunicationAuditCompletionEvent,
  expectedStartMetadataJson: string,
): boolean =>
  existing.idempotency_key === String(event.auditStartIdempotencyKey) &&
  existing.turn_id === String(event.turnId) &&
  existing.correlation_id === String(event.correlationId) &&
  existing.owner_id === String(event.ownerId) &&
  existing.conversation_id === String(event.conversationId) &&
  existing.operation_kind === 'text-turn' &&
  existing.policy_version === String(event.policyVersion) &&
  existing.metadata_json === expectedStartMetadataJson;

const startSemanticallyEquivalent = (
  existing: AuditStartRow,
  event: CommunicationAuditStartEvent,
  metadataJson: string,
): boolean =>
  existing.turn_id === String(event.turnId) &&
  existing.correlation_id === String(event.correlationId) &&
  existing.owner_id === String(event.ownerId) &&
  existing.conversation_id === String(event.conversationId) &&
  existing.operation_kind === event.operationKind &&
  existing.policy_version === String(event.policyVersion) &&
  existing.metadata_json === metadataJson;

const completionSemanticallyEquivalent = (
  existing: AuditCompletionRow,
  event: CommunicationAuditCompletionEvent,
  metadataJson: string,
): boolean =>
  existing.turn_id === String(event.turnId) &&
  existing.correlation_id === String(event.correlationId) &&
  existing.owner_id === String(event.ownerId) &&
  existing.conversation_id === String(event.conversationId) &&
  existing.operation_kind === event.operationKind &&
  existing.policy_version === String(event.policyVersion) &&
  existing.delivery_status === event.deliveryStatus &&
  existing.checkpoint_status === event.checkpointStatus &&
  existing.audit_start_status === event.auditStartStatus &&
  existing.audit_completion_status === event.auditCompletionStatus &&
  (existing.error_code ?? null) === (event.errorCode ?? null) &&
  existing.metadata_json === metadataJson;

type AuditScanPhase = 'start' | 'completion';

const scanMetadataFailClosed = async (
  scanner: SensitiveDataScannerPort,
  metadata: Readonly<Record<string, string>>,
  operationContext: OperationContext,
  phase: AuditScanPhase,
): Promise<CommunicationError | null> => {
  const scanned = await scanner.scanMetadata(metadata, operationContext);
  if (!scanned.ok)
    return communicationError('SECRET_SCAN_UNAVAILABLE', 'Sensitive data scanner unavailable.');
  if (scanned.value.decision !== 'allow' || scanned.value.findings.length > 0) {
    if (phase === 'start')
      return communicationError('AUDIT_START_FAILED', 'Audit metadata failed sensitive-data scan.');
    return communicationError(
      'AUDIT_COMPLETION_FAILED',
      'Audit metadata failed sensitive-data scan.',
    );
  }
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
        'start',
      );
      if (scanError) return err(scanError);

      const encoded = encodeAuditMetadata(event.redactedMetadata);
      if (!encoded.ok) return ok({ kind: 'rejected', reason: 'Audit metadata encoding rejected.' });

      try {
        const outcome = runImmediate(db, (): CommunicationAuditRecordOutcome => {
          const existing = statements.selectStartByKey.get(event.idempotencyKey) as
            AuditStartRow | undefined;
          if (existing !== undefined) {
            if (startSemanticallyEquivalent(existing, event, encoded.json))
              return { kind: 'already-recorded' };
            return {
              kind: 'rejected',
              reason: 'Audit start idempotency key collides with a non-equivalent payload.',
            };
          }
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
            if (isSqliteUniqueConstraint(error)) {
              const raced = statements.selectStartByKey.get(event.idempotencyKey) as
                AuditStartRow | undefined;
              if (raced !== undefined && startSemanticallyEquivalent(raced, event, encoded.json))
                return { kind: 'already-recorded' };
              return {
                kind: 'rejected',
                reason: 'Audit start idempotency key collides with a non-equivalent payload.',
              };
            }
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
        'completion',
      );
      if (scanError) return err(scanError);

      const encoded = encodeAuditMetadata(event.redactedMetadata);
      if (!encoded.ok) return ok({ kind: 'rejected', reason: 'Audit metadata encoding rejected.' });

      const expectedStartMetadata = encodeAuditMetadata(CANONICAL_AUDIT_START_METADATA);
      if (!expectedStartMetadata.ok)
        return ok({
          kind: 'rejected',
          reason: 'Canonical audit start metadata encoding rejected.',
        });

      try {
        const outcome = runImmediate(db, (): CommunicationAuditRecordOutcome => {
          const start = statements.selectStartByKey.get(event.auditStartIdempotencyKey) as
            AuditStartRow | undefined;
          if (start === undefined)
            return {
              kind: 'rejected',
              reason: 'Completion requires the expected durable audit start key.',
            };
          if (!startRowMatchesExpected(start, event, expectedStartMetadata.json))
            return {
              kind: 'rejected',
              reason: 'Completion audit start is missing or semantically incompatible.',
            };

          const existing = statements.selectCompletionByKey.get(event.idempotencyKey) as
            AuditCompletionRow | undefined;
          if (existing !== undefined) {
            if (completionSemanticallyEquivalent(existing, event, encoded.json))
              return { kind: 'already-recorded' };
            return {
              kind: 'rejected',
              reason: 'Audit completion idempotency key collides with a non-equivalent payload.',
            };
          }

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
            if (isSqliteUniqueConstraint(error)) {
              const raced = statements.selectCompletionByKey.get(event.idempotencyKey) as
                AuditCompletionRow | undefined;
              if (
                raced !== undefined &&
                completionSemanticallyEquivalent(raced, event, encoded.json)
              )
                return { kind: 'already-recorded' };
              return {
                kind: 'rejected',
                reason: 'Audit completion idempotency key collides with a non-equivalent payload.',
              };
            }
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
