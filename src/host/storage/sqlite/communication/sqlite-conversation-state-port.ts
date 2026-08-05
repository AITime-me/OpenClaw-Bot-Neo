import { err, ok } from '../../../../core/domain/result.js';
import type { DomainError } from '../../../../core/domain/errors.js';
import type { OperationContext } from '../../../../core/domain/operation-context.js';
import type { SensitiveDataScannerPort } from '../../../../core/ports/sensitive-data-scanner.port.js';
import {
  communicationError,
  type CommunicationError,
} from '../../../../core/communication/domain/communication-errors.js';
import { parseConversationRevision } from '../../../../core/communication/domain/communication-identity.js';
import {
  isConversationCheckpointReconcileEligible,
  type ConversationCheckpointReconcileIneligibleStatus,
  type ConversationStateCheckpointOutcome,
  type ConversationStateLoadOutcome,
  type ConversationStatePort,
  type ConversationStateReconcileCheckpointOutcome,
} from '../../../../core/communication/ports/conversation-state.port.js';
import type { ConversationCheckpointMetadataStatus } from '../../../../core/communication/domain/conversation-state.js';
import type { SqliteDatabase, SqliteStatement } from '../better-sqlite3-driver.js';
import {
  decodeConversationSnapshot,
  encodeConversationSnapshotParts,
  fingerprintConversationSnapshot,
  snapshotTextsForScan,
} from './sqlite-communication-serialization.js';
import {
  assertSafeIntegerValue,
  isSqliteBusyOrLocked,
  isSqliteUniqueConstraint,
  runImmediate,
} from './sqlite-communication-errors.js';
import { freezeConversationStateSnapshot } from '../../../../core/communication/domain/conversation-state.js';

type SnapshotRow = {
  readonly owner_id: string;
  readonly conversation_id: string;
  readonly revision: number;
  readonly pause_state: string;
  readonly checkpoint_status: string;
  readonly checkpoint_revision: number;
  readonly active_context_json: string;
  readonly summary_json: string;
  readonly fingerprint: string;
  readonly updated_at: string;
};

type CheckpointOpRow = {
  readonly owner_id: string;
  readonly conversation_id: string;
  readonly idempotency_key: string;
  readonly op_kind: string;
  readonly fingerprint: string | null;
  readonly revision_after: number | null;
  readonly created_at: string;
};

type Prepared = {
  readonly selectSnapshot: SqliteStatement;
  readonly upsertSnapshot: SqliteStatement;
  readonly selectOp: SqliteStatement;
  readonly insertOp: SqliteStatement;
};

const closedError = (): CommunicationError =>
  communicationError('CONVERSATION_STATE_UNAVAILABLE', 'Conversation state port is closed.');

const asRevision = (value: number) => {
  const parsed = parseConversationRevision(value);
  if (!parsed.ok) throw new TypeError('conversation revision must be a safe integer');
  return parsed.value;
};

const nowIso = (): string => new Date().toISOString();

