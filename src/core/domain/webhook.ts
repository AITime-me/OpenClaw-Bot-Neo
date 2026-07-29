import type { CorrelationId, IdempotencyKey, ISO8601, Nonce, PayloadDigest } from './identity.js';
import type { PrivacyClassification } from './privacy.js';

export const WEBHOOK_ENVELOPE_VERSION = 'openclaw.webhook.v1' as const;
export type WebhookEnvelopeVersion = typeof WEBHOOK_ENVELOPE_VERSION;

export interface WebhookSignatureMetadata {
  readonly algorithm: string;
  readonly keyReference: string;
  /** Detached encoded signature. It is snapshotted by core and never copied to audit metadata. */
  readonly value: string;
}

/**
 * Declarative envelope fields. Digests must be produced from raw payload bytes inside the
 * trusted orchestration boundary — callers must not supply an unbound digest as proof.
 */
export interface WebhookEnvelope {
  readonly envelopeVersion: WebhookEnvelopeVersion;
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly payloadDigest: PayloadDigest;
  readonly signedEnvelopeDigest: PayloadDigest;
  readonly signatureDigest: PayloadDigest;
  readonly signature: WebhookSignatureMetadata;
  readonly idempotencyKey: IdempotencyKey;
  readonly nonce: Nonce;
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
  | 'REPLAY_DETECTED'
  | 'REPLAY'
  | 'DUPLICATE_EVENT'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'STALE_TIMESTAMP'
  | 'NONCE_REPLAY'
  | 'OVERSIZED_PAYLOAD'
  | 'CONTENT_LENGTH_MISMATCH'
  | 'VERIFIER_UNAVAILABLE'
  | 'VERIFIER_RESULT_INVALID'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_REQUIRED'
  | 'RATE_LIMITED'
  | 'INVALID_ENVELOPE'
  | 'INVALID_LIMITS'
  | 'EMPTY_DIGEST'
  | 'MALFORMED_DIGEST'
  | 'SCANNER_DENIED'
  | 'SCANNER_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'UNAUTHORIZED_BOOLEAN_STATE';

/** Controlled replay / idempotency outcomes returned by ReplayProtectionPort. */
export type WebhookReplayCheckOutcome =
  | 'accepted'
  | 'replay'
  | 'duplicate-event'
  | 'duplicate-idempotency-key'
  | 'stale-timestamp'
  | 'nonce-replay';

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
  readonly envelopeVersion: WebhookEnvelopeVersion;
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
  readonly nonce: Nonce;
  readonly rawPayload: Uint8Array;
}

export interface WebhookIngressLimits {
  readonly maxContentLength: number;
  readonly maxClockSkewMs: number;
  readonly maxIdLength: number;
  readonly maxEventTypeLength: number;
}

/**
 * Untrusted primitive verifier result returned by adapters. Core seals evidence after validation.
 * Extra fields (including optional reason codes) are rejected by the exact plain snapshot.
 */
export interface WebhookSignatureVerificationResult {
  readonly verified: boolean;
  readonly envelopeVersion: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly nonce: string;
  readonly payloadDigest: string;
  readonly signedEnvelopeDigest: string;
  readonly signatureDigest: string;
  readonly algorithm: string;
  readonly keyReference: string;
  readonly verifiedAt: string;
}

/**
 * Immutable request assembled by core from one exact command snapshot. Disposable copies prevent
 * verifier mutation from changing the canonical payload or signed representation.
 */
export interface WebhookCanonicalVerificationRequest {
  readonly envelope: WebhookEnvelope;
  readonly verificationRequestedAt: ISO8601;
  copyPayloadBytes(): Uint8Array;
  copyCanonicalSignedBytes(): Uint8Array;
}
