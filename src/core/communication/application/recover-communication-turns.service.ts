import { createHash } from 'node:crypto';
import type { OperationContext } from '../../domain/operation-context.js';
import type { CorrelationId, PolicyVersion } from '../../domain/identity.js';
import { parseISO8601 } from '../../domain/identity.js';
import { ok, type Result } from '../../domain/result.js';
import { communicationError, type CommunicationError } from '../domain/communication-errors.js';
import {
  parseCommunicationIdempotencyKey,
  parseCorrelationId,
  type TurnId,
} from '../domain/communication-identity.js';
import type { CommunicationTurnState } from '../domain/communication-turn.js';
import type { CommunicationTurnLedgerPort } from '../ports/communication-turn-ledger.port.js';
import type { CommunicationDeliveryOutboxPort } from '../ports/communication-delivery-outbox.port.js';
import type { ConversationStatePort } from '../ports/conversation-state.port.js';
import type { CommunicationAuditPort } from '../ports/communication-audit.port.js';
import type { CommunicationRecoveryCandidate } from '../domain/communication-recovery.js';
import { recordDurableCheckpointBarrier } from './phases/unknown-terminalization.js';
import type { ConversationCheckpointBarrierReason } from '../ports/conversation-state.port.js';
import {
  requireAuditSuccess,
  requireFactualSuccess,
  requireOutboxRecordSuccess,
  requireTransitionSuccess,
} from './phases/phase-outcomes.js';

export type RecoverySideEffectCounters = {
  llmCalls: number;
  deliveryCalls: number;
  memoryCalls: number;
};

export type RecoverCommunicationTurnsDeps = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly audit: CommunicationAuditPort;
  readonly policyVersion: PolicyVersion;
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 10_000;

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const recoveryCorrelation = (
  turnId: TurnId,
  existing: string | null,
): Result<CorrelationId, CommunicationError> => {
  const raw = existing ?? `recovery-${String(turnId)}`;
  const parsed = parseCorrelationId(raw);
  if (!parsed.ok)
    return {
      ok: false,
      error: communicationError(
        'RECOVERY_CONTEXT_UNAVAILABLE',
        'Recovery correlation unavailable.',
      ),
    };
  return ok(parsed.value);
};

const recoveryIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('recovery idempotency derivation failed');
  return parsed.value;
};

const transitionTo = async (
  ledger: CommunicationTurnLedgerPort,
  turnId: TurnId,
  expectedRevision: number,
  expectedState: CommunicationTurnState,
  targetState: CommunicationTurnState,
  correlationId: CorrelationId,
  operationContext: OperationContext,
): Promise<Result<number, CommunicationError>> => {
  const result = await ledger.transition(
    {
      turnId,
      expectedRevision: expectedRevision as never,
      expectedState,
      targetState,
      correlationId,
    },
    operationContext,
  );
  return requireTransitionSuccess(result, expectedRevision);
};

const completeFromCancelled = async (
  ledger: CommunicationTurnLedgerPort,
  turnId: TurnId,
  revision: number,
  correlationId: CorrelationId,
  operationContext: OperationContext,
): Promise<Result<void, CommunicationError>> => {
  const completed = await transitionTo(
    ledger,
    turnId,
    revision,
    'cancelled',
    'completed',
    correlationId,
    operationContext,
  );
  if (!completed.ok) return completed;
  return ok(undefined);
};

const cancelAndComplete = async (
  ledger: CommunicationTurnLedgerPort,
  candidate: CommunicationRecoveryCandidate,
  operationContext: OperationContext,
): Promise<Result<void, CommunicationError>> => {
  const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
  if (!corr.ok) return corr;
  let revision = Number(candidate.record.turnRevision);
  const state = candidate.record.state;
  if (state !== 'cancelled' && state !== 'completed') {
    const cancelled = await transitionTo(
      ledger,
      candidate.turnId,
      revision,
      state,
      'cancelled',
      corr.value,
      operationContext,
    );
    if (!cancelled.ok) return cancelled;
    revision = cancelled.value;
  }
  if (state === 'completed') return ok(undefined);
  return completeFromCancelled(ledger, candidate.turnId, revision, corr.value, operationContext);
};

