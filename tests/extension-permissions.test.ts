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
import { resolveExtensionPermissions } from '../src/core/policy/extension-permissions.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import * as publicApi from '../src/index.js';

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

const activeRegistration = (
  overrides: Partial<ExtensionManifest> = {},
  activationState: SealedExtensionRegistryEntry['activationState'] = 'active',
) => {
  const manifest = verified(overrides);
  const entry = sealExtensionRegistryEntry({
    extensionId: manifest.id,
    version: manifest.version,
    manifest,
    activationState,
    registeredAt: '2026-07-28T12:00:00.000Z' as never,
    provenance: manifest.provenance,
    policyVersion: 'extension-policy@1',
    effectiveRiskClass: manifest.riskClass,
    grantedCapabilityRefs: [],
    grantedPermissionRefs: [],
    disabledReason: activationState === 'disabled' ? 'disabled' : null,
    pendingReason: activationState === 'pending-policy' ? 'pending' : null,
  });
  return sealActiveExtensionRegistration(entry);
};

const policy = (allowed: readonly ExtensionPermission[]): ExtensionPermissionPolicy => ({
  deploymentAllowed: allowed,
  roleAllowed: allowed,
  securityAllowed: allowed,
  riskAllowed: allowed,
});

describe('effective extension risk', () => {
  it('keeps the stricter of manifest and runtime risk', () => {
    expect(resolveEffectiveExtensionRisk('untrusted-input', 'low')).toEqual({
      ok: true,
      risk: 'untrusted-input',
    });
    expect(resolveEffectiveExtensionRisk('high', 'low')).toEqual({ ok: true, risk: 'high' });
    expect(resolveEffectiveExtensionRisk('low', 'high')).toEqual({ ok: true, risk: 'high' });
  });

  it('denies unknown or missing risk values', () => {
    expect(resolveEffectiveExtensionRisk('unknown', 'low').ok).toBe(false);
    expect(resolveEffectiveExtensionRisk('low', 'unknown').ok).toBe(false);
    expect(resolveEffectiveExtensionRisk('low', null).ok).toBe(false);
  });
});

describe('extension permission resolution', () => {
  it('defaults to deny without sealed active registration', () => {
    const decision = resolveExtensionPermissions({
      registration: null,
      runtimeRisk: 'low',
      policy: policy([]),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_ACTIVE');
  });

  it('denies pending-policy registration even if caller claims activity', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration({}, 'pending-policy'),
      runtimeRisk: 'low',
      policy: policy(['external-read']),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_ACTIVE');
  });

  it('denies disabled and rejected registrations', () => {
    for (const state of ['disabled', 'rejected'] as const) {
      const decision = resolveExtensionPermissions({
        registration: activeRegistration({ enabled: state === 'disabled' ? false : true }, state),
        runtimeRisk: 'low',
        policy: policy(['external-read']),
      });
      expect(decision.allowed).toBe(false);
    }
  });

  it('does not let runtime low lower an untrusted manifest risk', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration({
        requestedPermissions: ['memory-write', 'external-read'],
        riskClass: 'untrusted-input',
        approvalPolicy: { mode: 'required-for-dangerous', effects: ['memory-write'] },
      }),
      runtimeRisk: 'low',
      policy: policy(['memory-write', 'external-read']),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.effectiveRisk).toBe('untrusted-input');
      expect(decision.effectivePermissions).toEqual(['external-read']);
    }
  });

  it('denies missing runtime risk', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration(),
      runtimeRisk: null,
      policy: policy(['external-read']),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('MISSING_RISK');
  });

  it('uses deny-priority intersection across deployment, role, security and risk', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration({
        requestedPermissions: ['external-read', 'notifications-send'],
        approvalPolicy: {
          mode: 'required-for-dangerous',
          effects: ['notifications-send'],
        },
      }),
      runtimeRisk: 'medium',
      policy: {
        deploymentAllowed: ['external-read', 'notifications-send'],
        roleAllowed: ['external-read', 'notifications-send'],
        securityAllowed: ['external-read'],
        riskAllowed: ['external-read', 'notifications-send'],
      },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual(['external-read']);
  });

  it('does not let Director role policy bypass Security Guard deny', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration(),
      runtimeRisk: 'medium',
      policy: {
        deploymentAllowed: ['external-read'],
        roleAllowed: ['external-read'],
        securityAllowed: [],
        riskAllowed: ['external-read'],
      },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual([]);
  });

  it('requires matching approval effects for dangerous permissions at validation time', () => {
    const candidate = {
      schemaVersion: '1.0',
      id: 'effect-test',
      version: '1.0.0',
      kind: 'technical-skill',
      displayName: 'Effect test',
      description: 'Safe deterministic test metadata.',
      declaredCapabilities: ['analysis.effect@1'],
      requiredPorts: [],
      requestedPermissions: ['external-send'],
      riskClass: 'high',
      approvalPolicy: { mode: 'required-for-dangerous', effects: ['write'] },
      dataClassifications: ['internal'],
      supportedInputKinds: ['text'],
      supportedOutputKinds: ['text'],
      configurationSchemaVersion: '1.0.0',
      enabled: true,
      provenance: { status: 'verified', source: 'trusted-deployment', note: 'Test.' },
      ownerScope: { mode: 'deployment-owner', ownerReference: 'test-owner' },
    };
    const validation = validateExtensionManifest(candidate);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.error.code).toBe('APPROVAL_EFFECT_MISMATCH');
  });

  it.each([
    ['memory-write', 'memory-write'],
    ['integration-write', 'integration-write'],
    ['exec', 'exec'],
    ['schedule-write', 'schedule-write'],
    ['notifications-send', 'notifications-send'],
    ['secrets-read', 'secrets-read'],
    ['external-send', 'external-send'],
  ] as const)('accepts %s only with matching %s effect', (permission, effect) => {
    const registration = activeRegistration({
      requestedPermissions: [permission],
      approvalPolicy: { mode: 'required-for-dangerous', effects: [effect] },
      riskClass: 'high',
    });
    const decision = resolveExtensionPermissions({
      registration,
      runtimeRisk: 'high',
      policy: policy([permission]),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual([permission]);
  });

  it('requires explicit deployment grant for dangerous permissions', () => {
    const decision = resolveExtensionPermissions({
      registration: activeRegistration({
        requestedPermissions: ['integration-write'],
        approvalPolicy: { mode: 'required-for-dangerous', effects: ['integration-write'] },
      }),
      runtimeRisk: 'high',
      policy: {
        deploymentAllowed: [],
        roleAllowed: ['integration-write'],
        securityAllowed: ['integration-write'],
        riskAllowed: ['integration-write'],
      },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('DANGEROUS_PERMISSION_NOT_GRANTED');
  });

  it('rejects model-authored permission and risk changes', () => {
    expect(
      resolveExtensionPermissions({
        registration: activeRegistration(),
        runtimeRisk: 'low',
        policy: policy(['external-read']),
        modelRequestedPermissions: ['exec'],
      }).allowed,
    ).toBe(false);
    expect(
      resolveExtensionPermissions({
        registration: activeRegistration(),
        runtimeRisk: 'low',
        policy: policy(['external-read']),
        modelRiskOverride: 'low',
      }).allowed,
    ).toBe(false);
  });

  it('does not export registry or risk bypass factories', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'sealExtensionRegistryEntry',
      'sealActiveExtensionRegistration',
      'sealTrustedActivationDecision',
      'sealAuthorizedWebhookIngress',
      'sealRawWebhookPayloadHandle',
    ])
      expect(names).not.toContain(forbidden);
  });
});
