export const COMMUNICATION_ERROR_CODES = Object.freeze([
  'AUTHENTICATION_REJECTED',
  'AUTHENTICATION_UNCERTAIN',
  'INVALID_OBSERVATION',
  'PAYLOAD_TOO_LARGE',
  'DUPLICATE_TRANSPORT_EVENT',
  'QUEUE_FULL',
  'GLOBAL_QUEUE_FULL',
  'LEDGER_UNAVAILABLE',
  'LEDGER_CONCURRENCY_CONFLICT',
  'ILLEGAL_STATE_TRANSITION',
  'CONVERSATION_STATE_UNAVAILABLE',
  'CONVERSATION_CHECKPOINT_FAILED',
  'AUDIT_START_FAILED',
  'AUDIT_COMPLETION_FAILED',
  'SECRET_SCAN_UNAVAILABLE',
  'MEMORY_UNAUTHORIZED',
  'MEMORY_UNAVAILABLE',
  'LLM_DISABLED',
  'PROVIDER_UNAVAILABLE',
  'QUOTA_UNAVAILABLE',
  'LLM_TIMEOUT',
  'LLM_CANCELLED',
  'LLM_OUTCOME_UNKNOWN',
  'INVALID_MODEL_RESPONSE',
  'OUTPUT_REJECTED',
  'RECIPIENT_DENIED',
  'DELIVERY_DISABLED',
  'DELIVERY_FAILED',
  'DELIVERY_OUTCOME_UNKNOWN',
  'OUTBOX_UNAVAILABLE',
  'CONFIG_INVALID',
  'ENCRYPTION_LIVE_GATE_BLOCKED',
  'RECOVERY_CONTEXT_UNAVAILABLE',
] as const);

export type CommunicationErrorCode = (typeof COMMUNICATION_ERROR_CODES)[number];

export interface CommunicationError {
  readonly code: CommunicationErrorCode;
  readonly reason: string;
}

export const isCommunicationErrorCode = (value: unknown): value is CommunicationErrorCode =>
  typeof value === 'string' && (COMMUNICATION_ERROR_CODES as readonly string[]).includes(value);

export const communicationError = (
  code: CommunicationErrorCode,
  reason: string,
): CommunicationError => Object.freeze({ code, reason });

export interface CommunicationOperationalFlags {
  readonly llmMustNotRun: boolean;
  readonly deliveryMustNotRun: boolean;
}

export interface CommunicationDuplicateTransportFlags extends CommunicationOperationalFlags {
  readonly newQueuePositionMustNotBeAssigned: true;
}

export const duplicateTransportOperationalFlags = (): CommunicationDuplicateTransportFlags =>
  Object.freeze({
    llmMustNotRun: true,
    deliveryMustNotRun: true,
    newQueuePositionMustNotBeAssigned: true,
  });

export const auditStartFailureFlags = (): CommunicationOperationalFlags =>
  Object.freeze({
    llmMustNotRun: true,
    deliveryMustNotRun: true,
  });

export const outputRejectedFlags = (): CommunicationOperationalFlags =>
  Object.freeze({
    llmMustNotRun: true,
    deliveryMustNotRun: true,
  });
