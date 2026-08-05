import type { CorrelationId, ISO8601, OwnerId, PolicyVersion } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type {
  AuditCompletionStatus,
  AuditStartStatus,
  CheckpointStatus,
  CommunicationError,
  CommunicationIdempotencyKey,
  CommunicationOperationalFlags,
  ConversationId,
  DeliveryStatus,
  TurnId,
} from '../domain/index.js';

export type CommunicationAuditOperationKind =
  'text-turn' | 'deterministic-notice' | 'checkpoint-reconciliation';

export interface CommunicationAuditStartEvent {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly operationKind: CommunicationAuditOperationKind;
  readonly policyVersion: PolicyVersion;
  readonly idempotencyKey: CommunicationIdempotencyKey;
  readonly timestamp: ISO8601;
  readonly redactedMetadata: Readonly<Record<string, string>>;
}

export interface CommunicationAuditCompletionEvent {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly operationKind: CommunicationAuditOperationKind;
  readonly policyVersion: PolicyVersion;
  readonly idempotencyKey: CommunicationIdempotencyKey;
  readonly timestamp: ISO8601;
  readonly deliveryStatus: DeliveryStatus;
  readonly checkpointStatus: CheckpointStatus;
  readonly auditStartStatus: AuditStartStatus;
  readonly auditCompletionStatus: AuditCompletionStatus;
  readonly errorCode: CommunicationError['code'] | null;
  readonly redactedMetadata: Readonly<Record<string, string>>;
}

export type CommunicationAuditRecordOutcome =
  | { readonly kind: 'recorded' }
  | { readonly kind: 'already-recorded' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface CommunicationAuditStartFailure extends CommunicationOperationalFlags {
  readonly code: 'AUDIT_START_FAILED';
  readonly reason: string;
}

export interface CommunicationAuditCompletionFailure {
  readonly code: 'AUDIT_COMPLETION_FAILED';
  readonly reason: string;
}

/** Two-phase audit: durable turn-start before LLM/delivery; idempotent completion afterward. */
export interface CommunicationAuditPort {
  recordStart(
    event: CommunicationAuditStartEvent,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationAuditRecordOutcome, CommunicationError>>;

  recordCompletion(
    event: CommunicationAuditCompletionEvent,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationAuditRecordOutcome, CommunicationError>>;
}
