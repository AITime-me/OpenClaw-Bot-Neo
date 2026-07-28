import {
  APPROVAL_EFFECTS,
  DANGEROUS_EXTENSION_PERMISSIONS,
  err,
  EXTENSION_IO_KINDS,
  EXTENSION_KINDS,
  EXTENSION_MANIFEST_SCHEMA_VERSION,
  EXTENSION_PERMISSIONS,
  EXTENSION_PORTS,
  EXTENSION_RISK_CLASSES,
  isDangerousExtensionPermission,
  ok,
  requiredApprovalEffectFor,
  type ExtensionManifest,
  type ExtensionManifestFailure,
  type Result,
  type VerifiedExtensionManifest,
} from '../domain/index.js';
import { sealVerifiedExtensionManifest } from '../domain/extension-manifest.internal.js';
import { scanSensitiveData } from './sensitive-data-scanner.js';

const ROOT_FIELDS = Object.freeze([
  'schemaVersion',
  'id',
  'version',
  'kind',
  'displayName',
  'description',
  'declaredCapabilities',
  'requiredPorts',
  'requestedPermissions',
  'riskClass',
  'approvalPolicy',
  'dataClassifications',
  'supportedInputKinds',
  'supportedOutputKinds',
  'configurationSchemaVersion',
  'enabled',
  'provenance',
  'ownerScope',
] as const);
const APPROVAL_FIELDS = Object.freeze(['mode', 'effects'] as const);
const PROVENANCE_FIELDS = Object.freeze(['status', 'source', 'note'] as const);
const OWNER_SCOPE_FIELDS = Object.freeze(['mode', 'ownerReference'] as const);
const PRIVACY_CLASSES = Object.freeze([
  'public',
  'internal',
  'confidential',
  'commercial-secret',
  'security-restricted',
] as const);
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*@[1-9]\d*$/;

