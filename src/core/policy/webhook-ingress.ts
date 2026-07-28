import type {
  WebhookEnvelope,
  WebhookFailureCode,
  WebhookIngressDecision,
  WebhookVerificationState,
} from '../domain/index.js';

const deny = (code: WebhookFailureCode, reason: string): WebhookIngressDecision => ({
  allowed: false,
  code,
  reason,
});

export interface WebhookIngressLimits {
  readonly maxContentLength: number;
  readonly maxClockSkewMs: number;
}

/** Deterministic composition of future verifier results. Every missing/unavailable check denies. */
export function authorizeWebhookIngress(
  envelope: WebhookEnvelope,
  verification: WebhookVerificationState,
  limits: WebhookIngressLimits,
  now: Date,
): WebhookIngressDecision {
  if (
    typeof envelope.sourceId !== 'string' ||
    envelope.sourceId.length === 0 ||
    typeof envelope.eventId !== 'string' ||
    envelope.eventId.length === 0 ||
    !Number.isSafeInteger(envelope.contentLength) ||
    envelope.contentLength < 0
  )
    return deny('INVALID_ENVELOPE', 'Webhook envelope is incomplete.');
  if (!verification.verifierAvailable)
    return deny('VERIFIER_UNAVAILABLE', 'Webhook verifier is unavailable.');
  if (!verification.sourceAuthenticated)
    return deny('UNKNOWN_SOURCE', 'Webhook source is not authenticated.');
  const occurredAt = Date.parse(envelope.occurredAt);
  const receivedAt = Date.parse(envelope.receivedAt);
  if (
    !Number.isFinite(occurredAt) ||
    !Number.isFinite(receivedAt) ||
    Math.abs(now.getTime() - receivedAt) > limits.maxClockSkewMs ||
    Math.abs(receivedAt - occurredAt) > limits.maxClockSkewMs
  )
    return deny('INVALID_TIMESTAMP', 'Webhook timestamps are invalid or stale.');
  if (envelope.contentLength > limits.maxContentLength)
    return deny('OVERSIZED_PAYLOAD', 'Webhook payload exceeds the configured limit.');
  if (!verification.signatureVerified)
    return deny('SIGNATURE_INVALID', 'Webhook signature verification failed.');
  if (verification.replayDetected) return deny('REPLAY', 'Webhook replay was detected.');
  if (verification.duplicateEvent)
    return deny('DUPLICATE_EVENT', 'Webhook event was already processed.');
  if (!verification.rateLimitAllowed) return deny('RATE_LIMITED', 'Webhook rate limit denied.');
  return { allowed: true };
}
