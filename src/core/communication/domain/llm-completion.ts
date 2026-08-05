import type { CorrelationId, OwnerId } from '../../domain/identity.js';
import type { ConversationId, TurnId } from './communication-identity.js';
import type { TextPrompt } from './text-prompt.js';

export const LLM_COMPLETION_OUTCOMES = Object.freeze([
  'completed',
  'cancelled-before-invocation',
  'known-timeout',
  'provider-unavailable',
  'quota-unavailable',
  'policy-rejected',
  'invalid-response',
  'outcome-unknown',
] as const);

export type LlmCompletionOutcome = (typeof LLM_COMPLETION_OUTCOMES)[number];

export const isLlmCompletionOutcome = (value: unknown): value is LlmCompletionOutcome =>
  typeof value === 'string' && (LLM_COMPLETION_OUTCOMES as readonly string[]).includes(value);

/** Known failures that may prepare a deterministic notice then deliver. */
export const LLM_NOTICE_ELIGIBLE_FAILURE_OUTCOMES = Object.freeze([
  'provider-unavailable',
  'quota-unavailable',
  'known-timeout',
  'cancelled-before-invocation',
] as const);

export type LlmNoticeEligibleFailureOutcome = (typeof LLM_NOTICE_ELIGIBLE_FAILURE_OUTCOMES)[number];

/** Known failures that complete without notice or delivery. */
export const LLM_NOTICE_INELIGIBLE_FAILURE_OUTCOMES = Object.freeze([
  'policy-rejected',
  'invalid-response',
] as const);

export type LlmNoticeIneligibleFailureOutcome =
  (typeof LLM_NOTICE_INELIGIBLE_FAILURE_OUTCOMES)[number];

export type LlmKnownFailureOutcome =
  LlmNoticeEligibleFailureOutcome | LlmNoticeIneligibleFailureOutcome;

export type LlmFailureDisposition =
  | {
      readonly kind: 'known-failure-with-notice';
      readonly outcome: LlmNoticeEligibleFailureOutcome;
    }
  | {
      readonly kind: 'known-failure-without-notice';
      readonly outcome: LlmNoticeIneligibleFailureOutcome;
    }
  | { readonly kind: 'outcome-unknown'; readonly outcome: 'outcome-unknown' };

/** Provider-independent tools-free completion request. */
export interface LlmCompletionRequest {
  readonly prompt: TextPrompt;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly conversationId: ConversationId;
  readonly ownerId: OwnerId;
  readonly deadlineMs: number;
  readonly abortSignal: AbortSignal | null;
}

export interface LlmCompletionSuccess {
  readonly kind: 'completed';
  readonly outcome: 'completed';
  readonly text: string;
}

export interface LlmCompletionKnownFailure {
  readonly kind: 'known-failure';
  readonly outcome: LlmKnownFailureOutcome;
}

export interface LlmCompletionOutcomeUnknown {
  readonly kind: 'outcome-unknown';
  readonly outcome: 'outcome-unknown';
}

export type LlmCompletionResult =
  LlmCompletionSuccess | LlmCompletionKnownFailure | LlmCompletionOutcomeUnknown;

export const isLlmNoticeEligibleFailureOutcome = (
  outcome: LlmCompletionOutcome,
): outcome is LlmNoticeEligibleFailureOutcome =>
  (LLM_NOTICE_ELIGIBLE_FAILURE_OUTCOMES as readonly string[]).includes(outcome);

export const isLlmNoticeIneligibleFailureOutcome = (
  outcome: LlmCompletionOutcome,
): outcome is LlmNoticeIneligibleFailureOutcome =>
  (LLM_NOTICE_INELIGIBLE_FAILURE_OUTCOMES as readonly string[]).includes(outcome);

/**
 * Classifies non-success LLM outcomes for ledger/policy routing.
 * Notice is never allowed for outcome-unknown; notice-ineligible failures complete without delivery.
 */
export const classifyLlmFailureDisposition = (
  outcome: Exclude<LlmCompletionOutcome, 'completed'>,
): LlmFailureDisposition => {
  if (outcome === 'outcome-unknown') return { kind: 'outcome-unknown', outcome };
  if (isLlmNoticeEligibleFailureOutcome(outcome))
    return { kind: 'known-failure-with-notice', outcome };
  return { kind: 'known-failure-without-notice', outcome };
};

export const llmOutcomeAllowsDeterministicNotice = (outcome: LlmCompletionOutcome): boolean =>
  isLlmNoticeEligibleFailureOutcome(outcome);

export const llmOutcomeForbidsAutomaticRetry = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'outcome-unknown' || isLlmNoticeIneligibleFailureOutcome(outcome);

export const llmOutcomeForbidsDeterministicNotice = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'outcome-unknown' || isLlmNoticeIneligibleFailureOutcome(outcome);

/** Notice-ineligible known failures and outcome-unknown must not start delivery. */
export const llmOutcomeForbidsDelivery = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'outcome-unknown' || isLlmNoticeIneligibleFailureOutcome(outcome);
