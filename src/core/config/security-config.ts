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
const PLACEHOLDER_PATTERN = /^<[a-z0-9]+(?:-[a-z0-9]+)*>$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/;
const ISO_DURATION_PATTERN =
  /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
const MIME_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

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
  readonly schemaVersion: '1.0-draft';
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
  const top = readExact(value, ['schemaVersion', 'metadata', 'proposedConfig']);
  if (!top.ok) return top;
  if (top.value.schemaVersion !== '1.0-draft')
    return fail('WRONG_SCHEMA_VERSION', 'OpenClaw draft schemaVersion must be 1.0-draft.');
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
      schemaVersion: '1.0-draft' as const,
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
  readonly schemaVersion: '1.0-draft';
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
  const top = readExact(value, ['schemaVersion', 'metadata', 'policy']);
  if (!top.ok) return top;
  if (top.value.schemaVersion !== '1.0-draft')
    return fail('WRONG_SCHEMA_VERSION', 'OpenClaw policy schemaVersion must be 1.0-draft.');
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
      schemaVersion: '1.0-draft' as const,
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

export type ExactDraftKind =
  | 'automation-notification-policy'
  | 'automation-quotas'
  | 'automation-reminders'
  | 'automation-subscriptions'
  | 'media-capabilities'
  | 'media-limits'
  | 'memory-retention'
  | 'policy-recipients'
  | 'policy-retention';

export interface ExactDraftConfig {
  readonly status: 'draft';
  readonly schemaVersion: '1.0-draft';
  readonly kind: ExactDraftKind;
  readonly payload: Readonly<Record<string, JsonDto>>;
}

const readSemanticDraft = (
  value: unknown,
  fields: readonly string[],
): Result<Readonly<Record<string, JsonDto>>, ConfigFailure> => {
  const dto = snapshotPlainJsonDto(value, {
    maxNodes: 512,
    maxDepth: 8,
    maxObjectKeys: 64,
    maxArrayLength: 64,
    maxStringLength: MAX_DRAFT_STRING,
    maxKeyLength: MAX_STRING,
  });
  if (!dto.ok) return fail('ACCESSOR', 'Contract draft is not a trusted plain JSON DTO.');
  if (dto.value === null || typeof dto.value !== 'object' || Array.isArray(dto.value))
    return fail('NOT_OBJECT', 'Contract draft must be an object.');
  const payload = dto.value as Readonly<Record<string, JsonDto>>;
  const exact = readExact(payload, fields);
  if (!exact.ok) return exact;
  if (payload.schemaVersion !== '1.0-draft')
    return fail('WRONG_SCHEMA_VERSION', 'Contract draft schemaVersion must be 1.0-draft.');
  if (payload.status !== 'draft')
    return fail('UNKNOWN_ENUM', 'Contract draft status must be draft.');
  return ok(payload);
};

const finishSemanticDraft = (
  kind: ExactDraftKind,
  payload: Readonly<Record<string, JsonDto>>,
): Result<ExactDraftConfig, ConfigFailure> =>
  ok(Object.freeze({ status: 'draft', schemaVersion: '1.0-draft', kind, payload }));

const controlledString = (
  value: unknown,
  label: string,
  allowed: readonly string[],
): Result<string, ConfigFailure> => {
  const parsed = boundedString(value, label, MAX_DRAFT_STRING);
  if (!parsed.ok) return parsed;
  return allowed.includes(parsed.value)
    ? parsed
    : fail('UNKNOWN_ENUM', `${label} contains an uncontrolled value.`);
};

const matchesSemanticString = (
  value: unknown,
  label: string,
  pattern: RegExp,
): Result<string, ConfigFailure> => {
  const parsed = boundedString(value, label, MAX_DRAFT_STRING);
  if (!parsed.ok) return parsed;
  return pattern.test(parsed.value) || PLACEHOLDER_PATTERN.test(parsed.value)
    ? parsed
    : fail('INVALID_VALUE', `${label} has an invalid semantic format.`);
};

