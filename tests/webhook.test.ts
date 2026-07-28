import { describe, expect, it } from 'vitest';
import { ok, type IdempotencyKey, type SafeWebhookAuditEvent } from '../src/core/domain/index.js';
import {
  computeWebhookPayloadDigest,
  sealPayloadBoundSignature,
} from '../src/core/domain/webhook.internal.js';
import { executeWebhookIngress } from '../src/core/application/webhook-ingress.service.js';
import type { WebhookIngressDeps } from '../src/core/application/webhook-ingress.service.js';
import {
  authorizeWebhookIngress,
  validateWebhookEnvelope,
  validateWebhookIngressLimits,
} from '../src/core/policy/webhook-ingress.js';
import { asCorrelation, fixedClock, iso, operationContext } from './support/fixtures.js';
import * as publicApi from '../src/index.js';

const limits = {
  maxContentLength: 2_048,
  maxClockSkewMs: 60_000,
  maxIdLength: 128,
  maxEventTypeLength: 128,
};

const command = (overrides: Record<string, unknown> = {}) => {
  const rawPayload = new TextEncoder().encode('{"status":"ready"}');
  return {
    sourceId: 'trusted-source',
    eventId: 'event-1',
    eventType: 'call-recording.ready',
    occurredAt: iso('2026-07-28T12:00:00.000Z'),
    contentType: 'application/json',
    declaredContentLength: rawPayload.byteLength,
    correlationId: asCorrelation(),
    privacyClassification: 'confidential' as const,
    signature: {
      algorithm: 'detached-signature-v1',
      keyReference: 'source-key-reference',
      signaturePresent: true,
    },
    idempotencyKey: 'event-1' as IdempotencyKey,
    rawPayload,
    ...overrides,
  };
};

const deps = (overrides: Partial<WebhookIngressDeps> = {}): WebhookIngressDeps => {
  const base: WebhookIngressDeps = {
    clock: fixedClock('2026-07-28T12:00:10.000Z'),
    sourceAuth: {
      authenticate: () => Promise.resolve(ok(true)),
    },
    signatures: {
      verify: (envelope, payload) =>
        Promise.resolve(
          ok(
            sealPayloadBoundSignature({
              sourceId: envelope.sourceId,
              payloadDigest: payload.payloadDigest,
              algorithm: envelope.signature.algorithm,
              keyReference: envelope.signature.keyReference,
              verifiedAt: iso('2026-07-28T12:00:10.000Z'),
            }),
          ),
        ),
    },
    replay: {
      checkAndRecord: () => Promise.resolve(ok('accepted')),
    },
    rateLimit: {
      decide: () => Promise.resolve(ok('allow')),
    },
    scanner: {
      scanText: (input) =>
        Promise.resolve(
          ok({
            decision: 'allow' as const,
            findings: [],
            redacted: input,
          }),
        ),
      scanMetadata: () =>
        Promise.resolve(
          ok({
            decision: 'allow' as const,
            findings: [],
            redactedEntries: {},
          }),
        ),
    },
    audit: {
      record: () => Promise.resolve(ok(undefined)),
    },
  };
  return { ...base, ...overrides };
};

