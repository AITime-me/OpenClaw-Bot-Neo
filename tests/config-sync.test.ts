import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_JSON_INVENTORY,
  parseContractDraftExample,
  parseMemoryClassificationConfig,
  parseMemoryNamespacesConfig,
  parseModelRoutingConfig,
  parseOpenClawDraftConfig,
  parseOpenClawPolicyDraftConfig,
  parseSecurityPolicyConfig,
} from '../src/core/config/index.js';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { scanSensitiveData } from '../src/core/policy/sensitive-data-scanner.js';
import { validateVoiceProfile } from '../src/core/policy/voice-profile.js';

const load = (path: string): { readonly raw: string; readonly value: unknown } => {
  const raw = readFileSync(path, 'utf8');
  return { raw, value: JSON.parse(raw) as unknown };
};

const listJsonFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) files.push(...listJsonFiles(path));
    else if (entry.name.endsWith('.json')) files.push(path);
  }
  return files.sort();
};

const validateInventoryEntry = (path: string, kind: string, value: unknown): boolean => {
  switch (kind) {
    case 'model-routing':
      return parseModelRoutingConfig(value).ok;
    case 'memory-namespaces':
      return parseMemoryNamespacesConfig(value).ok;
    case 'memory-classification':
      return parseMemoryClassificationConfig(value).ok;
    case 'security-policy':
      return parseSecurityPolicyConfig(value).ok;
    case 'extension-manifest':
      return validateExtensionManifest(value).ok;
    case 'voice-profile':
      return validateVoiceProfile(value).valid;
    case 'openclaw-draft':
      return parseOpenClawDraftConfig(value).ok;
    case 'openclaw-policy-draft':
      return parseOpenClawPolicyDraftConfig(value).ok;
    case 'contract-draft':
      return parseContractDraftExample(value, path).ok;
    default:
      return false;
  }
};

