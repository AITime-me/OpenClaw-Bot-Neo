import { err, ok, type Result } from '../../domain/result.js';
import type { IdentityFailure } from '../../domain/identity.js';
import type { ConversationSequence, TurnRevision } from './communication-identity.js';

export const COMMUNICATION_TURN_STATES = Object.freeze([
  'observed',
  'authentication_rejected',
  'authenticated',
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
  'completed',
] as const);

export type CommunicationTurnState = (typeof COMMUNICATION_TURN_STATES)[number];

export const isCommunicationTurnState = (value: unknown): value is CommunicationTurnState =>
  typeof value === 'string' && (COMMUNICATION_TURN_STATES as readonly string[]).includes(value);

export const DELIVERY_STATUSES = Object.freeze([
  'not_started',
  'started',
  'delivered',
  'failed',
  'outcome_unknown',
] as const);

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const CHECKPOINT_STATUSES = Object.freeze([
  'not_required',
  'pending',
  'succeeded',
  'failed',
] as const);

export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

export const AUDIT_START_STATUSES = Object.freeze(['pending', 'succeeded', 'failed'] as const);
export type AuditStartStatus = (typeof AUDIT_START_STATUSES)[number];

export const AUDIT_COMPLETION_STATUSES = Object.freeze([
  'not_started',
  'pending',
  'succeeded',
  'failed',
] as const);

export type AuditCompletionStatus = (typeof AUDIT_COMPLETION_STATUSES)[number];

export interface TurnAuditStatus {
  readonly start: AuditStartStatus;
  readonly completion: AuditCompletionStatus;
}

export const DEFAULT_MAX_DEPTH_PER_CONVERSATION = 8 as const;
export const MIN_MAX_DEPTH_PER_CONVERSATION = 2 as const;
export const MAX_MAX_DEPTH_PER_CONVERSATION = 64 as const;
export const MIN_MAX_GLOBAL_PENDING = 1 as const;
export const MAX_MAX_GLOBAL_PENDING = 4096 as const;
export const MAX_ACTIVE_TURNS_PER_CONVERSATION = 1 as const;

export interface CommunicationQueueConfig {
  readonly maxDepthPerConversation: number;
  readonly maxGlobalPending: number;
}

export interface CommunicationTurnRecord {
  readonly state: CommunicationTurnState;
  readonly turnRevision: TurnRevision;
  readonly conversationSequence: ConversationSequence | null;
  readonly deliveryStatus: DeliveryStatus;
  readonly checkpointStatus: CheckpointStatus;
  readonly auditStatus: TurnAuditStatus;
}

/**
 * Normative legal transitions for the durable turn ledger contract.
 * Admission order before queue: observed → authenticated|authentication_rejected → accepted → queued.
 */
const legalTransitions = {
  observed: ['authenticated', 'authentication_rejected'],
  authentication_rejected: ['completed'],
  authenticated: ['accepted'],
  accepted: ['queued'],
  queued: ['llm_started', 'cancelled'],
  llm_started: ['llm_completed', 'llm_known_failed', 'cancelled'],
  llm_known_failed: ['deterministic_notice_prepared'],
  deterministic_notice_prepared: ['output_validated'],
  llm_completed: ['output_validated'],
  output_validated: ['delivery_started'],
  delivery_started: ['delivered', 'delivery_failed', 'delivery_outcome_unknown'],
  delivered: ['completed'],
  delivery_failed: ['completed'],
  delivery_outcome_unknown: ['completed'],
  cancelled: ['completed'],
  completed: [],
} as const satisfies Record<CommunicationTurnState, readonly CommunicationTurnState[]>;

export const LEGAL_TRANSITIONS: Readonly<
  Record<CommunicationTurnState, readonly CommunicationTurnState[]>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(legalTransitions).map(([state, targets]) => [
      state,
      Object.freeze([...targets]),
    ]),
  ) as Record<CommunicationTurnState, readonly CommunicationTurnState[]>,
);

export const canTransitionCommunicationTurnState = (
  from: CommunicationTurnState,
  to: CommunicationTurnState,
): boolean => LEGAL_TRANSITIONS[from].includes(to);

export const assertLegalCommunicationTurnTransition = (
  from: CommunicationTurnState,
  to: CommunicationTurnState,
): Result<
  CommunicationTurnState,
  {
    readonly code: 'ILLEGAL_STATE_TRANSITION';
    readonly from: CommunicationTurnState;
    readonly to: CommunicationTurnState;
  }
> => {
  if (!canTransitionCommunicationTurnState(from, to))
    return err({ code: 'ILLEGAL_STATE_TRANSITION', from, to });
  return ok(to);
};

const parseQueueInteger = (
  value: unknown,
  label: string,
  min: number,
  max: number,
): Result<number, IdentityFailure> => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return err({ code: 'MALFORMED', reason: `${label} must be a safe integer.` });
  if (value < min || value > max)
    return err({ code: 'MALFORMED', reason: `${label} is outside the allowed range.` });
  return ok(value);
};

export const parseCommunicationQueueConfig = (
  value: unknown,
): Result<CommunicationQueueConfig, IdentityFailure> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return err({ code: 'MALFORMED', reason: 'Communication queue config must be an object.' });

  const descriptorDepth = Object.getOwnPropertyDescriptor(value, 'maxDepthPerConversation');
  const descriptorGlobal = Object.getOwnPropertyDescriptor(value, 'maxGlobalPending');
  if (
    descriptorDepth === undefined ||
    descriptorGlobal === undefined ||
    descriptorDepth.get !== undefined ||
    descriptorGlobal.get !== undefined
  )
    return err({
      code: 'MALFORMED',
      reason: 'Communication queue config must expose own data fields.',
    });

  const maxDepthPerConversation = parseQueueInteger(
    descriptorDepth.value,
    'maxDepthPerConversation',
    MIN_MAX_DEPTH_PER_CONVERSATION,
    MAX_MAX_DEPTH_PER_CONVERSATION,
  );
  const maxGlobalPending = parseQueueInteger(
    descriptorGlobal.value,
    'maxGlobalPending',
    MIN_MAX_GLOBAL_PENDING,
    MAX_MAX_GLOBAL_PENDING,
  );
  if (!maxDepthPerConversation.ok) return maxDepthPerConversation;
  if (!maxGlobalPending.ok) return maxGlobalPending;

  return ok(
    Object.freeze({
      maxDepthPerConversation: maxDepthPerConversation.value,
      maxGlobalPending: maxGlobalPending.value,
    }),
  );
};

export const defaultCommunicationQueueConfig = (): CommunicationQueueConfig =>
  Object.freeze({
    maxDepthPerConversation: DEFAULT_MAX_DEPTH_PER_CONVERSATION,
    maxGlobalPending: MIN_MAX_GLOBAL_PENDING,
  });

export const initialTurnAuditStatus = (): TurnAuditStatus =>
  Object.freeze({
    start: 'pending',
    completion: 'not_started',
  });

export const initialTurnOrthogonalStatuses = (): Pick<
  CommunicationTurnRecord,
  'deliveryStatus' | 'checkpointStatus' | 'auditStatus'
> =>
  Object.freeze({
    deliveryStatus: 'not_started',
    checkpointStatus: 'not_required',
    auditStatus: initialTurnAuditStatus(),
  });
