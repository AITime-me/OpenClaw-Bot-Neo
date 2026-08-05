import type { OperationContext } from '../../domain/operation-context.js';
import type { CorrelationId, OwnerId, PolicyVersion } from '../../domain/identity.js';
import { ok, type Result } from '../../domain/result.js';
import { communicationError, type CommunicationError } from '../domain/communication-errors.js';
import type { AuthenticatedCommunicationPrincipal } from '../domain/authenticated-communication-principal.js';
import type { ConversationId, TurnId, TurnRevision } from '../domain/communication-identity.js';
import type { TransportTextObservation } from '../domain/transport-text-observation.js';
import {
  classifyLlmFailureDisposition,
  type LlmCompletionResult,
} from '../domain/llm-completion.js';
import { getValidatedTextOutputView } from '../domain/text-delivery.internal.js';
import { freezeConversationStateSnapshot } from '../domain/conversation-state.js';
import { parseConversationRevision } from '../domain/communication-identity.js';
import type { CommunicationTurnLedgerPort } from '../ports/communication-turn-ledger.port.js';
import type { CommunicationAuditPort } from '../ports/communication-audit.port.js';
import type { CommunicationDeliveryOutboxPort } from '../ports/communication-delivery-outbox.port.js';
import type { ConversationStatePort } from '../ports/conversation-state.port.js';
import type { LlmCompletionPort } from '../ports/llm-completion.port.js';
import type { TextDeliveryPort } from '../ports/text-delivery.port.js';
import type { CommunicationMemoryAuthorizationPort } from '../ports/communication-memory-authorization.port.js';
import type { SensitiveDataScannerPort } from '../../ports/sensitive-data-scanner.port.js';
import { assembleTextPrompt } from '../policy/text-prompt-policy.js';
import {
  createDeterministicNotice,
  validateTextOutput,
  type DeterministicNoticeReason,
} from '../policy/text-output-policy.js';
import { applyCommunicationKillSwitchPolicy } from '../policy/communication-kill-switch-policy.js';
import type { CommunicationKillSwitchPort } from '../ports/communication-kill-switch.port.js';
import { OFFLINE_OUTBOX_MAX_TTL_MS } from '../ports/offline-communication-persistence.contract.js';
import { parseISO8601 } from '../../domain/identity.js';
import { parseCommunicationIdempotencyKey } from '../domain/communication-identity.js';
import {
  FIXED_NEO_PERSONA_BODY,
  FIXED_SECURITY_SYSTEM_BODY,
} from '../policy/text-prompt-policy.js';
import { createHash } from 'node:crypto';

export type ProcessTextTurnInput = {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly observation: TransportTextObservation;
  readonly turnRevision: TurnRevision;
  readonly policyVersion: PolicyVersion;
  readonly abortSignal: AbortSignal | null;
  readonly deadlineMs: number;
  /** Generation token; late promises with stale token must not mutate durable outcomes. */
  readonly generation: number;
};

export type ProcessTextTurnDeps = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly audit: CommunicationAuditPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly llm: LlmCompletionPort;
  readonly delivery: TextDeliveryPort;
  readonly memory: CommunicationMemoryAuthorizationPort;
  readonly scanner: SensitiveDataScannerPort;
  readonly killSwitch: CommunicationKillSwitchPort;
  readonly isGenerationCurrent: (generation: number) => boolean;
  readonly noteLlmCall?: () => void;
  readonly noteDeliveryCall?: () => void;
  readonly noteMemoryCall?: () => void;
};

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const mustIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('idempotency');
  return parsed.value;
};

