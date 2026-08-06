import { createHash } from 'node:crypto';
import type { OperationContext } from '../../../domain/operation-context.js';
import type { CorrelationId, OwnerId } from '../../../domain/identity.js';
import { ok, type Result } from '../../../domain/result.js';
import { communicationError, type CommunicationError } from '../../domain/communication-errors.js';
import type { ConversationId, TurnId, TurnRevision } from '../../domain/communication-identity.js';
import type { ConversationCheckpointBarrierReason } from '../../ports/conversation-state.port.js';
import type { ConversationStatePort } from '../../ports/conversation-state.port.js';
import type { CommunicationTurnLedgerPort } from '../../ports/communication-turn-ledger.port.js';
import type { CommunicationDeliveryOutboxPort } from '../../ports/communication-delivery-outbox.port.js';
import { parseCommunicationIdempotencyKey } from '../../domain/communication-identity.js';

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const mustIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('idempotency');
  return parsed.value;
};

export type BarrierWriteInput = {
  readonly conversationState: ConversationStatePort;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly correlationId: CorrelationId;
  readonly turnId: TurnId;
  readonly reason: ConversationCheckpointBarrierReason;
};

const BARRIER_CAS_ATTEMPTS = 3;

/**
 * Bounded fail-closed CAS attempts to record a durable checkpoint barrier.
 * Returns fatal error when durable barrier cannot be proven.
 */
export const recordDurableCheckpointBarrier = async (
  input: BarrierWriteInput,
  operationContext: OperationContext,
): Promise<Result<{ readonly revision: number }, CommunicationError>> => {
  const key = { ownerId: input.ownerId, conversationId: input.conversationId };
  let lastError = 'Checkpoint barrier write failed.';
  for (let attempt = 0; attempt < BARRIER_CAS_ATTEMPTS; attempt += 1) {
    const loaded = await input.conversationState.load(key, operationContext);
    if (!loaded.ok)
      return {
        ok: false,
        error: communicationError('CONVERSATION_CHECKPOINT_FAILED', 'Barrier load failed.'),
      };
    if (loaded.value.kind === 'unavailable')
      return {
        ok: false,
        error: communicationError('CONVERSATION_CHECKPOINT_FAILED', loaded.value.reason),
      };
    const expectedRevision =
      loaded.value.kind === 'found' ? loaded.value.snapshot.revision : (0 as never);
    const recorded = await input.conversationState.recordCheckpointBarrier(
      {
        key,
        expectedRevision,
        correlationId: input.correlationId,
        idempotencyKey: hex64(`barrier-${input.reason}-${String(input.turnId)}`),
        reason: input.reason,
      },
      operationContext,
    );
    if (!recorded.ok)
      return {
        ok: false,
        error: communicationError('CONVERSATION_CHECKPOINT_FAILED', 'Barrier Result.err.'),
      };
    if (recorded.value.kind === 'recorded' || recorded.value.kind === 'already-recorded')
      return ok({ revision: Number(recorded.value.revision) });
    if (recorded.value.kind === 'stale-revision') {
      lastError = 'Barrier CAS stale-revision.';
      continue;
    }
    lastError = recorded.value.reason;
    break;
  }
  return {
    ok: false,
    error: communicationError('CONVERSATION_CHECKPOINT_FAILED', lastError),
  };
};

export type TransitionFn = (
  expectedRevision: number,
  expectedState: Parameters<CommunicationTurnLedgerPort['transition']>[0]['expectedState'],
  targetState: Parameters<CommunicationTurnLedgerPort['transition']>[0]['targetState'],
) => Promise<Result<number, CommunicationError>>;

export const finalizeLlmOutcomeUnknown = async (args: {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly conversationState: ConversationStatePort;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly revision: number;
  readonly auditStartSucceeded: boolean;
  readonly transition: TransitionFn;
  readonly operationContext: OperationContext;
}): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  let revision = args.revision;
  const factual = await args.ledger.recordFactualOutcome(
    {
      turnId: args.turnId,
      correlationId: args.correlationId,
      expectedRevision: revision as TurnRevision,
      llmOutcome: 'outcome-unknown',
      deliveryStatus: 'not_started',
      checkpointStatus: 'failed',
      auditStatus: {
        start: args.auditStartSucceeded ? 'succeeded' : 'failed',
        completion: 'not_started',
      },
      errorCode: 'LLM_OUTCOME_UNKNOWN',
    },
    args.operationContext,
  );
  if (!factual.ok) return factual;
  if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

  const cancelled = await args.transition(revision, 'llm_started', 'cancelled');
  if (!cancelled.ok) return cancelled;
  revision = cancelled.value;
  const completed = await args.transition(revision, 'cancelled', 'completed');
  if (!completed.ok) return completed;

  const barrier = await recordDurableCheckpointBarrier(
    {
      conversationState: args.conversationState,
      ownerId: args.ownerId,
      conversationId: args.conversationId,
      correlationId: args.correlationId,
      turnId: args.turnId,
      reason: 'llm-outcome-unknown',
    },
    args.operationContext,
  );
  if (!barrier.ok) return barrier;
  return ok({ completed: true });
};

export const finalizeDeliveryOutcomeUnknown = async (args: {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly revision: number;
  readonly transition: TransitionFn;
  readonly operationContext: OperationContext;
}): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  let revision = args.revision;
  const outbox = await args.outbox.recordDeliveryOutcome(
    {
      turnId: args.turnId,
      correlationId: args.correlationId,
      idempotencyKey: mustIdempotency(`outbox-unknown-${String(args.turnId)}`),
      outcome: 'outcome-unknown',
    },
    args.operationContext,
  );
  if (!outbox.ok) return outbox;

  const factual = await args.ledger.recordFactualOutcome(
    {
      turnId: args.turnId,
      correlationId: args.correlationId,
      expectedRevision: revision as TurnRevision,
      llmOutcome: null,
      deliveryStatus: 'outcome_unknown',
      checkpointStatus: 'failed',
      auditStatus: { start: 'succeeded', completion: 'pending' },
      errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
    },
    args.operationContext,
  );
  if (!factual.ok) return factual;
  if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

  const moved = await args.transition(revision, 'delivery_started', 'delivery_outcome_unknown');
  if (!moved.ok) return moved;
  revision = moved.value;
  const completed = await args.transition(revision, 'delivery_outcome_unknown', 'completed');
  if (!completed.ok) return completed;

  const barrier = await recordDurableCheckpointBarrier(
    {
      conversationState: args.conversationState,
      ownerId: args.ownerId,
      conversationId: args.conversationId,
      correlationId: args.correlationId,
      turnId: args.turnId,
      reason: 'delivery-outcome-unknown',
    },
    args.operationContext,
  );
  if (!barrier.ok) return barrier;
  return ok({ completed: true });
};
