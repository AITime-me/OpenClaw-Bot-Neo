import { describe, expect, it } from 'vitest';
import { ok } from '../src/core/domain/index.js';
import {
  sealActiveExtensionRegistration,
  sealExtensionRegistryEntry,
} from '../src/core/domain/extension-registry-entry.internal.js';
import { createExtensionPermissionGateway } from '../src/core/application/extension-permission.gateway.js';
import { createExtensionActivationGateway } from '../src/core/application/extension-activation.gateway.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { asCorrelation, fixedClock, iso, operationContext } from './support/fixtures.js';
import * as publicApi from '../src/index.js';

const NOW = '2026-07-28T12:00:10.000Z';

const activeRegistration = () => {
  const result = validateExtensionManifest({
    schemaVersion: '1.0',
    id: 'derivation-test',
    version: '1.0.0',
    kind: 'technical-skill',
    displayName: 'Derivation test',
    description: 'Trusted derivation probe.',
    declaredCapabilities: ['analysis.permission@1'],
    requiredPorts: [],
    requestedPermissions: ['external-read'],
    riskClass: 'high',
    approvalPolicy: { mode: 'none', effects: [] },
    dataClassifications: ['internal'],
    supportedInputKinds: ['text'],
    supportedOutputKinds: ['text'],
    configurationSchemaVersion: '1.0.0',
    enabled: true,
    provenance: { status: 'verified', source: 'trusted-deployment', note: 'Test.' },
    ownerScope: { mode: 'deployment-owner', ownerReference: 'test-owner' },
  });
  if (!result.ok) throw new Error(result.error.code);
  const entry = sealExtensionRegistryEntry({
    extensionId: result.value.id,
    version: result.value.version,
    manifest: result.value,
    activationState: 'active',
    registeredAt: iso(NOW),
    provenance: result.value.provenance,
    policyVersion: 'extension-policy@1',
    effectiveRiskClass: 'high',
    grantedCapabilityRefs: [],
    grantedPermissionRefs: [],
    disabledReason: null,
    pendingReason: null,
  });
  const active = sealActiveExtensionRegistration(entry, 'digest-test');
  if (active === null) throw new Error('active');
  return active;
};

describe('FIN-004 trusted permission gateway', () => {
  it('creates risk decisions from pre-bound observations and rejects caller trust facts', async () => {
    const registration = activeRegistration();
    const gateway = createExtensionPermissionGateway({
      clock: fixedClock(NOW),
      policy: {
        currentPolicy: () =>
          Promise.resolve(
            ok({
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
            }),
          ),
      },
      routing: {
        observe: () =>
          Promise.resolve(
            ok({
              extensionId: registration.extensionId,
              extensionVersion: registration.version,
              correlationId: asCorrelation(),
              sourceTrust: 'untrusted-input',
              routingRiskFloor: 'low',
              sourceReference: 'src',
              channelId: 'ch',
              sessionId: 'sess',
              observedAt: '2026-07-28T12:00:00.000Z',
              expiresAt: '2026-07-28T12:30:00.000Z',
            }),
          ),
      },
      securityGuard: {
        decide: () =>
          Promise.resolve(
            ok({
              extensionId: registration.extensionId,
              extensionVersion: registration.version,
              correlationId: asCorrelation(),
              securityGuardFloor: 'low',
              denied: false,
              allowedPermissions: ['external-read'],
              observedAt: '2026-07-28T12:00:00.000Z',
              expiresAt: '2026-07-28T12:30:00.000Z',
            }),
          ),
      },
    });

    const outcome = await gateway.resolve(
      registration,
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        operationCategory: 'local-read',
        sourceReference: 'src',
      },
      operationContext(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Manifest/registration high + untrusted source keeps untrusted/high max.
    expect(outcome.value.runtimeRiskEvidence.classifiedRisk).toBe('untrusted-input');
    expect(outcome.value.decision.allowed).toBe(true);

    const deniedByGuard = createExtensionPermissionGateway({
      clock: fixedClock(NOW),
      policy: {
        currentPolicy: () =>
          Promise.resolve(
            ok({
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
            }),
          ),
      },
      routing: {
        observe: () =>
          Promise.resolve(
            ok({
              extensionId: registration.extensionId,
              extensionVersion: registration.version,
              correlationId: asCorrelation(),
              sourceTrust: 'owner-stated',
              routingRiskFloor: 'low',
              sourceReference: 'src',
              channelId: 'ch',
              sessionId: 'sess',
              observedAt: '2026-07-28T12:00:00.000Z',
              expiresAt: '2026-07-28T12:30:00.000Z',
            }),
          ),
      },
      securityGuard: {
        decide: () =>
          Promise.resolve(
            ok({
              extensionId: registration.extensionId,
              extensionVersion: registration.version,
              correlationId: asCorrelation(),
              securityGuardFloor: 'low',
              denied: true,
              allowedPermissions: [],
              observedAt: '2026-07-28T12:00:00.000Z',
              expiresAt: '2026-07-28T12:30:00.000Z',
            }),
          ),
      },
    });
    const blocked = await deniedByGuard.resolve(
      registration,
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        operationCategory: 'local-read',
        sourceReference: 'src',
      },
      operationContext(),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('SECURITY_DENIED');
  });

  it('rejects accessor/malformed policy observations', async () => {
    const registration = activeRegistration();
    const gateway = createExtensionPermissionGateway({
      clock: fixedClock(NOW),
      policy: {
        currentPolicy: () => {
          const value: Record<string, unknown> = {};
          Object.defineProperty(value, 'extensionId', {
            enumerable: true,
            get: () => registration.extensionId,
          });
          return Promise.resolve(ok(value as never));
        },
      },
      routing: {
        observe: () => Promise.resolve(ok({} as never)),
      },
      securityGuard: {
        decide: () => Promise.resolve(ok({} as never)),
      },
    });
    const result = await gateway.resolve(
      registration,
      {
        extensionId: registration.extensionId,
        extensionVersion: registration.version,
        correlationId: asCorrelation(),
        operationCategory: 'local-read',
        sourceReference: 'src',
      },
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_OBSERVATION');
  });
});

describe('FIN-005 activation gateway public surface', () => {
  it('does not expose caller-string deployment issuer', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('issueDeploymentAuthorization');
    expect(names).toContain('createExtensionActivationGateway');
    expect(typeof createExtensionActivationGateway).toBe('function');
  });
});

describe('FIN-006 voice gateway public surface', () => {
  it('keeps provider evidence sealer private', () => {
    const names = Object.keys(publicApi);
    expect(names).toContain('createVoiceResolutionGateway');
    expect(names).not.toContain('sealVerifiedVoiceProviderMatch');
  });
});