const localTimeOrPlaceholder = (value: unknown, label: string): Result<string, ConfigFailure> =>
  matchesSemanticString(value, label, LOCAL_TIME_PATTERN);

const timezoneOrPlaceholder = (value: unknown, label: string): Result<string, ConfigFailure> =>
  matchesSemanticString(value, label, TIMEZONE_PATTERN);

const durationOrPlaceholder = (value: unknown, label: string): Result<string, ConfigFailure> =>
  matchesSemanticString(value, label, ISO_DURATION_PATTERN);

const mimeOrPlaceholder = (value: unknown, label: string): Result<string, ConfigFailure> =>
  matchesSemanticString(value, label, MIME_PATTERN);

const percentOrPlaceholder = (
  value: unknown,
  label: string,
): Result<number | null, ConfigFailure> => {
  const parsed = boundedString(value, label, MAX_STRING);
  if (!parsed.ok) return parsed;
  if (PLACEHOLDER_PATTERN.test(parsed.value)) return ok(null);
  if (!/^(?:100|[1-9]\d?)$/.test(parsed.value))
    return fail('INVALID_VALUE', `${label} must be a whole percentage from 1 through 100.`);
  return ok(Number(parsed.value));
};

const exactBoolean = (
  value: unknown,
  label: string,
  required?: boolean,
): Result<boolean, ConfigFailure> => {
  if (typeof value !== 'boolean' || (required !== undefined && value !== required))
    return fail('INVALID_VALUE', `${label} has an invalid boolean value.`);
  return ok(value);
};

const objectArray = (
  value: unknown,
  label: string,
  max = MAX_ARRAY,
): Result<readonly JsonDto[], ConfigFailure> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > max)
    return fail('INVALID_VALUE', `${label} must be a non-empty bounded array.`);
  return ok(value);
};

export const parseAutomationNotificationPolicyDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'defaultDelivery',
    'timezone',
    'quietHours',
    'severity',
    'includeSensitiveRawData',
    'recipientPolicy',
  ]);
  if (!top.ok) return top;
  const delivery = controlledString(top.value.defaultDelivery, 'defaultDelivery', [
    'defer-during-quiet-hours',
    'immediate',
    'digest',
  ]);
  const timezone = timezoneOrPlaceholder(top.value.timezone, 'timezone');
  const quiet = readExact(top.value.quietHours, ['start', 'end']);
  const severity = readExact(top.value.severity, ['info', 'warning', 'critical']);
  if (!delivery.ok) return err(delivery.error);
  if (!timezone.ok) return err(timezone.error);
  if (!quiet.ok) return err(quiet.error);
  if (!severity.ok) return err(severity.error);
  const start = localTimeOrPlaceholder(quiet.value.start, 'quietHours.start');
  const end = localTimeOrPlaceholder(quiet.value.end, 'quietHours.end');
  const info = controlledString(severity.value.info, 'severity.info', ['digest', 'timely']);
  const warning = controlledString(severity.value.warning, 'severity.warning', [
    'digest',
    'timely',
  ]);
  const critical = controlledString(severity.value.critical, 'severity.critical', [
    'immediate-after-policy-check',
  ]);
  if (!start.ok) return err(start.error);
  if (!end.ok) return err(end.error);
  if (!info.ok) return err(info.error);
  if (!warning.ok) return err(warning.error);
  if (!critical.ok) return err(critical.error);
  if (start.value === end.value && !start.value.startsWith('<'))
    return fail('INVALID_VALUE', 'quietHours start and end must differ.');
  if (
    !exactBoolean(top.value.includeSensitiveRawData, 'includeSensitiveRawData', false).ok ||
    top.value.recipientPolicy !== 'allowlist-only'
  )
    return fail('INVALID_VALUE', 'Notification policy safety invariants are invalid.');
  return finishSemanticDraft('automation-notification-policy', top.value);
};

