import { err, ok, type Result } from '../domain/result.js';
import { exactPlainRecord, filledString } from '../domain/observation-validation.js';
import { snapshotPlainJsonDto, type JsonDto } from '../domain/json-dto-snapshot.js';
import type { MemoryNamespace } from '../domain/memory-namespace.js';
import type { PrivacyClassification } from '../domain/privacy.js';
import type { RiskClass } from '../routing/risk-class.js';

export type ConfigFailureCode =
  | 'NOT_OBJECT'
  | 'MISSING_FIELD'
  | 'EXTRA_FIELD'
  | 'UNKNOWN_ENUM'
  | 'WRONG_SCHEMA_VERSION'
  | 'INVALID_VALUE'
  | 'ACCESSOR'
  | 'TOO_LARGE';

export interface ConfigFailure {
  readonly code: ConfigFailureCode;
  readonly reason: string;
}

const fail = (code: ConfigFailureCode, reason: string): Result<never, ConfigFailure> =>
  err({ code, reason });

const RISK_CLASSES = Object.freeze([
  'low',
  'medium',
  'high',
  'untrusted-input',
] as const satisfies readonly RiskClass[]);
const PRIVACY = Object.freeze([
  'public',
  'internal',
  'confidential',
  'commercial-secret',
  'security-restricted',
] as const satisfies readonly PrivacyClassification[]);
const NAMESPACES = Object.freeze([
  'tvoe-vremya',
  'ai-my-time',
  'personal',
  'shared-public',
  'security-restricted',
] as const satisfies readonly MemoryNamespace[]);
const REQUIRED_METADATA = Object.freeze([
  'source',
  'observedAt',
  'confidence',
  'classification',
  'retentionClass',
] as const);
const OWNER_APPROVAL_EFFECTS = Object.freeze([
  'write',
  'send',
  'publish',
  'delete',
  'execute',
  'privilege-change',
] as const);
const SCAN_BEFORE = Object.freeze(['memory', 'log', 'external-call', 'audit'] as const);

const MAX_ROUTES = 16;
const MAX_STRING = 128;
const MAX_DRAFT_STRING = 256;
const MAX_ARRAY = 32;

const readExact = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Result<Readonly<Record<string, unknown>>, ConfigFailure> => {
  const snapshot = exactPlainRecord(value, required, optional);
  if (snapshot === null)
    return fail('ACCESSOR', 'Config object is not an exact plain data record.');
  return ok(snapshot);
};

const boundedString = (
  value: unknown,
  label: string,
  max = MAX_STRING,
): Result<string, ConfigFailure> => {
  if (!filledString(value, max))
    return fail('INVALID_VALUE', `${label} must be a non-empty bounded string.`);
  return ok(value);
};

