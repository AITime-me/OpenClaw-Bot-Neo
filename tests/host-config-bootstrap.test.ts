import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createExplicitAllowMemoryPolicy,
  createLocalHostFromConfig,
  parseLocalHostConfig,
} from '../src/host/index.js';
import {
  accessContext,
  asRecordId,
  authenticatedAccess,
  fixedClock,
  writeCommand,
} from './support/fixtures.js';

const modelRouting = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    modelIdentifiersConfirmed: false,
    defaultProviderMode: 'subscription-oauth-only',
    apiFallbackEnabled: false,
    paidFallbackEnabled: false,
    routes: Object.freeze([
      Object.freeze({
        risk: 'low',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-low-risk',
        approval: 'policy-dependent',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'medium',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-restricted-tools',
        approval: 'required-for-external-or-write',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'high',
        capabilityTier: 'validated-high-assurance-tier',
        toolProfile: 'high-risk-no-elevated-tools',
        approval: 'owner-required',
        fallbackToWeakerTier: false,
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'untrusted-input',
        capabilityTier: 'validated-untrusted-content-tier',
        toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
        approval: 'owner-required-for-any-tool-expansion',
        onUnavailable: 'fail-closed',
      }),
    ]),
    onUnavailable: 'fail-closed',
  });

const memoryNamespaces = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultAccess: 'deny',
    namespaces: Object.freeze([
      'tvoe-vremya',
      'ai-my-time',
      'personal',
      'shared-public',
      'security-restricted',
    ]),
    activeNamespaceRequired: true,
    crossNamespaceAccess: false,
    crossProjectAccessRequiresOwnerApproval: true,
    securityRestrictedIsolated: true,
    personalIsolatedFromProjects: true,
    requiredMetadata: Object.freeze([
      'source',
      'observedAt',
      'confidence',
      'classification',
      'retentionClass',
    ]),
    embedding: Object.freeze({ mode: 'none', externalProviderEnabled: false }),
  });

const memoryClassification = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultClassification: 'security-restricted',
    classes: Object.freeze({
      public: Object.freeze({ externalProcessingAllowed: 'policy-dependent' }),
      internal: Object.freeze({ externalProcessingAllowed: false }),
      confidential: Object.freeze({ externalProcessingAllowed: false }),
      'commercial-secret': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
      'security-restricted': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
    }),
    sensitiveDataScan: Object.freeze({ required: true, failureEffect: 'deny' }),
  });

const securityPolicy = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultEffect: 'deny',
    readOnlyFirst: true,
    paymentActionsAllowed: false,
    externalWritesAllowed: false,
    ownerApproval: Object.freeze({
      required: true,
      bindToTargetAndPayload: true,
      expires: true,
      replayAllowed: false,
    }),
    sensitiveDataScanner: Object.freeze({
      requiredBeforeAllSinks: true,
      deterministic: true,
      failureEffect: 'deny',
    }),
    reverseTrustAllowed: false,
  });

const validEnvelope = () => ({
  modelRouting: modelRouting(),
  memoryNamespaces: memoryNamespaces(),
  memoryClassification: memoryClassification(),
  securityPolicy: securityPolicy(),
});

const listHostConfigSources = (root = 'src/host/config'): string[] => {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const name of entries) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...listHostConfigSources(path));
    else if (name.endsWith('.ts')) files.push(path.replaceAll('\\', '/'));
  }
  return files;
};

