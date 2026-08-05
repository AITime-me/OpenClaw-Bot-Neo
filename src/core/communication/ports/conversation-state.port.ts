import type { CorrelationId, OwnerId } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type { ConversationRevision } from '../domain/communication-identity.js';
import type {
  CommunicationError,
  ConversationCheckpointMetadataStatus,
  ConversationId,
  ConversationStateSnapshot,
} from '../domain/index.js';

export interface ConversationStateKey {
  readonly conversationId: ConversationId;
  readonly ownerId: OwnerId;
}

export type ConversationStateLoadOutcome =
  | { readonly kind: 'found'; readonly snapshot: ConversationStateSnapshot }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ConversationStateCheckpointCommand {
  readonly key: ConversationStateKey;
  readonly expectedRevision: ConversationRevision;
  readonly nextSnapshot: ConversationStateSnapshot;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: string;
}

export type ConversationStateCheckpointOutcome =
  | { readonly kind: 'stored' }
  | { readonly kind: 'already-applied' }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'barrier-active' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Durable checkpoint barrier reasons (Build 3.7D0). */
export const CONVERSATION_CHECKPOINT_BARRIER_REASONS = Object.freeze([
  'checkpoint-failed',
  'llm-outcome-unknown',
  'delivery-outcome-unknown',
  'recovery-context-unavailable-after-delivery',
] as const);

export type ConversationCheckpointBarrierReason =
  (typeof CONVERSATION_CHECKPOINT_BARRIER_REASONS)[number];

export interface ConversationStateCheckpointBarrierCommand {
  readonly key: ConversationStateKey;
  readonly expectedRevision: ConversationRevision;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: string;
  readonly reason: ConversationCheckpointBarrierReason;
}

export type ConversationStateCheckpointBarrierOutcome =
  | { readonly kind: 'recorded'; readonly revision: ConversationRevision }
  | { readonly kind: 'already-recorded'; readonly revision: ConversationRevision }
  | { readonly kind: 'stale-revision'; readonly currentRevision: ConversationRevision }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Checkpoint reconciliation command.
 * Fingerprint is computed inside the port implementation — callers do not supply it.
 * Eligible only for pending → succeeded and failed → succeeded.
 * Must not create a snapshot, mutate context/summary/pause state, invoke LLM/delivery/memory/audit.
 * Successful reconcile increments revision by 1.
 */
export interface ConversationStateReconcileCheckpointCommand {
  readonly key: ConversationStateKey;
  readonly expectedRevision: ConversationRevision;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: string;
}

/** Statuses that make a checkpoint not eligible for reconciliation. */
export type ConversationCheckpointReconcileIneligibleStatus = 'not_required' | 'succeeded';

export type ConversationStateReconcileCheckpointOutcome =
  | { readonly kind: 'reconciled'; readonly revision: ConversationRevision }
  | { readonly kind: 'already-reconciled'; readonly revision: ConversationRevision }
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'not-eligible';
      readonly status: ConversationCheckpointReconcileIneligibleStatus;
      readonly currentRevision: ConversationRevision;
    }
  | { readonly kind: 'stale-revision'; readonly currentRevision: ConversationRevision }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Statuses eligible for reconcileCheckpoint (target is always succeeded). */
export const CONVERSATION_CHECKPOINT_RECONCILE_ELIGIBLE_FROM = Object.freeze([
  'pending',
  'failed',
] as const);

export type ConversationCheckpointReconcileEligibleFrom =
  (typeof CONVERSATION_CHECKPOINT_RECONCILE_ELIGIBLE_FROM)[number];

export const isConversationCheckpointReconcileEligible = (
  status: ConversationCheckpointMetadataStatus,
): status is ConversationCheckpointReconcileEligibleFrom =>
  status === 'pending' || status === 'failed';

/** Durable conversation checkpoint boundary — separate from memory, ledger, audit, outbox, delivery. */
export interface ConversationStatePort {
  load(
    key: ConversationStateKey,
    operationContext: OperationContext,
  ): Promise<Result<ConversationStateLoadOutcome, CommunicationError>>;

  checkpoint(
    command: ConversationStateCheckpointCommand,
    operationContext: OperationContext,
  ): Promise<Result<ConversationStateCheckpointOutcome, CommunicationError>>;

  /**
   * Records a durable checkpoint barrier: CAS revision+1, pause=degraded, status=failed.
   * Context/summary remain byte-equivalent (or protective empty snapshot when absent).
   * Does not invoke LLM, delivery, audit, or memory. Automatic unpause is forbidden.
   */
  recordCheckpointBarrier(
    command: ConversationStateCheckpointBarrierCommand,
    operationContext: OperationContext,
  ): Promise<Result<ConversationStateCheckpointBarrierOutcome, CommunicationError>>;

  reconcileCheckpoint(
    command: ConversationStateReconcileCheckpointCommand,
    operationContext: OperationContext,
  ): Promise<Result<ConversationStateReconcileCheckpointOutcome, CommunicationError>>;
}
