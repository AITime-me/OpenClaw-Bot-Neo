import {
  err,
  ok,
  validateOperationContext,
  type ISO8601,
  type OperationContext,
  type PayloadDigest,
  type Result,
  type SafeWebhookAuditEvent,
  type WebhookEnvelope,
  type WebhookFailureCode,
  type WebhookIngressCommand,
  type WebhookIngressLimits,
} from '../domain/index.js';
import {
  computeWebhookPayloadDigest,
  digestFromHandle,
  sealAuthenticatedWebhookSource,
  sealAuthorizedWebhookIngress,
  sealPayloadBoundSignature,
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
import { exactPlainObservation, filledString } from '../domain/observation-validation.js';

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
  readonly code:
    WebhookFailureCode | 'INVALID_OPERATION_CONTEXT' | 'AUDIT_FAILED' | 'DIGEST_MISMATCH';
  readonly reason: string;
};

export interface WebhookIngressOutcome {
  readonly evidence: AuthorizedWebhookIngressEvidence;
  readonly audit: SafeWebhookAuditEvent;
}

const VERIFIER_RESULT_FIELDS = Object.freeze([
  'verified',
  'sourceId',
  'payloadDigest',
  'algorithm',
  'keyReference',
  'verifiedAt',
]);

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

const assertCanonicalDigest = (
  handle: { readonly payloadDigest: string; copyBytes(): Uint8Array },
  expected: string,
): boolean => handle.payloadDigest === expected && digestFromHandle(handle as never) === expected;

/**
 * Single-read plain snapshot of an untrusted verifier result. Accessors, symbols, methods,
 * inherited fields and extra keys fail closed. Evidence is sealed only from the snapshot.
 */
const sealFromPrimitive = (
  result: unknown,
  envelope: WebhookEnvelope,
  canonicalDigest: string,
  trustedIso: ISO8601,
): Result<PayloadBoundSignatureEvidence, WebhookIngressFailure> => {
  const plain = exactPlainObservation(result, VERIFIER_RESULT_FIELDS);
  if (plain === null) return fail('VERIFIER_RESULT_INVALID', 'Verifier result is malformed.');
  const verified = plain.verified;
  const sourceId = plain.sourceId;
  const payloadDigest = plain.payloadDigest;
  const algorithm = plain.algorithm;
  const keyReference = plain.keyReference;
  const verifiedAt = plain.verifiedAt;
  if (typeof verified !== 'boolean')
    return fail('VERIFIER_RESULT_INVALID', 'Verifier result is malformed.');
  if (
    !filledString(sourceId) ||
    !filledString(payloadDigest) ||
    !filledString(algorithm) ||
    !filledString(keyReference) ||
    !filledString(verifiedAt)
  )
    return fail('VERIFIER_RESULT_INVALID', 'Verifier result is malformed.');
  if (!verified) return fail('SIGNATURE_INVALID', 'Webhook signature verification failed.');
  if (sourceId !== envelope.sourceId)
    return fail('SIGNATURE_INVALID', 'Signature sourceId does not match the envelope.');
  if (payloadDigest !== canonicalDigest)
    return fail('SIGNATURE_INVALID', 'Signature digest does not match canonical payload.');
  if (algorithm !== envelope.signature.algorithm)
    return fail('SIGNATURE_INVALID', 'Signature algorithm does not match the envelope.');
  if (keyReference !== envelope.signature.keyReference)
    return fail('SIGNATURE_INVALID', 'Signature key reference does not match the envelope.');
  return ok(
    sealPayloadBoundSignature({
      sourceId,
      payloadDigest: payloadDigest as PayloadDigest,
      algorithm,
      keyReference,
      verifiedAt: trustedIso,
    }),
  );
};

const mapReplayOutcome = (outcome: string): Result<true, WebhookIngressFailure> => {
  switch (outcome) {
    case 'accepted':
      return ok(true);
    case 'replay':
      return fail('REPLAY_DETECTED', 'Webhook replay was detected.');
    case 'duplicate-event':
      return fail('DUPLICATE_EVENT', 'Webhook event was already processed.');
    case 'duplicate-idempotency-key':
      return fail('DUPLICATE_IDEMPOTENCY_KEY', 'Webhook idempotency key was already used.');
    case 'stale-timestamp':
      return fail('STALE_TIMESTAMP', 'Webhook timestamp is outside the accepted window.');
    case 'nonce-replay':
      return fail('NONCE_REPLAY', 'Webhook nonce was already used.');
    default:
      return fail('VERIFIER_RESULT_INVALID', 'Replay protection returned an unknown outcome.');
  }
};

/**
 * Provider-independent webhook orchestration. Canonical payload bytes belong to core.
 * Adapters receive disposable copies and return untrusted primitive results.
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
  const canonicalDigest = payload.payloadDigest;
  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed.');

  const envelope: WebhookEnvelope = {
    sourceId: command.sourceId,
    eventId: command.eventId,
    eventType: command.eventType,
    occurredAt: command.occurredAt,
    receivedAt: trustedIso,
    payloadDigest: canonicalDigest,
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

  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed before verify.');

  const disposable = payload.copyBytes();
  const signatureResult = await deps.signatures.verify(
    envelope,
    disposable,
    canonicalDigest,
    context,
  );
  if (!signatureResult.ok)
    return fail('VERIFIER_UNAVAILABLE', 'Signature verifier is unavailable.');
  if (signatureResult.value === null)
    return fail('SIGNATURE_INVALID', 'Webhook signature verification failed.');

  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed after verify.');
  if (computeWebhookPayloadDigest(disposable) !== canonicalDigest) {
    // Adapter may mutate its disposable copy; that must not affect canonical authorization.
  }

  const sealedSignature = sealFromPrimitive(
    signatureResult.value,
    envelope,
    canonicalDigest,
    trustedIso,
  );
  if (!sealedSignature.ok) return sealedSignature;
  const signatureEvidence: PayloadBoundSignatureEvidence = sealedSignature.value;

  const timestampEvidence = sealWebhookTimestampEvidence({
    occurredAt: envelope.occurredAt,
    receivedAt: envelope.receivedAt,
    trustedNow: trustedIso,
  });

  const replay = await deps.replay.checkAndRecord(envelope, context);
  if (!replay.ok) return fail('VERIFIER_UNAVAILABLE', 'Replay protection is unavailable.');
  const replayMapped = mapReplayOutcome(replay.value);
  if (!replayMapped.ok) return replayMapped;
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

  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed before scan.');
  const scan = await deps.scanner.scanText(textFromBytes(payload.copyBytes()), context);
  if (!scan.ok) return fail('SCANNER_UNAVAILABLE', 'Sensitive-data scanner is unavailable.');
  if (scan.value.decision === 'deny')
    return fail('SCANNER_DENIED', 'Webhook payload failed sensitive-data scan.');
  const sanitized = sealSanitizedWebhookPayload({
    payloadDigest: canonicalDigest,
    privacyClassification: envelope.privacyClassification,
    redactedPreview: scan.value.redacted.slice(0, 64),
  });

  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed before authorize.');

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
  if (evidence === null)
    return fail('DIGEST_MISMATCH', 'Authorized webhook evidence could not be sealed.');

  const auditEvent: SafeWebhookAuditEvent = {
    sourceId: envelope.sourceId,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    digestPrefix: digestPrefix(canonicalDigest),
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