const recordBarrier = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  reason:
    | 'checkpoint-failed'
    | 'llm-outcome-unknown'
    | 'delivery-outcome-unknown'
    | 'recovery-context-unavailable-after-delivery',
  operationContext: OperationContext,
): Promise<void> => {
  const loaded = await deps.conversationState.load(
    { ownerId: input.ownerId, conversationId: input.conversationId },
    operationContext,
  );
  const expectedRevision =
    loaded.ok && loaded.value.kind === 'found' ? loaded.value.snapshot.revision : (0 as never);
  await deps.conversationState.recordCheckpointBarrier(
    {
      key: { ownerId: input.ownerId, conversationId: input.conversationId },
      expectedRevision,
      correlationId: input.correlationId,
      idempotencyKey: hex64(`barrier-${reason}-${String(input.turnId)}`),
      reason,
    },
    operationContext,
  );
};

const transition = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  expectedRevision: number,
  expectedState: Parameters<CommunicationTurnLedgerPort['transition']>[0]['expectedState'],
  targetState: Parameters<CommunicationTurnLedgerPort['transition']>[0]['targetState'],
  operationContext: OperationContext,
): Promise<Result<number, CommunicationError>> => {
  const result = await deps.ledger.transition(
    {
      turnId: input.turnId,
      expectedRevision: expectedRevision as never,
      expectedState,
      targetState,
      correlationId: input.correlationId,
    },
    operationContext,
  );
  if (!result.ok) return result;
  if (result.value.kind === 'transitioned') return ok(Number(result.value.turnRevision));
  if (result.value.kind === 'already-transitioned') return ok(expectedRevision);
  return {
    ok: false,
    error: communicationError('ILLEGAL_STATE_TRANSITION', result.value.kind),
  };
};

/**
 * Normative happy-path / notice / unknown turn processor after admission+queue.
 */
export const processTextTurn = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  if (!deps.isGenerationCurrent(input.generation)) return ok({ completed: true });

  const killObs = await deps.killSwitch.readSnapshot(operationContext);
  if (!killObs.ok)
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'Kill switch unavailable.'),
    };
  const kill = applyCommunicationKillSwitchPolicy(killObs.value);
  if (!kill.ok || kill.value.kind !== 'eligible')
    return {
      ok: false,
      error: communicationError('LLM_DISABLED', 'Communication kill switch blocked the turn.'),
    };

  let revision = Number(input.turnRevision);

  const startTs = parseISO8601(new Date().toISOString());
  if (!startTs.ok)
    return { ok: false, error: communicationError('CONFIG_INVALID', 'timestamp invalid.') };

  const auditStart = await deps.audit.recordStart(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      operationKind: 'text-turn',
      policyVersion: input.policyVersion,
      idempotencyKey: mustIdempotency(`audit-start-${String(input.turnId)}`),
      timestamp: startTs.value,
      redactedMetadata: { phase: 'start' },
    },
    operationContext,
  );
  if (!auditStart.ok) return auditStart;
  if (auditStart.value.kind === 'rejected' || auditStart.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('AUDIT_START_FAILED', auditStart.value.reason),
    };

  deps.noteMemoryCall?.();
  const memory = await deps.memory.readAuthorizedContext(
    {
      principal: input.principal,
      expectedOwnerId: input.ownerId,
      expectedConversationId: input.conversationId,
      correlationId: input.correlationId,
      purpose: 'text-prompt-context',
      maxRecords: 8,
      maxTotalBytes: 8192,
    },
    operationContext,
  );
  if (!memory.ok)
    return {
      ok: false,
      error: communicationError(
        memory.error.code === 'MEMORY_UNAVAILABLE' ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UNAUTHORIZED',
        memory.error.reason,
      ),
    };

  const assembled = await assembleTextPrompt(
    {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      policyVersion: input.policyVersion,
      securitySystemBody: FIXED_SECURITY_SYSTEM_BODY,
      neoPersonaBody: FIXED_NEO_PERSONA_BODY,
      memoryExcerpts: memory.value.excerpts.map((excerpt) =>
        Object.freeze({
          recordId: excerpt.recordId,
          namespace: excerpt.namespace,
          text: excerpt.text,
          provenanceLabel: excerpt.provenanceLabel,
          trustLabel: excerpt.trustLabel,
        }),
      ),
      activeConversationContext: Object.freeze([]),
      ownerText: input.observation.text,
      modelDerivedSummary: null,
    },
    deps.scanner,
    operationContext,
  );
  if (assembled.kind !== 'assembled')
    return {
      ok: false,
      error: communicationError('OUTPUT_REJECTED', assembled.reason),
    };

  const toLlm = await transition(deps, input, revision, 'queued', 'llm_started', operationContext);
  if (!toLlm.ok) return toLlm;
  revision = toLlm.value;

  if (!deps.isGenerationCurrent(input.generation)) {
    return finalizeUnknownLlm(deps, input, revision, operationContext);
  }

  deps.noteLlmCall?.();
  const llmResult = await deps.llm.complete(
    {
      prompt: assembled.prompt,
      turnId: input.turnId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      ownerId: input.ownerId,
      deadlineMs: input.deadlineMs,
      abortSignal: input.abortSignal,
    },
    operationContext,
  );
  if (!deps.isGenerationCurrent(input.generation))
    return finalizeUnknownLlm(deps, input, revision, operationContext);

  if (!llmResult.ok) return llmResult;
  return routeLlmResult(deps, input, revision, llmResult.value, operationContext);
};
const finalizeUnknownLlm = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revision: number,
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  const factual = await deps.ledger.recordFactualOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      expectedRevision: revision as never,
      llmOutcome: 'outcome-unknown',
      deliveryStatus: 'not_started',
      checkpointStatus: 'failed',
      auditStatus: { start: 'succeeded', completion: 'not_started' },
      errorCode: 'LLM_OUTCOME_UNKNOWN',
    },
    operationContext,
  );
  if (!factual.ok) return factual;
  if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);
  const cancelled = await transition(
    deps,
    input,
    revision,
    'llm_started',
    'cancelled',
    operationContext,
  );
  if (cancelled.ok) revision = cancelled.value;
  await transition(deps, input, revision, 'cancelled', 'completed', operationContext);
  await recordBarrier(deps, input, 'llm-outcome-unknown', operationContext);
  return ok({ completed: true });
};

