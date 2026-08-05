import type { CorrelationId, ISO8601, OwnerId } from '../../domain/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  isCommunicationTurnState,
  type CommunicationTurnState,
  type CommunicationTurnRecord,
} from './communication-turn.js';
import {
  communicationError,
  type CommunicationError,
  type CommunicationErrorCode,
} from './communication-errors.js';
import type { ConversationId, TurnId } from './communication-identity.js';
import type { LlmCompletionOutcome } from './llm-completion.js';

export const MIN_COMMUNICATION_RECOVERY_STATE_COUNT = 1 as const;
export const MAX_COMMUNICATION_RECOVERY_STATE_COUNT = 16 as const;
export const MIN_COMMUNICATION_RECOVERY_LIMIT = 1 as const;
export const MAX_COMMUNICATION_RECOVERY_LIMIT = 100 as const;

/** Normative recovery reason codes for restart candidates (non-authorizing). */
export const COMMUNICATION_RECOVERY_REASONS = Object.freeze([
  'may-continue-under-kill-switch',
  'llm-outcome-unknown-no-auto-retry',
  'notice-eligible-may-continue',
  'notice-ineligible-complete-without-delivery',
  'deterministic-notice-may-continue',
  'output-validated-may-continue-delivery',
  'delivery-outcome-unknown-no-auto-resend',
  'checkpoint-failed-reconcile-only',
  'completion-audit-retry-allowed',
  'terminal-no-resume',
] as const);

export type CommunicationRecoveryReason = (typeof COMMUNICATION_RECOVERY_REASONS)[number];

export const isCommunicationRecoveryReason = (
  value: unknown,
): value is CommunicationRecoveryReason =>
  typeof value === 'string' &&
  (COMMUNICATION_RECOVERY_REASONS as readonly string[]).includes(value);

export interface CommunicationRecoveryCandidateQuery {
  readonly states: readonly CommunicationTurnState[];
  readonly limit: number;
}

/**
 * Recovery scan row. Does not contain authority, principal, admission evidence,
 * output capability, payload, or recipient. Does not authorize LLM, delivery, or resend.
 */
export interface CommunicationRecoveryCandidate {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId | null;
  readonly ownerId: OwnerId | null;
  readonly conversationId: ConversationId | null;
  readonly observedAt: ISO8601;
  readonly updatedAt: ISO8601;
  readonly llmOutcome: LlmCompletionOutcome | null;
  readonly errorCode: CommunicationErrorCode | null;
  readonly record: CommunicationTurnRecord;
  readonly recoveryReasons: readonly [
    CommunicationRecoveryReason,
    ...CommunicationRecoveryReason[],
  ];
}

export type CommunicationRecoveryCandidateListOutcome =
  | { readonly kind: 'found'; readonly candidates: readonly CommunicationRecoveryCandidate[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Ordering for recovery candidate listing: updatedAt, then observedAt, then turnId. */
export const COMMUNICATION_RECOVERY_CANDIDATE_ORDER = Object.freeze([
  'updatedAt',
  'observedAt',
  'turnId',
] as const);

const configInvalid = (reason: string): Result<void, CommunicationError> =>
  err(communicationError('CONFIG_INVALID', reason));

/**
 * Fail-closed recovery query validation.
 * Accepts untrusted query shapes; non-array states and non-safe-integer limits are rejected.
 */
export const validateCommunicationRecoveryCandidateQuery = (query: {
  readonly states: unknown;
  readonly limit: unknown;
}): Result<void, CommunicationError> => {
  if (!Array.isArray(query.states)) {
    return configInvalid('Recovery query states must be an array.');
  }

  const stateCount = query.states.length;
  if (
    stateCount < MIN_COMMUNICATION_RECOVERY_STATE_COUNT ||
    stateCount > MAX_COMMUNICATION_RECOVERY_STATE_COUNT
  ) {
    return configInvalid(
      `Recovery query states must contain ${String(MIN_COMMUNICATION_RECOVERY_STATE_COUNT)}..${String(MAX_COMMUNICATION_RECOVERY_STATE_COUNT)} entries.`,
    );
  }

  const seen = new Set<string>();
  for (const state of query.states) {
    if (!isCommunicationTurnState(state)) {
      return configInvalid('Recovery query contains an unknown or illegal state.');
    }
    if (seen.has(state)) {
      return configInvalid('Recovery query states must not contain duplicates.');
    }
    seen.add(state);
  }

  if (typeof query.limit !== 'number' || !Number.isSafeInteger(query.limit)) {
    return configInvalid(
      'Recovery query limit must be a safe integer (NaN, Infinity, fractions, and unsafe integers are rejected).',
    );
  }

  if (
    query.limit < MIN_COMMUNICATION_RECOVERY_LIMIT ||
    query.limit > MAX_COMMUNICATION_RECOVERY_LIMIT
  ) {
    return configInvalid(
      `Recovery query limit must be ${String(MIN_COMMUNICATION_RECOVERY_LIMIT)}..${String(MAX_COMMUNICATION_RECOVERY_LIMIT)}.`,
    );
  }

  return ok(undefined);
};
