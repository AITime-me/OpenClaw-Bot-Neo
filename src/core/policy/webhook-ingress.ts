import type {
  WebhookEnvelope,
  WebhookFailureCode,
  WebhookIngressDecision,
  WebhookIngressLimits,
} from '../domain/index.js';
import { parseISO8601, WEBHOOK_ENVELOPE_VERSION } from '../domain/index.js';
import { isAuthorizedWebhookIngress } from '../domain/webhook.internal.js';

const deny = (code: WebhookFailureCode, reason: string): WebhookIngressDecision => ({
  allowed: false,
  code,
  reason,
});

const PRIVACY = Object.freeze([
  'public',
  'internal',
  'confidential',
  'commercial-secret',
  'security-restricted',
] as const);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Validate ingress limits before any authorization decision. */
export function validateWebhookIngressLimits(limits: WebhookIngressLimits): WebhookIngressDecision {
  if (
    !isFinitePositive(limits.maxContentLength) ||
    !isFinitePositive(limits.maxClockSkewMs) ||
    !isFinitePositive(limits.maxIdLength) ||
    !isFinitePositive(limits.maxEventTypeLength) ||
    !Number.isSafeInteger(limits.maxContentLength) ||
    !Number.isSafeInteger(limits.maxClockSkewMs) ||
    !Number.isSafeInteger(limits.maxIdLength) ||
    !Number.isSafeInteger(limits.maxEventTypeLength)
  )
    return deny('INVALID_LIMITS', 'Webhook limits must be finite positive integers.');
  return { allowed: true };
}

/** Strict runtime envelope validation used by the orchestration service. */
export function validateWebhookEnvelope(
  envelope: WebhookEnvelope,
  limits: WebhookIngressLimits,
  now: Date,
): WebhookIngressDecision {
  const limitsCheck = validateWebhookIngressLimits(limits);
  if (!limitsCheck.allowed) return limitsCheck;
  const envelopeVersion: unknown = envelope.envelopeVersion;
  if (envelopeVersion !== WEBHOOK_ENVELOPE_VERSION)
    return deny('INVALID_ENVELOPE', 'Webhook envelope version is unsupported.');
  if (
    typeof envelope.sourceId !== 'string' ||
    envelope.sourceId.length === 0 ||
    envelope.sourceId.length > limits.maxIdLength ||
    !ID_PATTERN.test(envelope.sourceId)
  )
    return deny('INVALID_ENVELOPE', 'Webhook sourceId is invalid.');
  if (
    typeof envelope.eventId !== 'string' ||
    envelope.eventId.length === 0 ||
    envelope.eventId.length > limits.maxIdLength ||
    !ID_PATTERN.test(envelope.eventId)
  )
    return deny('INVALID_ENVELOPE', 'Webhook eventId is invalid.');
  if (
    typeof envelope.eventType !== 'string' ||
    envelope.eventType.length === 0 ||
    envelope.eventType.length > limits.maxEventTypeLength
  )
    return deny('INVALID_ENVELOPE', 'Webhook eventType is invalid.');
  if (
    typeof envelope.idempotencyKey !== 'string' ||
    envelope.idempotencyKey.length === 0 ||
    envelope.idempotencyKey.length > limits.maxIdLength
  )
    return deny('INVALID_ENVELOPE', 'Webhook idempotencyKey is invalid.');
  if (
    typeof envelope.nonce !== 'string' ||
    envelope.nonce.length === 0 ||
    envelope.nonce.length > 256 ||
    !ID_PATTERN.test(envelope.nonce)
  )
    return deny('INVALID_ENVELOPE', 'Webhook nonce is invalid.');
  if (typeof envelope.correlationId !== 'string' || envelope.correlationId.length === 0)
    return deny('INVALID_ENVELOPE', 'Webhook correlationId is invalid.');
  if (typeof envelope.payloadDigest !== 'string' || envelope.payloadDigest.length === 0)
    return deny('EMPTY_DIGEST', 'Webhook payload digest is empty.');
  if (!DIGEST_PATTERN.test(envelope.payloadDigest))
    return deny('MALFORMED_DIGEST', 'Webhook payload digest is malformed.');
  if (
    !DIGEST_PATTERN.test(envelope.signedEnvelopeDigest) ||
    !DIGEST_PATTERN.test(envelope.signatureDigest)
  )
    return deny('MALFORMED_DIGEST', 'Webhook signed material digest is malformed.');
  if (typeof envelope.contentType !== 'string' || envelope.contentType.length === 0)
    return deny('INVALID_ENVELOPE', 'Webhook contentType is invalid.');
  if (!PRIVACY.some((value) => value === envelope.privacyClassification))
    return deny('INVALID_ENVELOPE', 'Webhook privacy classification is unknown.');
  if (
    !Number.isSafeInteger(envelope.contentLength) ||
    envelope.contentLength < 0 ||
    envelope.contentLength > limits.maxContentLength
  )
    return deny(
      envelope.contentLength > limits.maxContentLength ? 'OVERSIZED_PAYLOAD' : 'INVALID_ENVELOPE',
      'Webhook contentLength is invalid.',
    );
  if (
    typeof envelope.signature.algorithm !== 'string' ||
    envelope.signature.algorithm.length === 0 ||
    typeof envelope.signature.keyReference !== 'string' ||
    envelope.signature.keyReference.length === 0 ||
    typeof envelope.signature.value !== 'string' ||
    envelope.signature.value.length === 0 ||
    envelope.signature.value.length > 4_096
  )
    return deny('SIGNATURE_REQUIRED', 'Webhook signature material is invalid.');

  const occurredIdentity = parseISO8601(envelope.occurredAt);
  const receivedIdentity = parseISO8601(envelope.receivedAt);
  if (!occurredIdentity.ok || !receivedIdentity.ok)
    return deny('INVALID_TIMESTAMP', 'Webhook timestamps are not canonical.');
  const occurredAt = new Date(occurredIdentity.value).getTime();
  const receivedAt = new Date(receivedIdentity.value).getTime();
  const trustedNow = now instanceof Date ? now.getTime() : Number.NaN;
  if (
    !Number.isFinite(occurredAt) ||
    !Number.isFinite(receivedAt) ||
    !Number.isFinite(trustedNow) ||
    Number.isNaN(occurredAt) ||
    Number.isNaN(receivedAt)
  )
    return deny('INVALID_TIMESTAMP', 'Webhook timestamps are invalid.');
  if (occurredAt - trustedNow > limits.maxClockSkewMs)
    return deny('INVALID_TIMESTAMP', 'Webhook occurredAt is too far in the future.');
  if (Math.abs(trustedNow - receivedAt) > limits.maxClockSkewMs)
    return deny('INVALID_TIMESTAMP', 'Webhook receivedAt is outside allowed skew.');
  if (Math.abs(receivedAt - occurredAt) > limits.maxClockSkewMs)
    return deny('INVALID_TIMESTAMP', 'Webhook timestamps are stale or skewed.');
  return { allowed: true };
}

/**
 * Authorization accepts only sealed orchestration evidence. Ordinary boolean verification state
 * is explicitly rejected so callers cannot self-assert authenticity.
 */
export function authorizeWebhookIngress(evidence: unknown): WebhookIngressDecision {
  if (isAuthorizedWebhookIngress(evidence)) return { allowed: true };
  return deny(
    'UNAUTHORIZED_BOOLEAN_STATE',
    'Caller-supplied boolean verification is not authorization proof.',
  );
}

export type { WebhookIngressLimits };