const routeLlmResult = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revision: number,
  result: LlmCompletionResult,
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  if (result.kind === 'outcome-unknown')
    return finalizeUnknownLlm(deps, input, revision, operationContext);

  if (result.kind === 'known-failure') {
    const disposition = classifyLlmFailureDisposition(result.outcome);
    const toFailed = await transition(
      deps,
      input,
      revision,
      'llm_started',
      'llm_known_failed',
      operationContext,
    );
    if (!toFailed.ok) return toFailed;
    revision = toFailed.value;

    const factual = await deps.ledger.recordFactualOutcome(
      {
        turnId: input.turnId,
        correlationId: input.correlationId,
        expectedRevision: revision as never,
        llmOutcome: result.outcome,
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStatus: { start: 'succeeded', completion: 'not_started' },
        errorCode: null,
      },
      operationContext,
    );
    if (!factual.ok) return factual;
    if (factual.value.kind === 'recorded') revision = Number(factual.value.turnRevision);

    if (disposition.kind === 'known-failure-without-notice') {
      const completed = await transition(
        deps,
        input,
        revision,
        'llm_known_failed',
        'completed',
        operationContext,
      );
      if (!completed.ok) return completed;
      await recordCompletionAudit(deps, input, operationContext, 'succeeded');
      return ok({ completed: true });
    }

    // notice path
    const notice = await createDeterministicNotice(
      result.outcome as DeterministicNoticeReason,
      deps.scanner,
      operationContext,
    );
    if (notice.kind !== 'notice')
      return {
        ok: false,
        error: communicationError('OUTPUT_REJECTED', notice.reason),
      };
    const prepared = await transition(
      deps,
      input,
      revision,
      'llm_known_failed',
      'deterministic_notice_prepared',
      operationContext,
    );
    if (!prepared.ok) return prepared;
    revision = prepared.value;
    return deliverValidatedOutput(
      deps,
      input,
      revision,
      notice.output,
      'deterministic_notice_prepared',
      operationContext,
    );
  }

  // completed text
  const validated = await validateTextOutput(
    { source: 'llm', text: result.text },
    deps.scanner,
    operationContext,
  );
  if (validated.kind !== 'validated')
    return {
      ok: false,
      error: communicationError('OUTPUT_REJECTED', validated.reason),
    };
  const toCompleted = await transition(
    deps,
    input,
    revision,
    'llm_started',
    'llm_completed',
    operationContext,
  );
  if (!toCompleted.ok) return toCompleted;
  revision = toCompleted.value;
  return deliverValidatedOutput(
    deps,
    input,
    revision,
    validated.output,
    'llm_completed',
    operationContext,
  );
};

