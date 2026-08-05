import { err, ok } from '../../../../core/domain/result.js';
import type { DomainError } from '../../../../core/domain/errors.js';
import type { FreshObservedAdmissionEvidence } from '../../../../core/communication/domain/authenticated-communication-principal.js';
import {
  canTransitionCommunicationTurnState,
  defaultCommunicationQueueConfig,
  type CommunicationQueueConfig,
  type CommunicationTurnRecord,
  type CommunicationTurnState,
  type DeliveryStatus,
  type CheckpointStatus,
  type AuditStartStatus,
  type AuditCompletionStatus,
} from '../../../../core/communication/domain/communication-turn.js';
import {
  communicationError,
  duplicateTransportOperationalFlags,
  type CommunicationError,
  isCommunicationErrorCode,
} from '../../../../core/communication/domain/communication-errors.js';
import {
  parseConversationSequence,
  parseTurnRevision,
  type ConversationSequence,
  type TurnId,
  type TurnRevision,
} from '../../../../core/communication/domain/communication-identity.js';
import {
  validateCommunicationRecoveryCandidateQuery,
  type CommunicationRecoveryCandidate,
  type CommunicationRecoveryReason,
} from '../../../../core/communication/domain/communication-recovery.js';
import { isLlmCompletionOutcome } from '../../../../core/communication/domain/llm-completion.js';
import type {
  AcceptConversationTurnOutcome,
  CommunicationTurnLedgerPort,
  CommunicationTurnTransitionOutcome,
  ObserveTransportEventOutcome,
  RecordAuthenticationResultOutcome,
  RecordFactualOutcomeResult,
  CommunicationRecoveryCandidateListOutcome,
} from '../../../../core/communication/ports/communication-turn-ledger.port.js';
import type { SqliteDatabase, SqliteStatement } from '../better-sqlite3-driver.js';
import {
  assertSafeIntegerValue,
  isSqliteBusyOrLocked,
  isSqliteUniqueConstraint,
  runImmediate,
} from './sqlite-communication-errors.js';

/** Durable principal claims injected by the offline factory (no persistence.internal import). */
export type InjectedPrincipalClaims = {
  readonly turnId: TurnId;
  readonly ownerId: string;
  readonly conversationId: string;
};

export type TurnLedgerFacadeDeps = {
  readonly sealAdmissionEvidence: (turnId: TurnId) => FreshObservedAdmissionEvidence;
  readonly readPrincipalClaims: (principal: unknown) => InjectedPrincipalClaims | null;
};

type TurnRow = {
  readonly turn_id: string;
  readonly transport_instance_id: string;
  readonly idempotency_key: string;
  readonly state: string;
  readonly turn_revision: number;
  readonly conversation_sequence: number | null;
  readonly owner_id: string | null;
  readonly conversation_id: string | null;
  readonly correlation_id: string | null;
  readonly delivery_status: string;
  readonly checkpoint_status: string;
  readonly audit_start_status: string;
  readonly audit_completion_status: string;
  readonly llm_outcome: string | null;
  readonly error_code: string | null;
  readonly observed_at: string;
  readonly updated_at: string;
};

type Prepared = {
  readonly selectByIdempotency: SqliteStatement;
  readonly selectByTurnId: SqliteStatement;
  readonly insertTurn: SqliteStatement;
  readonly insertDedup: SqliteStatement;
  readonly updateTurn: SqliteStatement;
  readonly insertHistory: SqliteStatement;
  readonly selectSequence: SqliteStatement;
  readonly upsertSequence: SqliteStatement;
  readonly countConversationActive: SqliteStatement;
  readonly countGlobalActive: SqliteStatement;
  readonly listRecovery: SqliteStatement;
};

const asRevision = (value: number): TurnRevision => {
  const parsed = parseTurnRevision(value);
  if (!parsed.ok) throw new TypeError('turn revision must be a safe integer');
  return parsed.value;
};

