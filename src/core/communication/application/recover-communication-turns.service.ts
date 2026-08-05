import { createHash } from 'node:crypto';
import type { OperationContext } from '../../domain/operation-context.js';
import type { CorrelationId } from '../../domain/identity.js';
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
import type { CommunicationRecoveryCandidate } from '../domain/communication-recovery.js';

export type RecoverySideEffectCounters = {
  llmCalls: number;
  deliveryCalls: number;
  memoryCalls: number;
};

export type RecoverCommunicationTurnsDeps = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
};

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
  if (!result.ok) return result;
  if (result.value.kind === 'transitioned') return ok(Number(result.value.turnRevision));
  if (result.value.kind === 'already-transitioned') return ok(expectedRevision);
  return {
    ok: false,
    error: communicationError(
      'RECOVERY_CONTEXT_UNAVAILABLE',
      `Recovery transition ${expectedState}→${targetState} failed: ${result.value.kind}`,
    ),
  };
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

const maybeBarrier = async (
  conversationState: ConversationStatePort,
  candidate: CommunicationRecoveryCandidate,
  correlationId: CorrelationId,
  reason:
    | 'checkpoint-failed'
    | 'llm-outcome-unknown'
    | 'delivery-outcome-unknown'
    | 'recovery-context-unavailable-after-delivery',
  operationContext: OperationContext,
): Promise<void> => {
  if (candidate.ownerId === null || candidate.conversationId === null) return;
  const key = {
    ownerId: candidate.ownerId,
    conversationId: candidate.conversationId,
  };
  const loaded = await conversationState.load(key, operationContext);
  const expectedRevision =
    loaded.ok && loaded.value.kind === 'found' ? loaded.value.snapshot.revision : (0 as never);
  await conversationState.recordCheckpointBarrier(
    {
      key,
      expectedRevision,
      correlationId,
      idempotencyKey: hex64(`barrier-${reason}-${String(candidate.turnId)}`),
      reason,
    },
    operationContext,
  );
};

/**
 * Fail-safe restart recovery: no resume authority.
 * Never rehydrates principal, admission evidence, ValidatedTextOutput, or recipient.
 * Must not invoke LLM, delivery, or memory.
 */
export const recoverCommunicationTurns = async (
  deps: RecoverCommunicationTurnsDeps,
  operationContext: OperationContext,
  sideEffects: RecoverySideEffectCounters = { llmCalls: 0, deliveryCalls: 0, memoryCalls: 0 },
): Promise<Result<{ readonly recovered: number }, CommunicationError>> => {
  // Recovery must never call LLM/delivery/memory — counters stay at zero.
  if (
    sideEffects.llmCalls !== 0 ||
    sideEffects.deliveryCalls !== 0 ||
    sideEffects.memoryCalls !== 0
  )
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'Recovery side-effect counters must start at 0.'),
    };

  const unfinished = [
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

  const listed = await deps.ledger.listRecoveryCandidates(
    { states: [...unfinished], limit: 100 },
    operationContext,
  );
  if (!listed.ok) return listed;
  if (listed.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('LEDGER_UNAVAILABLE', listed.value.reason),
    };

  const candidates = listed.value.candidates;
  let recovered = 0;

  for (const candidate of candidates) {
    const state = candidate.record.state;
    if (state === 'completed') continue;

    if (state === 'delivery_started') {
      const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
      if (!corr.ok) return corr;
      const looked = await deps.outbox.readDeliveryOutcome(
        { turnId: candidate.turnId, correlationId: corr.value },
        operationContext,
      );
      if (!looked.ok) return looked;

      let deliveryStatus: 'delivered' | 'failed' | 'outcome_unknown' = 'outcome_unknown';
      let target: CommunicationTurnState = 'delivery_outcome_unknown';
      let errorCode: CommunicationError['code'] | null = 'DELIVERY_OUTCOME_UNKNOWN';

      if (looked.value.kind === 'delivered') {
        deliveryStatus = 'delivered';
        target = 'delivered';
        errorCode = null;
      } else if (looked.value.kind === 'known-failure') {
        deliveryStatus = 'failed';
        target = 'delivery_failed';
        errorCode = 'DELIVERY_FAILED';
      } else if (
        looked.value.kind === 'outcome-unknown' ||
        looked.value.kind === 'not-recorded' ||
        looked.value.kind === 'not-found'
      ) {
        if (looked.value.kind === 'not-recorded' || looked.value.kind === 'not-found') {
          await deps.outbox.recordDeliveryOutcome(
            {
              turnId: candidate.turnId,
              correlationId: corr.value,
              idempotencyKey: recoveryIdempotency(`outbox-unknown-${String(candidate.turnId)}`),
              outcome: 'outcome-unknown',
            },
            operationContext,
          );
        }
      } else {
        return {
          ok: false,
          error: communicationError('OUTBOX_UNAVAILABLE', looked.value.reason),
        };
      }

      let revision = Number(candidate.record.turnRevision);
      const factual = await deps.ledger.recordFactualOutcome(
        {
          turnId: candidate.turnId,
          correlationId: corr.value,
          expectedRevision: revision as never,
          llmOutcome: null,
          deliveryStatus,
          checkpointStatus: deliveryStatus === 'outcome_unknown' ? 'failed' : 'not_required',
          auditStatus: candidate.record.auditStatus,
          errorCode,
        },
        operationContext,
      );
      if (!factual.ok) return factual;
      if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

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

      const completed = await transitionTo(
        deps.ledger,
        candidate.turnId,
        revision,
        target,
        'completed',
        corr.value,
        operationContext,
      );
      if (!completed.ok) return completed;

      if (deliveryStatus === 'outcome_unknown')
        await maybeBarrier(
          deps.conversationState,
          candidate,
          corr.value,
          'delivery-outcome-unknown',
          operationContext,
        );
      recovered += 1;
      continue;
    }

    if (state === 'llm_started' && candidate.llmOutcome === null) {
      const corr = recoveryCorrelation(candidate.turnId, candidate.correlationId);
      if (!corr.ok) return corr;
      let revision = Number(candidate.record.turnRevision);
      const factual = await deps.ledger.recordFactualOutcome(
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
      );
      if (!factual.ok) return factual;
      if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

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
      const done = await completeFromCancelled(
        deps.ledger,
        candidate.turnId,
        cancelled.value,
        corr.value,
        operationContext,
      );
      if (!done.ok) return done;
      await maybeBarrier(
        deps.conversationState,
        candidate,
        corr.value,
        'llm-outcome-unknown',
        operationContext,
      );
      recovered += 1;
      continue;
    }

    if (
      state === 'delivered' ||
      state === 'delivery_failed' ||
      state === 'delivery_outcome_unknown' ||
      state === 'authentication_rejected'
    ) {
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
      recovered += 1;
      continue;
    }

    const cancelled = await cancelAndComplete(deps.ledger, candidate, operationContext);
    if (!cancelled.ok) return cancelled;
    recovered += 1;
  }

  return ok({ recovered });
};
