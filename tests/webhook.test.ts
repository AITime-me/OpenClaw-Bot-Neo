import { describe, expect, it } from 'vitest';
import type {
  IdempotencyKey,
  SafeWebhookAuditEvent,
  WebhookEnvelope,
  WebhookVerificationState,
} from '../src/core/domain/index.js';
import { authorizeWebhookIngress } from '../src/core/policy/webhook-ingress.js';
import { asCorrelation, asDigest, iso } from './support/fixtures.js';

const envelope = (overrides: Partial<WebhookEnvelope> = {}): WebhookEnvelope => ({
  sourceId: 'trusted-source',
  eventId: 'event-1',
  eventType: 'call-recording.ready',
  occurredAt: iso('2026-07-28T12:00:00.000Z'),
  receivedAt: iso('2026-07-28T12:00:01.000Z'),
  payloadDigest: asDigest('digest'),
  signature: {
    algorithm: 'detached-signature-v1',
    keyReference: 'source-key-reference',
    signaturePresent: true,
  },
  idempotencyKey: 'event-1' as IdempotencyKey,
  contentType: 'application/json',
  contentLength: 1_024,
  correlationId: asCorrelation(),
  privacyClassification: 'confidential',
  ...overrides,
});
const verified = (overrides: Partial<WebhookVerificationState> = {}): WebhookVerificationState => ({
  sourceAuthenticated: true,
  signatureVerified: true,
  replayDetected: false,
  duplicateEvent: false,
  rateLimitAllowed: true,
  verifierAvailable: true,
  ...overrides,
});
const limits = { maxContentLength: 2_048, maxClockSkewMs: 60_000 };
const now = new Date('2026-07-28T12:00:10.000Z');

describe('webhook ingress policy', () => {
  it('allows only an authenticated, verified and fresh event', () => {
    expect(authorizeWebhookIngress(envelope(), verified(), limits, now)).toEqual({
      allowed: true,
    });
  });

  it.each([
    ['UNKNOWN_SOURCE', { sourceAuthenticated: false }, {}],
    ['REPLAY', { replayDetected: true }, {}],
    ['DUPLICATE_EVENT', { duplicateEvent: true }, {}],
    ['VERIFIER_UNAVAILABLE', { verifierAvailable: false }, {}],
    ['SIGNATURE_INVALID', { signatureVerified: false }, {}],
    ['RATE_LIMITED', { rateLimitAllowed: false }, {}],
  ])('denies %s', (code, verification, envelopeOverrides) => {
    const decision = authorizeWebhookIngress(
      envelope(envelopeOverrides),
      verified(verification),
      limits,
      now,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe(code);
  });

  it('denies an invalid timestamp', () => {
    const decision = authorizeWebhookIngress(
      envelope({ occurredAt: iso('invalid') }),
      verified(),
      limits,
      now,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('INVALID_TIMESTAMP');
  });

  it('denies an oversized payload', () => {
    const decision = authorizeWebhookIngress(
      envelope({ contentLength: 2_049 }),
      verified(),
      limits,
      now,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('OVERSIZED_PAYLOAD');
  });

  it('safe audit metadata has no signature or verification secret field', () => {
    const audit: SafeWebhookAuditEvent = {
      sourceId: 'trusted-source',
      eventId: 'event-1',
      eventType: 'call-recording.ready',
      payloadDigest: asDigest(),
      correlationId: asCorrelation(),
      privacyClassification: 'confidential',
      outcome: 'denied',
      failureCode: 'SIGNATURE_INVALID',
      occurredAt: iso('2026-07-28T12:00:00.000Z'),
    };
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('verificationSecret');
  });
});
