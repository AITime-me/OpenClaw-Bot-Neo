import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ok,
  parseIdempotencyKey,
  parseNonce,
  WEBHOOK_ENVELOPE_VERSION,
  type ExtensionManifest,
} from '../src/core/domain/index.js';
import {
  getSanitizedMetadataCanonical,
  getSanitizedTextCanonical,
  isSanitizedMetadata,
  isSanitizedText,
  isVerifiedMemoryWrite,
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
  issueSecretBoundaryClearance,
  verifiedMemoryWriteHasClearance,
} from '../src/core/domain/sanitized.internal.js';
import { freezeStringRecord } from '../src/core/domain/immutable.js';
import {
  isAuthenticatedMemoryAccessContext,
  sealAuthenticatedMemoryAccess,
} from '../src/core/domain/memory-access.internal.js';
import {
  isRuntimeRiskEvidence,
  sealRuntimeRiskEvidence,
} from '../src/core/domain/extension-runtime-risk.internal.js';
import {
  isActiveExtensionRegistration,
  isDeploymentAuthorizationEvidence,
  sealActiveExtensionRegistration,
  sealDeploymentAuthorization,
  sealExtensionRegistryEntry,
} from '../src/core/domain/extension-registry-entry.internal.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { validateVoiceProfile } from '../src/core/policy/voice-profile.js';
import { isValidatedVoiceProfile } from '../src/core/domain/voice-profile.internal.js';
import {
  isAuthorizedWebhookIngress,
  isRawWebhookPayloadHandle,
  sealAuthorizedWebhookIngress,
  sealRawWebhookPayloadHandle,
  sealPayloadBoundSignature,
  sealAuthenticatedWebhookSource,
  sealWebhookTimestampEvidence,
  sealWebhookReplayEvidence,
  sealWebhookRateLimitEvidence,
  sealSanitizedWebhookPayload,
} from '../src/core/domain/webhook.internal.js';
import { executeMemoryWrite } from '../src/core/application/memory-write.service.js';
import { computePayloadDigest } from '../src/core/application/payload-digest.js';
import * as publicApi from '../src/index.js';
import {
  asActor,
  asCorrelation,
  asOwner,
  asRecordId,
  authenticatedAccess,
  createHarness,
  grantForCommand,
  iso,
  NOW,
  operationContext,
  writeCommand,
} from './support/fixtures.js';

const rejectAllCopies = (guard: (value: unknown) => boolean, original: object): void => {
  expect(guard(original)).toBe(true);

  expect(guard({ ...original })).toBe(false);
  expect(guard(Object.assign({}, original))).toBe(false);
  expect(guard(Object.create(original))).toBe(false);
  const prototypeUnknown: unknown = Object.getPrototypeOf(original);
  expect(
    guard(
      Object.create(
        prototypeUnknown === null || typeof prototypeUnknown === 'object' ? prototypeUnknown : null,
      ),
    ),
  ).toBe(false);

  const stringCopy = Object.fromEntries(Object.entries(original));
  expect(guard(stringCopy)).toBe(false);

  const symbolCopy: Record<PropertyKey, unknown> = { ...stringCopy };
  for (const symbol of Object.getOwnPropertySymbols(original))
    symbolCopy[symbol] = (original as Record<symbol, unknown>)[symbol];
  expect(guard(symbolCopy)).toBe(false);
  expect(guard(Object.freeze({ ...original }))).toBe(false);

  try {
    expect(guard(structuredClone(original))).toBe(false);
  } catch {
    // Host objects may refuse structuredClone.
  }

  try {
    expect(guard(JSON.parse(JSON.stringify(original)))).toBe(false);
  } catch {
    // Non-JSON-safe evidence is fine.
  }
};

