import type { CorrelationId, IdempotencyKey, ISO8601, PayloadDigest } from './identity.js';
import type { PrivacyClassification } from './privacy.js';

export interface WebhookSignatureMetadata {
  readonly algorithm: string;
  readonly keyReference: string;
  readonly signaturePresent: boolean;
  /** The signature value and verification secret are intentionally absent. */
}

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
  | 'VERIFIER_UNAVAILABLE'
  | 'SIGNATURE_INVALID'
  | 'RATE_LIMITED'
  | 'INVALID_ENVELOPE';

export type WebhookIngressDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: WebhookFailureCode; readonly reason: string };

/** Safe audit metadata contains classifications and identifiers, never signature material. */
export interface SafeWebhookAuditEvent {
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadDigest: PayloadDigest;
  readonly correlationId: CorrelationId;
  readonly privacyClassification: PrivacyClassification;
  readonly outcome: 'allowed' | 'denied';
  readonly failureCode?: WebhookFailureCode;
  readonly occurredAt: ISO8601;
}
