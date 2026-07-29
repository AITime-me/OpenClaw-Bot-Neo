import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_JSON_INVENTORY,
  parseAutomationNotificationPolicyDraft,
  parseAutomationQuotasDraft,
  parseAutomationRemindersDraft,
  parseAutomationSubscriptionsDraft,
  parseMediaCapabilitiesDraft,
  parseMediaLimitsDraft,
  parseMemoryRetentionDraft,
  parseMemoryClassificationConfig,
  parseMemoryNamespacesConfig,
  parseModelRoutingConfig,
  parseOpenClawDraftConfig,
  parseOpenClawPolicyDraftConfig,
  parsePolicyRecipientsDraft,
  parsePolicyRetentionDraft,
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
    case 'automation-notification-policy':
      return parseAutomationNotificationPolicyDraft(value).ok;
    case 'automation-quotas':
      return parseAutomationQuotasDraft(value).ok;
    case 'automation-reminders':
      return parseAutomationRemindersDraft(value).ok;
    case 'automation-subscriptions':
      return parseAutomationSubscriptionsDraft(value).ok;
    case 'media-capabilities':
      return parseMediaCapabilitiesDraft(value).ok;
    case 'media-limits':
      return parseMediaLimitsDraft(value).ok;
    case 'memory-retention':
      return parseMemoryRetentionDraft(value).ok;
    case 'policy-recipients':
      return parsePolicyRecipientsDraft(value).ok;
    case 'policy-retention':
      return parsePolicyRetentionDraft(value).ok;
    default:
      return false;
  }
};

const parseStatusCDraft = (kind: string, value: unknown) => {
  switch (kind) {
    case 'openclaw-draft':
      return parseOpenClawDraftConfig(value);
    case 'openclaw-policy-draft':
      return parseOpenClawPolicyDraftConfig(value);
    case 'automation-notification-policy':
      return parseAutomationNotificationPolicyDraft(value);
    case 'automation-quotas':
      return parseAutomationQuotasDraft(value);
    case 'automation-reminders':
      return parseAutomationRemindersDraft(value);
    case 'automation-subscriptions':
      return parseAutomationSubscriptionsDraft(value);
    case 'media-capabilities':
      return parseMediaCapabilitiesDraft(value);
    case 'media-limits':
      return parseMediaLimitsDraft(value);
    case 'memory-retention':
      return parseMemoryRetentionDraft(value);
    case 'policy-recipients':
      return parsePolicyRecipientsDraft(value);
    case 'policy-retention':
      return parsePolicyRetentionDraft(value);
    default:
      return null;
  }
};

const recordAt = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
  const nested = value[key];
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested))
    throw new TypeError(`${key} is not a record`);
  return nested as Record<string, unknown>;
};

const arrayAt = (value: Record<string, unknown>, key: string): unknown[] => {
  const nested = value[key];
  if (!Array.isArray(nested)) throw new TypeError(`${key} is not an array`);
  return nested;
};

const mutateSourceDeep = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.push('__source-mutation__');
    for (const item of value.slice(0, -1)) mutateSourceDeep(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') (value as Record<string, unknown>)[key] = `${item}-mutated`;
    else if (typeof item === 'boolean') (value as Record<string, unknown>)[key] = !item;
    else if (typeof item === 'number') (value as Record<string, unknown>)[key] = item + 1;
    else mutateSourceDeep(item);
  }
};

