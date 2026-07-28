import {
  err,
  ok,
  validateOperationContext,
  type ISO8601,
  type OperationContext,
  type Result,
  type SafeWebhookAuditEvent,
  type WebhookEnvelope,
  type WebhookFailureCode,
  type WebhookIngressCommand,
  type WebhookIngressLimits,
} from '../domain/index.js';
import {
  sealAuthenticatedWebhookSource,
  sealAuthorizedWebhookIngress,
  sealRawWebhookPayloadHandle,
  sealSanitizedWebhookPayload,
  sealWebhookRateLimitEvidence,
  sealWebhookReplayEvidence,
  sealWebhookTimestampEvidence,
  type AuthorizedWebhookIngressEvidence,
  type PayloadBoundSignatureEvidence,
} from '../domain/webhook.internal.js';
import type {
  ClockPort,
  SensitiveDataScannerPort,
  WebhookAuditPort,
  WebhookRateLimitPort,
  WebhookReplayProtectionPort,
  WebhookSignatureVerificationPort,
  WebhookSourceAuthenticationPort,
} from '../ports/index.js';
import {
  validateWebhookEnvelope,
  validateWebhookIngressLimits,
} from '../policy/webhook-ingress.js';

export interface WebhookIngressDeps {
  readonly clock: ClockPort;
  readonly sourceAuth: WebhookSourceAuthenticationPort;
  readonly signatures: WebhookSignatureVerificationPort;
  readonly replay: WebhookReplayProtectionPort;
  readonly rateLimit: WebhookRateLimitPort;
  readonly scanner: SensitiveDataScannerPort;
  readonly audit: WebhookAuditPort;
}

export type WebhookIngressFailure = {
  readonly code: WebhookFailureCode | 'INVALID_OPERATION_CONTEXT' | 'AUDIT_FAILED';
  readonly reason: string;
};

export interface WebhookIngressOutcome {
  readonly evidence: AuthorizedWebhookIngressEvidence;
  readonly audit: SafeWebhookAuditEvent;
}

const fail = (
  code: WebhookIngressFailure['code'],
  reason: string,
): Result<never, WebhookIngressFailure> => err({ code, reason });

const digestPrefix = (digest: string): string => digest.slice(0, 12);

const textFromBytes = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
};

/**
 * Provider-independent webhook orchestration. Order is the security contract:
 * trusted clock → limits → raw payload/digest → envelope → authenticate → signature →
 * timestamp → replay → rate limit → scanner → authorized evidence → safe audit.
 * Never activates extensions or writes memory.
 */