describe('example configuration semantic consistency', () => {
  it.each([
    'config/extensions/call-analysis.skill.example.json',
    'config/extensions/external-call-service.integration.example.json',
  ])('%s matches the manifest contract and remains disabled', (path) => {
    const config = load(path);
    const result = validateExtensionManifest(config.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
      expect(result.value.provenance.status).toBe('unverified');
    }
    const scan = scanSensitiveData(config.raw);
    expect(scan.ok).toBe(true);
    if (scan.ok) expect(scan.value.findings).toHaveLength(0);
    expect(config.raw).not.toContain('OPENAI_API_KEY');
  });

  it('keeps call analysis separate from external service ingestion', () => {
    const skill = validateExtensionManifest(
      load('config/extensions/call-analysis.skill.example.json').value,
    );
    const integration = validateExtensionManifest(
      load('config/extensions/external-call-service.integration.example.json').value,
    );
    expect(skill.ok && skill.value.kind === 'business-skill').toBe(true);
    expect(integration.ok && integration.value.kind === 'integration').toBe(true);
  });

  it('validates Neo profile as masculine, provider-independent and text-only fallback', () => {
    const config = load('config/voice/neo.example.json');
    const result = validateVoiceProfile(config.value);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.profile.genderPresentation).toBe('masculine');
    expect(result.profile.fallbackMode).toBe('text-only');
  });

  it('maps every config/**/*.json through the complete inventory validators', () => {
    const all = listJsonFiles('config');
    const inventoryPaths = CONFIG_JSON_INVENTORY.map((entry) => entry.path).sort();
    expect(all).toEqual(inventoryPaths);
    for (const entry of CONFIG_JSON_INVENTORY) {
      const loaded = load(entry.path);
      expect(
        validateInventoryEntry(entry.path, entry.kind, loaded.value),
        `${entry.path} failed validator ${entry.kind}`,
      ).toBe(true);
    }
  });

  it('detects unknown JSON files missing from inventory', () => {
    const all = listJsonFiles('config');
    const known = new Set(CONFIG_JSON_INVENTORY.map((entry) => entry.path));
    expect(all.every((path) => known.has(path))).toBe(true);
    expect(known.has('config/openclaw.example.draft.json')).toBe(true);
    expect(known.has('config/openclaw.policy.example.json')).toBe(true);
  });

  it('denies old untrusted risk, unknown privacy and schema drift', () => {
    const routing = structuredClone(load('config/model-routing.example.json').value) as Record<
      string,
      unknown
    >;
    const routes = routing.routes as Record<string, unknown>[];
    const fourth = routes[3];
    if (fourth === undefined) throw new Error('expected fourth route');
    routes[3] = {
      risk: 'untrusted',
      capabilityTier: fourth.capabilityTier,
      toolProfile: fourth.toolProfile,
      approval: fourth.approval,
      onUnavailable: fourth.onUnavailable,
    };
    expect(parseModelRoutingConfig(routing).ok).toBe(false);
    expect(parseModelRoutingConfig(load('config/model-routing.example.json').value).ok).toBe(true);

    const classification = structuredClone(
      load('config/memory/classification.example.json').value,
    ) as Record<string, unknown>;
    classification.defaultClassification = 'secret';
    expect(parseMemoryClassificationConfig(classification).ok).toBe(false);
  });

  it('rejects accessors, proxies, extras and mutations for production parsers', () => {
    let getterCalls = 0;
    const withGetter = {};
    Object.defineProperty(withGetter, 'schemaVersion', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '1.0';
      },
    });
    expect(parseModelRoutingConfig(withGetter).ok).toBe(false);
    expect(getterCalls).toBe(0);

    let nestedGets = 0;
    const nested = structuredClone(load('config/model-routing.example.json').value) as Record<
      string,
      unknown
    >;
    const routes = nested.routes as unknown[];
    const poisoned = {};
    Object.defineProperty(poisoned, 'risk', {
      enumerable: true,
      get() {
        nestedGets += 1;
        return 'low';
      },
    });
    routes[0] = poisoned;
    expect(parseModelRoutingConfig(nested).ok).toBe(false);
    expect(nestedGets).toBe(0);

    const proto: Record<string, unknown> = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    Object.assign(proto, load('config/model-routing.example.json').value);
    expect(parseModelRoutingConfig(proto).ok).toBe(false);

    const base = load('config/model-routing.example.json').value as Record<string, unknown>;
    const proxied = new Proxy(structuredClone(base), {
      get(target, prop, receiver): unknown {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(parseModelRoutingConfig(proxied).ok).toBe(false);

    const withSymbol = { ...structuredClone(base), [Symbol('x')]: 1 };
    expect(parseModelRoutingConfig(withSymbol).ok).toBe(false);

    const extra = { ...structuredClone(base), hidden: true };
    expect(parseModelRoutingConfig(extra).ok).toBe(false);

    const nestedExtra = structuredClone(base) as {
      routes: Record<string, unknown>[];
    };
    const firstRoute = nestedExtra.routes[0];
    if (firstRoute === undefined) throw new Error('missing route');
    nestedExtra.routes[0] = { ...firstRoute, extraNested: true };
    expect(parseModelRoutingConfig(nestedExtra).ok).toBe(false);

    const withMethod = {
      ...structuredClone(base),
      toJSON() {
        return {};
      },
    };
    expect(parseModelRoutingConfig(withMethod).ok).toBe(false);

    const mutable = structuredClone(base) as {
      status: string;
      routes: { risk: string }[];
    };
    const parsed = parseModelRoutingConfig(mutable);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    mutable.status = 'active';
    const first = mutable.routes[0];
    if (first !== undefined) first.risk = 'high';
    expect(parsed.value.status).toBe('draft');
    expect(parsed.value.routes[0]?.risk).toBe('low');
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.routes)).toBe(true);
  });

  it('validates root OpenClaw drafts through dedicated parsers', () => {
    expect(parseOpenClawDraftConfig(load('config/openclaw.example.draft.json').value).ok).toBe(
      true,
    );
    expect(
      parseOpenClawPolicyDraftConfig(load('config/openclaw.policy.example.json').value).ok,
    ).toBe(true);
  });

  it('preserves eight business skills and one technical multimodal skill', () => {
    const names = readdirSync('skills', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(
      [
        'ai-scout',
        'business-analyst',
        'director',
        'integration-engineer',
        'marketing-strategist',
        'multimodal-workflow',
        'personal-assistant',
        'security-guard',
        'tech-watchdog',
      ].sort(),
    );
  });
});
