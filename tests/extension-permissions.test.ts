import { describe, expect, it } from 'vitest';
import type {
  ExtensionManifest,
  ExtensionPermission,
  ExtensionPermissionPolicy,
  SealedExtensionRegistryEntry,
} from '../src/core/domain/index.js';
import {
  sealActiveExtensionRegistration,
  sealExtensionRegistryEntry,
} from '../src/core/domain/extension-registry-entry.internal.js';
import { resolveEffectiveExtensionRisk } from '../src/core/domain/extension-risk.js';
import { sealRuntimeRiskEvidence } from '../src/core/domain/extension-runtime-risk.internal.js';
import { classifyExtensionRuntimeRisk } from '../src/core/application/runtime-risk-classification.service.js';
import {
  parseRoutingObservation,
  parseSecurityGuardObservation,
} from '../src/core/application/runtime-risk-classification.service.js';
import { sealCurrentExtensionPolicySnapshot } from '../src/core/domain/extension-policy.internal.js';
import { resolveExtensionPermissions } from '../src/core/policy/extension-permissions.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { asCorrelation, fixedClock, iso, operationContext } from './support/fixtures.js';
import * as publicApi from '../src/index.js';

const NOW = '2026-07-28T12:00:10.000Z';

const verified = (overrides: Partial<ExtensionManifest> = {}) => {
  const result = validateExtensionManifest({
    schemaVersion: '1.0',
    id: 'permission-test',
    version: '1.0.0',
    kind: 'technical-skill',
    displayName: 'Permission test',
    description: 'Safe deterministic test metadata.',
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
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

const sealedEntry = (
  overrides: Partial<ExtensionManifest> = {},
  activationState: SealedExtensionRegistryEntry['activationState'] = 'active',
  effectiveRiskClass?: SealedExtensionRegistryEntry['effectiveRiskClass'],
) => {
  const manifest = verified(overrides);
  return sealExtensionRegistryEntry({
    extensionId: manifest.id,
    version: manifest.version,
    manifest,
    activationState,
    registeredAt: iso(NOW),
    provenance: manifest.provenance,
    policyVersion: 'extension-policy@1',
    effectiveRiskClass: effectiveRiskClass ?? manifest.riskClass,
    grantedCapabilityRefs: [],
    grantedPermissionRefs: [],
    disabledReason: activationState === 'disabled' ? 'disabled' : null,
    pendingReason: activationState === 'pending-policy' ? 'pending' : null,
  });
};

const activeRegistration = (
  overrides: Partial<ExtensionManifest> = {},
  effectiveRiskClass?: SealedExtensionRegistryEntry['effectiveRiskClass'],
) => {
  const entry = sealedEntry(overrides, 'active', effectiveRiskClass);
  const active = sealActiveExtensionRegistration(entry, 'digest-test');
  if (active === null) throw new Error('active');
  return active;
};

const riskEvidence = (
  registration: ReturnType<typeof activeRegistration>,
  classifiedRisk: 'low' | 'medium' | 'high' | 'untrusted-input' = 'medium',
) =>
  sealRuntimeRiskEvidence({
    extensionId: registration.extensionId,
    extensionVersion: registration.version,
    correlationId: asCorrelation(),
    classifiedRisk,
    sourceTrustClassification: 'owner-stated',
    policyVersion: 'risk-policy@1',
    registrationPolicyVersion: registration.policyVersion,
    registrationEffectiveRisk: registration.effectiveRiskClass,
    classifiedAt: iso('2026-07-28T12:00:00.000Z'),
    expiresAt: iso('2026-07-28T12:05:00.000Z'),
    provenance: 'trusted-runtime-classifier',
  });

const policy = (allowed: readonly ExtensionPermission[]): ExtensionPermissionPolicy => ({
  deploymentAllowed: allowed,
  roleAllowed: allowed,
  securityAllowed: allowed,
  riskAllowed: allowed,
});

const request = (
  registration: ReturnType<typeof activeRegistration> | null,
  evidence: ReturnType<typeof riskEvidence> | null,
  permissionPolicy: ExtensionPermissionPolicy = policy(['external-read']),
) => ({
  registration,
  runtimeRiskEvidence: evidence,
  correlationId: evidence?.correlationId ?? asCorrelation(),
  policy: permissionPolicy,
  now: new Date(NOW),
});

describe('effective extension risk', () => {
  it('keeps the strictest of multiple risk inputs', () => {
    expect(resolveEffectiveExtensionRisk('untrusted-input', 'low')).toEqual({
      ok: true,
      risk: 'untrusted-input',
    });
    expect(resolveEffectiveExtensionRisk('high', 'low', 'medium')).toEqual({
      ok: true,
      risk: 'high',
    });
    expect(resolveEffectiveExtensionRisk('low', 'high')).toEqual({ ok: true, risk: 'high' });
  });

  it('denies unknown risk values', () => {
    expect(resolveEffectiveExtensionRisk('unknown', 'low').ok).toBe(false);
    expect(resolveEffectiveExtensionRisk().ok).toBe(false);
  });
});

describe('extension permission resolution', () => {
  it('defaults to deny without sealed active registration', () => {
    const decision = resolveExtensionPermissions(request(null, null, policy([])));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_ACTIVE');
  });

  it('rejects ordinary low-risk objects as evidence', () => {
    const registration = activeRegistration();
    const decision = resolveExtensionPermissions({
      registration,
      runtimeRiskEvidence: {
        classifiedRisk: 'low',
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
      } as never,
      correlationId: asCorrelation(),
      policy: policy(['external-read']),
      now: new Date(NOW),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('MISSING_RISK');
  });

  it('rejects forged active-like objects without runtime brand', () => {
    const decision = resolveExtensionPermissions({
      registration: {
        activationState: 'active',
        extensionId: 'permission-test',
        version: '1.0.0',
        policyVersion: 'extension-policy@1',
        effectiveRiskClass: 'low',
        manifest: verified(),
        manifestDigest: 'x',
      } as never,
      runtimeRiskEvidence: null,
      correlationId: asCorrelation(),
      policy: policy(['external-read']),
      now: new Date(NOW),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_ACTIVE');
  });

  it('does not let sealed runtime low lower manifest or registration high risk', () => {
    const registration = activeRegistration(
      {
        requestedPermissions: ['memory-write', 'external-read'],
        riskClass: 'high',
        approvalPolicy: { mode: 'required-for-dangerous', effects: ['memory-write'] },
      },
      'high',
    );
    const decision = resolveExtensionPermissions(
      request(
        registration,
        riskEvidence(registration, 'low'),
        policy(['memory-write', 'external-read']),
      ),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectiveRisk).toBe('high');
  });

  it('keeps untrusted registration risk when sealed runtime is low', () => {
    const registration = activeRegistration(
      {
        requestedPermissions: ['memory-write', 'external-read'],
        riskClass: 'untrusted-input',
        approvalPolicy: { mode: 'required-for-dangerous', effects: ['memory-write'] },
      },
      'untrusted-input',
    );
    const decision = resolveExtensionPermissions(
      request(
        registration,
        riskEvidence(registration, 'low'),
        policy(['memory-write', 'external-read']),
      ),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.effectiveRisk).toBe('untrusted-input');
      expect(decision.effectivePermissions).toEqual(['external-read']);
    }
  });

  it('denies missing, stale and mismatched risk evidence', () => {
    const registration = activeRegistration();
    expect(resolveExtensionPermissions(request(registration, null)).allowed).toBe(false);
    const stale = sealRuntimeRiskEvidence({
      ...riskEvidence(registration),
      classifiedAt: iso('2026-07-28T11:00:00.000Z'),
      expiresAt: iso('2026-07-28T11:01:00.000Z'),
    });
    const staleDecision = resolveExtensionPermissions(request(registration, stale));
    expect(staleDecision.allowed).toBe(false);
    if (!staleDecision.allowed) expect(staleDecision.code).toBe('STALE_RISK');

    const wrongId = sealRuntimeRiskEvidence({
      ...riskEvidence(registration),
      extensionId: 'other',
    });
    const mismatch = resolveExtensionPermissions(request(registration, wrongId));
    expect(mismatch.allowed).toBe(false);
    if (!mismatch.allowed) expect(mismatch.code).toBe('VERSION_MISMATCH');
  });

  it('uses deny-priority intersection across deployment, role, security and risk', () => {
    const registration = activeRegistration({
      requestedPermissions: ['external-read', 'notifications-send'],
      approvalPolicy: { mode: 'required-for-dangerous', effects: ['notifications-send'] },
    });
    const decision = resolveExtensionPermissions(
      request(registration, riskEvidence(registration), {
        deploymentAllowed: ['external-read', 'notifications-send'],
        roleAllowed: ['external-read', 'notifications-send'],
        securityAllowed: ['external-read'],
        riskAllowed: ['external-read', 'notifications-send'],
      }),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual(['external-read']);
  });

  it('does not let Director role policy bypass Security Guard deny', () => {
    const registration = activeRegistration();
    const decision = resolveExtensionPermissions(
      request(registration, riskEvidence(registration), {
        deploymentAllowed: ['external-read'],
        roleAllowed: ['external-read'],
        securityAllowed: [],
        riskAllowed: ['external-read'],
      }),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual([]);
  });

  it('classifies sealed runtime risk only through trusted observations', () => {
    const registration = activeRegistration({ riskClass: 'low' }, 'low');
    const policy = sealCurrentExtensionPolicySnapshot(
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        policyVersion: registration.policyVersion,
        riskPolicyVersion: 'risk-policy@1',
        deploymentAllowed: ['external-read'],
        roleAllowed: ['external-read'],
        securityAllowed: ['external-read'],
        riskAllowed: ['external-read'],
        deploymentAuthorizationTtlMs: 60_000,
        runtimeEvidenceTtlMs: 60_000,
        voiceEvidenceTtlMs: 60_000,
        issuedAt: '2026-07-28T12:00:00.000Z',
        expiresAt: '2026-07-28T12:30:00.000Z',
      },
      new Date(NOW),
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
      },
    );
    expect(policy).not.toBeNull();
    if (policy === null) return;
    const routing = parseRoutingObservation(
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        sourceTrust: 'owner-stated',
        routingRiskFloor: 'low',
        sourceReference: 'channel-ref',
        channelId: 'channel',
        sessionId: 'session',
        observedAt: '2026-07-28T12:00:00.000Z',
        expiresAt: '2026-07-28T12:30:00.000Z',
      },
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        sourceReference: 'channel-ref',
      },
      new Date(NOW),
    );
    const guard = parseSecurityGuardObservation(
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        securityGuardFloor: 'low',
        denied: false,
        allowedPermissions: ['external-read'],
        observedAt: '2026-07-28T12:00:00.000Z',
        expiresAt: '2026-07-28T12:30:00.000Z',
      },
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
      },
      new Date(NOW),
    );
    expect(routing).not.toBeNull();
    expect(guard).not.toBeNull();
    if (routing === null || guard === null) return;
    const classified = classifyExtensionRuntimeRisk(
      { clock: fixedClock(NOW) },
      registration,
      policy,
      routing,
      guard,
      {
        correlationId: asCorrelation(),
        operationCategory: 'external-effect',
        sourceReference: 'channel-ref',
        operationHints: { externalEffect: true, untrustedContentPresent: false },
      },
      operationContext(),
    );
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.classifiedRisk).toBe('high');
    expect(Object.isFrozen(classified.value)).toBe(true);
  });

  it('rejects model-authored permission and risk changes', () => {
    const registration = activeRegistration();
    const evidence = riskEvidence(registration);
    expect(
      resolveExtensionPermissions({
        ...request(registration, evidence),
        modelRequestedPermissions: ['exec'],
      }).allowed,
    ).toBe(false);
    expect(
      resolveExtensionPermissions({
        ...request(registration, evidence),
        modelRiskOverride: 'low',
      }).allowed,
    ).toBe(false);
  });

  it('does not export risk or activation bypass factories', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'sealRuntimeRiskEvidence',
      'sealActiveExtensionRegistration',
      'sealTrustedActivationDecision',
      'sealDeploymentAuthorization',
      'issueDeploymentAuthorization',
      'toActiveExtensionRegistration',
      'runtimeRiskEvidenceBrand',
      'sealCurrentExtensionPolicySnapshot',
    ])
      expect(names).not.toContain(forbidden);
    expect(names).toContain('createExtensionPermissionGateway');
  });
});
