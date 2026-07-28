import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/core/domain/index.js';
import { executeExtensionRegistration } from '../src/core/application/index.js';
import type { ExtensionRegistryPort } from '../src/core/ports/index.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { operationContext } from './support/fixtures.js';

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

const registry = (conflict: boolean): ExtensionRegistryPort => ({
  register: () => Promise.resolve(ok(undefined)),
  get: () => Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
  listEnabled: () => Promise.resolve(ok([])),
  hasConflict: () => Promise.resolve(ok(conflict)),
  getDeclaredCapabilities: () => Promise.resolve(ok([])),
  getRequestedPermissions: () => Promise.resolve(ok([])),
});

describe('trusted registration flow', () => {
  it('detects duplicate ID and version before registration', async () => {
    const result = await executeExtensionRegistration(
      { registry: registry(true) },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_ID_VERSION');
  });

  it('registers but never activates a disabled manifest', async () => {
    const result = await executeExtensionRegistration(
      { registry: registry(false) },
      manifest({ enabled: false }),
      operationContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activation).toBe('disabled');
  });

  it('leaves an enabled manifest pending policy instead of activating it', async () => {
    const result = await executeExtensionRegistration(
      { registry: registry(false) },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activation).toBe('pending-policy');
  });

  it('fails safely when the registry is unavailable', async () => {
    const unavailable: ExtensionRegistryPort = {
      ...registry(false),
      hasConflict: () => Promise.resolve(err({ code: 'NOT_CONFIGURED', component: 'registry' })),
    };
    const result = await executeExtensionRegistration(
      { registry: unavailable },
      manifest(),
      operationContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REGISTRY_UNAVAILABLE');
  });
});