export async function executeWebhookIngress(
  deps: WebhookIngressDeps,
  command: WebhookIngressCommand,
  limits: WebhookIngressLimits,
  context: OperationContext,
): Promise<Result<WebhookIngressOutcome, WebhookIngressFailure>> {
  if (validateOperationContext(context) !== null)
    return fail('INVALID_OPERATION_CONTEXT', 'Valid operation context is required.');

  const trustedNow = deps.clock.now();
  const trustedIso = trustedNow.toISOString() as ISO8601;
  const limitsCheck = validateWebhookIngressLimits(limits);
  if (!limitsCheck.allowed) return fail(limitsCheck.code, limitsCheck.reason);

  if (!(command.rawPayload instanceof Uint8Array))
    return fail('INVALID_ENVELOPE', 'Raw webhook payload is required.');
  if (command.rawPayload.byteLength !== command.declaredContentLength)
    return fail('CONTENT_LENGTH_MISMATCH', 'Declared content length does not match raw bytes.');
  if (command.rawPayload.byteLength > limits.maxContentLength)
    return fail('OVERSIZED_PAYLOAD', 'Webhook payload exceeds the configured limit.');

  const payload = sealRawWebhookPayloadHandle({
    bytes: command.rawPayload,
    contentType: command.contentType,
    sourceId: command.sourceId,
    eventId: command.eventId,
    receivedAt: trustedIso,
    correlationId: command.correlationId,
  });

  const envelope: WebhookEnvelope = {
    sourceId: command.sourceId,
    eventId: command.eventId,
    eventType: command.eventType,
    occurredAt: command.occurredAt,
    receivedAt: trustedIso,
    payloadDigest: payload.payloadDigest,
    signature: command.signature,
    idempotencyKey: command.idempotencyKey,
    contentType: command.contentType,
    contentLength: payload.contentLength,
    correlationId: command.correlationId,
    privacyClassification: command.privacyClassification,
  };

  const envelopeCheck = validateWebhookEnvelope(envelope, limits, trustedNow);
  if (!envelopeCheck.allowed) return fail(envelopeCheck.code, envelopeCheck.reason);

  const authenticated = await deps.sourceAuth.authenticate(envelope, context);
  if (!authenticated.ok)
    return fail('VERIFIER_UNAVAILABLE', 'Source authentication is unavailable.');
  if (!authenticated.value) return fail('UNKNOWN_SOURCE', 'Webhook source is not authenticated.');
  const sourceEvidence = sealAuthenticatedWebhookSource({
    sourceId: envelope.sourceId,
    authenticatedAt: trustedIso,
  });

  const signatureResult = await deps.signatures.verify(envelope, payload, context);
  if (!signatureResult.ok)
    return fail('VERIFIER_UNAVAILABLE', 'Signature verifier is unavailable.');
  if (signatureResult.value === null)
    return fail('SIGNATURE_INVALID', 'Webhook signature verification failed.');
  const signatureEvidence: PayloadBoundSignatureEvidence = signatureResult.value;
  if (signatureEvidence.payloadDigest !== payload.payloadDigest)
    return fail('SIGNATURE_INVALID', 'Signature evidence is not bound to this payload digest.');

  const timestampEvidence = sealWebhookTimestampEvidence({
    occurredAt: envelope.occurredAt,
    receivedAt: envelope.receivedAt,
    trustedNow: trustedIso,
  });

  const replay = await deps.replay.checkAndRecord(envelope, context);
  if (!replay.ok) return fail('VERIFIER_UNAVAILABLE', 'Replay protection is unavailable.');
  if (replay.value === 'replay') return fail('REPLAY', 'Webhook replay was detected.');
  if (replay.value === 'duplicate-event')
    return fail('DUPLICATE_EVENT', 'Webhook event was already processed.');
  const replayEvidence = sealWebhookReplayEvidence({
    eventId: envelope.eventId,
    idempotencyKey: envelope.idempotencyKey,
  });

  const rate = await deps.rateLimit.decide(envelope.sourceId, envelope.eventType, context);
  if (!rate.ok) return fail('VERIFIER_UNAVAILABLE', 'Rate limiter is unavailable.');
  if (rate.value === 'deny') return fail('RATE_LIMITED', 'Webhook rate limit denied.');
  const rateEvidence = sealWebhookRateLimitEvidence({
    sourceId: envelope.sourceId,
    eventType: envelope.eventType,
  });

  const scan = await deps.scanner.scanText(textFromBytes(payload.bytes), context);
  if (!scan.ok) return fail('SCANNER_UNAVAILABLE', 'Sensitive-data scanner is unavailable.');
  if (scan.value.decision === 'deny')
    return fail('SCANNER_DENIED', 'Webhook payload failed sensitive-data scan.');
  const sanitized = sealSanitizedWebhookPayload({
    payloadDigest: payload.payloadDigest,
    privacyClassification: envelope.privacyClassification,
    redactedPreview: scan.value.redacted.slice(0, 64),
  });

  const evidence = sealAuthorizedWebhookIngress({
    envelope,
    source: sourceEvidence,
    signature: signatureEvidence,
    timestamp: timestampEvidence,
    replay: replayEvidence,
    rateLimit: rateEvidence,
    sanitized,
    authorizedAt: trustedIso,
  });

  const auditEvent: SafeWebhookAuditEvent = {
    sourceId: envelope.sourceId,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    digestPrefix: digestPrefix(envelope.payloadDigest),
    contentLength: envelope.contentLength,
    correlationId: envelope.correlationId,
    privacyClassification: envelope.privacyClassification,
    outcome: 'allowed',
    occurredAt: trustedIso,
  };
  const audited = await deps.audit.record(auditEvent, context);
  if (!audited.ok) return fail('AUDIT_FAILED', 'Webhook audit failed.');

  return ok({ evidence, audit: auditEvent });
}
