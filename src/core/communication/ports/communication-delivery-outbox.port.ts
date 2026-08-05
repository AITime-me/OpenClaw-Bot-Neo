import type { CorrelationId, ISO8601, PayloadDigest } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type {
  AuthenticatedCommunicationPrincipal,
  CommunicationError,
  CommunicationIdempotencyKey,
  TurnId,
  ValidatedTextOutput,
} from '../domain/index.js';

export interface CommunicationDeliveryOutboxPutCommand {
  readonly output: ValidatedTextOutput;
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly outputDigest: PayloadDigest;
  readonly expiresAt: ISO8601;
}

export type CommunicationDeliveryOutboxPutOutcome =
  | { readonly kind: 'stored' }
  | { readonly kind: 'already-stored' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'encryption-required'; readonly reason: string };

export interface CommunicationDeliveryOutboxPendingQuery {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly limit: number;
}

export interface CommunicationDeliveryOutboxPendingEntry {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly outputDigest: PayloadDigest;
  readonly expiresAt: ISO8601;
  readonly sealedBindingVersion: string;
}

export type CommunicationDeliveryOutboxLoadPendingOutcome =
  | { readonly kind: 'found'; readonly entries: readonly CommunicationDeliveryOutboxPendingEntry[] }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type CommunicationDeliveryOutcomeKind = 'delivered' | 'known-failure' | 'outcome-unknown';

export interface CommunicationDeliveryOutboxRecordOutcomeCommand {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: CommunicationIdempotencyKey;
  readonly outcome: CommunicationDeliveryOutcomeKind;
}

export type CommunicationDeliveryOutboxRecordOutcomeResult =
  | { readonly kind: 'recorded' }
  | { readonly kind: 'already-recorded' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface CommunicationDeliveryOutboxReconciliationCandidateQuery {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
}

export type CommunicationDeliveryOutboxReconciliationCandidateOutcome =
  | {
      readonly kind: 'candidate';
      readonly turnId: TurnId;
      readonly correlationId: CorrelationId;
      readonly outcome: 'outcome-unknown';
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface CommunicationDeliveryOutboxReconcileCommand {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: CommunicationIdempotencyKey;
}

export type CommunicationDeliveryOutboxReconcileOutcome =
  | { readonly kind: 'reconciled' }
  | { readonly kind: 'already-reconciled' }
  | { readonly kind: 'not-eligible'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Short-lived encrypted-before-live outbox contract.
 * No recipient strings, chat ids, or transport SDK types.
 */
export interface CommunicationDeliveryOutboxPort {
  put(
    command: CommunicationDeliveryOutboxPutCommand,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationDeliveryOutboxPutOutcome, CommunicationError>>;

  loadPending(
    query: CommunicationDeliveryOutboxPendingQuery,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationDeliveryOutboxLoadPendingOutcome, CommunicationError>>;

  recordDeliveryOutcome(
    command: CommunicationDeliveryOutboxRecordOutcomeCommand,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationDeliveryOutboxRecordOutcomeResult, CommunicationError>>;

  getReconciliationCandidate(
    query: CommunicationDeliveryOutboxReconciliationCandidateQuery,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationDeliveryOutboxReconciliationCandidateOutcome, CommunicationError>>;

  reconcile(
    command: CommunicationDeliveryOutboxReconcileCommand,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationDeliveryOutboxReconcileOutcome, CommunicationError>>;
}
