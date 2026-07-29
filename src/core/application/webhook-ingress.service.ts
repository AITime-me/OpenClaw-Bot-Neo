import { isProxy } from 'node:util/types';
import {
  err,
  ok,
  parseCorrelationId,
  parseEventId,
  parseISO8601,
  parseIdempotencyKey,
  parseNonce,
  parseProviderReference,
  parseSourceId,
  validateOperationContext,
  WEBHOOK_ENVELOPE_VERSION,
  type CorrelationId,
  type IdempotencyKey,
  type ISO8601,
  type Nonce,
  type OperationContext,
  type PrivacyClassification,
  type Result,
  type SafeWebhookAuditEvent,
  type WebhookCanonicalVerificationRequest,
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
  WebhookIngressAuthorizationPort,
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
  readonly policy: WebhookIngressAuthorizationPort;
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
  'envelopeVersion',
  'sourceId',
  'eventId',
  'occurredAt',
  'idempotencyKey',
  'nonce',
  'payloadDigest',
  'signedEnvelopeDigest',
  'signatureDigest',
  'algorithm',
  'keyReference',
  'verifiedAt',
]);

const COMMAND_FIELDS = Object.freeze([
  'envelopeVersion',
  'sourceId',
  'eventId',
  'eventType',
  'occurredAt',
  'contentType',
  'declaredContentLength',
  'correlationId',
  'privacyClassification',
  'signature',
  'idempotencyKey',
  'nonce',
  'rawPayload',
] as const);

const SIGNATURE_FIELDS = Object.freeze(['algorithm', 'keyReference', 'value'] as const);
const PRIVACY = new Set<PrivacyClassification>([
  'public',
  'internal',
  'confidential',
  'commercial-secret',
  'security-restricted',
]);

interface WebhookCommandSnapshot {
  readonly envelopeVersion: typeof WEBHOOK_ENVELOPE_VERSION;
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: ISO8601;
  readonly contentType: string;
  readonly declaredContentLength: number;
  readonly correlationId: CorrelationId;
  readonly privacyClassification: PrivacyClassification;
  readonly signature: {
    readonly algorithm: string;
    readonly keyReference: string;
    readonly value: string;
  };
  readonly idempotencyKey: IdempotencyKey;
  readonly nonce: Nonce;
  readonly rawPayload: readonly number[];
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

const exactCommandDescriptors = (
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, PropertyDescriptor>> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== fields.length) return null;
  const allowed = new Set(fields);
  const descriptors: Record<string, PropertyDescriptor> = Object.create(null) as Record<
    string,
    PropertyDescriptor
  >;
  for (const name of names) {
    if (!allowed.has(name)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !descriptor.enumerable ||
      typeof descriptor.value === 'function'
    )
      return null;
    descriptors[name] = descriptor;
  }
  for (const field of fields)
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) return null;
  return Object.freeze(descriptors);
};

const copyExactBytes = (value: unknown, maxLength: number): readonly number[] | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    return null;
  const byteView = value as Uint8Array;
  let byteLength: number;
  try {
    const buffer = byteView.buffer;
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) return null;
    const detached = (buffer as ArrayBuffer & { readonly detached?: unknown }).detached;
    if (detached === true) return null;
    byteLength = byteView.byteLength;
    if (buffer.byteLength < byteView.byteOffset + byteLength) return null;
  } catch {
    return null;
  }
  if (byteLength > maxLength) return null;
  const names = Object.getOwnPropertyNames(byteView);
  if (names.length !== byteLength) return null;
  const bytes: number[] = [];
  for (let index = 0; index < byteLength; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(byteView, String(index));
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      typeof descriptor.value !== 'number' ||
      !Number.isInteger(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > 255
    )
      return null;
    bytes.push(descriptor.value);
  }
  return Object.freeze(bytes);
};

const visibleToken = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  /^[\x21-\x7e]+$/.test(value);

