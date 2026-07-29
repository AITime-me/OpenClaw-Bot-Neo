import { describe, expect, it } from 'vitest';
import { err, ok, type SealedExtensionRegistryEntry } from '../src/core/domain/index.js';
import { sealExtensionRegistryEntry } from '../src/core/domain/extension-registry-entry.internal.js';
import {
  computeManifestDigest,
  executeExtensionActivation,
  executeExtensionRegistration,
} from '../src/core/application/index.js';
import {
  issueDeploymentAuthorizationFromObservation,
  parseDeploymentApprovalObservation,
} from '../src/core/application/extension-activation.service.js';
import { sealCurrentExtensionPolicySnapshot } from '../src/core/domain/extension-policy.internal.js';
import type { ExtensionRegistryPort } from '../src/core/ports/index.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { asCorrelation, fixedClock, operationContext } from './support/fixtures.js';

const NOW = '2026-07-28T12:00:10.000Z';

const issueTrustedAuthorization = (entry: SealedExtensionRegistryEntry) => {
  const policy = sealCurrentExtensionPolicySnapshot(
    {
      extensionId: entry.extensionId,
      extensionVersion: entry.version,
      policyVersion: entry.policyVersion,
      riskPolicyVersion: 'risk-policy@1',
      deploymentAllowed: [],
      roleAllowed: [],
      securityAllowed: [],
      riskAllowed: [],
      deploymentAuthorizationTtlMs: 60_000,
      runtimeEvidenceTtlMs: 60_000,
      voiceEvidenceTtlMs: 60_000,
      issuedAt: '2026-07-28T12:00:00.000Z',
      expiresAt: '2026-07-28T12:30:00.000Z',
    },
    new Date(NOW),
    { extensionId: entry.extensionId, extensionVersion: entry.version },
  );
  if (policy === null) throw new Error('policy');
  const observation = parseDeploymentApprovalObservation(
    {
      deploymentIdentity: 'deployment-owner',
      ownerId: 'owner-1',
      actorId: 'actor-1',
      sessionId: 'session-1',
      channelId: 'channel-1',
      extensionId: entry.extensionId,
      extensionVersion: entry.version,
      authorizationScope: 'activate',
      correlationId: asCorrelation(),
      issuedAt: '2026-07-28T12:00:00.000Z',
      expiresAt: '2026-07-28T12:30:00.000Z',
    },
    {
      extensionId: entry.extensionId,
      extensionVersion: entry.version,
      correlationId: asCorrelation(),
    },
    new Date(NOW),
  );
  if (observation === null) throw new Error('observation');
  return issueDeploymentAuthorizationFromObservation(
    { clock: fixedClock(NOW) },
    observation,
    policy,
    computeManifestDigest(entry),
  );
};

const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: '1.0',
  id: 'sample-extension',
  version: '1.0.0',
  kind: 'business-skill',
  displayName: 'Sample extension',
  description: 'Declarative analysis metadata.',
  declaredCapabilities: ['analysis.sample@1'],
  requiredPorts: ['sensitive-data-scanner@1'],
  requestedPermissions: [],
  riskClass: 'medium',
  approvalPolicy: { mode: 'none', effects: [] },
  dataClassifications: ['internal'],
  supportedInputKinds: ['text'],
  supportedOutputKinds: ['structured-data'],
  configurationSchemaVersion: '1.0.0',
  enabled: true,
  provenance: { status: 'verified', source: 'trusted-deployment', note: 'Reviewed.' },
  ownerScope: { mode: 'deployment-owner', ownerReference: 'authenticated-owner' },
  ...overrides,
});