export const parseAutomationQuotasDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'enabled',
    'quotaTypes',
    'thresholds',
    'apiBillingIsFallback',
    'paidFallbackEnabled',
    'onExceeded',
  ]);
  if (!top.ok) return top;
  const quotaTypes = copyPlainStringArray(top.value.quotaTypes, {
    label: 'quotaTypes',
    maxItems: 3,
    maxItemLength: MAX_STRING,
    allowed: ['subscription-usage', 'storage', 'local-resource'],
    unique: true,
  });
  const thresholds = copyPlainStringArray(top.value.thresholds, {
    label: 'thresholds',
    maxItems: 4,
    maxItemLength: MAX_STRING,
    unique: true,
  });
  const parsedThresholds = thresholds.ok
    ? thresholds.value.map((threshold, index) =>
        percentOrPlaceholder(threshold, `thresholds[${String(index)}]`),
      )
    : [];
  if (
    !exactBoolean(top.value.enabled, 'enabled').ok ||
    !quotaTypes.ok ||
    quotaTypes.value.length === 0 ||
    !thresholds.ok ||
    thresholds.value.length < 2 ||
    parsedThresholds.some((threshold) => !threshold.ok) ||
    !exactBoolean(top.value.apiBillingIsFallback, 'apiBillingIsFallback', false).ok ||
    !exactBoolean(top.value.paidFallbackEnabled, 'paidFallbackEnabled', false).ok ||
    !controlledString(top.value.onExceeded, 'onExceeded', [
      'notify-and-mark-unavailable',
      'deny-and-notify',
    ]).ok
  )
    return fail('INVALID_VALUE', 'Automation quota schema or safety invariants are invalid.');
  const numericThresholds = parsedThresholds.flatMap((threshold) =>
    threshold.ok && threshold.value !== null ? [threshold.value] : [],
  );
  if (
    numericThresholds.length === parsedThresholds.length &&
    numericThresholds.some(
      (threshold, index) => index > 0 && threshold <= (numericThresholds[index - 1] ?? 0),
    )
  )
    return fail('INVALID_VALUE', 'Automation quota thresholds must be strictly increasing.');
  return finishSemanticDraft('automation-quotas', top.value);
};

export const parseAutomationRemindersDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'enabled',
    'timezone',
    'quietHours',
    'delivery',
    'paymentActionsAllowed',
  ]);
  if (!top.ok) return top;
  const timezone = timezoneOrPlaceholder(top.value.timezone, 'timezone');
  const quiet = readExact(top.value.quietHours, ['start', 'end', 'urgentBypassRequiresApproval']);
  const delivery = readExact(top.value.delivery, [
    'idempotencyRequired',
    'retryPolicy',
    'missedRunPolicy',
  ]);
  if (!timezone.ok) return err(timezone.error);
  if (!quiet.ok) return err(quiet.error);
  if (!delivery.ok) return err(delivery.error);
  const start = localTimeOrPlaceholder(quiet.value.start, 'quietHours.start');
  const end = localTimeOrPlaceholder(quiet.value.end, 'quietHours.end');
  const retry = controlledString(delivery.value.retryPolicy, 'delivery.retryPolicy', [
    '<define-after-scheduler-validation>',
    'no-retry',
    'single-retry',
    'bounded-exponential-backoff',
  ]);
  if (
    !start.ok ||
    !end.ok ||
    (start.value === end.value && !start.value.startsWith('<')) ||
    !retry.ok ||
    !exactBoolean(top.value.enabled, 'enabled').ok ||
    !exactBoolean(quiet.value.urgentBypassRequiresApproval, 'urgentBypass', true).ok ||
    !exactBoolean(delivery.value.idempotencyRequired, 'idempotencyRequired', true).ok ||
    !controlledString(delivery.value.missedRunPolicy, 'missedRunPolicy', [
      'notify-owner',
      'skip-and-notify',
    ]).ok ||
    !exactBoolean(top.value.paymentActionsAllowed, 'paymentActionsAllowed', false).ok
  )
    return fail('INVALID_VALUE', 'Reminder schema or safety invariants are invalid.');
  return finishSemanticDraft('automation-reminders', top.value);
};

export const parseAutomationSubscriptionsDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'enabled',
    'mode',
    'sources',
    'detect',
    'paymentActionsAllowed',
    'cancellationActionsAllowed',
    'changesRequireOwnerApproval',
  ]);
  if (!top.ok) return top;
  const sources = copyPlainStringArray(top.value.sources, {
    label: 'sources',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_DRAFT_STRING,
    unique: true,
  });
  const detect = copyPlainStringArray(top.value.detect, {
    label: 'detect',
    maxItems: 3,
    maxItemLength: MAX_STRING,
    allowed: ['renewal-date', 'price-change', 'duplicate-subscription'],
    unique: true,
  });
  if (
    !exactBoolean(top.value.enabled, 'enabled').ok ||
    top.value.mode !== 'read-only-observation' ||
    !sources.ok ||
    sources.value.length === 0 ||
    !detect.ok ||
    detect.value.length === 0 ||
    !exactBoolean(top.value.paymentActionsAllowed, 'paymentActionsAllowed', false).ok ||
    !exactBoolean(top.value.cancellationActionsAllowed, 'cancellationActionsAllowed', false).ok ||
    !exactBoolean(top.value.changesRequireOwnerApproval, 'changesRequireOwnerApproval', true).ok
  )
    return fail('INVALID_VALUE', 'Subscription schema or safety invariants are invalid.');
  return finishSemanticDraft('automation-subscriptions', top.value);
};

export const parseMediaCapabilitiesDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'localFirst',
    'paidProvidersEnabled',
    'capabilities',
  ]);
  if (!top.ok) return top;
  const capabilities = objectArray(top.value.capabilities, 'capabilities', 16);
  if (
    !capabilities.ok ||
    !exactBoolean(top.value.localFirst, 'localFirst', true).ok ||
    !exactBoolean(top.value.paidProvidersEnabled, 'paidProvidersEnabled', false).ok
  )
    return fail('INVALID_VALUE', 'Media capability safety flags are invalid.');
  const kinds = new Set<string>();
  for (const item of capabilities.value) {
    const capability = readExact(item, [
      'kind',
      'enabled',
      'provider',
      'requiresApprovalForExternalProcessing',
    ]);
    if (!capability.ok) return capability;
    const kind = controlledString(capability.value.kind, 'capability.kind', [
      'image-inspection',
      'audio-transcription',
      'document-extraction',
    ]);
    const provider = boundedString(
      capability.value.provider,
      'capability.provider',
      MAX_DRAFT_STRING,
    );
    if (
      !kind.ok ||
      kinds.has(kind.value) ||
      !provider.ok ||
      !exactBoolean(capability.value.enabled, 'capability.enabled').ok ||
      !exactBoolean(
        capability.value.requiresApprovalForExternalProcessing,
        'requiresApprovalForExternalProcessing',
        true,
      ).ok
    )
      return fail('INVALID_VALUE', 'Media capability entry is invalid or duplicated.');
    kinds.add(kind.value);
  }
  return finishSemanticDraft('media-capabilities', top.value);
};

const positiveNumberOrPlaceholder = (value: unknown, max: number): boolean =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max) ||
  (typeof value === 'string' && PLACEHOLDER_PATTERN.test(value));

export const parseMediaLimitsDraft = (value: unknown): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'limits',
    'onUnknownType',
    'onLimitExceeded',
  ]);
  if (!top.ok) return top;
  const limits = readExact(top.value.limits, [
    'maxInputBytes',
    'maxOutputBytes',
    'allowedMimeTypes',
    'maxDurationSeconds',
    'externalProcessing',
  ]);
  if (!limits.ok) return limits;
  const mime = copyPlainStringArray(limits.value.allowedMimeTypes, {
    label: 'allowedMimeTypes',
    maxItems: MAX_ARRAY,
    maxItemLength: MAX_STRING,
    unique: true,
  });
  if (
    !positiveNumberOrPlaceholder(limits.value.maxInputBytes, 1_073_741_824) ||
    !positiveNumberOrPlaceholder(limits.value.maxOutputBytes, 1_073_741_824) ||
    !positiveNumberOrPlaceholder(limits.value.maxDurationSeconds, 86_400) ||
    !mime.ok ||
    mime.value.length === 0 ||
    mime.value.some(
      (item, index) => !mimeOrPlaceholder(item, `allowedMimeTypes[${String(index)}]`).ok,
    ) ||
    !exactBoolean(limits.value.externalProcessing, 'externalProcessing', false).ok ||
    top.value.onUnknownType !== 'deny' ||
    top.value.onLimitExceeded !== 'deny'
  )
    return fail('INVALID_VALUE', 'Media limit schema or deny invariants are invalid.');
  if (
    typeof limits.value.maxInputBytes === 'number' &&
    typeof limits.value.maxOutputBytes === 'number' &&
    limits.value.maxOutputBytes > limits.value.maxInputBytes
  )
    return fail('INVALID_VALUE', 'maxOutputBytes must not exceed maxInputBytes.');
  return finishSemanticDraft('media-limits', top.value);
};