const snapshotWebhookCommand = (
  command: unknown,
  limits: WebhookIngressLimits,
): Result<WebhookCommandSnapshot, WebhookIngressFailure> => {
  const descriptors = exactCommandDescriptors(command, COMMAND_FIELDS);
  if (descriptors === null)
    return fail('INVALID_ENVELOPE', 'Webhook command must be exact plain data.');
  const field = (name: (typeof COMMAND_FIELDS)[number]): unknown => descriptors[name]?.value;
  const signature = exactPlainObservation(field('signature'), SIGNATURE_FIELDS);
  if (signature === null)
    return fail('INVALID_ENVELOPE', 'Webhook signature material must be exact plain data.');
  const sourceId = parseSourceId(field('sourceId'));
  const eventId = parseEventId(field('eventId'));
  const occurredAt = parseISO8601(field('occurredAt'));
  const correlationId = parseCorrelationId(field('correlationId'));
  const idempotencyKey = parseIdempotencyKey(field('idempotencyKey'));
  const nonce = parseNonce(field('nonce'));
  const keyReference = parseProviderReference(signature.keyReference);
  const rawPayload = copyExactBytes(field('rawPayload'), limits.maxContentLength);
  const envelopeVersion = field('envelopeVersion');
  const eventType = field('eventType');
  const contentType = field('contentType');
  const declaredContentLength = field('declaredContentLength');
  const privacyClassification = field('privacyClassification');
  if (
    envelopeVersion !== WEBHOOK_ENVELOPE_VERSION ||
    !sourceId.ok ||
    !eventId.ok ||
    !occurredAt.ok ||
    !correlationId.ok ||
    !idempotencyKey.ok ||
    !nonce.ok ||
    !keyReference.ok ||
    !filledString(eventType, limits.maxEventTypeLength) ||
    !filledString(contentType, 256) ||
    !visibleToken(signature.algorithm, 128) ||
    !visibleToken(signature.value, 4_096) ||
    !Number.isSafeInteger(declaredContentLength) ||
    (declaredContentLength as number) < 0 ||
    rawPayload === null ||
    rawPayload.length !== declaredContentLength ||
    typeof privacyClassification !== 'string' ||
    !PRIVACY.has(privacyClassification as PrivacyClassification)
  )
    return fail('INVALID_ENVELOPE', 'Webhook command contains invalid fields.');

  return ok(
    Object.freeze({
      envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
      sourceId: sourceId.value,
      eventId: eventId.value,
      eventType,
      occurredAt: occurredAt.value,
      contentType,
      declaredContentLength,
      correlationId: correlationId.value,
      privacyClassification: privacyClassification as PrivacyClassification,
      signature: Object.freeze({
        algorithm: signature.algorithm,
        keyReference: keyReference.value,
        value: signature.value,
      }),
      idempotencyKey: idempotencyKey.value,
      nonce: nonce.value,
      rawPayload,
    }),
  );
};