const prepare = (db: SqliteDatabase): Prepared =>
  Object.freeze({
    selectSnapshot: db.prepare(
      `SELECT * FROM conversation_snapshots WHERE owner_id = ? AND conversation_id = ? LIMIT 1`,
    ),
    upsertSnapshot: db.prepare(
      `INSERT INTO conversation_snapshots (
          owner_id, conversation_id, revision, pause_state, checkpoint_status, checkpoint_revision,
          active_context_json, summary_json, fingerprint, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, conversation_id) DO UPDATE SET
          revision = excluded.revision,
          pause_state = excluded.pause_state,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_revision = excluded.checkpoint_revision,
          active_context_json = excluded.active_context_json,
          summary_json = excluded.summary_json,
          fingerprint = excluded.fingerprint,
          updated_at = excluded.updated_at`,
    ),
    selectOp: db.prepare(
      `SELECT * FROM checkpoint_ops
        WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?
        LIMIT 1`,
    ),
    insertOp: db.prepare(
      `INSERT INTO checkpoint_ops (
          owner_id, conversation_id, idempotency_key, op_kind, fingerprint, revision_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
  });

const scanSnapshotFailClosed = async (
  scanner: SensitiveDataScannerPort,
  snapshot: Parameters<typeof snapshotTextsForScan>[0],
  operationContext: OperationContext,
): Promise<CommunicationError | null> => {
  for (const text of snapshotTextsForScan(snapshot)) {
    const scanned = await scanner.scanText(text, operationContext);
    if (!scanned.ok)
      return communicationError('SECRET_SCAN_UNAVAILABLE', 'Sensitive data scanner unavailable.');
    if (scanned.value.decision !== 'allow' || scanned.value.findings.length > 0)
      return communicationError(
        'CONVERSATION_STATE_UNAVAILABLE',
        'Conversation snapshot failed sensitive-data scan.',
      );
  }
  return null;
};

export const createSqliteConversationStatePort = (
  db: SqliteDatabase,
  assertOpen: () => DomainError | null,
  scanner: SensitiveDataScannerPort,
): ConversationStatePort => {
  const statements = prepare(db);

  const requireOpen = (): CommunicationError | null => {
    if (assertOpen() !== null) return closedError();
    return null;
  };

  return {
    async load(key, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const row = statements.selectSnapshot.get(key.ownerId, key.conversationId) as
          SnapshotRow | undefined;
        if (row === undefined) return ok({ kind: 'not-found' });
        const decoded = decodeConversationSnapshot({
          ownerId: row.owner_id,
          conversationId: row.conversation_id,
          revision: row.revision,
          pauseState: row.pause_state,
          checkpointStatus: row.checkpoint_status,
          checkpointRevision: row.checkpoint_revision,
          activeContextJson: row.active_context_json,
          summaryJson: row.summary_json,
        });
        if (!decoded.ok)
          return ok({ kind: 'unavailable', reason: 'Stored conversation snapshot is malformed.' });
        const outcome: ConversationStateLoadOutcome = {
          kind: 'found',
          snapshot: decoded.snapshot,
        };
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Conversation state load failed.' });
      }
    },

    async checkpoint(command, operationContext) {
      const closed = requireOpen();
      if (closed) return err(closed);

      const scanError = await scanSnapshotFailClosed(
        scanner,
        command.nextSnapshot,
        operationContext,
      );
      if (scanError) return err(scanError);

      const encoded = encodeConversationSnapshotParts(command.nextSnapshot);
      if (!encoded.ok)
        return ok({ kind: 'unavailable', reason: 'Conversation snapshot encoding failed.' });

      try {
        const outcome = runImmediate(db, (): ConversationStateCheckpointOutcome => {
          const existingOp = statements.selectOp.get(
            command.key.ownerId,
            command.key.conversationId,
            command.idempotencyKey,
          ) as CheckpointOpRow | undefined;
          if (existingOp !== undefined) {
            if (existingOp.op_kind !== 'checkpoint')
              return { kind: 'unavailable', reason: 'Idempotency key conflict.' };
            if (existingOp.fingerprint === encoded.fingerprint) return { kind: 'already-applied' };
            return {
              kind: 'unavailable',
              reason: 'Checkpoint idempotency fingerprint conflict.',
            };
          }

          const current = statements.selectSnapshot.get(
            command.key.ownerId,
            command.key.conversationId,
          ) as SnapshotRow | undefined;
          const expected = command.expectedRevision;
          if (current === undefined) {
            if (expected !== 0 && expected !== command.nextSnapshot.revision)
              return { kind: 'stale-revision' };
          } else {
            if (!assertSafeIntegerValue(current.revision))
              return { kind: 'unavailable', reason: 'Malformed conversation revision.' };
            if (current.revision !== expected) return { kind: 'stale-revision' };
          }

          if (command.nextSnapshot.ownerId !== command.key.ownerId)
            return { kind: 'unavailable', reason: 'Snapshot owner mismatch.' };
          if (command.nextSnapshot.conversationId !== command.key.conversationId)
            return { kind: 'unavailable', reason: 'Snapshot conversation mismatch.' };

          const updatedAt = nowIso();
          statements.upsertSnapshot.run(
            command.key.ownerId,
            command.key.conversationId,
            command.nextSnapshot.revision,
            command.nextSnapshot.pauseState,
            command.nextSnapshot.checkpoint.status,
            command.nextSnapshot.checkpoint.revision,
            encoded.activeContextJson,
            encoded.summaryJson,
            encoded.fingerprint,
            updatedAt,
          );
          try {
            statements.insertOp.run(
              command.key.ownerId,
              command.key.conversationId,
              command.idempotencyKey,
              'checkpoint',
              encoded.fingerprint,
              command.nextSnapshot.revision,
              updatedAt,
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) {
              const raced = statements.selectOp.get(
                command.key.ownerId,
                command.key.conversationId,
                command.idempotencyKey,
              ) as CheckpointOpRow | undefined;
              if (raced?.fingerprint === encoded.fingerprint) return { kind: 'already-applied' };
              return {
                kind: 'unavailable',
                reason: 'Checkpoint idempotency fingerprint conflict.',
              };
            }
            throw error;
          }
          return { kind: 'stored' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Conversation checkpoint failed.' });
      }
    },

    async reconcileCheckpoint(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): ConversationStateReconcileCheckpointOutcome => {
          const existingOp = statements.selectOp.get(
            command.key.ownerId,
            command.key.conversationId,
            command.idempotencyKey,
          ) as CheckpointOpRow | undefined;
          if (existingOp !== undefined) {
            if (existingOp.op_kind !== 'reconcile') return { kind: 'idempotency-conflict' };
            if (
              existingOp.revision_after !== null &&
              assertSafeIntegerValue(existingOp.revision_after)
            )
              return {
                kind: 'already-reconciled',
                revision: asRevision(existingOp.revision_after),
              };
            return { kind: 'idempotency-conflict' };
          }

          const current = statements.selectSnapshot.get(
            command.key.ownerId,
            command.key.conversationId,
          ) as SnapshotRow | undefined;
          if (current === undefined) return { kind: 'not-found' };
          if (!assertSafeIntegerValue(current.revision))
            return { kind: 'unavailable', reason: 'Malformed conversation revision.' };
          if (current.revision !== command.expectedRevision)
            return {
              kind: 'stale-revision',
              currentRevision: asRevision(current.revision),
            };

          if (
            current.checkpoint_status === 'not_required' ||
            current.checkpoint_status === 'succeeded'
          ) {
            const status: ConversationCheckpointReconcileIneligibleStatus =
              current.checkpoint_status;
            return {
              kind: 'not-eligible',
              status,
              currentRevision: asRevision(current.revision),
            };
          }
          const checkpointStatus =
            current.checkpoint_status as ConversationCheckpointMetadataStatus;
          if (!isConversationCheckpointReconcileEligible(checkpointStatus))
            return {
              kind: 'not-eligible',
              status: 'not_required',
              currentRevision: asRevision(current.revision),
            };

          const decoded = decodeConversationSnapshot({
            ownerId: current.owner_id,
            conversationId: current.conversation_id,
            revision: current.revision,
            pauseState: current.pause_state,
            checkpointStatus: current.checkpoint_status,
            checkpointRevision: current.checkpoint_revision,
            activeContextJson: current.active_context_json,
            summaryJson: current.summary_json,
          });
          if (!decoded.ok)
            return { kind: 'unavailable', reason: 'Stored conversation snapshot is malformed.' };

          const nextRevision = current.revision + 1;
          if (!Number.isSafeInteger(nextRevision))
            return { kind: 'unavailable', reason: 'Conversation revision overflow.' };

          const reconciled = freezeConversationStateSnapshot({
            ...decoded.snapshot,
            revision: asRevision(nextRevision),
            // context/summary/pause remain byte-equivalent via retained JSON columns
            pauseState: decoded.snapshot.pauseState,
            activeContext: decoded.snapshot.activeContext,
            modelDerivedSummary: decoded.snapshot.modelDerivedSummary,
            checkpoint: Object.freeze({
              status: 'succeeded' as const,
              revision: asRevision(nextRevision),
            }),
          });
          const fingerprint = fingerprintConversationSnapshot(reconciled);
          const updatedAt = nowIso();

          // Keep active_context_json / summary_json / pause_state byte-identical.
          statements.upsertSnapshot.run(
            current.owner_id,
            current.conversation_id,
            nextRevision,
            current.pause_state,
            'succeeded',
            nextRevision,
            current.active_context_json,
            current.summary_json,
            fingerprint,
            updatedAt,
          );
          try {
            statements.insertOp.run(
              command.key.ownerId,
              command.key.conversationId,
              command.idempotencyKey,
              'reconcile',
              fingerprint,
              nextRevision,
              updatedAt,
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'idempotency-conflict' };
            throw error;
          }
          return { kind: 'reconciled', revision: asRevision(nextRevision) };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Checkpoint reconciliation failed.' });
      }
    },
  };
};