const requireBarrier = async (
  conversationState: ConversationStatePort,
  candidate: CommunicationRecoveryCandidate,
  correlationId: CorrelationId,
  reason: ConversationCheckpointBarrierReason,
  operationContext: OperationContext,
): Promise<Result<void, CommunicationError>> => {
  if (candidate.ownerId === null || candidate.conversationId === null)
    return {
      ok: false,
      error: communicationError(
        'RECOVERY_CONTEXT_UNAVAILABLE',
        'Recovery barrier requires owner/conversation context.',
      ),
    };
  const barrier = await recordDurableCheckpointBarrier(
    {
      conversationState,
      ownerId: candidate.ownerId,
      conversationId: candidate.conversationId,
      correlationId,
      turnId: candidate.turnId,
      reason,
    },
    operationContext,
  );
  if (!barrier.ok) return barrier;
  return ok(undefined);
};

/**
 * After any delivery-like state, a missing conversation snapshot always requires a barrier
 * (including when ledger checkpointStatus is already succeeded).
 */
const needsCheckpointBarrier = async (
  conversationState: ConversationStatePort,
  candidate: CommunicationRecoveryCandidate,
  deliveryLikeState: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown',
  operationContext: OperationContext,
): Promise<Result<boolean, CommunicationError>> => {
  if (deliveryLikeState === 'delivery_outcome_unknown') return ok(true);

  const ledgerStatus = candidate.record.checkpointStatus;
  if (ledgerStatus === 'pending' || ledgerStatus === 'failed') return ok(true);

  if (candidate.ownerId === null || candidate.conversationId === null) {
    return ok(true);
  }

  const loaded = await conversationState.load(
    { ownerId: candidate.ownerId, conversationId: candidate.conversationId },
    operationContext,
  );
  if (!loaded.ok)
    return {
      ok: false,
      error: communicationError('RECOVERY_CONTEXT_UNAVAILABLE', 'Recovery checkpoint load failed.'),
    };
  if (loaded.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('CONVERSATION_STATE_UNAVAILABLE', loaded.value.reason),
    };
  if (loaded.value.kind === 'not-found') {
    return ok(true);
  }

  const snapStatus = loaded.value.snapshot.checkpoint.status;
  if (snapStatus === 'pending' || snapStatus === 'failed') return ok(true);

  if (ledgerStatus !== 'succeeded') return ok(true);

  return ok(false);
};

const barrierReasonFor = (
  state: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown',
): ConversationCheckpointBarrierReason => {
  if (state === 'delivery_outcome_unknown') return 'delivery-outcome-unknown';
  if (state === 'delivered') return 'recovery-context-unavailable-after-delivery';
  return 'checkpoint-failed';
};

/**
 * Idempotent completion-audit reconciliation. Without a proven terminal audit ingress stays closed.
 */
