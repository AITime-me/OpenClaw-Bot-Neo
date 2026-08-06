import { createHash } from 'node:crypto';
import type { OperationContext } from '../../../domain/operation-context.js';
import type { CorrelationId, OwnerId, PolicyVersion } from '../../../domain/identity.js';
import { ok, type Result } from '../../../domain/result.js';
import type { CommunicationError } from '../../domain/communication-errors.js';
import type { ConversationId, TurnId, TurnRevision } from '../../domain/communication-identity.js';
import { parseConversationRevision } from '../../domain/communication-identity.js';
import { freezeConversationStateSnapshot } from '../../domain/conversation-state.js';
import type { ConversationStatePort } from '../../ports/conversation-state.port.js';
import type { CommunicationTurnLedgerPort } from '../../ports/communication-turn-ledger.port.js';
import type { CommunicationAuditPort } from '../../ports/communication-audit.port.js';
import { parseISO8601 } from '../../../domain/identity.js';
import { parseCommunicationIdempotencyKey } from '../../domain/communication-identity.js';
import { recordDurableCheckpointBarrier } from './unknown-terminalization.js';
import type { TransitionFn } from './unknown-terminalization.js';

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const mustIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('idempotency');
  return parsed.value;
};

export type CheckpointFinalizationInput = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly conversationState: ConversationStatePort;
  readonly audit: CommunicationAuditPort;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly policyVersion: PolicyVersion;
  readonly ownerText: string;
  readonly revision: number;
  readonly deliveryStatus: 'delivered' | 'failed';
  readonly ledgerState: 'delivered' | 'delivery_failed';
  readonly transition: TransitionFn;
};

/**
 * After durable delivery/known-failure transition: handle checkpoint outcomes.
 * Failure keeps deliveryStatus immutable, sets checkpoint failed + barrier, honest audit.
 */
export const finalizeCheckpointAfterDelivery = async (
  input: CheckpointFinalizationInput,
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  let revision = input.revision;
  const key = { ownerId: input.ownerId, conversationId: input.conversationId };
  const loaded = await input.conversationState.load(key, operationContext);
  if (!loaded.ok)
    return failCheckpointPath(input, revision, operationContext, 'Checkpoint load failed.');
  if (loaded.value.kind === 'unavailable')
    return failCheckpointPath(input, revision, operationContext, loaded.value.reason);

  const expectedRevision =
    loaded.value.kind === 'found' ? loaded.value.snapshot.revision : (0 as never);
  const priorPause =
    loaded.value.kind === 'found' ? loaded.value.snapshot.pauseState : ('active' as const);
  const priorContext =
    loaded.value.kind === 'found' ? loaded.value.snapshot.activeContext : Object.freeze([]);
  const priorSummary =
    loaded.value.kind === 'found' ? loaded.value.snapshot.modelDerivedSummary : null;

  const nextRev = parseConversationRevision(Number(expectedRevision) + 1);
  if (!nextRev.ok)
    return failCheckpointPath(input, revision, operationContext, 'Next revision invalid.');

  const checkpointed = await input.conversationState.checkpoint(
    {
      key,
      expectedRevision,
      nextSnapshot: freezeConversationStateSnapshot({
        conversationId: input.conversationId,
        ownerId: input.ownerId,
        revision: nextRev.value,
        activeContext: Object.freeze([
          ...priorContext,
          Object.freeze({
            role: 'owner' as const,
            text: input.ownerText,
            trust: 'untrusted' as const,
          }),
        ]),
        modelDerivedSummary: priorSummary,
        pauseState: priorPause === 'degraded' ? 'degraded' : 'active',
        checkpoint: Object.freeze({ status: 'succeeded' as const, revision: nextRev.value }),
      }),
      correlationId: input.correlationId,
      idempotencyKey: hex64(`checkpoint-${String(input.turnId)}`),
    },
    operationContext,
  );
  if (!checkpointed.ok)
    return failCheckpointPath(input, revision, operationContext, 'Checkpoint Result.err.');

  if (checkpointed.value.kind === 'stored' || checkpointed.value.kind === 'already-applied') {
    const factual = await input.ledger.recordFactualOutcome(
      {
        turnId: input.turnId,
        correlationId: input.correlationId,
        expectedRevision: revision as TurnRevision,
        llmOutcome: null,
        deliveryStatus: input.deliveryStatus,
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'pending' },
        errorCode: input.deliveryStatus === 'delivered' ? null : 'DELIVERY_FAILED',
      },
      operationContext,
    );
    if (!factual.ok) return factual;
    if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

    const completed = await input.transition(revision, input.ledgerState, 'completed');
    if (!completed.ok) return completed;
    await recordCompletionAudit(
      input,
      operationContext,
      input.deliveryStatus === 'delivered' ? 'succeeded' : 'failed',
      'succeeded',
    );
    return ok({ completed: true });
  }

  // unavailable | stale-revision | barrier-active | other unproven
  const outcomeKind = checkpointed.value.kind;
  return failCheckpointPath(input, revision, operationContext, `Checkpoint outcome=${outcomeKind}`);
};

const failCheckpointPath = async (
  input: CheckpointFinalizationInput,
  revisionIn: number,
  operationContext: OperationContext,
  reason: string,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  void reason;
  let revision = revisionIn;
  const factual = await input.ledger.recordFactualOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      expectedRevision: revision as TurnRevision,
      llmOutcome: null,
      deliveryStatus: input.deliveryStatus,
      checkpointStatus: 'failed',
      auditStatus: { start: 'succeeded', completion: 'pending' },
      errorCode: 'CONVERSATION_CHECKPOINT_FAILED',
    },
    operationContext,
  );
  if (!factual.ok) return factual;
  if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

  const completed = await input.transition(revision, input.ledgerState, 'completed');
  if (!completed.ok) return completed;

  const barrier = await recordDurableCheckpointBarrier(
    {
      conversationState: input.conversationState,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      turnId: input.turnId,
      reason: 'checkpoint-failed',
    },
    operationContext,
  );
  if (!barrier.ok) return barrier;

  await recordCompletionAudit(input, operationContext, 'failed', 'failed');
  return ok({ completed: true });
};

const recordCompletionAudit = async (
  input: CheckpointFinalizationInput,
  operationContext: OperationContext,
  auditCompletionStatus: 'succeeded' | 'failed',
  checkpointStatus: 'succeeded' | 'failed',
): Promise<void> => {
  const ts = parseISO8601(new Date().toISOString());
  if (!ts.ok) return;
  await input.audit.recordCompletion(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      operationKind: 'text-turn',
      policyVersion: input.policyVersion,
      idempotencyKey: mustIdempotency(`audit-completion-${String(input.turnId)}`),
      timestamp: ts.value,
      deliveryStatus: input.deliveryStatus,
      checkpointStatus,
      auditStartStatus: 'succeeded',
      auditCompletionStatus,
      errorCode:
        checkpointStatus === 'failed'
          ? 'CONVERSATION_CHECKPOINT_FAILED'
          : input.deliveryStatus === 'delivered'
            ? null
            : 'DELIVERY_FAILED',
      redactedMetadata: {
        phase: 'completion',
        checkpointStatus,
        deliveryStatus: input.deliveryStatus,
      },
    },
    operationContext,
  );
};