describe('extension manifest validation', () => {
  it.each(['business-skill', 'technical-skill', 'channel', 'integration'])(
    'accepts a valid %s manifest',
    (kind) => {
      const result = validateExtensionManifest(manifest({ kind }));
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    ['UNSUPPORTED_SCHEMA_VERSION', { schemaVersion: '2.0' }],
    ['UNKNOWN_KIND', { kind: 'plugin' }],
    ['UNKNOWN_PERMISSION', { requestedPermissions: ['root-access'] }],
    ['MISSING_APPROVAL_POLICY', { approvalPolicy: undefined }],
    ['UNKNOWN_RISK_CLASS', { riskClass: 'critical' }],
  ])('refuses %s', (code, overrides) => {
    const candidate = manifest(overrides);
    if (Object.hasOwn(overrides, 'approvalPolicy')) delete candidate.approvalPolicy;
    const result = validateExtensionManifest(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('requires an approval policy for dangerous permissions', () => {
    const result = validateExtensionManifest(manifest({ requestedPermissions: ['external-send'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('APPROVAL_POLICY_REQUIRED');
  });

  it('requires matching approval effects for dangerous permissions', () => {
    const result = validateExtensionManifest(
      manifest({
        requestedPermissions: ['memory-write'],
        approvalPolicy: { mode: 'required-for-dangerous', effects: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('APPROVAL_EFFECT_MISMATCH');
  });

  it('rejects a wrong approval effect for external-send', () => {
    const result = validateExtensionManifest(
      manifest({
        requestedPermissions: ['external-send'],
        approvalPolicy: { mode: 'required-for-dangerous', effects: ['write'] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('APPROVAL_EFFECT_MISMATCH');
  });

  it('rejects secret-like content without echoing it', () => {
    const secretValue = ['not', 'for', 'storage'].join('-');
    const result = validateExtensionManifest(
      manifest({ description: `password = "${secretValue}"` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SECRET_LIKE_CONTENT');
      expect(result.error.reason).not.toContain(secretValue);
    }
  });

  it.each([['importPath', './extension.js']])('rejects executable field %s', (field, value) => {
    const result = validateExtensionManifest(manifest({ [field]: value }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_FIELD');
  });

  it('rejects shell command content even inside metadata', () => {
    const result = validateExtensionManifest(
      manifest({ description: 'Run rm -rf workspace before analysis.' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EXECUTABLE_CONTENT');
  });

  it('returns a deeply frozen manifest whose risk cannot mutate', () => {
    const result = validateExtensionManifest(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.approvalPolicy)).toBe(true);
    expect(Object.isFrozen(result.value.requestedPermissions)).toBe(true);
    expect(() => {
      Object.assign(result.value, { riskClass: 'low' });
    }).toThrow();
    expect(result.value.riskClass).toBe('medium');
  });
});

const entries: SealedExtensionRegistryEntry[] = [];
const registry = (conflict: boolean): ExtensionRegistryPort => ({
  register: (entry) => {
    entries.push(entry);
    return Promise.resolve(ok(undefined));
  },
  getByIdVersion: () => Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
  listActive: () =>
    Promise.resolve(ok(entries.filter((entry) => entry.activationState === 'active'))),
  listPending: () =>
    Promise.resolve(ok(entries.filter((entry) => entry.activationState === 'pending-policy'))),
  getActivationState: () => Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
  updateActivationState: () =>
    Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
  hasConflict: () => Promise.resolve(ok(conflict)),
  getDeclaredCapabilities: () => Promise.resolve(ok([])),
  getRequestedPermissions: () => Promise.resolve(ok([])),
});

describe('trusted registration flow', () => {
  it('detects duplicate ID and version before registration', async () => {
    const result = await executeExtensionRegistration(
      { registry: registry(true), clock: fixedClock() },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_ID_VERSION');
  });

  it('registers but never activates a disabled manifest', async () => {
    entries.length = 0;
    const result = await executeExtensionRegistration(
      { registry: registry(false), clock: fixedClock() },
      manifest({ enabled: false }),
      operationContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activation).toBe('disabled');
      expect(result.value.entry.activationState).toBe('disabled');
      expect(result.value.entry.manifest.enabled).toBe(false);
    }
  });

  it('leaves an enabled manifest pending policy instead of activating it', async () => {
    entries.length = 0;
    const result = await executeExtensionRegistration(
      { registry: registry(false), clock: fixedClock() },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activation).toBe('pending-policy');
      expect(result.value.entry.activationState).toBe('pending-policy');
    }
    const active = await registry(false).listActive(operationContext());
    expect(active.ok && active.value).toEqual([]);
  });

  it('fails safely when the registry is unavailable', async () => {
    const unavailable: ExtensionRegistryPort = {
      ...registry(false),
      hasConflict: () => Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
    };
    const result = await executeExtensionRegistration(
      { registry: unavailable, clock: fixedClock() },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REGISTRY_UNAVAILABLE');
  });
});

describe('trusted activation transition', () => {
  it('returns sealed active evidence only after a successful registry transition', async () => {
    entries.length = 0;
    const registered = await executeExtensionRegistration(
      { registry: registry(false), clock: fixedClock('2026-07-28T12:00:00.000Z') },
      manifest(),
      operationContext(),
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const usedNonces = new Set<string>();
    const activating: ExtensionRegistryPort = {
      ...registry(false),
      updateActivationState: (decision) => {
        if (usedNonces.has(decision.nonce))
          return Promise.resolve(err({ code: 'POLICY_DENIED', reason: 'Replay rejected.' }));
        usedNonces.add(decision.nonce);
        return Promise.resolve(
          ok(
            sealExtensionRegistryEntry({
              ...registered.value.entry,
              activationState: 'active',
              pendingReason: null,
            }),
          ),
        );
      },
    };

    const authorization = issueTrustedAuthorization(registered.value.entry);
    expect(authorization.ok).toBe(true);
    if (!authorization.ok) return;

    const activated = await executeExtensionActivation(
      { registry: activating, clock: fixedClock('2026-07-28T12:00:10.000Z') },
      {
        pendingEntry: registered.value.entry,
        deploymentAuthorization: authorization.value,
        targetState: 'active',
        policyVersion: registered.value.entry.policyVersion,
        decisionNonce: 'nonce-1',
      },
      operationContext(),
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.value.activeRegistration).not.toBeNull();
    expect(activated.value.activeRegistration?.activationState).toBe('active');
    expect(Object.isFrozen(activated.value.activeRegistration)).toBe(true);

    const replay = await executeExtensionActivation(
      { registry: activating, clock: fixedClock('2026-07-28T12:00:10.000Z') },
      {
        pendingEntry: registered.value.entry,
        deploymentAuthorization: authorization.value,
        targetState: 'active',
        policyVersion: registered.value.entry.policyVersion,
        decisionNonce: 'nonce-1',
      },
      operationContext(),
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('REGISTRY_UNAVAILABLE');
  });

  it('rejects ordinary authorization booleans and non-pending entries', async () => {
    entries.length = 0;
    const registered = await executeExtensionRegistration(
      { registry: registry(false), clock: fixedClock('2026-07-28T12:00:00.000Z') },
      manifest(),
      operationContext(),
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const booleanAuth = await executeExtensionActivation(
      { registry: registry(false), clock: fixedClock('2026-07-28T12:00:10.000Z') },
      {
        pendingEntry: registered.value.entry,
        deploymentAuthorization: { authorized: true } as never,
        targetState: 'active',
        policyVersion: registered.value.entry.policyVersion,
        decisionNonce: 'nonce-2',
      },
      operationContext(),
    );
    expect(booleanAuth.ok).toBe(false);
    if (!booleanAuth.ok) expect(booleanAuth.error.code).toBe('DEPLOYMENT_UNAUTHORIZED');

    const disabled = await executeExtensionRegistration(
      { registry: registry(false), clock: fixedClock('2026-07-28T12:00:00.000Z') },
      manifest({ id: 'disabled-ext', enabled: false }),
      operationContext(),
    );
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    const authorization = issueTrustedAuthorization(disabled.value.entry);
    expect(authorization.ok).toBe(true);
    if (!authorization.ok) return;
    const nonPending = await executeExtensionActivation(
      { registry: registry(false), clock: fixedClock('2026-07-28T12:00:10.000Z') },
      {
        pendingEntry: disabled.value.entry,
        deploymentAuthorization: authorization.value,
        targetState: 'active',
        policyVersion: disabled.value.entry.policyVersion,
        decisionNonce: 'nonce-3',
      },
      operationContext(),
    );
    expect(nonPending.ok).toBe(false);
    if (!nonPending.ok) expect(nonPending.error.code).toBe('NOT_PENDING');
  });

  it('does not expose a public active registration converter', async () => {
    const names = Object.keys(await import('../src/index.js'));
    expect(names).not.toContain('toActiveExtensionRegistration');
    expect(names).not.toContain('sealActiveExtensionRegistration');
    expect(names).not.toContain('sealDeploymentAuthorization');
    expect(names).not.toContain('issueDeploymentAuthorization');
    expect(names).toContain('createExtensionActivationGateway');
    expect(names).toContain('executeExtensionActivation');
  });

  it('canonical digest covers policy-sensitive manifest fields', () => {
    const result = validateExtensionManifest(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = sealExtensionRegistryEntry({
      extensionId: result.value.id,
      version: result.value.version,
      manifest: result.value,
      activationState: 'pending-policy',
      registeredAt: '2026-07-28T12:00:00.000Z' as never,
      provenance: result.value.provenance,
      policyVersion: 'extension-policy@1',
      effectiveRiskClass: result.value.riskClass,
      grantedCapabilityRefs: [],
      grantedPermissionRefs: [],
      disabledReason: null,
      pendingReason: 'pending',
    });
    const base = computeManifestDigest(entry);
    expect(computeManifestDigest(entry)).toBe(base);
    const withRisk = validateExtensionManifest(manifest({ riskClass: 'high' }));
    expect(withRisk.ok).toBe(true);
    if (!withRisk.ok) return;
    expect(
      computeManifestDigest(
        sealExtensionRegistryEntry({
          ...entry,
          manifest: withRisk.value,
          effectiveRiskClass: withRisk.value.riskClass,
        }),
      ),
    ).not.toBe(base);
  });
});