const deliverValidatedOutput = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revision: number,
  output: import('../domain/text-delivery.js').ValidatedTextOutput,
  fromState: 'llm_completed' | 'deterministic_notice_prepared',
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  const toValidated = await transition(
    deps,
    input,
    revision,
    fromState,
    'output_validated',
    operationContext,
  );
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
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'expiresAt invalid.'),
    };

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

  const toDelivery = await transition(
    deps,
    input,
    revision,
    'output_validated',
    'delivery_started',
    operationContext,
  );
  if (!toDelivery.ok) return toDelivery;
  revision = toDelivery.value;

  if (!deps.isGenerationCurrent(input.generation))
    return finalizeUnknownDelivery(deps, input, revision, operationContext);

  deps.noteDeliveryCall?.();
  const delivered = await deps.delivery.deliver(
    {
      output,
      principal: input.principal,
      turnId: input.turnId,
      correlationId: input.correlationId,
      abortSignal: input.abortSignal,
    },
    operationContext,
  );
  if (!deps.isGenerationCurrent(input.generation))
    return finalizeUnknownDelivery(deps, input, revision, operationContext);
  if (!delivered.ok) return delivered;

  let outboxOutcome: 'delivered' | 'known-failure' | 'outcome-unknown';
  let deliveryStatus: 'delivered' | 'failed' | 'outcome_unknown';
  let target: 'delivered' | 'delivery_failed' | 'delivery_outcome_unknown';
  let errorCode: CommunicationError['code'] | null;

  if (delivered.value.kind === 'delivered') {
    outboxOutcome = 'delivered';
    deliveryStatus = 'delivered';
    target = 'delivered';
    errorCode = null;
  } else if (
    delivered.value.kind === 'known-failure' ||
    delivered.value.kind === 'disabled' ||
    delivered.value.kind === 'recipient-denied'
  ) {
    outboxOutcome = 'known-failure';
    deliveryStatus = 'failed';
    target = 'delivery_failed';
    errorCode = 'DELIVERY_FAILED';
  } else {
    outboxOutcome = 'outcome-unknown';
    deliveryStatus = 'outcome_unknown';
    target = 'delivery_outcome_unknown';
    errorCode = 'DELIVERY_OUTCOME_UNKNOWN';
  }

  await deps.outbox.recordDeliveryOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      idempotencyKey: mustIdempotency(`outbox-outcome-${String(input.turnId)}`),
      outcome: outboxOutcome,
    },
    operationContext,
  );

  const factual = await deps.ledger.recordFactualOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      expectedRevision: revision as never,
      llmOutcome: null,
      deliveryStatus,
      checkpointStatus: deliveryStatus === 'outcome_unknown' ? 'failed' : 'pending',
      auditStatus: { start: 'succeeded', completion: 'pending' },
      errorCode,
    },
    operationContext,
  );
  if (factual.ok && factual.value.kind === 'recorded')
    revision = Number(factual.value.turnRevision);

  const moved = await transition(
    deps,
    input,
    revision,
    'delivery_started',
    target,
    operationContext,
  );
  if (moved.ok) revision = moved.value;

  if (deliveryStatus !== 'outcome_unknown') {
    const loaded = await deps.conversationState.load(
      { ownerId: input.ownerId, conversationId: input.conversationId },
      operationContext,
    );
    const expectedRevision =
      loaded.ok && loaded.value.kind === 'found' ? loaded.value.snapshot.revision : (0 as never);
    const nextRev = parseConversationRevision(Number(expectedRevision) + 1);
    if (nextRev.ok) {
      await deps.conversationState.checkpoint(
        {
          key: { ownerId: input.ownerId, conversationId: input.conversationId },
          expectedRevision,
          nextSnapshot: freezeConversationStateSnapshot({
            conversationId: input.conversationId,
            ownerId: input.ownerId,
            revision: nextRev.value,
            activeContext: Object.freeze([
              Object.freeze({
                role: 'owner' as const,
                text: input.observation.text,
                trust: 'untrusted' as const,
              }),
            ]),
            modelDerivedSummary: null,
            pauseState: 'active',
            checkpoint: Object.freeze({ status: 'succeeded' as const, revision: nextRev.value }),
          }),
          correlationId: input.correlationId,
          idempotencyKey: `checkpoint-${String(input.turnId)}`,
        },
        operationContext,
      );
    }
  } else {
    await recordBarrier(deps, input, 'delivery-outcome-unknown', operationContext);
  }

  await transition(deps, input, revision, target, 'completed', operationContext);
  await recordCompletionAudit(
    deps,
    input,
    operationContext,
    deliveryStatus === 'delivered' ? 'succeeded' : 'failed',
  );
  return ok({ completed: true });
};

