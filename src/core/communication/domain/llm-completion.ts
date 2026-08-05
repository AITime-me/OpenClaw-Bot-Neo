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
  readonly outcome: Exclude<LlmCompletionOutcome, 'completed' | 'outcome-unknown'>;
}

export interface LlmCompletionOutcomeUnknown {
  readonly kind: 'outcome-unknown';
  readonly outcome: 'outcome-unknown';
}

export type LlmCompletionResult =
  LlmCompletionSuccess | LlmCompletionKnownFailure | LlmCompletionOutcomeUnknown;

export const llmOutcomeAllowsDeterministicNotice = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'provider-unavailable' ||
  outcome === 'quota-unavailable' ||
  outcome === 'known-timeout' ||
  outcome === 'cancelled-before-invocation';

export const llmOutcomeForbidsAutomaticRetry = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'outcome-unknown';

export const llmOutcomeForbidsDeterministicNotice = (outcome: LlmCompletionOutcome): boolean =>
  outcome === 'outcome-unknown';