const reconcileCompletionAudit = async (
  deps: RecoverCommunicationTurnsDeps,
  candidate: CommunicationRecoveryCandidate,
  correlationId: CorrelationId,
  revisionIn: number,
  deliveryLike: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown',
  operationContext: OperationContext,
): Promise<Result<number, CommunicationError>> => {
  const completion = candidate.record.auditStatus.completion;
  if (completion === 'succeeded' || completion === 'failed') return ok(revisionIn);

  if (candidate.ownerId === null || candidate.conversationId === null)
    return {
      ok: false,
      error: communicationError(
        'RECOVERY_CONTEXT_UNAVAILABLE',
        'Completion audit reconciliation requires owner/conversation context.',
      ),
    };

  const deliveryStatus =
    deliveryLike === 'delivered'
      ? 'delivered'
      : deliveryLike === 'delivery_failed'
        ? 'failed'
        : 'outcome_unknown';
  const checkpointStatus =
    candidate.record.checkpointStatus === 'succeeded' ? 'succeeded' : 'failed';
  const auditCompletionStatus =
    deliveryStatus === 'delivered' && checkpointStatus === 'succeeded' ? 'succeeded' : 'failed';

  const ts = parseISO8601(new Date().toISOString());
  if (!ts.ok)
    return {
      ok: false,
      error: communicationError(
        'AUDIT_COMPLETION_FAILED',
        'Recovery completion audit timestamp invalid.',
      ),
    };

  const startEnsured = requireAuditSuccess(
    await deps.audit.recordStart(
      {
        turnId: candidate.turnId,
        correlationId,
        ownerId: candidate.ownerId,
        conversationId: candidate.conversationId,
        operationKind: 'checkpoint-reconciliation',
        policyVersion: deps.policyVersion,
        idempotencyKey: recoveryIdempotency(`audit-start-${String(candidate.turnId)}`),
        timestamp: ts.value,
        redactedMetadata: {
          phase: 'recovery-start',
          deliveryStatus,
        },
      },
      operationContext,
    ),
  );
  if (!startEnsured.ok) return startEnsured;

  const audited = requireAuditSuccess(
    await deps.audit.recordCompletion(
      {
        turnId: candidate.turnId,
        correlationId,
        ownerId: candidate.ownerId,
        conversationId: candidate.conversationId,
        operationKind: 'checkpoint-reconciliation',
        policyVersion: deps.policyVersion,
        idempotencyKey: recoveryIdempotency(`audit-completion-${String(candidate.turnId)}`),
        timestamp: ts.value,
        deliveryStatus,
        checkpointStatus,
        auditStartStatus: 'succeeded',
        auditCompletionStatus,
        errorCode:
          checkpointStatus === 'failed'
            ? 'CONVERSATION_CHECKPOINT_FAILED'
            : deliveryStatus === 'delivered'
              ? null
              : 'DELIVERY_FAILED',
        redactedMetadata: {
          phase: 'recovery-completion',
          checkpointStatus,
          deliveryStatus,
        },
      },
      operationContext,
    ),
  );
  if (!audited.ok) return audited;

  return requireFactualSuccess(
    await deps.ledger.recordFactualOutcome(
      {
        turnId: candidate.turnId,
        correlationId,
        expectedRevision: revisionIn as never,
        llmOutcome: candidate.llmOutcome,
        deliveryStatus,
        checkpointStatus,
        auditStatus: {
          start: 'succeeded',
          completion: auditCompletionStatus,
        },
        errorCode:
          checkpointStatus === 'failed'
            ? 'CONVERSATION_CHECKPOINT_FAILED'
            : deliveryStatus === 'delivered'
              ? null
              : 'DELIVERY_FAILED',
      },
      operationContext,
    ),
    revisionIn,
  );
};

const completeDeliveryLike = async (
  deps: RecoverCommunicationTurnsDeps,
  candidate: CommunicationRecoveryCandidate,
  state: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown',
  revisionIn: number,
  correlationId: CorrelationId,
  operationContext: OperationContext,
): Promise<Result<void, CommunicationError>> => {
  let revision = revisionIn;

  const needs = await needsCheckpointBarrier(
    deps.conversationState,
    {
      ...candidate,
      record: {
        ...candidate.record,
        state,
        turnRevision: revision as never,
      },
    },
    state,
    operationContext,
  );
  if (!needs.ok) return needs;
  if (needs.value) {
    const barrier = await requireBarrier(
      deps.conversationState,
      candidate,
      correlationId,
      barrierReasonFor(state),
      operationContext,
    );
    if (!barrier.ok) return barrier;
  }

  const audited = await reconcileCompletionAudit(
    deps,
    {
      ...candidate,
      record: {
        ...candidate.record,
        state,
        turnRevision: revision as never,
      },
    },
    correlationId,
    revision,
    state,
    operationContext,
  );
  if (!audited.ok) return audited;
  revision = audited.value;

  const completed = await transitionTo(
    deps.ledger,
    candidate.turnId,
    revision,
    state,
    'completed',
    correlationId,
    operationContext,
  );
  if (!completed.ok) return completed;
  return ok(undefined);
};

const pageFingerprint = (candidates: readonly CommunicationRecoveryCandidate[]): string =>
  candidates.map((candidate) => String(candidate.turnId)).join('\0');

const UNFINISHED_STATES = [
  'observed',
  'authenticated',
  'authentication_rejected',
  'accepted',
  'queued',
  'llm_started',
  'llm_known_failed',
  'deterministic_notice_prepared',
  'llm_completed',
  'output_validated',
  'delivery_started',
  'delivered',
  'delivery_failed',
  'delivery_outcome_unknown',
  'cancelled',
] as const satisfies readonly CommunicationTurnState[];

