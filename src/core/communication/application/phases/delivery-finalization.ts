import { createHash } from 'node:crypto';
import type { OperationContext } from '../../../domain/operation-context.js';
import { ok, type Result } from '../../../domain/result.js';
import { communicationError, type CommunicationError } from '../../domain/communication-errors.js';
import { parseCommunicationIdempotencyKey } from '../../domain/communication-identity.js';
import { getValidatedTextOutputView } from '../../domain/text-delivery.internal.js';
import type { ValidatedTextOutput } from '../../domain/text-delivery.js';
import { parseISO8601 } from '../../../domain/identity.js';
import { OFFLINE_OUTBOX_MAX_TTL_MS } from '../../ports/offline-communication-persistence.contract.js';
import type {
  ProcessTextTurnDeps,
  ProcessTextTurnInput,
  ProcessTextTurnSuccess,
} from '../process-text-turn.types.js';
import { bindTransition } from '../process-text-turn.types.js';
import { finalizeDeliveryOutcomeUnknown } from './unknown-terminalization.js';
import { finalizeCheckpointAfterDelivery } from './checkpoint-finalization.js';

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const mustIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('idempotency');
  return parsed.value;
};

/**
 * Outbox → delivery_started → proven/unknown delivery outcome → checkpoint finalization.
 * Post-start errors/rejections become durable delivery outcome-unknown (no resend).
 */
export const finalizeDeliveryAfterValidatedOutput = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revisionIn: number,
  output: ValidatedTextOutput,
  fromState: 'llm_completed' | 'deterministic_notice_prepared',
  operationContext: OperationContext,
): Promise<Result<ProcessTextTurnSuccess, CommunicationError>> => {
  let revision = revisionIn;
  const t = bindTransition(deps, input, operationContext);

  const toValidated = await t(revision, fromState, 'output_validated');
  if (!toValidated.ok) return toValidated;
  revision = toValidated.value;

  const view = getValidatedTextOutputView(output);
  if (view === null)
    return {
      ok: false,
      error: communicationError('OUTPUT_REJECTED', 'Validated output view unavailable.'),
    };

  const expiresAt = parseISO8601(new Date(Date.now() + OFFLINE_OUTBOX_MAX_TTL_MS).toISOString());
  if (!expiresAt.ok)
    return { ok: false, error: communicationError('CONFIG_INVALID', 'expiresAt invalid.') };

  const put = await deps.outbox.put(
    {
      output,
      principal: input.principal,
      turnId: input.turnId,
      correlationId: input.correlationId,
      outputDigest: view.payloadDigest,
      expiresAt: expiresAt.value,
    },
    operationContext,
  );
  if (!put.ok) return put;
  if (put.value.kind === 'rejected' || put.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('OUTBOX_UNAVAILABLE', put.value.reason),
    };

  const toDelivery = await t(revision, 'output_validated', 'delivery_started');
  if (!toDelivery.ok) return toDelivery;
  revision = toDelivery.value;

  if (!deps.isGenerationCurrent(input.generation)) {
    const unknown = await finalizeDeliveryOutcomeUnknown({
      ledger: deps.ledger,
      outbox: deps.outbox,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  deps.noteDeliveryCall?.();
  let delivered: Result<
    import('../../ports/text-delivery.port.js').TextDeliveryOutcome,
    CommunicationError
  >;
  try {
    delivered = await deps.delivery.deliver(
      {
        output,
        principal: input.principal,
        turnId: input.turnId,
        correlationId: input.correlationId,
        abortSignal: input.abortSignal,
      },
      operationContext,
    );
  } catch {
    const unknown = await finalizeDeliveryOutcomeUnknown({
      ledger: deps.ledger,
      outbox: deps.outbox,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  if (!deps.isGenerationCurrent(input.generation) || !delivered.ok) {
    const unknown = await finalizeDeliveryOutcomeUnknown({
      ledger: deps.ledger,
      outbox: deps.outbox,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  let outboxOutcome: 'delivered' | 'known-failure' | 'outcome-unknown';
  let deliveryStatus: 'delivered' | 'failed' | 'outcome_unknown';
  let errorCode: CommunicationError['code'] | null;

  if (delivered.value.kind === 'delivered') {
    outboxOutcome = 'delivered';
    deliveryStatus = 'delivered';
    errorCode = null;
  } else if (
    delivered.value.kind === 'known-failure' ||
    delivered.value.kind === 'disabled' ||
    delivered.value.kind === 'recipient-denied'
  ) {
    outboxOutcome = 'known-failure';
    deliveryStatus = 'failed';
    errorCode = 'DELIVERY_FAILED';
  } else {
    outboxOutcome = 'outcome-unknown';
    deliveryStatus = 'outcome_unknown';
    errorCode = 'DELIVERY_OUTCOME_UNKNOWN';
  }

  const recordedOutbox = await deps.outbox.recordDeliveryOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      idempotencyKey: mustIdempotency(`outbox-outcome-${String(input.turnId)}`),
      outcome: outboxOutcome,
    },
    operationContext,
  );
  if (!recordedOutbox.ok) return recordedOutbox;

  if (deliveryStatus === 'outcome_unknown') {
    const unknown = await finalizeDeliveryOutcomeUnknown({
      ledger: deps.ledger,
      outbox: deps.outbox,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  const provenDeliveryStatus: 'delivered' | 'failed' = deliveryStatus;
  const provenTarget: 'delivered' | 'delivery_failed' =
    deliveryStatus === 'delivered' ? 'delivered' : 'delivery_failed';

  const factual = await deps.ledger.recordFactualOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      expectedRevision: revision as never,
      llmOutcome: null,
      deliveryStatus: provenDeliveryStatus,
      checkpointStatus: 'pending',
      auditStatus: { start: 'succeeded', completion: 'pending' },
      errorCode,
    },
    operationContext,
  );
  if (!factual.ok) return factual;
  if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

  const moved = await t(revision, 'delivery_started', provenTarget);
  if (!moved.ok) return moved;
  revision = moved.value;

  const checkpointed = await finalizeCheckpointAfterDelivery(
    {
      ledger: deps.ledger,
      conversationState: deps.conversationState,
      audit: deps.audit,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      policyVersion: input.policyVersion,
      ownerText: input.observation.text,
      revision,
      deliveryStatus: provenDeliveryStatus,
      ledgerState: provenTarget,
      transition: t,
    },
    operationContext,
  );
  if (!checkpointed.ok) return checkpointed;
  return ok({ kind: 'completed' });
};