describe('FIN-001 sanitized snapshot immutability', () => {
  it('defensive-copies metadata and ignores retained reference mutation', () => {
    const retained: Record<string, string> = { origin: 'owner-note', tag: 'one' };
    const sealed = sealSanitizedMetadata(retained, 'allow');
    retained.origin = 'mutated';
    retained.tag = 'two';

    expect(sealed.entries.origin).toBe('owner-note');
    expect(sealed.entries.tag).toBe('one');
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.entries)).toBe(true);
    expect(isSanitizedMetadata(sealed)).toBe(true);
    expect(isSanitizedMetadata({ ...sealed })).toBe(false);
    expect(isSanitizedMetadata(Object.create(sealed))).toBe(false);
    expect(
      isSanitizedMetadata(Object.freeze({ entries: sealed.entries, scanDecision: 'allow' })),
    ).toBe(false);
  });

  it('copies string metadata through descriptors without executing caller code', () => {
    let getterRuns = 0;
    const getter = {};
    Object.defineProperty(getter, 'secret', {
      enumerable: true,
      get() {
        getterRuns += 1;
        throw new Error('must not execute');
      },
    });
    expect(freezeStringRecord(getter)).toBeNull();
    expect(getterRuns).toBe(0);
    expect(freezeStringRecord(new Proxy({ safe: 'value' }, {}))).toBeNull();

    const withSymbol = { safe: 'value' };
    Object.defineProperty(withSymbol, Symbol('hidden'), { value: 'secret' });
    expect(freezeStringRecord(withSymbol)).toBeNull();
    expect(
      freezeStringRecord(Object.assign(Object.create({ inherited: 'x' }), { safe: 'y' })),
    ).toBeNull();
    expect(freezeStringRecord({ ['k'.repeat(4_097)]: 'value' })).toBeNull();
    expect(freezeStringRecord({ safe: 'v'.repeat(65_537) })).toBeNull();

    const source = { safe: 'value' };
    const frozen = freezeStringRecord(source);
    expect(frozen).toEqual({ safe: 'value' });
    expect(Object.isFrozen(frozen)).toBe(true);
    source.safe = 'mutated';
    expect(frozen?.safe).toBe('value');
  });

  it('keeps text snapshot stable and rejects clones', () => {
    const sealed = sealSanitizedText('stable content', 'allow');
    expect(isSanitizedText(sealed)).toBe(true);
    expect(getSanitizedTextCanonical(sealed)?.value).toBe('stable content');
    rejectAllCopies(isSanitizedText, sealed);
  });

  it('rejects clones of sealed metadata and verified writes', () => {
    const content = sealSanitizedText('note', 'allow');
    const metadata = sealSanitizedMetadata({ a: '1' }, 'allow');
    const write = sealVerifiedMemoryWrite(
      {
        recordId: asRecordId(),
        ownerId: asOwner(),
        namespace: 'personal',
        content,
        metadata,
        source: { kind: 'owner', reference: 'note', observedAt: iso(NOW) },
        provenance: {
          capturedAt: iso(NOW),
          initiatedBy: asOwner(),
          transformation: 'owner-stated',
          ownerApproved: false,
          crossProjectAccess: false,
        },
        privacyClassification: 'confidential',
        trustLevel: 'owner-stated',
        retentionPolicy: {
          expiresAt: iso('2027-01-01T00:00:00.000Z'),
          reviewAt: iso('2026-10-01T00:00:00.000Z'),
          deleteOnExpiry: true,
        },
        approvalId: null,
        createdAt: iso(NOW),
        updatedAt: iso(NOW),
      },
      issueSecretBoundaryClearance(),
    );
    expect(write).not.toBeNull();
    if (write === null) return;
    expect(isVerifiedMemoryWrite(write)).toBe(true);
    expect(verifiedMemoryWriteHasClearance(write)).toBe(true);
    expect(Object.isFrozen(write)).toBe(true);
    expect(Object.isFrozen(write.provenance)).toBe(true);
    rejectAllCopies(isSanitizedMetadata, metadata);
    rejectAllCopies(isVerifiedMemoryWrite, write);
  });

  it('MemoryPort receives the pre-approval snapshot despite lookup/consume mutation', async () => {
    const retained: Record<string, string> = { origin: 'canonical', nested: 'array-like' };
    const command = writeCommand({
      rawContent: 'canonical body',
      rawMetadata: { origin: 'canonical', nested: 'array-like' },
      approvalId: 'approval-1' as never,
    });
    const access = authenticatedAccess();
    const grant = grantForCommand(command, access);

    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'owner-approval' },
      lookupGrant: grant,
      scanTextResult: ok({
        decision: 'allow',
        findings: [],
        redacted: 'canonical body',
      }),
      scanMetadataResult: ok({
        decision: 'allow',
        findings: [],
        redactedEntries: retained,
      }),
    });

    const originalLookup = harness.deps.approvals.lookup.bind(harness.deps.approvals);
    harness.deps.approvals.lookup = async (approvalId, operation) => {
      retained.origin = 'mutated-during-lookup';
      retained.nested = 'mutated-array';
      return originalLookup(approvalId, operation);
    };
    const originalConsume = harness.deps.approvals.consume.bind(harness.deps.approvals);
    harness.deps.approvals.consume = async (approvalId, nonce, operation) => {
      retained.origin = 'mutated-during-consume';
      return originalConsume(approvalId, nonce, operation);
    };

    const result = await executeMemoryWrite(harness.deps, access, command);
    expect(result.ok).toBe(true);
    expect(harness.writes).toHaveLength(1);
    const written = harness.writes[0];
    expect(written).toBeDefined();
    if (written === undefined) return;
    expect(written.metadata.entries.origin).toBe('canonical');
    expect(written.metadata.entries.nested).toBe('array-like');
    expect(getSanitizedMetadataCanonical(written.metadata)?.entries.origin).toBe('canonical');

    const digest = computePayloadDigest({
      effect: 'write',
      content: getSanitizedTextCanonical(written.content)?.value ?? '',
      metadata: getSanitizedMetadataCanonical(written.metadata)?.entries ?? {},
      namespace: written.namespace,
      target: `memory/${written.namespace}/${written.recordId}`,
      recordId: written.recordId,
      projectScope: {
        primary: access.projectScope.primary,
        permitted: [...access.projectScope.permitted].sort(),
        crossProjectPermitted: access.projectScope.crossProjectPermitted,
      },
    });
    expect(digest).toBe(grant.payloadDigest);
  });

  it('does not export sanitized sealers from the public API', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('sealSanitizedText');
    expect(names).not.toContain('sealSanitizedMetadata');
    expect(names).not.toContain('sealVerifiedMemoryWrite');
    expect(names).not.toContain('issueSecretBoundaryClearance');
    expect(names).not.toContain('sealSecretData');
  });
});

