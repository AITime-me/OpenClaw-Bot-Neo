import type { CorrelationId, ISO8601 } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type { FreshObservedAdmissionEvidence } from '../domain/authenticated-communication-principal.js';
import type {
  AuditCompletionStatus,
  AuditStartStatus,
  AuthenticatedCommunicationPrincipal,
  CheckpointStatus,
  CommunicationDuplicateTransportFlags,
  CommunicationError,
  CommunicationIdempotencyKey,
  CommunicationRecoveryCandidate,
  CommunicationRecoveryCandidateListOutcome,
  CommunicationRecoveryCandidateQuery,
  CommunicationTurnState,
  ConversationSequence,
  DeliveryStatus,
  LlmCompletionOutcome,
  TransportInstanceId,
  TurnId,
  TurnRevision,
} from '../domain/index.js';

export interface ObserveTransportEventCommand {
  readonly idempotencyKey: CommunicationIdempotencyKey;
  readonly transportInstanceId: TransportInstanceId;
  readonly turnId: TurnId;
  readonly observedAt: ISO8601;
}

export type ObserveTransportEventOutcome =
  | {
      readonly kind: 'fresh-observed';
      readonly turnId: TurnId;
      readonly turnRevision: TurnRevision;
      readonly admissionEvidence: FreshObservedAdmissionEvidence;
    }
  | {
      readonly kind: 'duplicate-existing';
      readonly turnId: TurnId;
      readonly state: CommunicationTurnState;
      readonly flags: CommunicationDuplicateTransportFlags;
    }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'concurrency-conflict'; readonly reason: string };

export interface RecordAuthenticationResultCommand {
  readonly turnId: TurnId;
  readonly expectedRevision: TurnRevision;
  readonly correlationId: CorrelationId;
  readonly outcome:
    | { readonly kind: 'authenticated'; readonly principal: AuthenticatedCommunicationPrincipal }
    | { readonly kind: 'authentication-rejected'; readonly reason: string };
}

export type RecordAuthenticationResultOutcome =
  | { readonly kind: 'recorded'; readonly turnRevision: TurnRevision }
  | { readonly kind: 'already-recorded' }
  | {
      readonly kind: 'illegal-transition';
      readonly from: CommunicationTurnState;
      readonly to: CommunicationTurnState;
    }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'concurrency-conflict'; readonly reason: string };

export interface AcceptConversationTurnCommand {
  readonly turnId: TurnId;
  readonly expectedRevision: TurnRevision;
  readonly correlationId: CorrelationId;
}

export type AcceptConversationTurnOutcome =
  | {
      readonly kind: 'accepted';
      readonly conversationSequence: ConversationSequence;
      readonly turnRevision: TurnRevision;
    }
  | { readonly kind: 'already-accepted'; readonly conversationSequence: ConversationSequence }
  | {
      readonly kind: 'illegal-transition';
      readonly from: CommunicationTurnState;
      readonly to: CommunicationTurnState;
    }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'concurrency-conflict'; readonly reason: string }
  | { readonly kind: 'queue-full' }
  | { readonly kind: 'global-queue-full' };

export interface CommunicationTurnTransitionCommand {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly expectedState: CommunicationTurnState;
  readonly expectedRevision: TurnRevision;
  readonly targetState: CommunicationTurnState;
}

export type CommunicationTurnTransitionOutcome =
  | { readonly kind: 'transitioned'; readonly turnRevision: TurnRevision }
  | { readonly kind: 'already-transitioned' }
  | {
      readonly kind: 'illegal-transition';
      readonly from: CommunicationTurnState;
      readonly to: CommunicationTurnState;
    }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'concurrency-conflict'; readonly reason: string };

export interface RecordFactualOutcomeCommand {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly expectedRevision: TurnRevision;
  readonly llmOutcome: LlmCompletionOutcome | null;
  readonly deliveryStatus: DeliveryStatus;
  readonly checkpointStatus: CheckpointStatus;
  readonly auditStatus: {
    readonly start: AuditStartStatus;
    readonly completion: AuditCompletionStatus;
  };
  readonly errorCode: CommunicationError['code'] | null;
}

export type RecordFactualOutcomeResult =
  | { readonly kind: 'recorded'; readonly turnRevision: TurnRevision }
  | { readonly kind: 'already-recorded' }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'fact-rewrite-denied'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'concurrency-conflict'; readonly reason: string };

export type {
  CommunicationRecoveryCandidate,
  CommunicationRecoveryCandidateListOutcome,
  CommunicationRecoveryCandidateQuery,
};

/**
 * Durable turn ledger contract for atomic observed admission, authentication, and sequencing.
 * Recovery listing orders by updatedAt, observedAt, turnId.
 * Invalid recovery bounds return CONFIG_INVALID (not a soft outcome).
 * Storage implementation is deferred to Build 3.7C.
 */
export interface CommunicationTurnLedgerPort {
  observeTransportEvent(
    command: ObserveTransportEventCommand,
    operationContext: OperationContext,
  ): Promise<Result<ObserveTransportEventOutcome, CommunicationError>>;

  recordAuthenticationResult(
    command: RecordAuthenticationResultCommand,
    operationContext: OperationContext,
  ): Promise<Result<RecordAuthenticationResultOutcome, CommunicationError>>;

  acceptConversationTurn(
    command: AcceptConversationTurnCommand,
    operationContext: OperationContext,
  ): Promise<Result<AcceptConversationTurnOutcome, CommunicationError>>;

  transition(
    command: CommunicationTurnTransitionCommand,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationTurnTransitionOutcome, CommunicationError>>;

  recordFactualOutcome(
    command: RecordFactualOutcomeCommand,
    operationContext: OperationContext,
  ): Promise<Result<RecordFactualOutcomeResult, CommunicationError>>;

  listRecoveryCandidates(
    query: CommunicationRecoveryCandidateQuery,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationRecoveryCandidateListOutcome, CommunicationError>>;
}