const fail = (
  code: ExtensionManifestFailure['code'],
  reason: string,
): Result<never, ExtensionManifestFailure> => err({ code, reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const hasExactFields = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.some((allowedKey) => allowedKey === key)) &&
  allowed.every((key) => Object.hasOwn(value, key));
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const isKnownValue = <T extends string>(catalog: readonly T[], value: unknown): value is T =>
  catalog.some((known) => known === value);
const isKnownArray = <T extends string>(catalog: readonly T[], value: unknown): value is T[] =>
  Array.isArray(value) &&
  value.every(
    (item): item is T => typeof item === 'string' && catalog.some((known) => known === item),
  );

export function validateExtensionManifest(
  candidate: unknown,
): Result<VerifiedExtensionManifest, ExtensionManifestFailure> {
  if (!isRecord(candidate)) return fail('INVALID_MANIFEST', 'Manifest must be an object.');
  const unknownRoot = Object.keys(candidate).find((key) => !isKnownValue(ROOT_FIELDS, key));
  if (unknownRoot !== undefined)
    return fail('UNKNOWN_FIELD', `Manifest contains unsupported field "${unknownRoot}".`);
  if (!Object.hasOwn(candidate, 'approvalPolicy'))
    return fail('MISSING_APPROVAL_POLICY', 'Approval policy is required.');
  if (!hasExactFields(candidate, ROOT_FIELDS))
    return fail('INVALID_MANIFEST', 'Manifest is missing one or more required fields.');
  if (candidate.schemaVersion !== EXTENSION_MANIFEST_SCHEMA_VERSION)
    return fail('UNSUPPORTED_SCHEMA_VERSION', 'Manifest schema version is unsupported.');
  if (!isKnownValue(EXTENSION_KINDS, candidate.kind))
    return fail('UNKNOWN_KIND', 'Extension kind is unknown.');
  if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id))
    return fail('INVALID_MANIFEST', 'Extension identifier is malformed.');
  if (typeof candidate.version !== 'string' || !VERSION_PATTERN.test(candidate.version))
    return fail('INVALID_VERSION', 'Extension version must be an exact semantic version.');
  if (
    typeof candidate.configurationSchemaVersion !== 'string' ||
    !VERSION_PATTERN.test(candidate.configurationSchemaVersion)
  )
    return fail('INVALID_VERSION', 'Configuration schema version must be exact.');
  if (
    typeof candidate.displayName !== 'string' ||
    candidate.displayName.length === 0 ||
    typeof candidate.description !== 'string' ||
    candidate.description.length === 0 ||
    candidate.description.length > 2_000
  )
    return fail('INVALID_MANIFEST', 'Display name and bounded description are required.');
  if (
    !isStringArray(candidate.declaredCapabilities) ||
    candidate.declaredCapabilities.length === 0 ||
    !unique(candidate.declaredCapabilities)
  )
    return fail('INVALID_CAPABILITY_ID', 'Declared capabilities must be unique identifiers.');
  if (!candidate.declaredCapabilities.every((value) => CAPABILITY_PATTERN.test(value)))
    return fail('INVALID_CAPABILITY_ID', 'Capability identifiers must be versioned.');
  if (
    !isKnownArray(EXTENSION_PORTS, candidate.requiredPorts) ||
    !unique(candidate.requiredPorts) ||
    !candidate.requiredPorts.every((value) => isKnownValue(EXTENSION_PORTS, value))
  )
    return fail('UNKNOWN_PORT', 'Manifest requests an unknown core port.');
  if (
    !isKnownArray(EXTENSION_PERMISSIONS, candidate.requestedPermissions) ||
    !unique(candidate.requestedPermissions)
  )
    return fail('UNKNOWN_PERMISSION', 'Requested permissions must be unique identifiers.');
  if (!isKnownValue(EXTENSION_RISK_CLASSES, candidate.riskClass))
    return fail('UNKNOWN_RISK_CLASS', 'Risk class is unknown.');
  if (!isRecord(candidate.approvalPolicy))
    return fail('MISSING_APPROVAL_POLICY', 'Approval policy is required.');
  if (!hasExactFields(candidate.approvalPolicy, APPROVAL_FIELDS))
    return fail('UNKNOWN_FIELD', 'Approval policy fields are incomplete or unsupported.');
  const approvalMode = candidate.approvalPolicy.mode;
  const approvalEffects = candidate.approvalPolicy.effects;
  if (
    approvalMode !== 'none' &&
    approvalMode !== 'required-for-dangerous' &&
    approvalMode !== 'always'
  )
    return fail('MISSING_APPROVAL_POLICY', 'Approval policy mode is malformed.');
  if (!Array.isArray(approvalEffects) || !unique(approvalEffects as string[]))
    return fail('MISSING_APPROVAL_POLICY', 'Approval policy effects are malformed.');
  if (!approvalEffects.every((value) => isKnownValue(APPROVAL_EFFECTS, value)))
    return fail('UNKNOWN_APPROVAL_EFFECT', 'Approval policy contains an unknown effect.');

  const requestsDangerous = candidate.requestedPermissions.some((permission) =>
    isKnownValue(DANGEROUS_EXTENSION_PERMISSIONS, permission),
  );
  if (requestsDangerous && approvalMode === 'none')
    return fail('APPROVAL_POLICY_REQUIRED', 'Dangerous permissions require approval policy.');
  if (requestsDangerous && approvalEffects.length === 0)
    return fail('APPROVAL_EFFECT_MISMATCH', 'Dangerous permissions require approval effects.');
  for (const permission of candidate.requestedPermissions) {
    if (!isDangerousExtensionPermission(permission)) continue;
    const required = requiredApprovalEffectFor(permission);
    if (required === null || !approvalEffects.includes(required))
      return fail(
        'APPROVAL_EFFECT_MISMATCH',
        'Dangerous permission lacks the matching approval effect.',
      );
  }

  if (
    !isKnownArray(PRIVACY_CLASSES, candidate.dataClassifications) ||
    candidate.dataClassifications.length === 0 ||
    !candidate.dataClassifications.every((value) => isKnownValue(PRIVACY_CLASSES, value))
  )
    return fail('INVALID_MANIFEST', 'Data classification is unknown.');
  if (
    !isKnownArray(EXTENSION_IO_KINDS, candidate.supportedInputKinds) ||
    candidate.supportedInputKinds.length === 0 ||
    !candidate.supportedInputKinds.every((value) => isKnownValue(EXTENSION_IO_KINDS, value)) ||
    !isKnownArray(EXTENSION_IO_KINDS, candidate.supportedOutputKinds) ||
    candidate.supportedOutputKinds.length === 0 ||
    !candidate.supportedOutputKinds.every((value) => isKnownValue(EXTENSION_IO_KINDS, value))
  )
    return fail('INVALID_MANIFEST', 'Input or output kind is unknown.');
  if (typeof candidate.enabled !== 'boolean')
    return fail('INVALID_MANIFEST', 'Enabled must be boolean.');
  if (!isRecord(candidate.provenance) || !hasExactFields(candidate.provenance, PROVENANCE_FIELDS))
    return fail('UNKNOWN_FIELD', 'Provenance fields are incomplete or unsupported.');
  if (
    (candidate.provenance.status !== 'verified' && candidate.provenance.status !== 'unverified') ||
    (candidate.provenance.source !== 'project' &&
      candidate.provenance.source !== 'trusted-deployment') ||
    typeof candidate.provenance.note !== 'string'
  )
    return fail('INVALID_MANIFEST', 'Provenance is malformed.');
  if (!isRecord(candidate.ownerScope) || !hasExactFields(candidate.ownerScope, OWNER_SCOPE_FIELDS))
    return fail('UNKNOWN_FIELD', 'Owner scope fields are incomplete or unsupported.');
  if (
    (candidate.ownerScope.mode !== 'deployment-owner' &&
      candidate.ownerScope.mode !== 'explicit-owner') ||
    typeof candidate.ownerScope.ownerReference !== 'string' ||
    candidate.ownerScope.ownerReference.length === 0
  )
    return fail('INVALID_MANIFEST', 'Owner scope is malformed.');

  const scan = scanSensitiveData(JSON.stringify(candidate));
  if (!scan.ok || scan.value.findings.length > 0)
    return fail('SECRET_LIKE_CONTENT', 'Manifest contains secret-like content.');
  const serialized = JSON.stringify(candidate).toLowerCase();
  if (
    [
      'import(',
      'require(',
      'node -e ',
      'powershell -',
      'cmd /c ',
      'curl ',
      'wget ',
      'rm -rf',
      '| sh',
    ].some((fragment) => serialized.includes(fragment))
  )
    return fail('EXECUTABLE_CONTENT', 'Manifest contains executable command-like content.');

  const manifest: ExtensionManifest = {
    schemaVersion: EXTENSION_MANIFEST_SCHEMA_VERSION,
    id: candidate.id,
    version: candidate.version,
    kind: candidate.kind,
    displayName: candidate.displayName,
    description: candidate.description,
    declaredCapabilities: candidate.declaredCapabilities,
    requiredPorts: candidate.requiredPorts,
    requestedPermissions: candidate.requestedPermissions,
    riskClass: candidate.riskClass,
    approvalPolicy: { mode: approvalMode, effects: approvalEffects },
    dataClassifications: candidate.dataClassifications,
    supportedInputKinds: candidate.supportedInputKinds,
    supportedOutputKinds: candidate.supportedOutputKinds,
    configurationSchemaVersion: candidate.configurationSchemaVersion,
    enabled: candidate.enabled,
    provenance: {
      status: candidate.provenance.status,
      source: candidate.provenance.source,
      note: candidate.provenance.note,
    },
    ownerScope: {
      mode: candidate.ownerScope.mode,
      ownerReference: candidate.ownerScope.ownerReference,
    },
  };
  return ok(sealVerifiedExtensionManifest(manifest));
}
