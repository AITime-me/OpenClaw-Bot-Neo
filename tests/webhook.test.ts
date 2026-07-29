import { describe, expect, it } from 'vitest';
import {
  ok,
  parseIdempotencyKey,
  parseNonce,
  WEBHOOK_ENVELOPE_VERSION,
  type SafeWebhookAuditEvent,
  type WebhookCanonicalVerificationRequest,
  type WebhookEnvelope,
  type WebhookSignatureVerificationResult,
} from '../src/core/domain/index.js';
import { computeWebhookPayloadDigest } from '../src/core/domain/webhook.internal.js';
import {
  canonicalWebhookSignedBytes,
  executeWebhookIngress,
} from '../src/core/application/webhook-ingress.service.js';
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

const idempotency = (value = 'event-1') => {
  const parsed = parseIdempotencyKey(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};

const nonce = (value = 'nonce-1') => {
  const parsed = parseNonce(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};

const parseCanonicalFields = (bytes: Uint8Array): readonly (readonly [string, string])[] => {
  const decoder = new TextDecoder();
  let index = 0;
  const readFramed = (): string => {
    const lengthStart = index;
    while (index < bytes.length && bytes[index] !== 0x3a) index += 1;
    if (index >= bytes.length) throw new Error('missing frame colon');
    const length = Number.parseInt(decoder.decode(bytes.slice(lengthStart, index)), 10);
    index += 1;
    const end = index + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > bytes.length)
      throw new Error('invalid frame length');
    const value = decoder.decode(bytes.slice(index, end));
    index = end;
    return value;
  };
  const fields: Array<readonly [string, string]> = [];
  while (index < bytes.length) {
    const key = readFramed();
    if (bytes[index] !== 0x3d) throw new Error('missing frame equals');
    index += 1;
    const value = readFramed();
    fields.push([key, value]);
    if (index < bytes.length) {
      if (bytes[index] !== 0x0a) throw new Error('missing field newline');
      index += 1;
    }
  }
  return fields;
};

const canonicalInput = {
  envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
  sourceId: 'trusted-source',
  eventId: 'event-1',
  eventType: 'call.ready',
  occurredAt: '2026-07-28T12:00:00.000Z',
  idempotencyKey: 'idempotency-1',
  nonce: 'nonce-1',
  payloadDigest: 'a'.repeat(64),
  contentType: 'application/json',
  contentLength: 17,
  correlationId: 'correlation-1',
  privacyClassification: 'confidential',
  algorithm: 'detached-signature-v1',
  keyReference: 'source-key-reference',
};

const verifiedResult = (
  request: WebhookCanonicalVerificationRequest,
  overrides: Partial<WebhookSignatureVerificationResult> = {},
): WebhookSignatureVerificationResult => ({
  verified: true,
  envelopeVersion: request.envelope.envelopeVersion,
  sourceId: request.envelope.sourceId,
  eventId: request.envelope.eventId,
  occurredAt: request.envelope.occurredAt,
  idempotencyKey: request.envelope.idempotencyKey,
  nonce: request.envelope.nonce,
  payloadDigest: request.envelope.payloadDigest,
  signedEnvelopeDigest: request.envelope.signedEnvelopeDigest,
  signatureDigest: request.envelope.signatureDigest,
  algorithm: request.envelope.signature.algorithm,
  keyReference: request.envelope.signature.keyReference,
  verifiedAt: request.verificationRequestedAt,
  ...overrides,
});

const command = (overrides: Record<string, unknown> = {}) => {
  const rawPayload = new TextEncoder().encode('{"status":"ready"}');
  return {
    envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
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
      value: 'dGVzdC1zaWduYXR1cmU=',
    },
    idempotencyKey: idempotency(),
    nonce: nonce(),
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
      verify: (request) => Promise.resolve(ok(verifiedResult(request))),
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
    policy: {
      authorize: () => Promise.resolve(ok('allow')),
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

  it('keeps canonical bytes intact when the caller mutates the original array', async () => {
    const raw = new TextEncoder().encode('immutable-core-payload');
    const original = Uint8Array.from(raw);
    const result = await executeWebhookIngress(
      deps({
        scanner: {
          scanText: (input) => {
            expect(input).toBe('immutable-core-payload');
            return Promise.resolve(ok({ decision: 'allow', findings: [], redacted: input }));
          },
          scanMetadata: () =>
            Promise.resolve(ok({ decision: 'allow', findings: [], redactedEntries: {} })),
        },
      }),
      command({ rawPayload: original, declaredContentLength: original.byteLength }),
      limits,
      operationContext(),
    );
    original[0] = 0;
    expect(result.ok).toBe(true);
  });

  it('keeps canonical digest when a malicious verifier mutates its disposable copy', async () => {
    const raw = new TextEncoder().encode('canonical-payload');
    const canonicalDigest = computeWebhookPayloadDigest(raw);
    let scanned = '';
    const result = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) => {
            const bytes = request.copyPayloadBytes();
            bytes[0] = 0xff;
            expect(request.envelope.payloadDigest).toBe(canonicalDigest);
            return Promise.resolve(ok(verifiedResult(request)));
          },
        },
        scanner: {
          scanText: (input) => {
            scanned = input;
            return Promise.resolve(ok({ decision: 'allow', findings: [], redacted: input }));
          },
          scanMetadata: () =>
            Promise.resolve(ok({ decision: 'allow', findings: [], redactedEntries: {} })),
        },
      }),
      command({ rawPayload: raw, declaredContentLength: raw.byteLength }),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(true);
    expect(scanned).toBe('canonical-payload');
  });

  it('uses one immutable command/signature snapshot across asynchronous adapters', async () => {
    const input = command();
    const originalPayload = Uint8Array.from(input.rawPayload);
    const result = await executeWebhookIngress(
      deps({
        sourceAuth: {
          authenticate: () => {
            input.eventId = 'mutated-event';
            input.occurredAt = iso('2026-07-28T12:00:09.000Z');
            input.idempotencyKey = idempotency('mutated-idempotency');
            input.nonce = nonce('mutated-nonce');
            input.signature.value = 'bXV0YXRlZA==';
            input.rawPayload[0] = 0xff;
            return Promise.resolve(ok(true));
          },
        },
        signatures: {
          verify: (request) => {
            expect(request.envelope.eventId).toBe('event-1');
            expect(request.envelope.occurredAt).toBe('2026-07-28T12:00:00.000Z');
            expect(request.envelope.idempotencyKey).toBe('event-1');
            expect(request.envelope.nonce).toBe('nonce-1');
            expect(request.envelope.signature.value).toBe('dGVzdC1zaWduYXR1cmU=');
            expect(request.copyPayloadBytes()).toEqual(originalPayload);
            return Promise.resolve(ok(verifiedResult(request)));
          },
        },
      }),
      input,
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects nested executable command fields and unsupported byte containers', async () => {
    let getterRuns = 0;
    const signatureWithGetter = {
      algorithm: 'detached-signature-v1',
      keyReference: 'source-key-reference',
    };
    Object.defineProperty(signatureWithGetter, 'value', {
      enumerable: true,
      get() {
        getterRuns += 1;
        return 'dGVzdA==';
      },
    });
    const getterResult = await executeWebhookIngress(
      deps(),
      command({ signature: signatureWithGetter }),
      limits,
      operationContext(),
    );
    expect(getterResult.ok).toBe(false);
    expect(getterRuns).toBe(0);

    const proxyResult = await executeWebhookIngress(
      deps(),
      command({ signature: new Proxy(command().signature, {}) }),
      limits,
      operationContext(),
    );
    expect(proxyResult.ok).toBe(false);

    class CustomBytes extends Uint8Array {}
    const custom = new CustomBytes([1, 2, 3]);
    const customResult = await executeWebhookIngress(
      deps(),
      command({ rawPayload: custom, declaredContentLength: custom.byteLength }),
      limits,
      operationContext(),
    );
    expect(customResult.ok).toBe(false);
  });

  it('rejects top-level accessors without reading the raw command property', async () => {
    let reads = 0;
    const input = command();
    Object.defineProperty(input, 'eventId', {
      enumerable: true,
      get() {
        reads += 1;
        return 'event-1';
      },
    });
    const result = await executeWebhookIngress(deps(), input, limits, operationContext());
    expect(result.ok).toBe(false);
    expect(reads).toBe(0);
  });

  it('seals the verifier snapshot before replay and ignores later result mutation', async () => {
    let returned: WebhookSignatureVerificationResult | undefined;
    const result = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) => {
            returned = verifiedResult(request);
            return Promise.resolve(ok(returned));
          },
        },
        replay: {
          checkAndRecord: () => {
            if (returned !== undefined)
              Object.assign(returned, {
                sourceId: 'changed',
                eventId: 'changed',
                signedEnvelopeDigest: '0'.repeat(64),
              });
            return Promise.resolve(ok('accepted'));
          },
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence.signature.sourceId).toBe('trusted-source');
    expect(result.value.evidence.signature.eventId).toBe('event-1');
    expect(result.value.evidence.signature.signedEnvelopeDigest).not.toBe('0'.repeat(64));
  });

  it('builds a stable, length-framed canonical signed representation', async () => {
    const digests: string[] = [];
    const capture = deps({
      signatures: {
        verify: (request) => {
          expect(computeWebhookPayloadDigest(request.copyCanonicalSignedBytes())).toBe(
            request.envelope.signedEnvelopeDigest,
          );
          digests.push(request.envelope.signedEnvelopeDigest);
          return Promise.resolve(ok(verifiedResult(request)));
        },
      },
    });
    expect((await executeWebhookIngress(capture, command(), limits, operationContext())).ok).toBe(
      true,
    );
    expect((await executeWebhookIngress(capture, command(), limits, operationContext())).ok).toBe(
      true,
    );
    expect(
      (
        await executeWebhookIngress(
          capture,
          command({ eventId: 'event-2' }),
          limits,
          operationContext(),
        )
      ).ok,
    ).toBe(true);
    expect(digests[0]).toBe(digests[1]);
    expect(digests[2]).not.toBe(digests[0]);
  });

  it('frames UTF-8, delimiters and field order without ambiguity', () => {
    const input = {
      ...canonicalInput,
      eventType: 'событие:\nготово',
      contentType: 'application/x:test\nmode=one',
    };
    const first = canonicalWebhookSignedBytes(input);
    const second = canonicalWebhookSignedBytes(input);
    expect(first).toEqual(second);
    const fields = parseCanonicalFields(first);
    expect(fields.map(([key]) => key)).toEqual([
      'envelopeVersion',
      'sourceId',
      'eventId',
      'eventType',
      'occurredAt',
      'idempotencyKey',
      'nonce',
      'payloadDigest',
      'contentType',
      'contentLength',
      'correlationId',
      'privacyClassification',
      'signatureAlgorithm',
      'keyReference',
    ]);
    expect(Object.fromEntries(fields).eventType).toBe(input.eventType);
    expect(Object.fromEntries(fields).contentType).toBe(input.contentType);
    expect(new TextEncoder().encode(input.eventType).byteLength).toBeGreaterThan(
      input.eventType.length,
    );
  });

  it('binds every canonical field and keeps Unicode normalization variants distinct', () => {
    const baseDigest = computeWebhookPayloadDigest(canonicalWebhookSignedBytes(canonicalInput));
    const variants = [
      { envelopeVersion: 'openclaw.webhook.v2' },
      { sourceId: 'trusted-source-2' },
      { eventId: 'event-2' },
      { eventType: 'call.changed' },
      { occurredAt: '2026-07-28T12:00:01.000Z' },
      { idempotencyKey: 'idempotency-2' },
      { nonce: 'nonce-2' },
      { payloadDigest: 'b'.repeat(64) },
      { contentType: 'application/cbor' },
      { contentLength: 18 },
      { correlationId: 'correlation-2' },
      { privacyClassification: 'internal' },
      { algorithm: 'detached-signature-v2' },
      { keyReference: 'source-key-reference-2' },
    ];
    for (const variant of variants)
      expect(
        computeWebhookPayloadDigest(canonicalWebhookSignedBytes({ ...canonicalInput, ...variant })),
      ).not.toBe(baseDigest);

    const composed = canonicalWebhookSignedBytes({ ...canonicalInput, eventType: '\u00e9' });
    const decomposed = canonicalWebhookSignedBytes({ ...canonicalInput, eventType: 'e\u0301' });
    expect(composed).not.toEqual(decomposed);
  });

  it('prevents empty/missing, partitioning and delimiter collisions', () => {
    const empty = canonicalWebhookSignedBytes({ ...canonicalInput, eventType: '' });
    expect(() =>
      canonicalWebhookSignedBytes({
        ...canonicalInput,
        eventType: undefined,
      } as never),
    ).toThrow('Canonical webhook fields');
    expect(empty).not.toEqual(
      canonicalWebhookSignedBytes({ ...canonicalInput, eventType: 'undefined' }),
    );
    expect(
      canonicalWebhookSignedBytes({
        ...canonicalInput,
        eventType: 'a',
        contentType: 'bc',
      }),
    ).not.toEqual(
      canonicalWebhookSignedBytes({
        ...canonicalInput,
        eventType: 'ab',
        contentType: 'c',
      }),
    );
    expect(canonicalWebhookSignedBytes({ ...canonicalInput, eventType: 'x\n1:y=z' })).not.toEqual(
      canonicalWebhookSignedBytes({ ...canonicalInput, eventType: 'x', contentType: '1:y=z' }),
    );
  });

  it('binds canonical content length to the actual payload byte length', async () => {
    const payload = new TextEncoder().encode('многобайт');
    let capturedLength = -1;
    const accepted = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) => {
            capturedLength = Number(
              Object.fromEntries(parseCanonicalFields(request.copyCanonicalSignedBytes()))
                .contentLength,
            );
            return Promise.resolve(ok(verifiedResult(request)));
          },
        },
      }),
      command({ rawPayload: payload, declaredContentLength: payload.byteLength }),
      limits,
      operationContext(),
    );
    expect(accepted.ok).toBe(true);
    expect(capturedLength).toBe(payload.byteLength);
    const rejected = await executeWebhookIngress(
      deps(),
      command({ rawPayload: payload, declaredContentLength: payload.length - 1 }),
      limits,
      operationContext(),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('INVALID_ENVELOPE');
  });

  it('denies every mismatched signed-envelope field from verifier', async () => {
    const cases = [
      { payloadDigest: '0'.repeat(64) },
      { sourceId: 'other-source' },
      { eventId: 'other-event' },
      { occurredAt: '2026-07-28T12:00:09.000Z' },
      { idempotencyKey: 'other-idempotency' },
      { nonce: 'other-nonce' },
      { signedEnvelopeDigest: '1'.repeat(64) },
      { signatureDigest: '2'.repeat(64) },
      { envelopeVersion: 'openclaw.webhook.v2' },
      { algorithm: 'other-alg' },
      { keyReference: 'other-key' },
    ] as const;
    for (const broken of cases) {
      const result = await executeWebhookIngress(
        deps({
          signatures: {
            verify: (request) => Promise.resolve(ok(verifiedResult(request, broken))),
          },
        }),
        command(),
        limits,
        operationContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SIGNATURE_INVALID');
    }
  });

  it.each([
    ['UNKNOWN_SOURCE', { sourceAuth: { authenticate: () => Promise.resolve(ok(false)) } }],
    ['SIGNATURE_INVALID', { signatures: { verify: () => Promise.resolve(ok(null)) } }],
    [
      'REPLAY_DETECTED',
      { replay: { checkAndRecord: () => Promise.resolve(ok('replay' as const)) } },
    ],
    [
      'DUPLICATE_EVENT',
      { replay: { checkAndRecord: () => Promise.resolve(ok('duplicate-event' as const)) } },
    ],
    [
      'DUPLICATE_IDEMPOTENCY_KEY',
      {
        replay: {
          checkAndRecord: () => Promise.resolve(ok('duplicate-idempotency-key' as const)),
        },
      },
    ],
    [
      'STALE_TIMESTAMP',
      { replay: { checkAndRecord: () => Promise.resolve(ok('stale-timestamp' as const)) } },
    ],
    [
      'NONCE_REPLAY',
      { replay: { checkAndRecord: () => Promise.resolve(ok('nonce-replay' as const)) } },
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

  it('denies accessor verifier results without executing getters into evidence', async () => {
    let reads = 0;
    const result = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) => {
            const target = verifiedResult(request);
            const proxied: typeof target = new Proxy(target, {
              get(obj, prop, receiver): unknown {
                reads += 1;
                return Reflect.get(obj, prop, receiver);
              },
            });
            return Promise.resolve(ok(proxied));
          },
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VERIFIER_RESULT_INVALID');
    expect(reads).toBe(0);
  });

  it('denies getter/extra/inherited verifier results and freezes snapshot evidence', async () => {
    const withGetter = {};
    Object.defineProperty(withGetter, 'verified', {
      enumerable: true,
      get() {
        return true;
      },
    });
    for (const key of [
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
    ])
      Object.defineProperty(withGetter, key, { enumerable: true, value: 'x' });
    const getterResult = await executeWebhookIngress(
      deps({
        signatures: { verify: () => Promise.resolve(ok(withGetter as never)) },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(getterResult.ok).toBe(false);
    if (!getterResult.ok) expect(getterResult.error.code).toBe('VERIFIER_RESULT_INVALID');

    const extraResult = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) =>
            Promise.resolve(ok({ ...verifiedResult(request), extra: true } as never)),
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(extraResult.ok).toBe(false);

    const partialResult = await executeWebhookIngress(
      deps({
        signatures: {
          verify: () => Promise.resolve(ok({ verified: true } as never)),
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(partialResult.ok).toBe(false);

    const inheritedResult = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) =>
            Promise.resolve(
              ok(Object.assign(Object.create({ inherited: true }), verifiedResult(request))),
            ),
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(inheritedResult.ok).toBe(false);

    let setterCalls = 0;
    const setterResult = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) => {
            const value = verifiedResult(request);
            let source = value.sourceId;
            Object.defineProperty(value, 'sourceId', {
              enumerable: true,
              set(next: string) {
                setterCalls += 1;
                source = next;
              },
            });
            void source;
            return Promise.resolve(ok(value));
          },
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(setterResult.ok).toBe(false);
    expect(setterCalls).toBe(0);
  });

  it('rejects replay-key substitution before replay storage and redacts adapter errors', async () => {
    let replayCalls = 0;
    const secretError = 'verifier leaked signing material';
    const mismatch = await executeWebhookIngress(
      deps({
        signatures: {
          verify: (request) =>
            Promise.resolve(ok(verifiedResult(request, { idempotencyKey: 'substituted' }))),
        },
        replay: {
          checkAndRecord: () => {
            replayCalls += 1;
            return Promise.resolve(ok('accepted'));
          },
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(mismatch.ok).toBe(false);
    expect(replayCalls).toBe(0);

    const unavailable = await executeWebhookIngress(
      deps({
        signatures: {
          verify: () =>
            Promise.resolve({
              ok: false,
              error: { code: 'EXTERNAL_FAILURE', operation: secretError, retryable: false },
            }),
        },
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(unavailable.ok).toBe(false);
    expect(JSON.stringify(unavailable)).not.toContain(secretError);
  });

  it.each([
    [
      'rate limit',
      {
        rateLimit: { decide: () => Promise.resolve(ok('deny' as const)) },
      },
      'RATE_LIMITED',
    ],
    [
      'scanner',
      {
        scanner: {
          scanText: () =>
            Promise.resolve(ok({ decision: 'deny' as const, findings: [], redacted: '' })),
          scanMetadata: () =>
            Promise.resolve(ok({ decision: 'allow' as const, findings: [], redactedEntries: {} })),
        },
      },
      'SCANNER_DENIED',
    ],
    [
      'policy',
      {
        policy: { authorize: () => Promise.resolve(ok('deny' as const)) },
      },
      'POLICY_DENIED',
    ],
  ])(
    'does not record replay keys after a %s pre-authorization deny',
    async (_label, override, code) => {
      let replayCalls = 0;
      const result = await executeWebhookIngress(
        deps({
          ...override,
          replay: {
            checkAndRecord: () => {
              replayCalls += 1;
              return Promise.resolve(ok('accepted'));
            },
          },
        }),
        command(),
        limits,
        operationContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
      expect(replayCalls).toBe(0);
    },
  );

  it('allows retry after pre-authorization deny and records only the accepted attempt', async () => {
    let allowRate = false;
    let replayCalls = 0;
    const shared = deps({
      rateLimit: {
        decide: () => Promise.resolve(ok(allowRate ? 'allow' : 'deny')),
      },
      replay: {
        checkAndRecord: () => {
          replayCalls += 1;
          return Promise.resolve(ok('accepted'));
        },
      },
    });
    const denied = await executeWebhookIngress(shared, command(), limits, operationContext());
    expect(denied.ok).toBe(false);
    allowRate = true;
    const accepted = await executeWebhookIngress(shared, command(), limits, operationContext());
    expect(accepted.ok).toBe(true);
    expect(replayCalls).toBe(1);
  });

  it('consumes the replay key before a downstream audit failure', async () => {
    let recorded = false;
    const shared = deps({
      replay: {
        checkAndRecord: () => {
          if (recorded) return Promise.resolve(ok('duplicate-idempotency-key'));
          recorded = true;
          return Promise.resolve(ok('accepted'));
        },
      },
      audit: {
        record: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'EXTERNAL_FAILURE', operation: 'audit', retryable: true },
          }),
      },
    });
    const first = await executeWebhookIngress(shared, command(), limits, operationContext());
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe('AUDIT_FAILED');
    const retry = await executeWebhookIngress(
      deps({
        replay: shared.replay,
      }),
      command(),
      limits,
      operationContext(),
    );
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
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
  });

  it('denies empty digest and invalid dates at envelope validation', () => {
    const raw = new TextEncoder().encode('x');
    const envelope: WebhookEnvelope = {
      envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
      sourceId: 'trusted-source',
      eventId: 'event-1',
      eventType: 'call-recording.ready',
      occurredAt: iso('2026-07-28T12:00:00.000Z'),
      receivedAt: iso('2026-07-28T12:00:01.000Z'),
      payloadDigest: computeWebhookPayloadDigest(raw),
      signedEnvelopeDigest: computeWebhookPayloadDigest(new TextEncoder().encode('signed')),
      signatureDigest: computeWebhookPayloadDigest(new TextEncoder().encode('signature')),
      signature: {
        algorithm: 'detached-signature-v1',
        keyReference: 'source-key-reference',
        value: 'dGVzdA==',
      },
      idempotencyKey: idempotency(),
      nonce: nonce(),
      contentType: 'application/json',
      contentLength: raw.byteLength,
      correlationId: asCorrelation(),
      privacyClassification: 'confidential' as const,
    };
    Object.assign(envelope, { occurredAt: 'invalid', payloadDigest: '' });
    const decision = validateWebhookEnvelope(
      envelope,
      limits,
      new Date('2026-07-28T12:00:10.000Z'),
    );
    expect(decision.allowed).toBe(false);
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
    expect(serialized).not.toContain('rawPayload');
  });

  it('does not export sealed webhook factories', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('sealAuthorizedWebhookIngress');
    expect(names).not.toContain('sealRawWebhookPayloadHandle');
    expect(names).not.toContain('sealPayloadBoundSignature');
    expect(names).toContain('executeWebhookIngress');
  });
});