/**
 * Fail-safe restart recovery: no resume authority. Paginated until empty.
 * Unchanged non-empty pages fail closed.
 */
export const recoverCommunicationTurns = async (
  deps: RecoverCommunicationTurnsDeps,
  operationContext: OperationContext,
  sideEffects: RecoverySideEffectCounters = { llmCalls: 0, deliveryCalls: 0, memoryCalls: 0 },
): Promise<Result<{ readonly recovered: number }, CommunicationError>> => {
  if (
    sideEffects.llmCalls !== 0 ||
    sideEffects.deliveryCalls !== 0 ||
    sideEffects.memoryCalls !== 0
  )
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'Recovery side-effect counters must start at 0.'),
    };

  let recovered = 0;
  let pages = 0;
  let previousFingerprint: string | null = null;

  while (pages < MAX_PAGES) {
    pages += 1;
    const listed = await deps.ledger.listRecoveryCandidates(
      { states: [...UNFINISHED_STATES], limit: PAGE_LIMIT },
      operationContext,
    );
    if (!listed.ok) return listed;
    if (listed.value.kind === 'unavailable')
      return {
        ok: false,
        error: communicationError('LEDGER_UNAVAILABLE', listed.value.reason),
      };

    const candidates = listed.value.candidates;
    if (candidates.length === 0) return ok({ recovered });

    const fingerprint = pageFingerprint(candidates);
    if (previousFingerprint !== null && fingerprint === previousFingerprint)
      return {
        ok: false,
        error: communicationError(
          'RECOVERY_CONTEXT_UNAVAILABLE',
          'Recovery page did not change after processing; fail closed.',
        ),
      };
    previousFingerprint = fingerprint;

    let pageRecovered = 0;
    for (const candidate of candidates) {
      const handled = await recoverOne(deps, candidate, operationContext);
      if (!handled.ok) return handled;
      pageRecovered += 1;
      recovered += 1;
    }

    if (pageRecovered === 0)
      return {
        ok: false,
        error: communicationError(
          'RECOVERY_CONTEXT_UNAVAILABLE',
          'Recovery made no progress on a non-empty candidate page.',
        ),
      };
  }

  return {
    ok: false,
    error: communicationError(
      'RECOVERY_CONTEXT_UNAVAILABLE',
      'Recovery pagination exceeded bound.',
    ),
  };
};