describe('parseLocalHostConfig', () => {
  it('parses a valid four-section envelope into a deep frozen snapshot', () => {
    const input = validEnvelope();
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = result.value;
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.modelRouting)).toBe(true);
    expect(Object.isFrozen(config.memoryNamespaces)).toBe(true);
    expect(Object.isFrozen(config.memoryClassification)).toBe(true);
    expect(Object.isFrozen(config.securityPolicy)).toBe(true);
    expect(Object.isFrozen(config.diagnostics)).toBe(true);
    expect(Object.isFrozen(config.modelRouting.routes)).toBe(true);
    expect(Object.isFrozen(config.modelRouting.routes[0])).toBe(true);
    expect(Object.isFrozen(config.memoryNamespaces.namespaces)).toBe(true);
    expect(Object.isFrozen(config.memoryClassification.classes)).toBe(true);
    expect(Object.isFrozen(config.memoryClassification.classes.public)).toBe(true);
    expect(Object.isFrozen(config.securityPolicy.ownerApproval)).toBe(true);
    expect(Object.isFrozen(config.diagnostics.validatedFamilies)).toBe(true);
    expect(config.diagnostics).toEqual({
      sourceKind: 'parsed-object',
      localOnly: true,
      validatedFamilies: [
        'model-routing',
        'memory-namespaces',
        'memory-classification',
        'security-policy',
      ],
      credentialsLoaded: false,
      providersActivated: false,
      externalCompatibilityVerified: false,
      fileSystemAccess: 'none',
      environmentAccess: 'none',
      networkClients: 'none',
      apiFallbackEnabled: false,
      paidFallbackEnabled: false,
      deploymentReady: false,
    });
    expect(config.modelRouting.modelIdentifiersConfirmed).toBe(false);
    expect(config.modelRouting.apiFallbackEnabled).toBe(false);

    expect(() => {
      (config as { extra?: string }).extra = 'nope';
    }).toThrow();
    expect(() => {
      (config.modelRouting as { apiFallbackEnabled: boolean }).apiFallbackEnabled = true;
    }).toThrow();
    expect(() => {
      (config.modelRouting.routes as { length: number }).length = 0;
    }).toThrow();
    expect(config.modelRouting.apiFallbackEnabled).toBe(false);
    expect(config.modelRouting.routes).toHaveLength(4);
  });

  it('isolates results from later top-level and nested input mutation', () => {
    const nestedRoutes = [
      {
        risk: 'low',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-low-risk',
        approval: 'policy-dependent',
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'medium',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-restricted-tools',
        approval: 'required-for-external-or-write',
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'high',
        capabilityTier: 'validated-high-assurance-tier',
        toolProfile: 'high-risk-no-elevated-tools',
        approval: 'owner-required',
        fallbackToWeakerTier: false,
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'untrusted-input',
        capabilityTier: 'validated-untrusted-content-tier',
        toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
        approval: 'owner-required-for-any-tool-expansion',
        onUnavailable: 'fail-closed',
      },
    ];
    const routing = {
      status: 'draft',
      schemaVersion: '1.0',
      modelIdentifiersConfirmed: false,
      defaultProviderMode: 'subscription-oauth-only',
      apiFallbackEnabled: false,
      paidFallbackEnabled: false,
      routes: nestedRoutes,
      onUnavailable: 'fail-closed',
    };
    const input: Record<string, unknown> = {
      modelRouting: routing,
      memoryNamespaces: memoryNamespaces(),
      memoryClassification: memoryClassification(),
      securityPolicy: securityPolicy(),
    };
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input['openclaw'] = { secret: 'should-not-matter' };
    (routing as { apiFallbackEnabled: boolean }).apiFallbackEnabled = true;
    const firstRoute = nestedRoutes[0];
    if (firstRoute !== undefined) (firstRoute as { risk: string }).risk = 'high';
    expect(result.value.modelRouting.apiFallbackEnabled).toBe(false);
    expect(result.value.modelRouting.routes[0]?.risk).toBe('low');
  });

  it('returns independent snapshots for two parse calls', () => {
    const first = parseLocalHostConfig(validEnvelope());
    const second = parseLocalHostConfig(validEnvelope());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).not.toBe(second.value);
    expect(first.value.modelRouting).not.toBe(second.value.modelRouting);
    expect(first.value.memoryNamespaces).not.toBe(second.value.memoryNamespaces);
    expect(first.value.memoryClassification).not.toBe(second.value.memoryClassification);
    expect(first.value.securityPolicy).not.toBe(second.value.securityPolicy);
    expect(first.value.modelRouting.routes).not.toBe(second.value.modelRouting.routes);
  });

  it.each([
    ['modelRouting'],
    ['memoryNamespaces'],
    ['memoryClassification'],
    ['securityPolicy'],
  ] as const)('denies missing %s', (missing) => {
    const base = validEnvelope();
    const input: Record<string, unknown> = {
      modelRouting: base.modelRouting,
      memoryNamespaces: base.memoryNamespaces,
      memoryClassification: base.memoryClassification,
      securityPolicy: base.securityPolicy,
    };
    Reflect.deleteProperty(input, missing);
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_CONFIG_SECTION');
    expect(result.error.field).toBe(missing);
  });

  it('denies unknown top-level fields including draft/OpenClaw/voice sections', () => {
    const input = { ...validEnvelope(), openclaw: { status: 'draft' } };
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN_CONFIG_FIELD');
    expect(result.error.field).toBe('openclaw');
  });

  it.each([[null], [[]], ['string'], [42], [true]])('denies non-object container %p', (value) => {
    const result = parseLocalHostConfig(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_CONFIG_CONTAINER');
  });

  it('denies class instances and custom prototypes', () => {
    class ConfigBag {
      readonly marker = true;
    }
    const custom = {};
    Object.assign(custom, validEnvelope());
    Object.setPrototypeOf(custom, { polluted: true });
    expect(parseLocalHostConfig(new ConfigBag()).ok).toBe(false);
    expect(parseLocalHostConfig(custom).ok).toBe(false);
  });

  it('does not invoke getters on the envelope', () => {
    let getterCalls = 0;
    const input = validEnvelope() as Record<string, unknown>;
    Object.defineProperty(input, 'modelRouting', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter-must-not-run');
      },
    });
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_CONFIG_INPUT');
    expect(getterCalls).toBe(0);
  });

  it('does not invoke nested section getters before fail-closed', () => {
    let getterCalls = 0;
    const routing: Record<string, unknown> = { ...modelRouting() };
    Object.defineProperty(routing, 'status', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('nested-getter-must-not-run');
      },
    });
    const result = parseLocalHostConfig({
      ...validEnvelope(),
      modelRouting: routing,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSAFE_CONFIG_INPUT');
      expect(result.error.field).toBe('modelRouting');
      const serialized = JSON.stringify(result.error);
      expect(serialized).not.toContain('nested-getter-must-not-run');
    }
    expect(getterCalls).toBe(0);
  });

  it('does not invoke deeper nested getters inside a section object', () => {
    let getterCalls = 0;
    const publicClass: Record<string, unknown> = {
      externalProcessingAllowed: 'policy-dependent',
    };
    Object.defineProperty(publicClass, 'externalProcessingAllowed', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('deep-nested-getter-must-not-run');
      },
    });
    const classification: Record<string, unknown> = {
      ...memoryClassification(),
      classes: {
        ...memoryClassification().classes,
        public: publicClass,
      },
    };
    const result = parseLocalHostConfig({
      ...validEnvelope(),
      memoryClassification: classification,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSAFE_CONFIG_INPUT');
      expect(result.error.field).toBe('memoryClassification');
      expect(JSON.stringify(result.error)).not.toContain('deep-nested-getter-must-not-run');
    }
    expect(getterCalls).toBe(0);
  });

  it('rejects Proxy containers before any observable trap runs', () => {
    const traps = {
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      get: 0,
      has: 0,
    };
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          traps.getPrototypeOf += 1;
          throw new Error('getPrototypeOf-must-not-run');
        },
        ownKeys() {
          traps.ownKeys += 1;
          throw new Error('ownKeys-must-not-run');
        },
        getOwnPropertyDescriptor() {
          traps.getOwnPropertyDescriptor += 1;
          throw new Error('getOwnPropertyDescriptor-must-not-run');
        },
        get() {
          traps.get += 1;
          throw new Error('get-must-not-run');
        },
        has() {
          traps.has += 1;
          throw new Error('has-must-not-run');
        },
      },
    );
    const result = parseLocalHostConfig(proxy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_CONFIG_INPUT');
    expect(traps).toEqual({
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      get: 0,
      has: 0,
    });
  });

  it('denies invalid model routing and enabled fallbacks', () => {
    const invalid = {
      ...validEnvelope(),
      modelRouting: { ...modelRouting(), schemaVersion: '9.9' },
    };
    expect(parseLocalHostConfig(invalid).ok).toBe(false);

    const apiOn = {
      ...validEnvelope(),
      modelRouting: { ...modelRouting(), apiFallbackEnabled: true },
    };
    const apiResult = parseLocalHostConfig(apiOn);
    expect(apiResult.ok).toBe(false);
    if (!apiResult.ok) expect(apiResult.error.code).toBe('INVALID_MODEL_ROUTING_CONFIG');

    const paidOn = {
      ...validEnvelope(),
      modelRouting: { ...modelRouting(), paidFallbackEnabled: true },
    };
    expect(parseLocalHostConfig(paidOn).ok).toBe(false);
  });

  it('denies invalid memory namespaces, classification, and security policy', () => {
    expect(
      parseLocalHostConfig({
        ...validEnvelope(),
        memoryNamespaces: { ...memoryNamespaces(), defaultAccess: 'allow' },
      }).ok,
    ).toBe(false);
    expect(
      parseLocalHostConfig({
        ...validEnvelope(),
        memoryClassification: { ...memoryClassification(), schemaVersion: 'bad' },
      }).ok,
    ).toBe(false);
    expect(
      parseLocalHostConfig({
        ...validEnvelope(),
        securityPolicy: { ...securityPolicy(), paymentActionsAllowed: true },
      }).ok,
    ).toBe(false);
  });

  it('keeps secret-looking sentinels out of failure payloads', () => {
    const secret = 'sk-live-SUPER-SECRET-TOKEN-VALUE';
    const input = {
      ...validEnvelope(),
      modelRouting: { ...modelRouting(), defaultProviderMode: secret },
    };
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('SUPER-SECRET');
    expect(result.error.reason).not.toContain(secret);
  });

  it('does not stringify the full input into errors', () => {
    const input = validEnvelope() as Record<string, unknown>;
    input['voiceProfile'] = { huge: 'x'.repeat(200) };
    const result = parseLocalHostConfig(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain('xxxx');
    expect(result.error.reason.length).toBeLessThan(200);
  });

  it('does not require credentials, activate providers, or read process.env', () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = parseLocalHostConfig(validEnvelope());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.diagnostics.credentialsLoaded).toBe(false);
      expect(result.value.diagnostics.providersActivated).toBe(false);
      expect(result.value.diagnostics.environmentAccess).toBe('none');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe('createLocalHostFromConfig', () => {
  it('bootstraps isolated hosts and keeps deny-by-default memory policy', async () => {
    const first = createLocalHostFromConfig(validEnvelope(), { clock: fixedClock() });
    const second = createLocalHostFromConfig(validEnvelope(), { clock: fixedClock() });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.host).not.toBe(second.value.host);
    expect(first.value.config).not.toBe(second.value.config);
    expect(first.value.config.modelRouting).not.toBe(second.value.config.modelRouting);
    expect(first.value.host.diagnostics.defaultMemoryPolicy).toBe('deny');

    const denied = await first.value.host.writeMemory(
      authenticatedAccess(),
      writeCommand({ recordId: 'cfg-deny' }),
    );
    expect(denied.ok).toBe(false);

    const allowed = createLocalHostFromConfig(validEnvelope(), {
      clock: fixedClock(),
      policy: createExplicitAllowMemoryPolicy(),
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    const written = await allowed.value.host.writeMemory(
      authenticatedAccess(),
      writeCommand({ recordId: 'cfg-allow' }),
    );
    expect(written.ok).toBe(true);
  });

  it('requires an explicit clock and does not mint authenticated evidence', async () => {
    const missingClock = createLocalHostFromConfig(validEnvelope(), {} as never);
    expect(missingClock.ok).toBe(false);
    if (!missingClock.ok) {
      expect(missingClock.error.code).toBe('HOST_COMPOSITION_REJECTED');
      expect(JSON.stringify(missingClock.error)).not.toContain('stack');
      expect(missingClock.error).not.toHaveProperty('stack');
    }

    const boot = createLocalHostFromConfig(validEnvelope(), {
      clock: fixedClock(),
      policy: createExplicitAllowMemoryPolicy(),
    });
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const plain = await boot.value.host.readMemory(accessContext() as never, {
      recordId: asRecordId('cfg-plain'),
      expectedOwnerId: accessContext().ownerId,
      expectedNamespace: 'personal',
    });
    expect(plain.ok).toBe(false);
  });

  it('returns expected invalid scanner/policy shapes as HOST_COMPOSITION_REJECTED', () => {
    const badScanner = createLocalHostFromConfig(validEnvelope(), {
      clock: fixedClock(),
      scanner: { scanText: 'nope' } as never,
    });
    expect(badScanner.ok).toBe(false);
    if (!badScanner.ok) expect(badScanner.error.code).toBe('HOST_COMPOSITION_REJECTED');

    const badPolicy = createLocalHostFromConfig(validEnvelope(), {
      clock: fixedClock(),
      policy: {} as never,
    });
    expect(badPolicy.ok).toBe(false);
    if (!badPolicy.ok) {
      expect(badPolicy.error.code).toBe('HOST_COMPOSITION_REJECTED');
      expect(JSON.stringify(badPolicy.error)).not.toContain('sk-live');
    }
  });

  it('does not mask unexpected programmer errors as HOST_COMPOSITION_REJECTED', () => {
    expect(() =>
      createLocalHostFromConfig(validEnvelope(), {
        get clock() {
          throw new ReferenceError('programmer-invariant-broken');
        },
      } as never),
    ).toThrow(ReferenceError);

    expect(() =>
      createLocalHostFromConfig(validEnvelope(), {
        get clock() {
          throw new TypeError('invariant broken elsewhere');
        },
      } as never),
    ).toThrow(TypeError);
  });

  it('returns config parse failures without creating a host or touching hostInput', () => {
    let clockReads = 0;
    const result = createLocalHostFromConfig(
      { broken: true },
      {
        get clock() {
          clockReads += 1;
          return fixedClock();
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(clockReads).toBe(0);
  });
});

describe('host config hygiene', () => {
  it('host config sources avoid filesystem, JSON.parse, env, and network modules', () => {
    const sources = listHostConfigSources().map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));
    for (const source of sources) {
      expect(source.text).not.toMatch(/\bfrom ['"]node:fs(?:\/promises)?['"]/);
      expect(source.text).not.toMatch(/\bfrom ['"]node:path['"]/);
      expect(source.text).not.toMatch(/\bfrom ['"]node:(http|https|net|tls|child_process)['"]/);
      expect(source.text).not.toMatch(/\bJSON\.parse\b/);
      expect(source.text).not.toMatch(/\bprocess\.env\b/);
      expect(source.text).not.toMatch(/\.internal/);
      expect(source.text).not.toMatch(/from ['"].*tests\//);
      expect(source.text).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bfetch\b/);
    }
  });
});