const finalizeUnknownDelivery = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revision: number,
  operationContext: OperationContext,
): Promise<Result<{ readonly completed: true }, CommunicationError>> => {
  await deps.outbox.recordDeliveryOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      idempotencyKey: mustIdempotency(`outbox-unknown-${String(input.turnId)}`),
      outcome: 'outcome-unknown',
    },
    operationContext,
  );
  const factual = await deps.ledger.recordFactualOutcome(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      expectedRevision: revision as never,
      llmOutcome: null,
      deliveryStatus: 'outcome_unknown',
      checkpointStatus: 'failed',
      auditStatus: { start: 'succeeded', completion: 'pending' },
      errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
    },
    operationContext,
  );
  if (factual.ok && factual.value.kind === 'recorded')
    revision = Number(factual.value.turnRevision);
  const moved = await transition(
    deps,
    input,
    revision,
    'delivery_started',
    'delivery_outcome_unknown',
    operationContext,
  );
  if (moved.ok) revision = moved.value;
  await transition(
    deps,
    input,
    revision,
    'delivery_outcome_unknown',
    'completed',
    operationContext,
  );
  await recordBarrier(deps, input, 'delivery-outcome-unknown', operationContext);
  return ok({ completed: true });
};

const recordCompletionAudit = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  operationContext: OperationContext,
  status: 'succeeded' | 'failed',
): Promise<void> => {
  const ts = parseISO8601(new Date().toISOString());
  await deps.audit.recordCompletion(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      operationKind: 'text-turn',
      policyVersion: input.policyVersion,
      idempotencyKey: mustIdempotency(`audit-completion-${String(input.turnId)}`),
      timestamp: ts.ok ? ts.value : (new Date().toISOString() as never),
      deliveryStatus: status === 'succeeded' ? 'delivered' : 'outcome_unknown',
      checkpointStatus: status === 'succeeded' ? 'succeeded' : 'failed',
      auditStartStatus: 'succeeded',
      auditCompletionStatus: status,
      errorCode: null,
      redactedMetadata: { phase: 'completion' },
    },
    operationContext,
  );
};