export const parseMemoryRetentionDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'defaultRetention',
    'classes',
    'legalHoldEnabled',
    'deletionVerificationRequired',
  ]);
  if (!top.ok) return top;
  const defaultRetention = controlledString(top.value.defaultRetention, 'defaultRetention', [
    'session-only',
    'short-lived',
    'audit-minimal',
  ]);
  const classes = readExact(top.value.classes, ['session-only', 'short-lived', 'audit-minimal']);
  if (!defaultRetention.ok) return err(defaultRetention.error);
  if (!classes.ok) return err(classes.error);
  for (const name of ['session-only', 'short-lived', 'audit-minimal'] as const) {
    const item = readExact(
      classes.value[name],
      name === 'audit-minimal'
        ? ['duration', 'persistent', 'rawContentAllowed']
        : ['duration', 'persistent'],
    );
    if (!item.ok) return item;
    if (!durationOrPlaceholder(item.value.duration, `${name}.duration`).ok)
      return fail('INVALID_VALUE', `${name} duration is invalid.`);
    const expectedPersistent = name !== 'session-only';
    if (!exactBoolean(item.value.persistent, `${name}.persistent`, expectedPersistent).ok)
      return fail('INVALID_VALUE', `${name} persistence invariant is invalid.`);
    if (
      name === 'audit-minimal' &&
      !exactBoolean(item.value.rawContentAllowed, 'rawContentAllowed', false).ok
    )
      return fail('INVALID_VALUE', 'Audit-minimal raw content must remain denied.');
  }
  if (
    !exactBoolean(top.value.legalHoldEnabled, 'legalHoldEnabled').ok ||
    !exactBoolean(top.value.deletionVerificationRequired, 'deletionVerificationRequired', true).ok
  )
    return fail('INVALID_VALUE', 'Memory retention safety flags are invalid.');
  return finishSemanticDraft('memory-retention', top.value);
};

export const parsePolicyRecipientsDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'defaultEffect',
    'recipients',
    'arbitraryRecipientsAllowed',
  ]);
  if (!top.ok) return top;
  const recipients = objectArray(top.value.recipients, 'recipients');
  if (
    !recipients.ok ||
    top.value.defaultEffect !== 'deny' ||
    !exactBoolean(top.value.arbitraryRecipientsAllowed, 'arbitraryRecipientsAllowed', false).ok
  )
    return fail('INVALID_VALUE', 'Recipient policy deny invariants are invalid.');
  const references = new Set<string>();
  for (const item of recipients.value) {
    const recipient = readExact(item, [
      'recipientRef',
      'categories',
      'allowedNotifications',
      'verified',
    ]);
    if (!recipient.ok) return recipient;
    const reference = boundedString(recipient.value.recipientRef, 'recipientRef', MAX_DRAFT_STRING);
    const categories = copyPlainStringArray(recipient.value.categories, {
      label: 'recipient.categories',
      maxItems: 8,
      maxItemLength: MAX_STRING,
      allowed: ['owner', 'project', 'system'],
      unique: true,
    });
    const notifications = copyPlainStringArray(recipient.value.allowedNotifications, {
      label: 'allowedNotifications',
      maxItems: 8,
      maxItemLength: MAX_STRING,
      allowed: ['status', 'approval-request', 'security-alert', 'digest'],
      unique: true,
    });
    if (
      !reference.ok ||
      references.has(reference.value) ||
      !categories.ok ||
      categories.value.length === 0 ||
      !notifications.ok ||
      notifications.value.length === 0 ||
      !exactBoolean(recipient.value.verified, 'recipient.verified').ok
    )
      return fail('INVALID_VALUE', 'Recipient entry is invalid or duplicated.');
    references.add(reference.value);
  }
  return finishSemanticDraft('policy-recipients', top.value);
};

