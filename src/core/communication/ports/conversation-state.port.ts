import type { CorrelationId, OwnerId } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type { ConversationRevision } from '../domain/communication-identity.js';
import type {
  CommunicationError,
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
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ConversationStateReconcileCheckpointCommand {
  readonly key: ConversationStateKey;
  readonly expectedRevision: ConversationRevision;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: string;
}

export type ConversationStateReconcileCheckpointOutcome =
  | { readonly kind: 'reconciled' }
  | { readonly kind: 'already-reconciled' }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'unavailable'; readonly reason: string };

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

  reconcileCheckpoint(
    command: ConversationStateReconcileCheckpointCommand,
    operationContext: OperationContext,
  ): Promise<Result<ConversationStateReconcileCheckpointOutcome, CommunicationError>>;
}
