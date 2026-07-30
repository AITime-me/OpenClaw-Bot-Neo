import { isProxy } from 'node:util/types';
import { err, ok, type Result } from '../../core/domain/result.js';
import { snapshotPlainJsonDto } from '../../core/domain/json-dto-snapshot.js';
import {
  parseMemoryClassificationConfig,
  parseMemoryNamespacesConfig,
  parseModelRoutingConfig,
  parseSecurityPolicyConfig,
  type MemoryClassificationConfig,
  type MemoryNamespacesConfig,
  type ModelRoutingConfig,
  type SecurityPolicyConfig,
} from '../../core/config/index.js';

const SECTION_KEYS = Object.freeze([
  'modelRouting',
  'memoryNamespaces',
  'memoryClassification',
  'securityPolicy',
] as const);

type SectionKey = (typeof SECTION_KEYS)[number];

export type LocalHostConfigFailureCode =
  | 'INVALID_CONFIG_CONTAINER'
  | 'UNKNOWN_CONFIG_FIELD'
  | 'MISSING_CONFIG_SECTION'
  | 'INVALID_MODEL_ROUTING_CONFIG'
  | 'INVALID_MEMORY_NAMESPACES_CONFIG'
  | 'INVALID_MEMORY_CLASSIFICATION_CONFIG'
  | 'INVALID_SECURITY_POLICY_CONFIG'
  | 'UNSAFE_CONFIG_INPUT'
  | 'HOST_COMPOSITION_REJECTED';

export interface LocalHostConfigFailure {
  readonly code: LocalHostConfigFailureCode;
  readonly reason: string;
  readonly field?: string;
}

export interface LocalHostConfigDiagnostics {
  readonly sourceKind: 'parsed-object';
  readonly localOnly: true;
  readonly validatedFamilies: readonly [
    'model-routing',
    'memory-namespaces',
    'memory-classification',
    'security-policy',
  ];
  readonly credentialsLoaded: false;
  readonly providersActivated: false;
  readonly externalCompatibilityVerified: false;
  readonly fileSystemAccess: 'none';
  readonly environmentAccess: 'none';
  readonly networkClients: 'none';
  readonly apiFallbackEnabled: false;
  readonly paidFallbackEnabled: false;
  readonly deploymentReady: false;
}

export interface LocalHostConfig {
  readonly modelRouting: ModelRoutingConfig;
  readonly memoryNamespaces: MemoryNamespacesConfig;
  readonly memoryClassification: MemoryClassificationConfig;
  readonly securityPolicy: SecurityPolicyConfig;
  readonly diagnostics: LocalHostConfigDiagnostics;
}