export const parsePolicyRetentionDraft = (
  value: unknown,
): Result<ExactDraftConfig, ConfigFailure> => {
  const top = readSemanticDraft(value, [
    'schemaVersion',
    'status',
    'default',
    'rules',
    'deletionVerificationRequired',
  ]);
  if (!top.ok) return top;
  const rules = objectArray(top.value.rules, 'rules');
  if (
    !rules.ok ||
    top.value.default !== 'minimum-necessary' ||
    !exactBoolean(top.value.deletionVerificationRequired, 'deletionVerificationRequired', true).ok
  )
    return fail('INVALID_VALUE', 'Retention policy safety invariants are invalid.');
  const sinks = new Set<string>();
  for (const item of rules.value) {
    const discriminator = readExact(
      item,
      ['sink'],
      ['rawSensitiveDataAllowed', 'duration', 'retentionControl'],
    );
    if (!discriminator.ok) return discriminator;
    const sink = controlledString(discriminator.value.sink, 'rule.sink', [
      'logs',
      'audit',
      'external',
    ]);
    if (!sink.ok || sinks.has(sink.value))
      return fail('INVALID_VALUE', 'Retention sink is invalid or duplicated.');
    sinks.add(sink.value);
    if (sink.value === 'external') {
      const external = readExact(item, ['sink', 'retentionControl']);
      if (!external.ok || external.value.retentionControl !== 'provider-validated-or-deny')
        return fail('INVALID_VALUE', 'External retention rule is invalid.');
    } else {
      const internal = readExact(item, ['sink', 'rawSensitiveDataAllowed', 'duration']);
      if (
        !internal.ok ||
        !exactBoolean(internal.value.rawSensitiveDataAllowed, 'rawSensitiveDataAllowed', false)
          .ok ||
        !durationOrPlaceholder(internal.value.duration, 'rule.duration').ok
      )
        return fail('INVALID_VALUE', 'Internal retention rule is invalid.');
    }
  }
  return finishSemanticDraft('policy-retention', top.value);
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
  | ExactDraftKind;

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
    kind: 'automation-quotas',
    status: 'C',
    note: 'Contract-only automation quotas draft.',
  },
  {
    path: 'config/automation/subscriptions.example.json',
    kind: 'automation-subscriptions',
    status: 'C',
    note: 'Contract-only subscriptions draft.',
  },
  {
    path: 'config/automation/reminders.example.json',
    kind: 'automation-reminders',
    status: 'C',
    note: 'Contract-only reminders draft.',
  },
  {
    path: 'config/automation/notification-policy.example.json',
    kind: 'automation-notification-policy',
    status: 'C',
    note: 'Contract-only notification policy draft.',
  },
  {
    path: 'config/media/limits.example.json',
    kind: 'media-limits',
    status: 'C',
    note: 'Contract-only media limits draft.',
  },
  {
    path: 'config/media/capabilities.example.json',
    kind: 'media-capabilities',
    status: 'C',
    note: 'Contract-only media capabilities draft.',
  },
  {
    path: 'config/memory/retention.example.json',
    kind: 'memory-retention',
    status: 'C',
    note: 'Contract-only memory retention draft.',
  },
  {
    path: 'config/policy/retention.example.json',
    kind: 'policy-retention',
    status: 'C',
    note: 'Contract-only policy retention draft.',
  },
  {
    path: 'config/policy/recipients.example.json',
    kind: 'policy-recipients',
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