const recoverOne = async (
  deps: RecoverCommunicationTurnsDeps,
  candidate: CommunicationRecoveryCandidate,
  operationContext: OperationContext,
): Promise<Result<void, CommunicationError>> => {
  const state = candidate.record.state;
  if (state === 'completed') return ok(undefined);

  if (state === 'delivery_started') {
    const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
    if (!corr.ok) return corr;
    const looked = await deps.outbox.readDeliveryOutcome(
      { turnId: candidate.turnId, correlationId: corr.value },
      operationContext,
    );
    if (!looked.ok) return looked;

    let deliveryStatus: 'delivered' | 'failed' | 'outcome_unknown';
    let target: CommunicationTurnState;
    let errorCode: CommunicationError['code'] | null;
    let deliveryLike: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown';

    if (looked.value.kind === 'delivered') {
      deliveryStatus = 'delivered';
      target = 'delivered';
      errorCode = null;
      deliveryLike = 'delivered';
    } else if (looked.value.kind === 'known-failure') {
      deliveryStatus = 'failed';
      target = 'delivery_failed';
      errorCode = 'DELIVERY_FAILED';
      deliveryLike = 'delivery_failed';
    } else if (
      looked.value.kind === 'outcome-unknown' ||
      looked.value.kind === 'not-recorded' ||
      looked.value.kind === 'not-found'
    ) {
      deliveryStatus = 'outcome_unknown';
      target = 'delivery_outcome_unknown';
      errorCode = 'DELIVERY_OUTCOME_UNKNOWN';
      deliveryLike = 'delivery_outcome_unknown';
      if (looked.value.kind === 'not-recorded' || looked.value.kind === 'not-found') {
        const tombstone = await deps.outbox.recordDeliveryOutcome(
          {
            turnId: candidate.turnId,
            correlationId: corr.value,
            idempotencyKey: recoveryIdempotency(`outbox-unknown-${String(candidate.turnId)}`),
            outcome: 'outcome-unknown',
          },
          operationContext,
        );
        const recorded = requireOutboxRecordSuccess(tombstone);
        if (!recorded.ok) return recorded;
      }
    } else {
      return {
        ok: false,
        error: communicationError('OUTBOX_UNAVAILABLE', looked.value.reason),
      };
    }

    const ledgerCheckpoint = candidate.record.checkpointStatus;
    const nextCheckpointStatus =
      deliveryStatus === 'outcome_unknown'
        ? 'failed'
        : ledgerCheckpoint === 'pending' || ledgerCheckpoint === 'failed'
          ? ledgerCheckpoint
          : ledgerCheckpoint === 'succeeded'
            ? 'succeeded'
            : 'pending';

    let revision = Number(candidate.record.turnRevision);
    const factual = requireFactualSuccess(
      await deps.ledger.recordFactualOutcome(
        {
          turnId: candidate.turnId,
          correlationId: corr.value,
          expectedRevision: revision as never,
          llmOutcome: null,
          deliveryStatus,
          checkpointStatus: nextCheckpointStatus,
          auditStatus: candidate.record.auditStatus,
          errorCode,
        },
        operationContext,
      ),
      revision,
    );
    if (!factual.ok) return factual;
    revision = factual.value;

    const moved = await transitionTo(
      deps.ledger,
      candidate.turnId,
      revision,
      'delivery_started',
      target,
      corr.value,
      operationContext,
    );
    if (!moved.ok) return moved;
    revision = moved.value;

    return completeDeliveryLike(
      deps,
      {
        ...candidate,
        record: {
          ...candidate.record,
          checkpointStatus: nextCheckpointStatus,
          state: target,
          turnRevision: revision as never,
        },
      },
      deliveryLike,
      revision,
      corr.value,
      operationContext,
    );
  }

  if (state === 'llm_started' && candidate.llmOutcome === null) {
    const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
    if (!corr.ok) return corr;
    let revision = Number(candidate.record.turnRevision);
    const factual = requireFactualSuccess(
      await deps.ledger.recordFactualOutcome(
        {
          turnId: candidate.turnId,
          correlationId: corr.value,
          expectedRevision: revision as never,
          llmOutcome: 'outcome-unknown',
          deliveryStatus: 'not_started',
          checkpointStatus: 'failed',
          auditStatus: candidate.record.auditStatus,
          errorCode: 'LLM_OUTCOME_UNKNOWN',
        },
        operationContext,
      ),
      revision,
    );
    if (!factual.ok) return factual;
    revision = factual.value;

    const cancelled = await transitionTo(
      deps.ledger,
      candidate.turnId,
      revision,
      'llm_started',
      'cancelled',
      corr.value,
      operationContext,
    );
    if (!cancelled.ok) return cancelled;
    const barrier = await requireBarrier(
      deps.conversationState,
      candidate,
      corr.value,
      'llm-outcome-unknown',
      operationContext,
    );
    if (!barrier.ok) return barrier;
    const done = await completeFromCancelled(
      deps.ledger,
      candidate.turnId,
      cancelled.value,
      corr.value,
      operationContext,
    );
    if (!done.ok) return done;
    return ok(undefined);
  }

  if (
    state === 'delivered' ||
    state === 'delivery_failed' ||
    state === 'delivery_outcome_unknown'
  ) {
    const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
    if (!corr.ok) return corr;
    return completeDeliveryLike(
      deps,
      candidate,
      state,
      Number(candidate.record.turnRevision),
      corr.value,
      operationContext,
    );
  }

  if (state === 'authentication_rejected') {
    const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
    if (!corr.ok) return corr;
    const completed = await transitionTo(
      deps.ledger,
      candidate.turnId,
      Number(candidate.record.turnRevision),
      state,
      'completed',
      corr.value,
      operationContext,
    );
    if (!completed.ok) return completed;
    return ok(undefined);
  }

  return cancelAndComplete(deps.ledger, candidate, operationContext);
};