describe('webhook orchestration', () => {
  it('authorizes only through sealed orchestration evidence', async () => {
    const result = await executeWebhookIngress(deps(), command(), limits, operationContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(authorizeWebhookIngress(result.value.evidence)).toEqual({ allowed: true });
    expect(result.value.audit.digestPrefix).toHaveLength(12);
    expect(JSON.stringify(result.value.audit)).not.toContain('signature');
  });

  it('rejects caller-supplied boolean verification as authorization proof', () => {
    const decision = authorizeWebhookIngress({
      sourceAuthenticated: true,
      signatureVerified: true,
      replayDetected: false,
      duplicateEvent: false,
      rateLimitAllowed: true,
      verifierAvailable: true,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('UNAUTHORIZED_BOOLEAN_STATE');
  });

  it('binds signature evidence to the computed raw payload digest', async () => {
    const raw = new TextEncoder().encode('payload-a');
    const otherDigest = computeWebhookPayloadDigest(new TextEncoder().encode('payload-b'));
    const result = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (envelope) =>
            Promise.resolve(
              ok(
                sealPayloadBoundSignature({
                  sourceId: envelope.sourceId,
                  payloadDigest: otherDigest,
                  algorithm: envelope.signature.algorithm,
                  keyReference: envelope.signature.keyReference,
                  verifiedAt: iso('2026-07-28T12:00:10.000Z'),
                }),
              ),
            ),
        },
      }),
      command({ rawPayload: raw, declaredContentLength: raw.byteLength }),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_INVALID');
  });

  it.each([
    ['UNKNOWN_SOURCE', { sourceAuth: { authenticate: () => Promise.resolve(ok(false)) } }],
    ['SIGNATURE_INVALID', { signatures: { verify: () => Promise.resolve(ok(null)) } }],
    ['REPLAY', { replay: { checkAndRecord: () => Promise.resolve(ok('replay' as const)) } }],
    [
      'DUPLICATE_EVENT',
      { replay: { checkAndRecord: () => Promise.resolve(ok('duplicate-event' as const)) } },
    ],
    ['RATE_LIMITED', { rateLimit: { decide: () => Promise.resolve(ok('deny' as const)) } }],
  ])('denies %s', async (code, override) => {
    const result = await executeWebhookIngress(
      deps(override),
      command(),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('denies NaN and non-positive limits', () => {
    expect(
      validateWebhookIngressLimits({
        maxContentLength: Number.NaN,
        maxClockSkewMs: 1,
        maxIdLength: 1,
        maxEventTypeLength: 1,
      }).allowed,
    ).toBe(false);
    expect(
      validateWebhookIngressLimits({
        maxContentLength: 0,
        maxClockSkewMs: 1,
        maxIdLength: 1,
        maxEventTypeLength: 1,
      }).allowed,
    ).toBe(false);
  });

  it('denies empty digest and invalid dates at envelope validation', () => {
    const raw = new TextEncoder().encode('x');
    const envelope = {
      sourceId: 'trusted-source',
      eventId: 'event-1',
      eventType: 'call-recording.ready',
      occurredAt: iso('invalid'),
      receivedAt: iso('2026-07-28T12:00:01.000Z'),
      payloadDigest: '' as never,
      signature: {
        algorithm: 'detached-signature-v1',
        keyReference: 'source-key-reference',
        signaturePresent: true,
      },
      idempotencyKey: 'event-1' as IdempotencyKey,
      contentType: 'application/json',
      contentLength: raw.byteLength,
      correlationId: asCorrelation(),
      privacyClassification: 'confidential' as const,
    };
    const decision = validateWebhookEnvelope(
      envelope,
      limits,
      new Date('2026-07-28T12:00:10.000Z'),
    );
    expect(decision.allowed).toBe(false);
  });

  it('denies content length mismatch before sinks', async () => {
    const result = await executeWebhookIngress(
      deps(),
      command({ declaredContentLength: 999 }),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONTENT_LENGTH_MISMATCH');
  });

  it('keeps raw payload and signature material out of audit metadata', () => {
    const audit: SafeWebhookAuditEvent = {
      sourceId: 'trusted-source',
      eventId: 'event-1',
      eventType: 'call-recording.ready',
      digestPrefix: 'abcdef123456',
      contentLength: 12,
      correlationId: asCorrelation(),
      privacyClassification: 'confidential',
      outcome: 'denied',
      failureCode: 'SIGNATURE_INVALID',
      occurredAt: iso('2026-07-28T12:00:00.000Z'),
    };
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('verificationSecret');
    expect(serialized).not.toContain('rawPayload');
  });

  it('does not export sealed webhook factories', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('sealAuthorizedWebhookIngress');
    expect(names).not.toContain('sealRawWebhookPayloadHandle');
    expect(names).toContain('executeWebhookIngress');
  });
});
