import { describe, expect, it } from 'vitest';
import type {
  ExtensionManifest,
  ExtensionPermission,
  ExtensionPermissionPolicy,
  VerifiedExtensionManifest,
} from '../src/core/domain/index.js';
import { resolveExtensionPermissions } from '../src/core/policy/extension-permissions.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';

const verified = (overrides: Partial<ExtensionManifest> = {}): VerifiedExtensionManifest => {
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

const policy = (allowed: readonly ExtensionPermission[]): ExtensionPermissionPolicy => ({
  deploymentAllowed: allowed,
  roleAllowed: allowed,
  securityAllowed: allowed,
  riskAllowed: allowed,
});

describe('extension permission resolution', () => {
  it('defaults to deny without a registered manifest', () => {
    const decision = resolveExtensionPermissions({
      manifest: null,
      registered: false,
      operationRisk: 'low',
      policy: policy([]),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('UNKNOWN_EXTENSION');
  });

  it('denies a disabled extension', () => {
    const decision = resolveExtensionPermissions({
      manifest: verified({ enabled: false }),
      registered: true,
      operationRisk: 'low',
      policy: policy(['external-read']),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('DISABLED_EXTENSION');
  });

  it('denies an unknown permission at runtime', () => {
    const unknown = 'root-access' as ExtensionPermission;
    const decision = resolveExtensionPermissions({
      manifest: verified(),
      registered: true,
      operationRisk: 'low',
      policy: policy([unknown]),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('UNKNOWN_PERMISSION');
  });

  it('uses deny-priority intersection across deployment, role, security and risk', () => {
    const manifest = verified({
      requestedPermissions: ['external-read', 'notifications-send'],
    });
    const decision = resolveExtensionPermissions({
      manifest,
      registered: true,
      operationRisk: 'medium',
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
      manifest: verified(),
      registered: true,
      operationRisk: 'medium',
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

  it('removes dangerous permissions for untrusted input', () => {
    const manifest = verified({
      requestedPermissions: ['memory-write', 'external-read'],
      approvalPolicy: { mode: 'required-for-dangerous', effects: ['write'] },
    });
    const decision = resolveExtensionPermissions({
      manifest,
      registered: true,
      operationRisk: 'untrusted-input',
      policy: policy(['memory-write', 'external-read']),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).toEqual(['external-read']);
  });

  it('requires explicit deployment grant for dangerous permissions', () => {
    const manifest = verified({
      requestedPermissions: ['integration-write'],
      approvalPolicy: { mode: 'required-for-dangerous', effects: ['write'] },
    });
    const decision = resolveExtensionPermissions({
      manifest,
      registered: true,
      operationRisk: 'high',
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

  it('does not give an integration memory access automatically', () => {
    const integration = verified({
      kind: 'integration',
      requestedPermissions: ['external-read'],
    });
    const decision = resolveExtensionPermissions({
      manifest: integration,
      registered: true,
      operationRisk: 'medium',
      policy: policy(['external-read', 'memory-read']),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).not.toContain('memory-read');
  });

  it.each([
    ['channel', 'memory-read'],
    ['technical-skill', 'exec'],
    ['business-skill', 'secrets-read'],
  ] as const)('does not grant %s the undeclared %s permission', (kind, undeclared) => {
    const extension = verified({ kind, requestedPermissions: ['external-read'] });
    const decision = resolveExtensionPermissions({
      manifest: extension,
      registered: true,
      operationRisk: 'medium',
      policy: policy(['external-read', undeclared]),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.effectivePermissions).not.toContain(undeclared);
  });

  it('rejects model-authored permission changes', () => {
    const decision = resolveExtensionPermissions({
      manifest: verified(),
      registered: true,
      operationRisk: 'low',
      policy: policy(['external-read']),
      modelRequestedPermissions: ['exec'],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('MODEL_PERMISSION_OVERRIDE');
  });
});
