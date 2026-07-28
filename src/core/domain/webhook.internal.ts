import { createHash } from 'node:crypto';
import type { CorrelationId, IdempotencyKey, ISO8601, PayloadDigest } from './identity.js';
import type { PrivacyClassification } from './privacy.js';
import type { WebhookEnvelope } from './webhook.js';

export const rawWebhookPayloadBrand: unique symbol = Symbol('RawWebhookPayloadHandle');
export const authenticatedWebhookSourceBrand: unique symbol = Symbol('AuthenticatedWebhookSource');
export const payloadBoundSignatureBrand: unique symbol = Symbol('PayloadBoundSignatureEvidence');
export const webhookTimestampEvidenceBrand: unique symbol = Symbol('WebhookTimestampEvidence');
export const webhookReplayEvidenceBrand: unique symbol = Symbol('WebhookReplayEvidence');
export const webhookRateLimitEvidenceBrand: unique symbol = Symbol('WebhookRateLimitEvidence');
export const sanitizedWebhookPayloadBrand: unique symbol = Symbol('SanitizedWebhookPayload');
export const authorizedWebhookIngressBrand: unique symbol = Symbol('AuthorizedWebhookIngress');

/**
 * Opaque payload handle. Canonical bytes are not exposed as a shared writable reference.
 * `copyBytes()` always returns a disposable copy that cannot mutate core-owned storage.
 */
export interface RawWebhookPayloadHandle {
  readonly [rawWebhookPayloadBrand]: true;
  readonly payloadDigest: PayloadDigest;
  readonly contentLength: number;
  readonly contentType: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly receivedAt: ISO8601;
  readonly correlationId: CorrelationId;
  /** Returns a disposable copy of canonical bytes. Mutating the copy never affects core. */
  copyBytes(): Uint8Array;
}

export interface AuthenticatedWebhookSourceEvidence {
  readonly [authenticatedWebhookSourceBrand]: true;
  readonly sourceId: string;
  readonly authenticatedAt: ISO8601;
}

export interface PayloadBoundSignatureEvidence {
  readonly [payloadBoundSignatureBrand]: true;
  readonly sourceId: string;
  readonly payloadDigest: PayloadDigest;
  readonly algorithm: string;
  readonly keyReference: string;
  readonly verifiedAt: ISO8601;
}

export interface WebhookTimestampEvidence {
  readonly [webhookTimestampEvidenceBrand]: true;
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly trustedNow: ISO8601;
}

export interface WebhookReplayEvidence {
  readonly [webhookReplayEvidenceBrand]: true;
  readonly eventId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly status: 'accepted';
}

export interface WebhookRateLimitEvidence {
  readonly [webhookRateLimitEvidenceBrand]: true;
  readonly sourceId: string;
  readonly eventType: string;
  readonly decision: 'allow';
}

export interface SanitizedWebhookPayloadEvidence {
  readonly [sanitizedWebhookPayloadBrand]: true;
  readonly payloadDigest: PayloadDigest;
  readonly privacyClassification: PrivacyClassification;
  readonly redactedPreview: string;
}

export interface AuthorizedWebhookIngressEvidence {
  readonly [authorizedWebhookIngressBrand]: true;
  readonly envelope: WebhookEnvelope;
  readonly source: AuthenticatedWebhookSourceEvidence;
  readonly signature: PayloadBoundSignatureEvidence;
  readonly timestamp: WebhookTimestampEvidence;
  readonly replay: WebhookReplayEvidence;
  readonly rateLimit: WebhookRateLimitEvidence;
  readonly sanitized: SanitizedWebhookPayloadEvidence;
  readonly authorizedAt: ISO8601;
}

export type { WebhookSignatureVerificationResult } from './webhook.js';

const freezeRecord = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  if (ArrayBuffer.isView(value)) return;
  for (const nested of Object.values(value as Record<string, unknown>)) freezeRecord(nested);
  Object.freeze(value);
};

export function computeWebhookPayloadDigest(bytes: Uint8Array): PayloadDigest {
  return createHash('sha256').update(bytes).digest('hex') as PayloadDigest;
}

export const sealRawWebhookPayloadHandle = (input: {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly receivedAt: ISO8601;
  readonly correlationId: CorrelationId;
}): RawWebhookPayloadHandle => {
  const canonical = Uint8Array.from(input.bytes);
  const digest = computeWebhookPayloadDigest(canonical);
  const sealed: RawWebhookPayloadHandle = {
    payloadDigest: digest,
    contentLength: canonical.byteLength,
    contentType: input.contentType,
    sourceId: input.sourceId,
    eventId: input.eventId,
    receivedAt: input.receivedAt,
    correlationId: input.correlationId,
    copyBytes: () => Uint8Array.from(canonical),
    [rawWebhookPayloadBrand]: true as const,
  };
  Object.freeze(sealed);
  return sealed;
};

/** Recompute digest from a handle's canonical copy for mutation integrity checks. */
export const digestFromHandle = (handle: RawWebhookPayloadHandle): PayloadDigest =>
  computeWebhookPayloadDigest(handle.copyBytes());

export const sealAuthenticatedWebhookSource = (input: {
  readonly sourceId: string;
  readonly authenticatedAt: ISO8601;
}): AuthenticatedWebhookSourceEvidence => {
  const sealed = { ...input, [authenticatedWebhookSourceBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const sealPayloadBoundSignature = (input: {
  readonly sourceId: string;
  readonly payloadDigest: PayloadDigest;
  readonly algorithm: string;
  readonly keyReference: string;
  readonly verifiedAt: ISO8601;
}): PayloadBoundSignatureEvidence => {
  const sealed = { ...input, [payloadBoundSignatureBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const sealWebhookTimestampEvidence = (input: {
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly trustedNow: ISO8601;
}): WebhookTimestampEvidence => {
  const sealed = { ...input, [webhookTimestampEvidenceBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const sealWebhookReplayEvidence = (input: {
  readonly eventId: string;
  readonly idempotencyKey: IdempotencyKey;
}): WebhookReplayEvidence => {
  const sealed = {
    ...input,
    status: 'accepted' as const,
    [webhookReplayEvidenceBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const sealWebhookRateLimitEvidence = (input: {
  readonly sourceId: string;
  readonly eventType: string;
}): WebhookRateLimitEvidence => {
  const sealed = {
    ...input,
    decision: 'allow' as const,
    [webhookRateLimitEvidenceBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const sealSanitizedWebhookPayload = (input: {
  readonly payloadDigest: PayloadDigest;
  readonly privacyClassification: PrivacyClassification;
  readonly redactedPreview: string;
}): SanitizedWebhookPayloadEvidence => {
  const sealed = { ...input, [sanitizedWebhookPayloadBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const sealAuthorizedWebhookIngress = (input: {
  readonly envelope: WebhookEnvelope;
  readonly source: AuthenticatedWebhookSourceEvidence;
  readonly signature: PayloadBoundSignatureEvidence;
  readonly timestamp: WebhookTimestampEvidence;
  readonly replay: WebhookReplayEvidence;
  readonly rateLimit: WebhookRateLimitEvidence;
  readonly sanitized: SanitizedWebhookPayloadEvidence;
  readonly authorizedAt: ISO8601;
}): AuthorizedWebhookIngressEvidence => {
  const sealed = { ...input, [authorizedWebhookIngressBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const isAuthorizedWebhookIngress = (
  value: unknown,
): value is AuthorizedWebhookIngressEvidence =>
  typeof value === 'object' && value !== null && authorizedWebhookIngressBrand in value;