const expectDeepFrozen = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const item of Object.values(value)) expectDeepFrozen(item);
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

  it('enforces exact schemas for every contract-draft family', () => {
    const entries = CONFIG_JSON_INVENTORY.filter((entry) => entry.status === 'C');
    for (const entry of entries) {
      const valid = load(entry.path).value;
      expect(validateInventoryEntry(entry.path, entry.kind, valid), entry.path).toBe(true);

      const missingSchema = structuredClone(valid) as Record<string, unknown>;
      delete missingSchema.schemaVersion;
      expect(validateInventoryEntry(entry.path, entry.kind, missingSchema), entry.path).toBe(false);

      const wrongSchema = structuredClone(valid) as Record<string, unknown>;
      wrongSchema.schemaVersion = '2.0';
      expect(validateInventoryEntry(entry.path, entry.kind, wrongSchema), entry.path).toBe(false);

      const extra = structuredClone(valid) as Record<string, unknown>;
      extra.unexpected = true;
      expect(validateInventoryEntry(entry.path, entry.kind, extra), entry.path).toBe(false);

      const mutable = structuredClone(valid) as Record<string, unknown>;
      const parsed =
        entry.kind === 'openclaw-draft'
          ? parseOpenClawDraftConfig(mutable)
          : entry.kind === 'openclaw-policy-draft'
            ? parseOpenClawPolicyDraftConfig(mutable)
            : null;
      if (parsed !== null && parsed.ok) {
        mutable.schemaVersion = 'changed';
        expect(parsed.value.schemaVersion).toBe('1.0-draft');
        expect(Object.isFrozen(parsed.value)).toBe(true);
      }
    }
  });

  it('accepts semantic status-C variations and rejects invalid cross-field combinations', () => {
    const cases: Array<{
      readonly path: string;
      readonly kind: string;
      readonly vary: (value: Record<string, unknown>) => void;
      readonly breakInvariant: (value: Record<string, unknown>) => void;
      readonly duplicate: (value: Record<string, unknown>) => void;
      readonly oversize: (value: Record<string, unknown>) => void;
    }> = [
      {
        path: 'config/openclaw.example.draft.json',
        kind: 'openclaw-draft',
        vary: (value) => {
          recordAt(value, 'proposedConfig').channelAdapter = '<second-safe-adapter>';
        },
        breakInvariant: (value) => {
          recordAt(value, 'proposedConfig').apiFallbackEnabled = true;
        },
        duplicate: (value) => {
          recordAt(value, 'proposedConfig').channelAdapterAlias = '<second-safe-adapter>';
        },
        oversize: (value) => {
          recordAt(value, 'proposedConfig').channelAdapter = 'x'.repeat(300);
        },
      },
      {
        path: 'config/openclaw.policy.example.json',
        kind: 'openclaw-policy-draft',
        vary: (value) => {
          const policy = recordAt(value, 'policy');
          policy.ownerApprovalRequiredFor = arrayAt(policy, 'ownerApprovalRequiredFor').reverse();
        },
        breakInvariant: (value) => {
          recordAt(value, 'policy').paymentActionsAllowed = true;
        },
        duplicate: (value) => {
          const policy = recordAt(value, 'policy');
          const effects = arrayAt(policy, 'ownerApprovalRequiredFor');
          effects.push(effects[0]);
        },
        oversize: (value) => {
          const policy = recordAt(value, 'policy');
          arrayAt(policy, 'ownerApprovalRequiredFor')[0] = 'x'.repeat(300);
        },
      },
      {
        path: 'config/automation/notification-policy.example.json',
        kind: 'automation-notification-policy',
        vary: (value) => {
          value.timezone = 'Asia/Yekaterinburg';
        },
        breakInvariant: (value) => {
          value.includeSensitiveRawData = true;
        },
        duplicate: (value) => {
          value.timezoneAlias = value.timezone;
        },
        oversize: (value) => {
          value.timezone = 'x'.repeat(300);
        },
      },
      {
        path: 'config/automation/quotas.example.json',
        kind: 'automation-quotas',
        vary: (value) => {
          value.thresholds = ['75', '95'];
        },
        breakInvariant: (value) => {
          value.paidFallbackEnabled = true;
        },
        duplicate: (value) => {
          const thresholds = arrayAt(value, 'thresholds');
          thresholds.push(thresholds[0]);
        },
        oversize: (value) => {
          arrayAt(value, 'thresholds')[0] = 'x'.repeat(300);
        },
      },
      {
        path: 'config/automation/reminders.example.json',
        kind: 'automation-reminders',
        vary: (value) => {
          value.timezone = 'UTC';
        },
        breakInvariant: (value) => {
          recordAt(value, 'quietHours').urgentBypassRequiresApproval = false;
        },
        duplicate: (value) => {
          value.timezoneAlias = value.timezone;
        },
        oversize: (value) => {
          value.timezone = 'x'.repeat(300);
        },
      },
      {
        path: 'config/automation/subscriptions.example.json',
        kind: 'automation-subscriptions',
        vary: (value) => {
          value.sources = ['owner-approved-source-2'];
        },
        breakInvariant: (value) => {
          value.cancellationActionsAllowed = true;
        },
        duplicate: (value) => {
          const sources = arrayAt(value, 'sources');
          sources.push(sources[0]);
        },
        oversize: (value) => {
          arrayAt(value, 'sources')[0] = 'x'.repeat(300);
        },
      },
      {
        path: 'config/media/capabilities.example.json',
        kind: 'media-capabilities',
        vary: (value) => {
          const first = arrayAt(value, 'capabilities')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).provider = '<second-local-provider>';
        },
        breakInvariant: (value) => {
          const first = arrayAt(value, 'capabilities')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).requiresApprovalForExternalProcessing = false;
        },
        duplicate: (value) => {
          const capabilities = arrayAt(value, 'capabilities');
          capabilities.push(structuredClone(capabilities[0]));
        },
        oversize: (value) => {
          const first = arrayAt(value, 'capabilities')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).provider = 'x'.repeat(300);
        },
      },
      {
        path: 'config/media/limits.example.json',
        kind: 'media-limits',
        vary: (value) => {
          recordAt(value, 'limits').allowedMimeTypes = ['image/png'];
        },
        breakInvariant: (value) => {
          recordAt(value, 'limits').externalProcessing = true;
        },
        duplicate: (value) => {
          const mime = arrayAt(recordAt(value, 'limits'), 'allowedMimeTypes');
          mime.push(mime[0]);
        },
        oversize: (value) => {
          arrayAt(recordAt(value, 'limits'), 'allowedMimeTypes')[0] = 'x'.repeat(300);
        },
      },
      {
        path: 'config/memory/retention.example.json',
        kind: 'memory-retention',
        vary: (value) => {
          recordAt(recordAt(value, 'classes'), 'short-lived').duration = 'P7D';
        },
        breakInvariant: (value) => {
          recordAt(recordAt(value, 'classes'), 'audit-minimal').rawContentAllowed = true;
        },
        duplicate: (value) => {
          recordAt(value, 'classes')['short-lived-alias'] = structuredClone(
            recordAt(recordAt(value, 'classes'), 'short-lived'),
          );
        },
        oversize: (value) => {
          recordAt(recordAt(value, 'classes'), 'short-lived').duration = 'x'.repeat(300);
        },
      },
      {
        path: 'config/policy/recipients.example.json',
        kind: 'policy-recipients',
        vary: (value) => {
          const first = arrayAt(value, 'recipients')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).recipientRef = 'owner-2';
        },
        breakInvariant: (value) => {
          value.arbitraryRecipientsAllowed = true;
        },
        duplicate: (value) => {
          const recipients = arrayAt(value, 'recipients');
          recipients.push(structuredClone(recipients[0]));
        },
        oversize: (value) => {
          const first = arrayAt(value, 'recipients')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).recipientRef = 'x'.repeat(300);
        },
      },
      {
        path: 'config/policy/retention.example.json',
        kind: 'policy-retention',
        vary: (value) => {
          const first = arrayAt(value, 'rules')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).duration = 'P3D';
        },
        breakInvariant: (value) => {
          const first = arrayAt(value, 'rules')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).rawSensitiveDataAllowed = true;
        },
        duplicate: (value) => {
          const rules = arrayAt(value, 'rules');
          rules.push(structuredClone(rules[0]));
        },
        oversize: (value) => {
          const first = arrayAt(value, 'rules')[0];
          if (first !== null && typeof first === 'object' && !Array.isArray(first))
            (first as Record<string, unknown>).duration = 'x'.repeat(300);
        },
      },
    ];

    for (const item of cases) {
      const original = load(item.path).value as Record<string, unknown>;
      expect(parseStatusCDraft(item.kind, original)?.ok, `${item.kind} example`).toBe(true);

      const variation = structuredClone(original);
      item.vary(variation);
      const parsed = parseStatusCDraft(item.kind, variation);
      expect(parsed?.ok, `${item.kind} valid variation`).toBe(true);
      if (parsed?.ok) {
        const immutableSnapshot = JSON.stringify(parsed.value);
        mutateSourceDeep(variation);
        expect(JSON.stringify(parsed.value), `${item.kind} detached snapshot`).toBe(
          immutableSnapshot,
        );
        expectDeepFrozen(parsed.value);
      }

      const invalid = structuredClone(original);
      item.breakInvariant(invalid);
      expect(parseStatusCDraft(item.kind, invalid)?.ok, `${item.kind} cross-field deny`).toBe(
        false,
      );

      const wrongType = structuredClone(original);
      wrongType.status = 1;
      expect(parseStatusCDraft(item.kind, wrongType)?.ok, `${item.kind} wrong type`).toBe(false);

      const unknownEnum = structuredClone(original);
      unknownEnum.status = 'active';
      expect(parseStatusCDraft(item.kind, unknownEnum)?.ok, `${item.kind} unknown enum`).toBe(
        false,
      );

      const duplicate = structuredClone(original);
      item.duplicate(duplicate);
      expect(parseStatusCDraft(item.kind, duplicate)?.ok, `${item.kind} duplicate`).toBe(false);

      const oversize = structuredClone(original);
      item.oversize(oversize);
      expect(parseStatusCDraft(item.kind, oversize)?.ok, `${item.kind} out of range`).toBe(false);

      let getterReads = 0;
      const withGetter = structuredClone(original);
      Object.defineProperty(withGetter, 'status', {
        enumerable: true,
        get() {
          getterReads += 1;
          return 'draft';
        },
      });
      expect(parseStatusCDraft(item.kind, withGetter)?.ok, `${item.kind} accessor`).toBe(false);
      expect(getterReads, `${item.kind} accessor execution`).toBe(0);
      expect(
        parseStatusCDraft(item.kind, new Proxy(structuredClone(original), {}))?.ok,
        `${item.kind} proxy`,
      ).toBe(false);
    }
  });

  it('rejects nested drift, accessors, proxies, invalid semantic strings and bounds', () => {
    const quotas = load('config/automation/quotas.example.json').value as Record<string, unknown>;
    const extraNested = structuredClone(quotas);
    extraNested.thresholds = ['<warning-percent>', '<critical-percent>', '<warning-percent>'];
    expect(parseAutomationQuotasDraft(extraNested).ok).toBe(false);

    let reads = 0;
    const withGetter = structuredClone(quotas);
    Object.defineProperty(withGetter, 'enabled', {
      enumerable: true,
      get() {
        reads += 1;
        return false;
      },
    });
    expect(parseAutomationQuotasDraft(withGetter).ok).toBe(false);
    expect(reads).toBe(0);

    const proxied = new Proxy(structuredClone(quotas), {});
    expect(parseAutomationQuotasDraft(proxied).ok).toBe(false);

    const oversized = structuredClone(quotas);
    oversized.onExceeded = 'x'.repeat(300);
    expect(parseAutomationQuotasDraft(oversized).ok).toBe(false);

    for (const invalidThresholds of [
      ['95', '75'],
      ['0', '101'],
      ['warning', 'critical'],
    ]) {
      const invalidQuotas = structuredClone(quotas);
      invalidQuotas.thresholds = invalidThresholds;
      expect(parseAutomationQuotasDraft(invalidQuotas).ok).toBe(false);
    }

    const notification = load('config/automation/notification-policy.example.json').value as Record<
      string,
      unknown
    >;
    const invalidTimezone = structuredClone(notification);
    invalidTimezone.timezone = 'tomorrow';
    expect(parseAutomationNotificationPolicyDraft(invalidTimezone).ok).toBe(false);
    const invalidTime = structuredClone(notification);
    recordAt(invalidTime, 'quietHours').start = '25:00';
    expect(parseAutomationNotificationPolicyDraft(invalidTime).ok).toBe(false);

    const reminders = load('config/automation/reminders.example.json').value as Record<
      string,
      unknown
    >;
    const invalidRetry = structuredClone(reminders);
    recordAt(invalidRetry, 'delivery').retryPolicy = 'retry-forever';
    expect(parseAutomationRemindersDraft(invalidRetry).ok).toBe(false);

    const mediaLimits = load('config/media/limits.example.json').value as Record<string, unknown>;
    const zeroLimit = structuredClone(mediaLimits);
    recordAt(zeroLimit, 'limits').maxInputBytes = 0;
    expect(parseMediaLimitsDraft(zeroLimit).ok).toBe(false);
    const invalidMime = structuredClone(mediaLimits);
    recordAt(invalidMime, 'limits').allowedMimeTypes = ['not-a-mime'];
    expect(parseMediaLimitsDraft(invalidMime).ok).toBe(false);

    const memoryRetention = load('config/memory/retention.example.json').value as Record<
      string,
      unknown
    >;
    const invalidMemoryDuration = structuredClone(memoryRetention);
    recordAt(recordAt(invalidMemoryDuration, 'classes'), 'short-lived').duration = 'forever';
    expect(parseMemoryRetentionDraft(invalidMemoryDuration).ok).toBe(false);

    const policyRetention = load('config/policy/retention.example.json').value as Record<
      string,
      unknown
    >;
    const invalidPolicyDuration = structuredClone(policyRetention);
    const firstRule = arrayAt(invalidPolicyDuration, 'rules')[0] as Record<string, unknown>;
    firstRule.duration = 'forever';
    expect(parsePolicyRetentionDraft(invalidPolicyDuration).ok).toBe(false);
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