const asSequence = (value: number): ConversationSequence => {
  const parsed = parseConversationSequence(value);
  if (!parsed.ok) throw new TypeError('conversation sequence must be a safe integer');
  return parsed.value;
};

const closedError = (): CommunicationError =>
  communicationError('LEDGER_UNAVAILABLE', 'Communication turn ledger is closed.');

const busyOutcome = <T extends { kind: 'concurrency-conflict'; reason: string }>(
  factory: (reason: string) => T,
): T => factory('SQLite database is busy or locked.');

const prepare = (db: SqliteDatabase): Prepared =>
  Object.freeze({
    selectByIdempotency: db.prepare(`SELECT * FROM turns WHERE idempotency_key = ? LIMIT 1`),
    selectByTurnId: db.prepare(`SELECT * FROM turns WHERE turn_id = ? LIMIT 1`),
    insertTurn: db.prepare(
      `INSERT INTO turns (
          turn_id, transport_instance_id, idempotency_key, state, turn_revision,
          conversation_sequence, owner_id, conversation_id, correlation_id,
          delivery_status, checkpoint_status, audit_start_status, audit_completion_status,
          llm_outcome, error_code, observed_at, updated_at
        ) VALUES (?, ?, ?, 'observed', 1, NULL, NULL, NULL, NULL,
                  'not_started', 'not_required', 'pending', 'not_started',
                  NULL, NULL, ?, ?)`,
    ),
    insertDedup: db.prepare(
      `INSERT INTO turn_dedup (idempotency_key, turn_id, created_at) VALUES (?, ?, ?)`,
    ),
    updateTurn: db.prepare(
      `UPDATE turns SET
          state = ?,
          turn_revision = ?,
          conversation_sequence = ?,
          owner_id = ?,
          conversation_id = ?,
          correlation_id = ?,
          delivery_status = ?,
          checkpoint_status = ?,
          audit_start_status = ?,
          audit_completion_status = ?,
          llm_outcome = ?,
          error_code = ?,
          updated_at = ?
        WHERE turn_id = ? AND turn_revision = ?`,
    ),
    insertHistory: db.prepare(
      `INSERT INTO factual_history (
          turn_id, recorded_at, llm_outcome, delivery_status, checkpoint_status,
          audit_start_status, audit_completion_status, error_code, turn_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectSequence: db.prepare(
      `SELECT next_sequence AS next_sequence
         FROM sequence_counters
        WHERE owner_id = ? AND conversation_id = ?
        LIMIT 1`,
    ),
    upsertSequence: db.prepare(
      `INSERT INTO sequence_counters (owner_id, conversation_id, next_sequence)
       VALUES (?, ?, ?)
       ON CONFLICT(owner_id, conversation_id) DO UPDATE SET next_sequence = excluded.next_sequence`,
    ),
    countConversationActive: db.prepare(
      `SELECT COUNT(*) AS n FROM turns
        WHERE owner_id = ? AND conversation_id = ?
          AND conversation_sequence IS NOT NULL
          AND state != 'completed'`,
    ),
    countGlobalActive: db.prepare(
      `SELECT COUNT(*) AS n FROM turns
        WHERE conversation_sequence IS NOT NULL
          AND state != 'completed'`,
    ),
    listRecovery: db.prepare(
      `SELECT * FROM turns
        WHERE state IN (SELECT value FROM json_each(?))
        ORDER BY updated_at ASC, observed_at ASC, turn_id ASC
        LIMIT ?`,
    ),
  });

const toRecord = (row: TurnRow): CommunicationTurnRecord =>
  Object.freeze({
    state: row.state as CommunicationTurnState,
    turnRevision: asRevision(row.turn_revision),
    conversationSequence:
      row.conversation_sequence === null ? null : asSequence(row.conversation_sequence),
    deliveryStatus: row.delivery_status as DeliveryStatus,
    checkpointStatus: row.checkpoint_status as CheckpointStatus,
    auditStatus: Object.freeze({
      start: row.audit_start_status as AuditStartStatus,
      completion: row.audit_completion_status as AuditCompletionStatus,
    }),
  });

const deriveRecoveryReasons = (
  row: TurnRow,
): readonly [CommunicationRecoveryReason, ...CommunicationRecoveryReason[]] => {
  const reasons: CommunicationRecoveryReason[] = [];
  if (row.llm_outcome === 'outcome-unknown') reasons.push('llm-outcome-unknown-no-auto-retry');
  if (row.state === 'llm_known_failed') {
    reasons.push(
      row.llm_outcome === 'policy-rejected' || row.llm_outcome === 'invalid-response'
        ? 'notice-ineligible-complete-without-delivery'
        : 'notice-eligible-may-continue',
    );
  }
  if (row.state === 'deterministic_notice_prepared')
    reasons.push('deterministic-notice-may-continue');
  if (row.state === 'output_validated') reasons.push('output-validated-may-continue-delivery');
  if (row.state === 'delivery_outcome_unknown' || row.delivery_status === 'outcome_unknown')
    reasons.push('delivery-outcome-unknown-no-auto-resend');
  if (row.checkpoint_status === 'failed') reasons.push('checkpoint-failed-reconcile-only');
  if (row.audit_completion_status === 'failed' || row.audit_completion_status === 'pending')
    reasons.push('completion-audit-retry-allowed');
  if (
    row.state === 'completed' ||
    row.state === 'cancelled' ||
    row.state === 'authentication_rejected'
  )
    reasons.push('terminal-no-resume');
  if (reasons.length === 0) reasons.push('may-continue-under-kill-switch');
  return Object.freeze(reasons) as readonly [
    CommunicationRecoveryReason,
    ...CommunicationRecoveryReason[],
  ];
};

const nowIso = (): string => new Date().toISOString();

export const createSqliteCommunicationTurnLedgerPort = (
  db: SqliteDatabase,
  assertOpen: () => DomainError | null,
  facades: TurnLedgerFacadeDeps,
  queueConfig: CommunicationQueueConfig = defaultCommunicationQueueConfig(),
): CommunicationTurnLedgerPort => {
  const statements = prepare(db);

  const requireOpen = (): CommunicationError | null => {
    const closed = assertOpen();
    if (closed !== null) return closedError();
    return null;
  };

  const loadTurn = (turnId: string): TurnRow | undefined =>
    statements.selectByTurnId.get(turnId) as TurnRow | undefined;

  const writeTurn = (
    row: TurnRow,
    expectedRevision: number,
    updatedAt: string,
  ): { ok: true } | { ok: false; kind: 'stale' } => {
    const result = statements.updateTurn.run(
      row.state,
      row.turn_revision,
      row.conversation_sequence,
      row.owner_id,
      row.conversation_id,
      row.correlation_id,
      row.delivery_status,
      row.checkpoint_status,
      row.audit_start_status,
      row.audit_completion_status,
      row.llm_outcome,
      row.error_code,
      updatedAt,
      row.turn_id,
      expectedRevision,
    );
    if (result.changes !== 1) return { ok: false, kind: 'stale' };
    return { ok: true };
  };

  return {
    async observeTransportEvent(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): ObserveTransportEventOutcome => {
          const existing = statements.selectByIdempotency.get(command.idempotencyKey) as
            TurnRow | undefined;
          if (existing !== undefined) {
            return {
              kind: 'duplicate-existing',
              turnId: existing.turn_id as TurnId,
              state: existing.state as CommunicationTurnState,
              flags: duplicateTransportOperationalFlags(),
            };
          }
          const observedAt = command.observedAt;
          try {
            statements.insertTurn.run(
              command.turnId,
              command.transportInstanceId,
              command.idempotencyKey,
              observedAt,
              observedAt,
            );
            statements.insertDedup.run(command.idempotencyKey, command.turnId, observedAt);
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) {
              const dup = statements.selectByIdempotency.get(command.idempotencyKey) as
                TurnRow | undefined;
              if (dup !== undefined) {
                return {
                  kind: 'duplicate-existing',
                  turnId: dup.turn_id as TurnId,
                  state: dup.state as CommunicationTurnState,
                  flags: duplicateTransportOperationalFlags(),
                };
              }
            }
            throw error;
          }
          return {
            kind: 'fresh-observed',
            turnId: command.turnId,
            turnRevision: asRevision(1),
            admissionEvidence: facades.sealAdmissionEvidence(command.turnId),
          };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok(busyOutcome((reason) => ({ kind: 'concurrency-conflict', reason })));
        return ok({ kind: 'unavailable', reason: 'Turn ledger observe failed.' });
      }
    },

    async recordAuthenticationResult(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): RecordAuthenticationResultOutcome => {
          const row = loadTurn(command.turnId);
          if (row === undefined) return { kind: 'unavailable', reason: 'Turn not found.' };
          if (!assertSafeIntegerValue(row.turn_revision))
            return { kind: 'unavailable', reason: 'Malformed turn revision.' };
          if (row.turn_revision !== command.expectedRevision) return { kind: 'stale-revision' };

          const targetState =
            command.outcome.kind === 'authenticated' ? 'authenticated' : 'authentication_rejected';
          if (row.state === targetState) return { kind: 'already-recorded' };
          if (
            !canTransitionCommunicationTurnState(row.state as CommunicationTurnState, targetState)
          )
            return {
              kind: 'illegal-transition',
              from: row.state as CommunicationTurnState,
              to: targetState,
            };

          let ownerId = row.owner_id;
          let conversationId = row.conversation_id;
          const correlationId = command.correlationId;
          if (command.outcome.kind === 'authenticated') {
            const claims = facades.readPrincipalClaims(command.outcome.principal);
            if (claims === null)
              return { kind: 'unavailable', reason: 'Principal claims are not durable.' };
            if (claims.turnId !== command.turnId)
              return { kind: 'unavailable', reason: 'Principal turn binding mismatch.' };
            ownerId = claims.ownerId;
            conversationId = claims.conversationId;
          }

          const nextRevision = row.turn_revision + 1;
          if (!Number.isSafeInteger(nextRevision))
            return { kind: 'unavailable', reason: 'Turn revision overflow.' };
          const updated: TurnRow = {
            ...row,
            state: targetState,
            turn_revision: nextRevision,
            owner_id: ownerId,
            conversation_id: conversationId,
            correlation_id: correlationId,
          };
          const written = writeTurn(updated, row.turn_revision, nowIso());
          if (!written.ok) return { kind: 'stale-revision' };
          return { kind: 'recorded', turnRevision: asRevision(nextRevision) };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok(busyOutcome((reason) => ({ kind: 'concurrency-conflict', reason })));
        return ok({ kind: 'unavailable', reason: 'Authentication result persistence failed.' });
      }
    },

    async acceptConversationTurn(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): AcceptConversationTurnOutcome => {
          const row = loadTurn(command.turnId);
          if (row === undefined) return { kind: 'unavailable', reason: 'Turn not found.' };
          if (!assertSafeIntegerValue(row.turn_revision))
            return { kind: 'unavailable', reason: 'Malformed turn revision.' };
          if (row.state === 'accepted' && row.conversation_sequence !== null) {
            return {
              kind: 'already-accepted',
              conversationSequence: asSequence(row.conversation_sequence),
            };
          }
          if (row.turn_revision !== command.expectedRevision) return { kind: 'stale-revision' };
          if (!canTransitionCommunicationTurnState(row.state as CommunicationTurnState, 'accepted'))
            return {
              kind: 'illegal-transition',
              from: row.state as CommunicationTurnState,
              to: 'accepted',
            };
          if (row.owner_id === null || row.conversation_id === null)
            return {
              kind: 'unavailable',
              reason: 'Authenticated owner/conversation claims required.',
            };

          const conversationCount = statements.countConversationActive.get(
            row.owner_id,
            row.conversation_id,
          ) as { n: number };
          if (conversationCount.n >= queueConfig.maxDepthPerConversation)
            return { kind: 'queue-full' };
          const globalCount = statements.countGlobalActive.get() as { n: number };
          if (globalCount.n >= queueConfig.maxGlobalPending) return { kind: 'global-queue-full' };

          const counter = statements.selectSequence.get(row.owner_id, row.conversation_id) as
            { next_sequence: number } | undefined;
          const assigned = counter?.next_sequence ?? 1;
          if (!Number.isSafeInteger(assigned) || assigned < 1)
            return { kind: 'unavailable', reason: 'Malformed sequence counter.' };
          const nextCounter = assigned + 1;
          if (!Number.isSafeInteger(nextCounter))
            return { kind: 'unavailable', reason: 'Sequence counter overflow.' };
          statements.upsertSequence.run(row.owner_id, row.conversation_id, nextCounter);

          const nextRevision = row.turn_revision + 1;
          const updated: TurnRow = {
            ...row,
            state: 'accepted',
            turn_revision: nextRevision,
            conversation_sequence: assigned,
            correlation_id: command.correlationId,
          };
          const written = writeTurn(updated, row.turn_revision, nowIso());
          if (!written.ok) return { kind: 'stale-revision' };
          return {
            kind: 'accepted',
            conversationSequence: asSequence(assigned),
            turnRevision: asRevision(nextRevision),
          };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok(busyOutcome((reason) => ({ kind: 'concurrency-conflict', reason })));
        return ok({ kind: 'unavailable', reason: 'Accept conversation turn failed.' });
      }
    },

    async transition(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): CommunicationTurnTransitionOutcome => {
          const row = loadTurn(command.turnId);
          if (row === undefined) return { kind: 'unavailable', reason: 'Turn not found.' };
          if (!assertSafeIntegerValue(row.turn_revision))
            return { kind: 'unavailable', reason: 'Malformed turn revision.' };
          if (row.state === command.targetState) return { kind: 'already-transitioned' };
          if (row.turn_revision !== command.expectedRevision) return { kind: 'stale-revision' };
          if (row.state !== command.expectedState)
            return {
              kind: 'illegal-transition',
              from: row.state as CommunicationTurnState,
              to: command.targetState,
            };
          const fromState = row.state;
          if (!canTransitionCommunicationTurnState(fromState, command.targetState))
            return {
              kind: 'illegal-transition',
              from: fromState,
              to: command.targetState,
            };
          const nextRevision = row.turn_revision + 1;
          const updated: TurnRow = {
            ...row,
            state: command.targetState,
            turn_revision: nextRevision,
            correlation_id: command.correlationId,
          };
          const written = writeTurn(updated, row.turn_revision, nowIso());
          if (!written.ok) return { kind: 'stale-revision' };
          return { kind: 'transitioned', turnRevision: asRevision(nextRevision) };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok(busyOutcome((reason) => ({ kind: 'concurrency-conflict', reason })));
        return ok({ kind: 'unavailable', reason: 'Turn transition failed.' });
      }
    },

    async recordFactualOutcome(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      try {
        const outcome = runImmediate(db, (): RecordFactualOutcomeResult => {
          const row = loadTurn(command.turnId);
          if (row === undefined) return { kind: 'unavailable', reason: 'Turn not found.' };
          if (!assertSafeIntegerValue(row.turn_revision))
            return { kind: 'unavailable', reason: 'Malformed turn revision.' };
          if (row.turn_revision !== command.expectedRevision) return { kind: 'stale-revision' };

          if (row.delivery_status === 'delivered' && command.deliveryStatus !== 'delivered')
            return {
              kind: 'fact-rewrite-denied',
              reason: 'Delivered delivery status is immutable.',
            };
          if (
            row.delivery_status === 'outcome_unknown' &&
            command.deliveryStatus !== 'outcome_unknown'
          )
            return {
              kind: 'fact-rewrite-denied',
              reason: 'Delivery outcome unknown is immutable.',
            };
          if (
            row.llm_outcome !== null &&
            command.llmOutcome !== null &&
            row.llm_outcome !== command.llmOutcome
          )
            return {
              kind: 'fact-rewrite-denied',
              reason: 'LLM outcome fact is immutable once set.',
            };
          if (row.llm_outcome !== null && command.llmOutcome === null)
            return {
              kind: 'fact-rewrite-denied',
              reason: 'LLM outcome fact cannot be cleared.',
            };

          const sameFacts =
            row.llm_outcome === command.llmOutcome &&
            row.delivery_status === command.deliveryStatus &&
            row.checkpoint_status === command.checkpointStatus &&
            row.audit_start_status === command.auditStatus.start &&
            row.audit_completion_status === command.auditStatus.completion &&
            row.error_code === command.errorCode;
          if (sameFacts) return { kind: 'already-recorded' };

          const nextRevision = row.turn_revision + 1;
          const updatedAt = nowIso();
          const updated: TurnRow = {
            ...row,
            turn_revision: nextRevision,
            correlation_id: command.correlationId,
            llm_outcome: command.llmOutcome ?? row.llm_outcome,
            delivery_status: command.deliveryStatus,
            checkpoint_status: command.checkpointStatus,
            audit_start_status: command.auditStatus.start,
            audit_completion_status: command.auditStatus.completion,
            error_code: command.errorCode,
          };
          const written = writeTurn(updated, row.turn_revision, updatedAt);
          if (!written.ok) return { kind: 'stale-revision' };
          statements.insertHistory.run(
            command.turnId,
            updatedAt,
            updated.llm_outcome,
            updated.delivery_status,
            updated.checkpoint_status,
            updated.audit_start_status,
            updated.audit_completion_status,
            updated.error_code,
            nextRevision,
          );
          return { kind: 'recorded', turnRevision: asRevision(nextRevision) };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok(busyOutcome((reason) => ({ kind: 'concurrency-conflict', reason })));
        return ok({ kind: 'unavailable', reason: 'Factual outcome persistence failed.' });
      }
    },

    async listRecoveryCandidates(query, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      const validated = validateCommunicationRecoveryCandidateQuery(query);
      if (!validated.ok) return validated;
      try {
        const rows = statements.listRecovery.all(
          JSON.stringify(query.states),
          query.limit,
        ) as TurnRow[];
        const candidates: CommunicationRecoveryCandidate[] = rows.map((row) => {
          const llmOutcome =
            row.llm_outcome === null
              ? null
              : isLlmCompletionOutcome(row.llm_outcome)
                ? row.llm_outcome
                : null;
          const errorCode =
            row.error_code === null
              ? null
              : isCommunicationErrorCode(row.error_code)
                ? row.error_code
                : null;
          return Object.freeze({
            turnId: row.turn_id as TurnId,
            correlationId: row.correlation_id,
            ownerId: row.owner_id,
            conversationId: row.conversation_id,
            observedAt: row.observed_at,
            updatedAt: row.updated_at,
            llmOutcome,
            errorCode,
            record: toRecord(row),
            recoveryReasons: deriveRecoveryReasons(row),
          }) as CommunicationRecoveryCandidate;
        });
        const outcome: CommunicationRecoveryCandidateListOutcome = {
          kind: 'found',
          candidates: Object.freeze(candidates),
        };
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Recovery candidate listing failed.' });
      }
    },
  };
};