const copyPlainStringArray = (
  value: unknown,
  options: {
    readonly label: string;
    readonly maxItems: number;
    readonly maxItemLength: number;
    readonly allowed?: readonly string[];
    readonly requireExact?: readonly string[];
    readonly unique?: boolean;
  },
): Result<readonly string[], ConfigFailure> => {
  if (value === null || typeof value !== 'object' || !Array.isArray(value))
    return fail('INVALID_VALUE', `${options.label} must be an array.`);
  if (Object.getOwnPropertySymbols(value).length > 0)
    return fail('ACCESSOR', `${options.label} must not contain symbol keys.`);
  const length = value.length;
  if (length > options.maxItems) return fail('TOO_LARGE', `${options.label} exceeds bounds.`);
  const copy: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index))
      return fail('INVALID_VALUE', `${options.label} must not be sparse.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined)
      return fail('ACCESSOR', `${options.label} array accessors are denied.`);
    if (typeof descriptor.value === 'function')
      return fail('ACCESSOR', `${options.label} must not contain functions.`);
    const item: unknown = descriptor.value;
    if (typeof item !== 'string' || item.length === 0 || item.length > options.maxItemLength)
      return fail('INVALID_VALUE', `${options.label} items must be non-empty bounded strings.`);
    if (options.allowed !== undefined && !options.allowed.includes(item))
      return fail('UNKNOWN_ENUM', `${options.label} contains an uncontrolled value.`);
    if (options.unique === true) {
      if (seen.has(item))
        return fail('INVALID_VALUE', `${options.label} must not contain duplicates.`);
      seen.add(item);
    }
    copy.push(item);
  }
  if (options.requireExact !== undefined) {
    if (copy.length !== options.requireExact.length)
      return fail('INVALID_VALUE', `${options.label} must contain the exact required set.`);
    for (const required of options.requireExact)
      if (!copy.includes(required))
        return fail('MISSING_FIELD', `${options.label} is missing required entry.`);
  }
  return ok(Object.freeze(copy));
};

export interface ModelRoutingConfig {
  readonly schemaVersion: '1.0';
  readonly status: 'draft' | 'active';
  readonly modelIdentifiersConfirmed: boolean;
  readonly defaultProviderMode: 'subscription-oauth-only';
  readonly apiFallbackEnabled: false;
  readonly paidFallbackEnabled: false;
  readonly routes: readonly {
    readonly risk: RiskClass;
    readonly capabilityTier: string;
    readonly toolProfile: string;
    readonly approval: string;
    readonly onUnavailable: 'fail-closed';
    readonly fallbackToWeakerTier?: false;
  }[];
  readonly onUnavailable: 'fail-closed';
}

export const parseModelRoutingConfig = (
  value: unknown,
): Result<ModelRoutingConfig, ConfigFailure> => {
  const top = readExact(value, [
    'schemaVersion',
    'status',
    'modelIdentifiersConfirmed',
    'defaultProviderMode',
    'apiFallbackEnabled',
    'paidFallbackEnabled',
    'routes',
    'onUnavailable',
  ]);
  if (!top.ok) return top;
  const snap = top.value;
  if (snap.schemaVersion !== '1.0')
    return fail('WRONG_SCHEMA_VERSION', 'Model routing schemaVersion must be 1.0.');
  if (snap.status !== 'draft' && snap.status !== 'active')
    return fail('UNKNOWN_ENUM', 'status must be draft or active.');
  if (snap.defaultProviderMode !== 'subscription-oauth-only')
    return fail('UNKNOWN_ENUM', 'defaultProviderMode is not supported.');
  if (snap.apiFallbackEnabled !== false || snap.paidFallbackEnabled !== false)
    return fail('INVALID_VALUE', 'API and paid fallbacks must remain disabled.');
  if (snap.onUnavailable !== 'fail-closed')
    return fail('UNKNOWN_ENUM', 'onUnavailable must be fail-closed.');
  if (typeof snap.modelIdentifiersConfirmed !== 'boolean')
    return fail('INVALID_VALUE', 'modelIdentifiersConfirmed must be boolean.');
  const modelIdentifiersConfirmed = snap.modelIdentifiersConfirmed;
  if (snap.routes === null || typeof snap.routes !== 'object' || !Array.isArray(snap.routes))
    return fail('INVALID_VALUE', 'routes must be an array.');
  if (snap.routes.length === 0 || snap.routes.length > MAX_ROUTES)
    return fail('TOO_LARGE', 'routes length is out of bounds.');

  const routes: ModelRoutingConfig['routes'][number][] = [];
  const seenRisks = new Set<string>();
  for (let index = 0; index < snap.routes.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(snap.routes, index))
      return fail('INVALID_VALUE', 'routes must not be sparse.');
    const descriptor = Object.getOwnPropertyDescriptor(snap.routes, index);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined)
      return fail('ACCESSOR', 'routes array accessors are denied.');
    const routeSnap = readExact(
      descriptor.value,
      ['risk', 'capabilityTier', 'toolProfile', 'approval', 'onUnavailable'],
      ['fallbackToWeakerTier'],
    );
    if (!routeSnap.ok) return routeSnap;
    const route = routeSnap.value;
    if (route.risk === 'untrusted')
      return fail('UNKNOWN_ENUM', 'risk value "untrusted" is invalid; use "untrusted-input".');
    if (typeof route.risk !== 'string' || !(RISK_CLASSES as readonly string[]).includes(route.risk))
      return fail('UNKNOWN_ENUM', 'route.risk is not a controlled RiskClass.');
    if (seenRisks.has(route.risk))
      return fail('INVALID_VALUE', 'route.risk values must be unique.');
    seenRisks.add(route.risk);
    if (route.onUnavailable !== 'fail-closed')
      return fail('UNKNOWN_ENUM', 'route.onUnavailable must be fail-closed.');
    const tier = boundedString(route.capabilityTier, 'capabilityTier');
    if (!tier.ok) return tier;
    const tools = boundedString(route.toolProfile, 'toolProfile');
    if (!tools.ok) return tools;
    const approval = boundedString(route.approval, 'approval');
    if (!approval.ok) return approval;
    if (route.fallbackToWeakerTier !== undefined && route.fallbackToWeakerTier !== false)
      return fail('INVALID_VALUE', 'fallbackToWeakerTier must be false when present.');
    routes.push(
      Object.freeze({
        risk: route.risk as RiskClass,
        capabilityTier: tier.value,
        toolProfile: tools.value,
        approval: approval.value,
        onUnavailable: 'fail-closed' as const,
        ...(route.fallbackToWeakerTier === false ? { fallbackToWeakerTier: false as const } : {}),
      }),
    );
  }

  return ok(
    Object.freeze({
      schemaVersion: '1.0' as const,
      status: snap.status,
      modelIdentifiersConfirmed,
      defaultProviderMode: 'subscription-oauth-only' as const,
      apiFallbackEnabled: false as const,
      paidFallbackEnabled: false as const,
      routes: Object.freeze(routes),
      onUnavailable: 'fail-closed' as const,
    }),
  );
};

export interface MemoryNamespacesConfig {
  readonly schemaVersion: '1.0';
  readonly status: 'draft' | 'active';
  readonly defaultAccess: 'deny';
  readonly namespaces: readonly MemoryNamespace[];
  readonly activeNamespaceRequired: true;
  readonly crossNamespaceAccess: false;
  readonly crossProjectAccessRequiresOwnerApproval: true;
  readonly securityRestrictedIsolated: true;
  readonly personalIsolatedFromProjects: true;
  readonly requiredMetadata: readonly string[];
  readonly embedding: { readonly mode: 'none'; readonly externalProviderEnabled: false };
}

export const parseMemoryNamespacesConfig = (
  value: unknown,
): Result<MemoryNamespacesConfig, ConfigFailure> => {
  const top = readExact(value, [
    'schemaVersion',
    'status',
    'defaultAccess',
    'namespaces',
    'activeNamespaceRequired',
    'crossNamespaceAccess',
    'crossProjectAccessRequiresOwnerApproval',
    'securityRestrictedIsolated',
    'personalIsolatedFromProjects',
    'requiredMetadata',
    'embedding',
  ]);
  if (!top.ok) return top;
  const snap = top.value;
  if (snap.schemaVersion !== '1.0')
    return fail('WRONG_SCHEMA_VERSION', 'Memory namespaces schemaVersion must be 1.0.');
  if (snap.status !== 'draft' && snap.status !== 'active')
    return fail('UNKNOWN_ENUM', 'status must be draft or active.');
  if (snap.defaultAccess !== 'deny') return fail('UNKNOWN_ENUM', 'defaultAccess must be deny.');
  if (
    snap.activeNamespaceRequired !== true ||
    snap.crossNamespaceAccess !== false ||
    snap.crossProjectAccessRequiresOwnerApproval !== true ||
    snap.securityRestrictedIsolated !== true ||
    snap.personalIsolatedFromProjects !== true
  )
    return fail('INVALID_VALUE', 'namespace isolation flags are incorrect.');

  const namespaces = copyPlainStringArray(snap.namespaces, {
    label: 'namespaces',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_STRING,
    allowed: NAMESPACES,
    requireExact: NAMESPACES,
    unique: true,
  });
  if (!namespaces.ok) return namespaces;

  const requiredMetadata = copyPlainStringArray(snap.requiredMetadata, {
    label: 'requiredMetadata',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_STRING,
    requireExact: REQUIRED_METADATA,
    unique: true,
  });
  if (!requiredMetadata.ok) return requiredMetadata;

  const embedding = readExact(snap.embedding, ['mode', 'externalProviderEnabled']);
  if (!embedding.ok) return embedding;
  if (embedding.value.mode !== 'none' || embedding.value.externalProviderEnabled !== false)
    return fail('INVALID_VALUE', 'embedding must remain disabled.');

  return ok(
    Object.freeze({
      schemaVersion: '1.0' as const,
      status: snap.status,
      defaultAccess: 'deny' as const,
      namespaces: namespaces.value as readonly MemoryNamespace[],
      activeNamespaceRequired: true as const,
      crossNamespaceAccess: false as const,
      crossProjectAccessRequiresOwnerApproval: true as const,
      securityRestrictedIsolated: true as const,
      personalIsolatedFromProjects: true as const,
      requiredMetadata: requiredMetadata.value,
      embedding: Object.freeze({ mode: 'none' as const, externalProviderEnabled: false as const }),
    }),
  );
};

export interface MemoryClassificationConfig {
  readonly schemaVersion: '1.0';
  readonly status: 'draft' | 'active';
  readonly defaultClassification: PrivacyClassification;
  readonly classes: Readonly<
    Record<
      PrivacyClassification,
      {
        readonly externalProcessingAllowed: false | 'policy-dependent';
        readonly storeAllowed?: false;
      }
    >
  >;
  readonly sensitiveDataScan: { readonly required: true; readonly failureEffect: 'deny' };
}

export const parseMemoryClassificationConfig = (
  value: unknown,
): Result<MemoryClassificationConfig, ConfigFailure> => {
  const top = readExact(value, [
    'schemaVersion',
    'status',
    'defaultClassification',
    'classes',
    'sensitiveDataScan',
  ]);
  if (!top.ok) return top;
  const snap = top.value;
  if (snap.schemaVersion !== '1.0')
    return fail('WRONG_SCHEMA_VERSION', 'Memory classification schemaVersion must be 1.0.');
  if (snap.status !== 'draft' && snap.status !== 'active')
    return fail('UNKNOWN_ENUM', 'status must be draft or active.');
  if (
    typeof snap.defaultClassification !== 'string' ||
    !(PRIVACY as readonly string[]).includes(snap.defaultClassification)
  )
    return fail('UNKNOWN_ENUM', 'defaultClassification is not a controlled privacy value.');

  const classesSnap = readExact(snap.classes, PRIVACY);
  if (!classesSnap.ok) return classesSnap;
  const classes = {} as {
    [K in PrivacyClassification]: {
      readonly externalProcessingAllowed: false | 'policy-dependent';
      readonly storeAllowed?: false;
    };
  };
  for (const key of PRIVACY) {
    const entry = readExact(
      classesSnap.value[key],
      ['externalProcessingAllowed'],
      ['storeAllowed'],
    );
    if (!entry.ok) return entry;
    if (
      entry.value.externalProcessingAllowed !== false &&
      entry.value.externalProcessingAllowed !== 'policy-dependent'
    )
      return fail('UNKNOWN_ENUM', 'externalProcessingAllowed is uncontrolled.');
    if (entry.value.storeAllowed !== undefined && entry.value.storeAllowed !== false)
      return fail('INVALID_VALUE', 'storeAllowed must be false when present.');
    classes[key] = Object.freeze({
      externalProcessingAllowed: entry.value.externalProcessingAllowed,
      ...(entry.value.storeAllowed === false ? { storeAllowed: false as const } : {}),
    });
  }

  const scan = readExact(snap.sensitiveDataScan, ['required', 'failureEffect']);
  if (!scan.ok) return scan;
  if (scan.value.required !== true || scan.value.failureEffect !== 'deny')
    return fail('INVALID_VALUE', 'sensitiveDataScan must require deny-on-failure.');

  return ok(
    Object.freeze({
      schemaVersion: '1.0' as const,
      status: snap.status,
      defaultClassification: snap.defaultClassification as PrivacyClassification,
      classes: Object.freeze(classes),
      sensitiveDataScan: Object.freeze({ required: true as const, failureEffect: 'deny' as const }),
    }),
  );
};

export interface SecurityPolicyConfig {
  readonly schemaVersion: '1.0';
  readonly status: 'draft' | 'active';
  readonly defaultEffect: 'deny';
  readonly readOnlyFirst: true;
  readonly paymentActionsAllowed: false;
  readonly externalWritesAllowed: false;
  readonly ownerApproval: {
    readonly required: true;
    readonly bindToTargetAndPayload: true;
    readonly expires: true;
    readonly replayAllowed: false;
  };
  readonly sensitiveDataScanner: {
    readonly requiredBeforeAllSinks: true;
    readonly deterministic: true;
    readonly failureEffect: 'deny';
  };
  readonly reverseTrustAllowed: false;
}

export const parseSecurityPolicyConfig = (
  value: unknown,
): Result<SecurityPolicyConfig, ConfigFailure> => {
  const top = readExact(value, [
    'schemaVersion',
    'status',
    'defaultEffect',
    'readOnlyFirst',
    'paymentActionsAllowed',
    'externalWritesAllowed',
    'ownerApproval',
    'sensitiveDataScanner',
    'reverseTrustAllowed',
  ]);
  if (!top.ok) return top;
  const snap = top.value;
  if (snap.schemaVersion !== '1.0')
    return fail('WRONG_SCHEMA_VERSION', 'Security policy schemaVersion must be 1.0.');
  if (snap.status !== 'draft' && snap.status !== 'active')
    return fail('UNKNOWN_ENUM', 'status must be draft or active.');
  if (
    snap.defaultEffect !== 'deny' ||
    snap.readOnlyFirst !== true ||
    snap.paymentActionsAllowed !== false ||
    snap.externalWritesAllowed !== false ||
    snap.reverseTrustAllowed !== false
  )
    return fail('INVALID_VALUE', 'security policy fail-closed flags are incorrect.');

  const ownerApproval = readExact(snap.ownerApproval, [
    'required',
    'bindToTargetAndPayload',
    'expires',
    'replayAllowed',
  ]);
  if (!ownerApproval.ok) return ownerApproval;
  if (
    ownerApproval.value.required !== true ||
    ownerApproval.value.bindToTargetAndPayload !== true ||
    ownerApproval.value.expires !== true ||
    ownerApproval.value.replayAllowed !== false
  )
    return fail('INVALID_VALUE', 'ownerApproval flags are incorrect.');

  const scanner = readExact(snap.sensitiveDataScanner, [
    'requiredBeforeAllSinks',
    'deterministic',
    'failureEffect',
  ]);
  if (!scanner.ok) return scanner;
  if (
    scanner.value.requiredBeforeAllSinks !== true ||
    scanner.value.deterministic !== true ||
    scanner.value.failureEffect !== 'deny'
  )
    return fail('INVALID_VALUE', 'sensitiveDataScanner flags are incorrect.');

  return ok(
    Object.freeze({
      schemaVersion: '1.0' as const,
      status: snap.status,
      defaultEffect: 'deny' as const,
      readOnlyFirst: true as const,
      paymentActionsAllowed: false as const,
      externalWritesAllowed: false as const,
      ownerApproval: Object.freeze({
        required: true as const,
        bindToTargetAndPayload: true as const,
        expires: true as const,
        replayAllowed: false as const,
      }),
      sensitiveDataScanner: Object.freeze({
        requiredBeforeAllSinks: true as const,
        deterministic: true as const,
        failureEffect: 'deny' as const,
      }),
      reverseTrustAllowed: false as const,
    }),
  );
};

export interface OpenClawDraftConfig {
  readonly metadata: {
    readonly status: 'draft';
    readonly runtime: 'OpenClaw';
    readonly runtimeCompatibility: 'UNVERIFIED';
    readonly purpose: 'architecture-example-only';
    readonly notDeployable: true;
  };
  readonly proposedConfig: {
    readonly bindHost: '127.0.0.1';
    readonly providerMode: 'subscription-oauth-only';
    readonly apiFallbackEnabled: false;
    readonly paidFallbackEnabled: false;
    readonly approvalMode: 'owner-explicit';
    readonly defaultAccess: 'read-only';
    readonly memoryEmbedding: 'none';
    readonly channelAdapter: string;
    readonly modelSelection: string;
  };
}

export const parseOpenClawDraftConfig = (
  value: unknown,
): Result<OpenClawDraftConfig, ConfigFailure> => {
  const top = readExact(value, ['metadata', 'proposedConfig']);
  if (!top.ok) return top;
  const metadata = readExact(top.value.metadata, [
    'status',
    'runtime',
    'runtimeCompatibility',
    'purpose',
    'notDeployable',
  ]);
  if (!metadata.ok) return metadata;
  if (
    metadata.value.status !== 'draft' ||
    metadata.value.runtime !== 'OpenClaw' ||
    metadata.value.runtimeCompatibility !== 'UNVERIFIED' ||
    metadata.value.purpose !== 'architecture-example-only' ||
    metadata.value.notDeployable !== true
  )
    return fail('INVALID_VALUE', 'OpenClaw draft metadata is incorrect.');

  const proposed = readExact(top.value.proposedConfig, [
    'bindHost',
    'providerMode',
    'apiFallbackEnabled',
    'paidFallbackEnabled',
    'approvalMode',
    'defaultAccess',
    'memoryEmbedding',
    'channelAdapter',
    'modelSelection',
  ]);
  if (!proposed.ok) return proposed;
  if (
    proposed.value.bindHost !== '127.0.0.1' ||
    proposed.value.providerMode !== 'subscription-oauth-only' ||
    proposed.value.apiFallbackEnabled !== false ||
    proposed.value.paidFallbackEnabled !== false ||
    proposed.value.approvalMode !== 'owner-explicit' ||
    proposed.value.defaultAccess !== 'read-only' ||
    proposed.value.memoryEmbedding !== 'none'
  )
    return fail('INVALID_VALUE', 'OpenClaw draft proposedConfig flags are incorrect.');
  const channel = boundedString(proposed.value.channelAdapter, 'channelAdapter', MAX_DRAFT_STRING);
  if (!channel.ok) return channel;
  const model = boundedString(proposed.value.modelSelection, 'modelSelection', MAX_DRAFT_STRING);
  if (!model.ok) return model;

  return ok(
    Object.freeze({
      metadata: Object.freeze({
        status: 'draft' as const,
        runtime: 'OpenClaw' as const,
        runtimeCompatibility: 'UNVERIFIED' as const,
        purpose: 'architecture-example-only' as const,
        notDeployable: true as const,
      }),
      proposedConfig: Object.freeze({
        bindHost: '127.0.0.1' as const,
        providerMode: 'subscription-oauth-only' as const,
        apiFallbackEnabled: false as const,
        paidFallbackEnabled: false as const,
        approvalMode: 'owner-explicit' as const,
        defaultAccess: 'read-only' as const,
        memoryEmbedding: 'none' as const,
        channelAdapter: channel.value,
        modelSelection: model.value,
      }),
    }),
  );
};

export interface OpenClawPolicyDraftConfig {
  readonly metadata: {
    readonly status: 'draft';
    readonly runtimeCompatibility: 'UNVERIFIED';
  };
  readonly policy: {
    readonly defaultEffect: 'deny';
    readonly readOnlyFirst: true;
    readonly ownerApprovalRequiredFor: readonly string[];
    readonly paymentActionsAllowed: false;
    readonly apiFallbackEnabled: false;
    readonly paidFallbackEnabled: false;
    readonly scanBefore: readonly string[];
    readonly scannerFailureEffect: 'deny';
  };
}

export const parseOpenClawPolicyDraftConfig = (
  value: unknown,
): Result<OpenClawPolicyDraftConfig, ConfigFailure> => {
  const top = readExact(value, ['metadata', 'policy']);
  if (!top.ok) return top;
  const metadata = readExact(top.value.metadata, ['status', 'runtimeCompatibility']);
  if (!metadata.ok) return metadata;
  if (metadata.value.status !== 'draft' || metadata.value.runtimeCompatibility !== 'UNVERIFIED')
    return fail('INVALID_VALUE', 'OpenClaw policy draft metadata is incorrect.');

  const policy = readExact(top.value.policy, [
    'defaultEffect',
    'readOnlyFirst',
    'ownerApprovalRequiredFor',
    'paymentActionsAllowed',
    'apiFallbackEnabled',
    'paidFallbackEnabled',
    'scanBefore',
    'scannerFailureEffect',
  ]);
  if (!policy.ok) return policy;
  if (
    policy.value.defaultEffect !== 'deny' ||
    policy.value.readOnlyFirst !== true ||
    policy.value.paymentActionsAllowed !== false ||
    policy.value.apiFallbackEnabled !== false ||
    policy.value.paidFallbackEnabled !== false ||
    policy.value.scannerFailureEffect !== 'deny'
  )
    return fail('INVALID_VALUE', 'OpenClaw policy draft flags are incorrect.');

  const effects = copyPlainStringArray(policy.value.ownerApprovalRequiredFor, {
    label: 'ownerApprovalRequiredFor',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_STRING,
    requireExact: OWNER_APPROVAL_EFFECTS,
    unique: true,
  });
  if (!effects.ok) return effects;
  const scanBefore = copyPlainStringArray(policy.value.scanBefore, {
    label: 'scanBefore',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_STRING,
    requireExact: SCAN_BEFORE,
    unique: true,
  });
  if (!scanBefore.ok) return scanBefore;

  return ok(
    Object.freeze({
      metadata: Object.freeze({
        status: 'draft' as const,
        runtimeCompatibility: 'UNVERIFIED' as const,
      }),
      policy: Object.freeze({
        defaultEffect: 'deny' as const,
        readOnlyFirst: true as const,
        ownerApprovalRequiredFor: effects.value,
        paymentActionsAllowed: false as const,
        apiFallbackEnabled: false as const,
        paidFallbackEnabled: false as const,
        scanBefore: scanBefore.value,
        scannerFailureEffect: 'deny' as const,
      }),
    }),
  );
};

export interface ContractDraftConfig {
  readonly status: 'draft';
  readonly schemaVersion: '1.0-draft';
  readonly rawKind: string;
  readonly payload: Readonly<Record<string, JsonDto>>;
}

/**
 * Contract-only draft examples: deep plain-JSON snapshot first, then fail-closed flag checks.
 * Nested values are immutable copies and do not retain references to the input.
 */
export const parseContractDraftExample = (
  value: unknown,
  expectedKind: string,
): Result<ContractDraftConfig, ConfigFailure> => {
  const dto = snapshotPlainJsonDto(value, { maxNodes: 256, maxDepth: 8 });
  if (!dto.ok) return fail('ACCESSOR', 'Contract draft is not a trusted plain JSON DTO.');
  if (dto.value === null || typeof dto.value !== 'object' || Array.isArray(dto.value))
    return fail('NOT_OBJECT', 'Contract draft must be an object.');
  const payload = dto.value as Readonly<Record<string, JsonDto>>;
  if (payload.status !== 'draft')
    return fail('UNKNOWN_ENUM', 'Contract draft status must be draft.');
  if (payload.paidFallbackEnabled === true || payload.apiBillingIsFallback === true)
    return fail('INVALID_VALUE', 'Paid/API billing fallback must remain disabled.');
  if (payload.paymentActionsAllowed === true)
    return fail('INVALID_VALUE', 'paymentActionsAllowed must remain false.');
  if (payload.paidProvidersEnabled === true)
    return fail('INVALID_VALUE', 'paidProvidersEnabled must remain false.');
  if (payload.enabled === true)
    return fail(
      'INVALID_VALUE',
      'Contract draft examples must remain disabled when enabled is set.',
    );
  if (payload.includeSensitiveRawData === true)
    return fail('INVALID_VALUE', 'includeSensitiveRawData must remain false.');
  if (payload.arbitraryRecipientsAllowed === true)
    return fail('INVALID_VALUE', 'arbitraryRecipientsAllowed must remain false.');

  return ok(
    Object.freeze({
      status: 'draft' as const,
      schemaVersion: '1.0-draft' as const,
      rawKind: expectedKind,
      payload,
    }),
  );
};

export type ConfigValidatorKind =
  | 'model-routing'
  | 'memory-namespaces'
  | 'memory-classification'
  | 'security-policy'
  | 'extension-manifest'
  | 'voice-profile'
  | 'openclaw-draft'
  | 'openclaw-policy-draft'
  | 'contract-draft';

export interface ConfigInventoryEntry {
  readonly path: string;
  readonly kind: ConfigValidatorKind;
  readonly status: 'A' | 'B' | 'C';
  readonly note: string;
}

export const CONFIG_JSON_INVENTORY: readonly ConfigInventoryEntry[] = Object.freeze([
  {
    path: 'config/model-routing.example.json',
    kind: 'model-routing',
    status: 'A',
    note: 'Production model routing parser.',
  },
  {
    path: 'config/memory/namespaces.example.json',
    kind: 'memory-namespaces',
    status: 'A',
    note: 'Production memory namespaces parser.',
  },
  {
    path: 'config/memory/classification.example.json',
    kind: 'memory-classification',
    status: 'A',
    note: 'Production memory classification parser.',
  },
  {
    path: 'config/policy/security-policy.example.json',
    kind: 'security-policy',
    status: 'A',
    note: 'Production security policy parser.',
  },
  {
    path: 'config/extensions/call-analysis.skill.example.json',
    kind: 'extension-manifest',
    status: 'B',
    note: 'Existing extension manifest validator.',
  },
  {
    path: 'config/extensions/external-call-service.integration.example.json',
    kind: 'extension-manifest',
    status: 'B',
    note: 'Existing extension manifest validator.',
  },
  {
    path: 'config/voice/neo.example.json',
    kind: 'voice-profile',
    status: 'B',
    note: 'Existing VoiceProfile validator.',
  },
  {
    path: 'config/openclaw.example.draft.json',
    kind: 'openclaw-draft',
    status: 'C',
    note: 'Contract-only OpenClaw runtime draft; not deployable.',
  },
  {
    path: 'config/openclaw.policy.example.json',
    kind: 'openclaw-policy-draft',
    status: 'C',
    note: 'Contract-only OpenClaw policy draft; not deployable.',
  },
  {
    path: 'config/automation/quotas.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only automation quotas draft.',
  },
  {
    path: 'config/automation/subscriptions.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only subscriptions draft.',
  },
  {
    path: 'config/automation/reminders.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only reminders draft.',
  },
  {
    path: 'config/automation/notification-policy.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only notification policy draft.',
  },
  {
    path: 'config/media/limits.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only media limits draft.',
  },
  {
    path: 'config/media/capabilities.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only media capabilities draft.',
  },
  {
    path: 'config/memory/retention.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only memory retention draft.',
  },
  {
    path: 'config/policy/retention.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only policy retention draft.',
  },
  {
    path: 'config/policy/recipients.example.json',
    kind: 'contract-draft',
    status: 'C',
    note: 'Contract-only recipients draft.',
  },
]);

/** Production-sensitive subset paths from CONFIG_JSON_INVENTORY (status A|B). */
export const SECURITY_SENSITIVE_CONFIG_ALLOWLIST = Object.freeze(
  CONFIG_JSON_INVENTORY.filter((entry) => entry.status === 'A' || entry.status === 'B').map(
    (entry) => entry.path,
  ),
);
