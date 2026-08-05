import type { CorrelationId, ISO8601, OwnerId } from '../../domain/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  COMMUNICATION_TURN_STATES,
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

export const validateCommunicationRecoveryCandidateQuery = (
  query: CommunicationRecoveryCandidateQuery,
): Result<void, CommunicationError> => {
  const stateCount = query.states.length;
  if (
    stateCount < MIN_COMMUNICATION_RECOVERY_STATE_COUNT ||
    stateCount > MAX_COMMUNICATION_RECOVERY_STATE_COUNT
  ) {
    return err(
      communicationError(
        'CONFIG_INVALID',
        `Recovery query states must contain ${String(MIN_COMMUNICATION_RECOVERY_STATE_COUNT)}..${String(MAX_COMMUNICATION_RECOVERY_STATE_COUNT)} entries.`,
      ),
    );
  }

  if (stateCount > COMMUNICATION_TURN_STATES.length) {
    return err(
      communicationError('CONFIG_INVALID', 'Recovery query states exceed known turn state count.'),
    );
  }

  const seen = new Set<string>();
  for (const state of query.states) {
    if (!(COMMUNICATION_TURN_STATES as readonly string[]).includes(state)) {
      return err(communicationError('CONFIG_INVALID', 'Recovery query contains an unknown state.'));
    }
    if (seen.has(state)) {
      return err(
        communicationError('CONFIG_INVALID', 'Recovery query states must not contain duplicates.'),
      );
    }
    seen.add(state);
  }

  if (
    query.limit < MIN_COMMUNICATION_RECOVERY_LIMIT ||
    query.limit > MAX_COMMUNICATION_RECOVERY_LIMIT
  ) {
    return err(
      communicationError(
        'CONFIG_INVALID',
        `Recovery query limit must be ${String(MIN_COMMUNICATION_RECOVERY_LIMIT)}..${String(MAX_COMMUNICATION_RECOVERY_LIMIT)}.`,
      ),
    );
  }

  return ok(undefined);
};