/** Internal canonical framing utility. Package root does not export this trust-boundary helper. */
export const canonicalWebhookSignedBytes = (input: {
  readonly envelopeVersion: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly nonce: string;
  readonly payloadDigest: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly correlationId: string;
  readonly privacyClassification: string;
  readonly algorithm: string;
  readonly keyReference: string;
}): Uint8Array => {
  const encoder = new TextEncoder();
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0)
    throw new TypeError('Canonical webhook fields must be present primitive values.');
  const fields = [
    ['envelopeVersion', input.envelopeVersion],
    ['sourceId', input.sourceId],
    ['eventId', input.eventId],
    ['eventType', input.eventType],
    ['occurredAt', input.occurredAt],
    ['idempotencyKey', input.idempotencyKey],
    ['nonce', input.nonce],
    ['payloadDigest', input.payloadDigest],
    ['contentType', input.contentType],
    ['contentLength', String(input.contentLength)],
    ['correlationId', input.correlationId],
    ['privacyClassification', input.privacyClassification],
    ['signatureAlgorithm', input.algorithm],
    ['keyReference', input.keyReference],
  ] as const;
  if (fields.some(([, value]) => typeof value !== 'string'))
    throw new TypeError('Canonical webhook fields must be present primitive values.');
  const lengthPrefix = (value: string): string =>
    `${encoder.encode(value).byteLength.toString(10)}:${value}`;
  return encoder.encode(
    fields.map(([key, value]) => `${lengthPrefix(key)}=${lengthPrefix(value)}`).join('\n'),
  );
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
  const envelopeVersion = plain.envelopeVersion;
  const sourceId = plain.sourceId;
  const eventId = plain.eventId;
  const occurredAt = plain.occurredAt;
  const idempotencyKey = plain.idempotencyKey;
  const nonce = plain.nonce;
  const payloadDigest = plain.payloadDigest;
  const signedEnvelopeDigest = plain.signedEnvelopeDigest;
  const signatureDigest = plain.signatureDigest;
  const algorithm = plain.algorithm;
  const keyReference = plain.keyReference;
  const verifiedAt = plain.verifiedAt;
  if (typeof verified !== 'boolean')
    return fail('VERIFIER_RESULT_INVALID', 'Verifier result is malformed.');
  if (
    !filledString(sourceId) ||
    !filledString(envelopeVersion) ||
    !filledString(eventId) ||
    !filledString(occurredAt) ||
    !filledString(idempotencyKey) ||
    !filledString(nonce) ||
    !filledString(payloadDigest) ||
    !filledString(signedEnvelopeDigest) ||
    !filledString(signatureDigest) ||
    !filledString(algorithm) ||
    !filledString(keyReference) ||
    !filledString(verifiedAt)
  )
    return fail('VERIFIER_RESULT_INVALID', 'Verifier result is malformed.');
  if (!verified) return fail('SIGNATURE_INVALID', 'Webhook signature verification failed.');
  const verifiedAtIdentity = parseISO8601(verifiedAt);
  if (!verifiedAtIdentity.ok || verifiedAtIdentity.value !== trustedIso)
    return fail('SIGNATURE_INVALID', 'Verifier timestamp does not match the trusted request.');
  if (envelopeVersion !== envelope.envelopeVersion)
    return fail('SIGNATURE_INVALID', 'Signature envelope version does not match.');
  if (sourceId !== envelope.sourceId)
    return fail('SIGNATURE_INVALID', 'Signature sourceId does not match the envelope.');
  if (eventId !== envelope.eventId)
    return fail('SIGNATURE_INVALID', 'Signature eventId does not match the envelope.');
  if (occurredAt !== envelope.occurredAt)
    return fail('SIGNATURE_INVALID', 'Signature occurredAt does not match the envelope.');
  if (idempotencyKey !== envelope.idempotencyKey)
    return fail('SIGNATURE_INVALID', 'Signature idempotency key does not match the envelope.');
  if (nonce !== envelope.nonce)
    return fail('SIGNATURE_INVALID', 'Signature nonce does not match the envelope.');
  if (payloadDigest !== canonicalDigest)
    return fail('SIGNATURE_INVALID', 'Signature digest does not match canonical payload.');
  if (signedEnvelopeDigest !== envelope.signedEnvelopeDigest)
    return fail('SIGNATURE_INVALID', 'Signed envelope digest does not match.');
  if (signatureDigest !== envelope.signatureDigest)
    return fail('SIGNATURE_INVALID', 'Signature material digest does not match.');
  if (algorithm !== envelope.signature.algorithm)
    return fail('SIGNATURE_INVALID', 'Signature algorithm does not match the envelope.');
  if (keyReference !== envelope.signature.keyReference)
    return fail('SIGNATURE_INVALID', 'Signature key reference does not match the envelope.');
  return ok(
    sealPayloadBoundSignature({
      envelopeVersion: envelope.envelopeVersion,
      sourceId,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      idempotencyKey: envelope.idempotencyKey,
      nonce: envelope.nonce,
      payloadDigest: envelope.payloadDigest,
      signedEnvelopeDigest: envelope.signedEnvelopeDigest,
      signatureDigest: envelope.signatureDigest,
      algorithm,
      keyReference,
      verifiedAt: verifiedAtIdentity.value,
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

  const limitsCheck = validateWebhookIngressLimits(limits);
  if (!limitsCheck.allowed) return fail(limitsCheck.code, limitsCheck.reason);
  const commandResult = snapshotWebhookCommand(command, limits);
  if (!commandResult.ok) return commandResult;
  const commandSnapshot = commandResult.value;

  const trustedNow = deps.clock.now();
  const trustedIsoResult = parseISO8601(trustedNow.toISOString());
  if (!trustedIsoResult.ok)
    return fail('INVALID_TIMESTAMP', 'Trusted clock returned an invalid timestamp.');
  const trustedIso = trustedIsoResult.value;

  const payload = sealRawWebhookPayloadHandle({
    bytes: Uint8Array.from(commandSnapshot.rawPayload),
    contentType: commandSnapshot.contentType,
    sourceId: commandSnapshot.sourceId,
    eventId: commandSnapshot.eventId,
    receivedAt: trustedIso,
    correlationId: commandSnapshot.correlationId,
  });
  const canonicalDigest = payload.payloadDigest;
  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed.');

  const signedBytes = canonicalWebhookSignedBytes({
    envelopeVersion: commandSnapshot.envelopeVersion,
    sourceId: commandSnapshot.sourceId,
    eventId: commandSnapshot.eventId,
    eventType: commandSnapshot.eventType,
    occurredAt: commandSnapshot.occurredAt,
    idempotencyKey: commandSnapshot.idempotencyKey,
    nonce: commandSnapshot.nonce,
    payloadDigest: canonicalDigest,
    contentType: commandSnapshot.contentType,
    contentLength: payload.contentLength,
    correlationId: commandSnapshot.correlationId,
    privacyClassification: commandSnapshot.privacyClassification,
    algorithm: commandSnapshot.signature.algorithm,
    keyReference: commandSnapshot.signature.keyReference,
  });
  const signedEnvelopeDigest = computeWebhookPayloadDigest(signedBytes);
  const signatureDigest = computeWebhookPayloadDigest(
    new TextEncoder().encode(commandSnapshot.signature.value),
  );
  const envelope: WebhookEnvelope = Object.freeze({
    envelopeVersion: commandSnapshot.envelopeVersion,
    sourceId: commandSnapshot.sourceId,
    eventId: commandSnapshot.eventId,
    eventType: commandSnapshot.eventType,
    occurredAt: commandSnapshot.occurredAt,
    receivedAt: trustedIso,
    payloadDigest: canonicalDigest,
    signedEnvelopeDigest,
    signatureDigest,
    signature: commandSnapshot.signature,
    idempotencyKey: commandSnapshot.idempotencyKey,
    nonce: commandSnapshot.nonce,
    contentType: commandSnapshot.contentType,
    contentLength: payload.contentLength,
    correlationId: commandSnapshot.correlationId,
    privacyClassification: commandSnapshot.privacyClassification,
  });

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

  const verificationRequest: WebhookCanonicalVerificationRequest = Object.freeze({
    envelope,
    verificationRequestedAt: trustedIso,
    copyPayloadBytes: () => payload.copyBytes(),
    copyCanonicalSignedBytes: () => Uint8Array.from(signedBytes),
  });
  const signatureResult = await deps.signatures.verify(verificationRequest, context);
  if (!signatureResult.ok)
    return fail('VERIFIER_UNAVAILABLE', 'Signature verifier is unavailable.');
  if (signatureResult.value === null)
    return fail('SIGNATURE_INVALID', 'Webhook signature verification failed.');

  if (!assertCanonicalDigest(payload, canonicalDigest))
    return fail('DIGEST_MISMATCH', 'Canonical payload digest integrity failed after verify.');
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

  const policy = await deps.policy.authorize(envelope, context);
  if (!policy.ok) return fail('VERIFIER_UNAVAILABLE', 'Webhook policy is unavailable.');
  if (policy.value === 'deny') return fail('POLICY_DENIED', 'Webhook policy denied the event.');

  const replay = await deps.replay.checkAndRecord(envelope, context);
  if (!replay.ok) return fail('VERIFIER_UNAVAILABLE', 'Replay protection is unavailable.');
  const replayMapped = mapReplayOutcome(replay.value);
  if (!replayMapped.ok) return replayMapped;
  const replayEvidence = sealWebhookReplayEvidence({
    eventId: envelope.eventId,
    idempotencyKey: envelope.idempotencyKey,
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