describe('FIN-002 authenticated context clones and bindings', () => {
  it('rejects forged and cloned access contexts', () => {
    const legitimate = authenticatedAccess();
    rejectAllCopies(isAuthenticatedMemoryAccessContext, legitimate);
    expect(Object.getOwnPropertySymbols(legitimate)).toEqual([]);

    const permitted = ['personal'];
    const sealed = sealAuthenticatedMemoryAccess(
      {
        ownerId: asOwner(),
        actorId: asActor(),
        roles: ['personal-assistant'],
        activeNamespace: 'personal',
        projectScope: {
          primary: 'personal',
          permitted,
          crossProjectPermitted: false,
        },
        channelId: 'channel',
        sessionId: 'session',
        issuedAt: '2026-07-01T11:59:00.000Z',
        expiresAt: '2026-07-01T12:30:00.000Z',
        correlationId: asCorrelation(),
      },
      operationContext(),
      new Date(NOW),
    );
    expect(sealed).not.toBeNull();
    permitted.push('tvoe-vremya');
    expect(sealed?.projectScope.permitted).toEqual(['personal']);
  });
});

describe('FIN-003 transferable Symbol/clone rejection across evidence families', () => {
  const verifiedManifest = () => {
    const result = validateExtensionManifest({
      schemaVersion: '1.0',
      id: 'trust-foundation',
      version: '1.0.0',
      kind: 'technical-skill',
      displayName: 'Trust foundation',
      description: 'Deterministic evidence clone probe.',
      declaredCapabilities: ['analysis.permission@1'],
      requiredPorts: [],
      requestedPermissions: ['external-read'],
      riskClass: 'medium',
      approvalPolicy: { mode: 'none', effects: [] },
      dataClassifications: ['internal'],
      supportedInputKinds: ['text'],
      supportedOutputKinds: ['text'],
      configurationSchemaVersion: '1.0.0',
      enabled: true,
      provenance: { status: 'verified', source: 'trusted-deployment', note: 'Test.' },
      ownerScope: { mode: 'deployment-owner', ownerReference: 'test-owner' },
    } satisfies ExtensionManifest);
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };

  it('RuntimeRiskEvidence rejects adversarial copies', () => {
    const evidence = sealRuntimeRiskEvidence({
      extensionId: 'ext-1',
      extensionVersion: '1.0.0',
      correlationId: asCorrelation(),
      classifiedRisk: 'high',
      sourceTrustClassification: 'untrusted-input',
      policyVersion: 'risk-policy@1',
      registrationPolicyVersion: 'extension-policy@1',
      registrationEffectiveRisk: 'high',
      classifiedAt: iso(NOW),
      expiresAt: iso('2026-07-01T12:05:00.000Z'),
      provenance: 'trusted-runtime-classifier',
    });
    rejectAllCopies(isRuntimeRiskEvidence, evidence);
    expect(Object.getOwnPropertySymbols(evidence)).toEqual([]);
  });

  it('ActiveExtensionRegistration and deployment authorization reject copies', () => {
    const manifest = verifiedManifest();
    const entry = sealExtensionRegistryEntry({
      extensionId: manifest.id,
      version: manifest.version,
      manifest,
      activationState: 'active',
      registeredAt: iso(NOW),
      provenance: manifest.provenance,
      policyVersion: 'extension-policy@1',
      effectiveRiskClass: manifest.riskClass,
      grantedCapabilityRefs: [],
      grantedPermissionRefs: [],
      disabledReason: null,
      pendingReason: null,
    });
    const active = sealActiveExtensionRegistration(entry, 'digest');
    expect(active).not.toBeNull();
    if (active === null) return;
    const deployment = sealDeploymentAuthorization({
      deploymentIdentity: 'deploy-1',
      extensionId: 'ext-1',
      extensionVersion: '1.0.0',
      manifestDigest: 'digest',
      policyVersion: 'extension-policy@1',
      issuedAt: iso(NOW),
      expiresAt: iso('2027-01-01T00:00:00.000Z'),
    });
    rejectAllCopies(isActiveExtensionRegistration, active);
    rejectAllCopies(isDeploymentAuthorizationEvidence, deployment);
  });

  it('Voice and webhook evidence reject copies', () => {
    const voiceResult = validateVoiceProfile({
      id: 'neo',
      schemaVersion: '1.0',
      language: 'ru-RU',
      genderPresentation: 'masculine',
      tone: 'calm-confident-intellectual',
      pace: 'moderate',
      expressiveness: 'restrained',
      styleTags: [
        'calm',
        'intelligent',
        'confident',
        'restrained',
        'slightly-futuristic',
        'good-russian-diction',
        'not-call-center',
        'not-pompous-announcer',
      ],
      primaryVoiceSelector: {
        language: 'ru-RU',
        genderPresentation: 'masculine',
        styleTags: ['calm', 'restrained', 'good-russian-diction'],
      },
      fallbackVoiceSelectors: [],
      fallbackMode: 'text-only',
      allowCrossGenderFallback: false,
      allowVoiceCloning: false,
      allowIdentityImitation: false,
      enabled: true,
    });
    expect(voiceResult.valid).toBe(true);
    if (!voiceResult.valid) return;
    rejectAllCopies(isValidatedVoiceProfile, voiceResult.profile);

    const raw = sealRawWebhookPayloadHandle({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/json',
      sourceId: 'src',
      eventId: 'evt',
      receivedAt: iso(NOW),
      correlationId: asCorrelation(),
    });
    rejectAllCopies(isRawWebhookPayloadHandle, raw);
    const idempotency = parseIdempotencyKey('idem-1');
    const replayNonce = parseNonce('nonce-1');
    if (!idempotency.ok || !replayNonce.ok) throw new Error('Invalid webhook test identity.');

    const authorized = sealAuthorizedWebhookIngress({
      envelope: {
        envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
        sourceId: 'src',
        eventId: 'evt',
        eventType: 'call.completed',
        occurredAt: iso(NOW),
        receivedAt: iso(NOW),
        payloadDigest: raw.payloadDigest,
        signedEnvelopeDigest: raw.payloadDigest,
        signatureDigest: raw.payloadDigest,
        signature: {
          algorithm: 'hmac-sha256',
          keyReference: 'key',
          value: 'dGVzdA==',
        },
        idempotencyKey: idempotency.value,
        nonce: replayNonce.value,
        contentType: 'application/json',
        contentLength: 3,
        correlationId: asCorrelation(),
        privacyClassification: 'internal',
      },
      source: sealAuthenticatedWebhookSource({
        sourceId: 'src',
        authenticatedAt: iso(NOW),
      }),
      signature: sealPayloadBoundSignature({
        envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
        sourceId: 'src',
        eventId: 'evt',
        occurredAt: iso(NOW),
        idempotencyKey: idempotency.value,
        nonce: replayNonce.value,
        payloadDigest: raw.payloadDigest,
        signedEnvelopeDigest: raw.payloadDigest,
        signatureDigest: raw.payloadDigest,
        algorithm: 'hmac-sha256',
        keyReference: 'key',
        verifiedAt: iso(NOW),
      }),
      timestamp: sealWebhookTimestampEvidence({
        occurredAt: iso(NOW),
        receivedAt: iso(NOW),
        trustedNow: iso(NOW),
      }),
      replay: sealWebhookReplayEvidence({
        eventId: 'evt',
        idempotencyKey: idempotency.value,
      }),
      rateLimit: sealWebhookRateLimitEvidence({
        sourceId: 'src',
        eventType: 'call.completed',
      }),
      sanitized: sealSanitizedWebhookPayload({
        payloadDigest: raw.payloadDigest,
        privacyClassification: 'internal',
        redactedPreview: '[redacted]',
      }),
      authorizedAt: iso(NOW),
    });
    expect(authorized).not.toBeNull();
    if (authorized !== null) rejectAllCopies(isAuthorizedWebhookIngress, authorized);
  });
});

describe('package exports map', () => {
  it('allows only the documented root public API subpath', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
      files: string[];
    };
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(pkg.files).toEqual(['dist']);
    expect(JSON.stringify(pkg.exports)).not.toContain('.internal');
    expect(JSON.stringify(pkg.exports)).not.toContain('tests/');
  });

  it('root public API has no sealers, registries or brand markers', () => {
    const names = Object.keys(publicApi);
    expect(names).toContain('createMemoryAccessGateway');
    expect(names).toContain('executeMemoryWrite');
    for (const forbidden of [
      'sealAuthenticatedMemoryAccess',
      'sealSanitizedText',
      'sealRuntimeRiskEvidence',
      'sealActiveExtensionRegistration',
      'sealDeploymentAuthorization',
      'sealAuthorizedWebhookIngress',
      'sealValidatedVoiceProfile',
      'authenticatedRegistry',
      'sanitizedTextBrand',
      'runtimeRiskEvidenceBrand',
      'accessContext',
      'fixedClock',
      'createHarness',
    ])
      expect(names).not.toContain(forbidden);
  });
});
