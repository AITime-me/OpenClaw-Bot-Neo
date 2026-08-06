import type { OperationContext } from '../../../domain/operation-context.js';
import { ok, type Result } from '../../../domain/result.js';
import { communicationError, type CommunicationError } from '../../domain/communication-errors.js';
import {
  classifyLlmFailureDisposition,
  type LlmCompletionResult,
} from '../../domain/llm-completion.js';
import { assembleTextPrompt } from '../../policy/text-prompt-policy.js';
import {
  createDeterministicNotice,
  validateTextOutput,
  type DeterministicNoticeReason,
} from '../../policy/text-output-policy.js';
import {
  FIXED_NEO_PERSONA_BODY,
  FIXED_SECURITY_SYSTEM_BODY,
} from '../../policy/text-prompt-policy.js';
import {
  bindTransition,
  type ProcessTextTurnDeps,
  type ProcessTextTurnInput,
  type ProcessTextTurnSuccess,
} from '../process-text-turn.types.js';
import { finalizeLlmOutcomeUnknown } from './unknown-terminalization.js';
import { finalizeDeliveryAfterValidatedOutput } from './delivery-finalization.js';
import { raceInvocationWithAbort } from './invocation-abort-latch.js';
import { requireFactualSuccess } from './phase-outcomes.js';

/**
 * Memory → prompt → LLM after audit start and execution gate.
 * Post-start Result.err / throw / abort → durable LLM outcome-unknown.
 */
export const executeAfterAuditStart = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revisionIn: number,
  operationContext: OperationContext,
): Promise<Result<ProcessTextTurnSuccess, CommunicationError>> => {
  let revision = revisionIn;
  const t = bindTransition(deps, input, operationContext);

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

  const toLlm = await t(revision, 'queued', 'llm_started');
  if (!toLlm.ok) return toLlm;
  revision = toLlm.value;

  if (!deps.isGenerationCurrent(input.generation)) {
    const unknown = await finalizeLlmOutcomeUnknown({
      ledger: deps.ledger,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      auditStartSucceeded: true,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  deps.noteLlmCall?.();
  const raced = await raceInvocationWithAbort(
    deps.llm.complete(
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
    ),
    input.abortSignal,
  );

  if (
    raced.kind === 'aborted' ||
    raced.kind === 'rejected' ||
    !deps.isGenerationCurrent(input.generation)
  ) {
    const unknown = await finalizeLlmOutcomeUnknown({
      ledger: deps.ledger,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      auditStartSucceeded: true,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  if (!raced.value.ok) {
    const unknown = await finalizeLlmOutcomeUnknown({
      ledger: deps.ledger,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      auditStartSucceeded: true,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  return routeLlmResult(deps, input, revision, raced.value.value, operationContext);
};

const routeLlmResult = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  revisionIn: number,
  result: LlmCompletionResult,
  operationContext: OperationContext,
): Promise<Result<ProcessTextTurnSuccess, CommunicationError>> => {
  let revision = revisionIn;
  const t = bindTransition(deps, input, operationContext);

  if (result.kind === 'outcome-unknown') {
    const unknown = await finalizeLlmOutcomeUnknown({
      ledger: deps.ledger,
      conversationState: deps.conversationState,
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      revision,
      auditStartSucceeded: true,
      transition: t,
      operationContext,
    });
    if (!unknown.ok) return unknown;
    return ok({ kind: 'completed' });
  }

  if (result.kind === 'known-failure') {
    const disposition = classifyLlmFailureDisposition(result.outcome);
    const toFailed = await t(revision, 'llm_started', 'llm_known_failed');
    if (!toFailed.ok) return toFailed;
    revision = toFailed.value;

    const factual = requireFactualSuccess(
      await deps.ledger.recordFactualOutcome(
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
      ),
      revision,
    );
    if (!factual.ok) return factual;
    revision = factual.value;

    if (disposition.kind === 'known-failure-without-notice') {
      const completed = await t(revision, 'llm_known_failed', 'completed');
      if (!completed.ok) return completed;
      return ok({ kind: 'completed' });
    }

    const notice = await createDeterministicNotice(
      result.outcome as DeterministicNoticeReason,
      deps.scanner,
      operationContext,
    );
    if (notice.kind !== 'notice')
      return { ok: false, error: communicationError('OUTPUT_REJECTED', notice.reason) };
    const prepared = await t(revision, 'llm_known_failed', 'deterministic_notice_prepared');
    if (!prepared.ok) return prepared;
    return finalizeDeliveryAfterValidatedOutput(
      deps,
      input,
      prepared.value,
      notice.output,
      'deterministic_notice_prepared',
      result.outcome,
      operationContext,
    );
  }

  const validated = await validateTextOutput(
    { source: 'llm', text: result.text },
    deps.scanner,
    operationContext,
  );
  if (validated.kind !== 'validated')
    return { ok: false, error: communicationError('OUTPUT_REJECTED', validated.reason) };
  const toCompleted = await t(revision, 'llm_started', 'llm_completed');
  if (!toCompleted.ok) return toCompleted;
  return finalizeDeliveryAfterValidatedOutput(
    deps,
    input,
    toCompleted.value,
    validated.output,
    'llm_completed',
    'completed',
    operationContext,
  );
};