const DIAGNOSTICS: LocalHostConfigDiagnostics = Object.freeze({
  sourceKind: 'parsed-object',
  localOnly: true,
  validatedFamilies: Object.freeze([
    'model-routing',
    'memory-namespaces',
    'memory-classification',
    'security-policy',
  ] as const),
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

const fail = (
  code: LocalHostConfigFailureCode,
  reason: string,
  field?: string,
): Result<never, LocalHostConfigFailure> =>
  err(field === undefined ? { code, reason } : { code, reason, field });

/**
 * Plain-object check for already non-Proxy values. Callers must reject Proxies with
 * `util.types.isProxy` before invoking this helper so `instanceof` / `getPrototypeOf`
 * cannot fire user traps.
 */
const isPlainObject = (value: object): boolean => {
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof RegExp) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Copies one own data property without invoking getters/setters.
 * Rejects accessors, methods, symbols, and missing keys.
 */
const readOwnDataProperty = (
  container: object,
  key: string,
): Result<unknown, LocalHostConfigFailure> => {
  if (Object.getOwnPropertySymbols(container).length > 0)
    return fail('UNSAFE_CONFIG_INPUT', 'Config object must not contain symbol keys.');
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined)
    return fail('MISSING_CONFIG_SECTION', 'Required config section is missing.', key);
  if (descriptor.get !== undefined || descriptor.set !== undefined)
    return fail('UNSAFE_CONFIG_INPUT', 'Config accessors are denied.', key);
  if (typeof descriptor.value === 'function')
    return fail('UNSAFE_CONFIG_INPUT', 'Config methods are denied.', key);
  return ok(descriptor.value);
};

/**
 * Deep plain JSON snapshot of a section without executing getters.
 * The resulting object is safe to pass into existing core config parsers.
 */
const snapshotSection = (
  value: unknown,
  field: SectionKey,
): Result<Readonly<Record<string, unknown>>, LocalHostConfigFailure> => {
  const snapshot = snapshotPlainJsonDto(value, {
    maxNodes: 512,
    maxDepth: 8,
    maxObjectKeys: 64,
    maxArrayLength: 64,
    maxStringLength: 256,
    maxKeyLength: 128,
  });
  if (!snapshot.ok)
    return fail('UNSAFE_CONFIG_INPUT', 'Config section is not a safe plain JSON object.', field);
  if (
    snapshot.value === null ||
    typeof snapshot.value !== 'object' ||
    Array.isArray(snapshot.value)
  )
    return fail('UNSAFE_CONFIG_INPUT', 'Config section must be a plain object.', field);
  return ok(snapshot.value as Readonly<Record<string, unknown>>);
};

/**
 * Pure local host config parser. Accepts only an explicit parsed object envelope with the
 * four status-A sections. No filesystem, JSON text, environment, credentials, or provider
 * activation. Success is a validated immutable snapshot, not authority evidence.
 */
export function parseLocalHostConfig(
  input: unknown,
): Result<LocalHostConfig, LocalHostConfigFailure> {
  if (input === null || typeof input !== 'object')
    return fail('INVALID_CONFIG_CONTAINER', 'Local host config must be a plain object.');
  // Reject Proxies before instanceof / getPrototypeOf / enumeration so traps never run.
  if (isProxy(input)) return fail('UNSAFE_CONFIG_INPUT', 'Proxy config containers are denied.');
  if (!isPlainObject(input))
    return fail('INVALID_CONFIG_CONTAINER', 'Local host config must be a plain object.');

  if (Object.getOwnPropertySymbols(input).length > 0)
    return fail('UNSAFE_CONFIG_INPUT', 'Config object must not contain symbol keys.');

  for (const key of Object.getOwnPropertyNames(input)) {
    if (!(SECTION_KEYS as readonly string[]).includes(key))
      return fail('UNKNOWN_CONFIG_FIELD', 'Unknown top-level config field is denied.', key);
  }

  for (const required of SECTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, required))
      return fail('MISSING_CONFIG_SECTION', 'Required config section is missing.', required);
  }

  // Reject non-enumerable own accessors/data on unexpected shapes by reading only allowed keys.
  const modelRoutingRaw = readOwnDataProperty(input, 'modelRouting');
  if (!modelRoutingRaw.ok) return modelRoutingRaw;
  const memoryNamespacesRaw = readOwnDataProperty(input, 'memoryNamespaces');
  if (!memoryNamespacesRaw.ok) return memoryNamespacesRaw;
  const memoryClassificationRaw = readOwnDataProperty(input, 'memoryClassification');
  if (!memoryClassificationRaw.ok) return memoryClassificationRaw;
  const securityPolicyRaw = readOwnDataProperty(input, 'securityPolicy');
  if (!securityPolicyRaw.ok) return securityPolicyRaw;

  const modelRoutingSnap = snapshotSection(modelRoutingRaw.value, 'modelRouting');
  if (!modelRoutingSnap.ok) return modelRoutingSnap;
  const memoryNamespacesSnap = snapshotSection(memoryNamespacesRaw.value, 'memoryNamespaces');
  if (!memoryNamespacesSnap.ok) return memoryNamespacesSnap;
  const memoryClassificationSnap = snapshotSection(
    memoryClassificationRaw.value,
    'memoryClassification',
  );
  if (!memoryClassificationSnap.ok) return memoryClassificationSnap;
  const securityPolicySnap = snapshotSection(securityPolicyRaw.value, 'securityPolicy');
  if (!securityPolicySnap.ok) return securityPolicySnap;

  const modelRouting = parseModelRoutingConfig(modelRoutingSnap.value);
  if (!modelRouting.ok)
    return fail(
      'INVALID_MODEL_ROUTING_CONFIG',
      'Model routing config failed semantic validation.',
      'modelRouting',
    );
  // apiFallbackEnabled / paidFallbackEnabled remain false via parseModelRoutingConfig.

  const memoryNamespaces = parseMemoryNamespacesConfig(memoryNamespacesSnap.value);
  if (!memoryNamespaces.ok)
    return fail(
      'INVALID_MEMORY_NAMESPACES_CONFIG',
      'Memory namespaces config failed semantic validation.',
      'memoryNamespaces',
    );

  const memoryClassification = parseMemoryClassificationConfig(memoryClassificationSnap.value);
  if (!memoryClassification.ok)
    return fail(
      'INVALID_MEMORY_CLASSIFICATION_CONFIG',
      'Memory classification config failed semantic validation.',
      'memoryClassification',
    );

  const securityPolicy = parseSecurityPolicyConfig(securityPolicySnap.value);
  if (!securityPolicy.ok)
    return fail(
      'INVALID_SECURITY_POLICY_CONFIG',
      'Security policy config failed semantic validation.',
      'securityPolicy',
    );

  return ok(
    Object.freeze({
      modelRouting: modelRouting.value,
      memoryNamespaces: memoryNamespaces.value,
      memoryClassification: memoryClassification.value,
      securityPolicy: securityPolicy.value,
      diagnostics: DIAGNOSTICS,
    }),
  );
}
