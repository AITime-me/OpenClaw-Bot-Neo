import type { CorrelationId, IdempotencyKey, ISO8601, PayloadDigest } from './identity.js';
import type { PrivacyClassification } from './privacy.js';

export interface WebhookSignatureMetadata {
  readonly algorithm: string;
  readonly keyReference: string;
  readonly signaturePresent: boolean;
  /** The signature value and verification secret are intentionally absent. */
}

/**
 * Declarative envelope fields. Digests must be produced from raw payload bytes inside the
 * trusted orchestration boundary — callers must not supply an unbound digest as proof.
 */
export interface WebhookEnvelope {
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly payloadDigest: PayloadDigest;
  readonly signature: WebhookSignatureMetadata;
  readonly idempotencyKey: IdempotencyKey;
  readonly contentType: string;
  readonly contentLength: number;
  readonly correlationId: CorrelationId;
  readonly privacyClassification: PrivacyClassification;
}

/**
 * @deprecated Caller-supplied boolean verification is not authorization proof. Prefer sealed
 * evidence produced by executeWebhookIngress. Kept only for transitional type references.
 */
export interface WebhookVerificationState {
  readonly sourceAuthenticated: boolean;
  readonly signatureVerified: boolean;
  readonly replayDetected: boolean;
  readonly duplicateEvent: boolean;
  readonly rateLimitAllowed: boolean;
  readonly verifierAvailable: boolean;
}

export type WebhookFailureCode =
  | 'UNKNOWN_SOURCE'
  | 'INVALID_TIMESTAMP'
  | 'REPLAY'
  | 'DUPLICATE_EVENT'
  | 'OVERSIZED_PAYLOAD'
  | 'CONTENT_LENGTH_MISMATCH'
  | 'VERIFIER_UNAVAILABLE'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_REQUIRED'
  | 'RATE_LIMITED'
  | 'INVALID_ENVELOPE'
  | 'INVALID_LIMITS'
  | 'EMPTY_DIGEST'
  | 'MALFORMED_DIGEST'
  | 'SCANNER_DENIED'
  | 'SCANNER_UNAVAILABLE'
  | 'UNAUTHORIZED_BOOLEAN_STATE';

export type WebhookIngressDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: WebhookFailureCode; readonly reason: string };

/** Safe audit metadata contains classifications and identifiers, never signature material. */
export interface SafeWebhookAuditEvent {
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  /** Safe truncated digest identifier — never raw payload. */
  readonly digestPrefix: string;
  readonly contentLength: number;
  readonly correlationId: CorrelationId;
  readonly privacyClassification: PrivacyClassification;
  readonly outcome: 'allowed' | 'denied';
  readonly failureCode?: WebhookFailureCode;
  readonly occurredAt: ISO8601;
}

export interface WebhookIngressCommand {
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: ISO8601;
  readonly contentType: string;
  readonly declaredContentLength: number;
  readonly correlationId: CorrelationId;
  readonly privacyClassification: PrivacyClassification;
  readonly signature: WebhookSignatureMetadata;
  readonly idempotencyKey: IdempotencyKey;
  readonly rawPayload: Uint8Array;
}

export interface WebhookIngressLimits {
  readonly maxContentLength: number;
  readonly maxClockSkewMs: number;
  readonly maxIdLength: number;
  readonly maxEventTypeLength: number;
}
