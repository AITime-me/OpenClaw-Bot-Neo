import { createHash } from 'node:crypto';
import type { CorrelationId, IdempotencyKey, ISO8601, Nonce, PayloadDigest } from './identity.js';
import type { PrivacyClassification } from './privacy.js';
import type { WebhookEnvelope } from './webhook.js';
import { deepFreeze } from './immutable.js';

/**
 * Opaque payload handle. Canonical bytes are not exposed as a shared writable reference.
 * Trust is WeakMap membership; Symbol properties are not proof.
 */
export interface RawWebhookPayloadHandle {
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
  readonly sourceId: string;
  readonly authenticatedAt: ISO8601;
}

export interface PayloadBoundSignatureEvidence {
  readonly envelopeVersion: WebhookEnvelope['envelopeVersion'];
  readonly sourceId: string;
  readonly eventId: string;
  readonly occurredAt: ISO8601;
  readonly idempotencyKey: IdempotencyKey;
  readonly nonce: Nonce;
  readonly payloadDigest: PayloadDigest;
  readonly signedEnvelopeDigest: PayloadDigest;
  readonly signatureDigest: PayloadDigest;
  readonly algorithm: string;
  readonly keyReference: string;
  readonly verifiedAt: ISO8601;
}

export interface WebhookTimestampEvidence {
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly trustedNow: ISO8601;
}

export interface WebhookReplayEvidence {
  readonly eventId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly status: 'accepted';
}

export interface WebhookRateLimitEvidence {
  readonly sourceId: string;
  readonly eventType: string;
  readonly decision: 'allow';
}

export interface SanitizedWebhookPayloadEvidence {
  readonly payloadDigest: PayloadDigest;
  readonly privacyClassification: PrivacyClassification;
  readonly redactedPreview: string;
}

export interface AuthorizedWebhookIngressEvidence {
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

const rawPayloadRegistry = new WeakMap<object, PayloadDigest>();
const authenticatedSourceRegistry = new WeakMap<object, AuthenticatedWebhookSourceEvidence>();
const signatureRegistry = new WeakMap<object, PayloadBoundSignatureEvidence>();
const timestampRegistry = new WeakMap<object, WebhookTimestampEvidence>();
const replayRegistry = new WeakMap<object, WebhookReplayEvidence>();
const rateLimitRegistry = new WeakMap<object, WebhookRateLimitEvidence>();
const sanitizedPayloadRegistry = new WeakMap<object, SanitizedWebhookPayloadEvidence>();
const authorizedIngressRegistry = new WeakMap<object, AuthorizedWebhookIngressEvidence>();

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
  };
  Object.freeze(sealed);
  rawPayloadRegistry.set(sealed, digest);
  return sealed;
};

/** Recompute digest from a handle's canonical copy for mutation integrity checks. */
export const digestFromHandle = (handle: RawWebhookPayloadHandle): PayloadDigest =>
  computeWebhookPayloadDigest(handle.copyBytes());

export const isRawWebhookPayloadHandle = (value: unknown): value is RawWebhookPayloadHandle =>
  typeof value === 'object' && value !== null && rawPayloadRegistry.has(value);

export const sealAuthenticatedWebhookSource = (input: {
  readonly sourceId: string;
  readonly authenticatedAt: ISO8601;
}): AuthenticatedWebhookSourceEvidence => {
  const sealed = deepFreeze({ ...input });
  authenticatedSourceRegistry.set(sealed, sealed);
  return sealed;
};

export const sealPayloadBoundSignature = (input: {
  readonly envelopeVersion: WebhookEnvelope['envelopeVersion'];
  readonly sourceId: string;
  readonly eventId: string;
  readonly occurredAt: ISO8601;
  readonly idempotencyKey: IdempotencyKey;
  readonly nonce: Nonce;
  readonly payloadDigest: PayloadDigest;
  readonly signedEnvelopeDigest: PayloadDigest;
  readonly signatureDigest: PayloadDigest;
  readonly algorithm: string;
  readonly keyReference: string;
  readonly verifiedAt: ISO8601;
}): PayloadBoundSignatureEvidence => {
  const sealed = deepFreeze({ ...input });
  signatureRegistry.set(sealed, sealed);
  return sealed;
};

export const sealWebhookTimestampEvidence = (input: {
  readonly occurredAt: ISO8601;
  readonly receivedAt: ISO8601;
  readonly trustedNow: ISO8601;
}): WebhookTimestampEvidence => {
  const sealed = deepFreeze({ ...input });
  timestampRegistry.set(sealed, sealed);
  return sealed;
};

export const sealWebhookReplayEvidence = (input: {
  readonly eventId: string;
  readonly idempotencyKey: IdempotencyKey;
}): WebhookReplayEvidence => {
  const sealed = deepFreeze({
    ...input,
    status: 'accepted' as const,
  });
  replayRegistry.set(sealed, sealed);
  return sealed;
};

export const sealWebhookRateLimitEvidence = (input: {
  readonly sourceId: string;
  readonly eventType: string;
}): WebhookRateLimitEvidence => {
  const sealed = deepFreeze({
    ...input,
    decision: 'allow' as const,
  });
  rateLimitRegistry.set(sealed, sealed);
  return sealed;
};

export const sealSanitizedWebhookPayload = (input: {
  readonly payloadDigest: PayloadDigest;
  readonly privacyClassification: PrivacyClassification;
  readonly redactedPreview: string;
}): SanitizedWebhookPayloadEvidence => {
  const sealed = deepFreeze({ ...input });
  sanitizedPayloadRegistry.set(sealed, sealed);
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
}): AuthorizedWebhookIngressEvidence | null => {
  if (
    !authenticatedSourceRegistry.has(input.source) ||
    !signatureRegistry.has(input.signature) ||
    !timestampRegistry.has(input.timestamp) ||
    !replayRegistry.has(input.replay) ||
    !rateLimitRegistry.has(input.rateLimit) ||
    !sanitizedPayloadRegistry.has(input.sanitized)
  )
    return null;
  if (
    input.signature.sourceId !== input.envelope.sourceId ||
    input.signature.eventId !== input.envelope.eventId ||
    input.signature.occurredAt !== input.envelope.occurredAt ||
    input.signature.idempotencyKey !== input.envelope.idempotencyKey ||
    input.signature.nonce !== input.envelope.nonce ||
    input.signature.payloadDigest !== input.envelope.payloadDigest ||
    input.signature.signedEnvelopeDigest !== input.envelope.signedEnvelopeDigest ||
    input.signature.signatureDigest !== input.envelope.signatureDigest ||
    input.signature.algorithm !== input.envelope.signature.algorithm ||
    input.signature.keyReference !== input.envelope.signature.keyReference
  )
    return null;
  const sealed = deepFreeze({ ...input });
  authorizedIngressRegistry.set(sealed, sealed);
  return sealed;
};

export const isAuthorizedWebhookIngress = (
  value: unknown,
): value is AuthorizedWebhookIngressEvidence =>
  typeof value === 'object' && value !== null && authorizedIngressRegistry.has(value);
