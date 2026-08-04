import { deepFreeze } from '../immutable.js';
import type { ConnectorManifest, ManifestFailure, ToolManifest } from './manifests.js';
import {
  ACCOUNT_REQUIREMENTS,
  APPROVAL_REQUIREMENTS,
  CANCELLATION_SUPPORTS,
  DATA_SENSITIVITY_LEVELS,
  IDEMPOTENCY_SUPPORTS,
  NETWORK_REQUIREMENTS,
  TOOL_CAPABILITIES,
  TOOL_RISK_CLASSES,
  TOOL_SIDE_EFFECT_CLASSES,
  isFinancialAction,
  isWriteLikeSideEffect,
} from './capabilities.js';
import {
  CONNECTOR_MANIFEST_SCHEMA_VERSION,
  CONNECTOR_MAX_MANIFEST_TIMEOUT_MS,
  CONNECTOR_MIN_TIMEOUT_MS,
  CONNECTOR_TOOL_MANIFEST_SCHEMA_VERSION,
} from './constants.js';
import { parseConnectorId, parseToolId, parseToolVersion } from './identity.js';
import { err, ok, type Result } from '../result.js';
import { validateJsonSchemaDefinition } from './json-schema-validator.js';

export type VerifiedConnectorManifest = ConnectorManifest;
export type VerifiedToolManifest = ToolManifest;

const verifiedConnectorRegistry = new WeakMap<object, ConnectorManifest>();
const verifiedToolRegistry = new WeakMap<object, ToolManifest>();

export const sealVerifiedConnectorManifest = (
  manifest: ConnectorManifest,
): VerifiedConnectorManifest => {
  const sealed = deepFreeze({
    ...manifest,
    declaredCapabilities: Object.freeze([...manifest.declaredCapabilities]),
  });
  verifiedConnectorRegistry.set(sealed, sealed);
  return sealed;
};

export const sealVerifiedToolManifest = (manifest: ToolManifest): VerifiedToolManifest => {
  const sealed = deepFreeze({
    ...manifest,
    inputSchema: deepFreeze({ ...manifest.inputSchema }),
    outputSchema: deepFreeze({ ...manifest.outputSchema }),
  });
  verifiedToolRegistry.set(sealed, sealed);
  return sealed;
};

export const isVerifiedConnectorManifest = (value: unknown): value is VerifiedConnectorManifest =>
  typeof value === 'object' && value !== null && verifiedConnectorRegistry.has(value);

export const isVerifiedToolManifest = (value: unknown): value is VerifiedToolManifest =>
  typeof value === 'object' && value !== null && verifiedToolRegistry.has(value);

const fail = (code: ManifestFailure['code'], reason: string): Result<never, ManifestFailure> =>
  err({ code, reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKnown = <T extends string>(catalog: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && catalog.some((item) => item === value);

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const validateConnectorManifest = (
  raw: unknown,
): Result<VerifiedConnectorManifest, ManifestFailure> => {
  if (!isRecord(raw)) return fail('INVALID_MANIFEST', 'Connector manifest must be an object.');
  if (raw.schemaVersion !== CONNECTOR_MANIFEST_SCHEMA_VERSION)
    return fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported connector manifest schema version.');
  const connectorParsed = parseConnectorId(raw.connectorId);
  if (!connectorParsed.ok) return fail('INVALID_MANIFEST', 'Invalid connectorId.');
  if (typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 256)
    return fail('INVALID_MANIFEST', 'Invalid title.');
  if (typeof raw.description !== 'string' || raw.description.length > 4_096)
    return fail('INVALID_MANIFEST', 'Invalid description.');
  if (typeof raw.version !== 'string' || raw.version.length === 0 || raw.version.length > 64)
    return fail('INVALID_MANIFEST', 'Invalid version.');
  if (!Array.isArray(raw.declaredCapabilities) || !unique(raw.declaredCapabilities))
    return fail('INVALID_MANIFEST', 'declaredCapabilities must be a unique array.');
  if (!raw.declaredCapabilities.every((item) => isKnown(TOOL_CAPABILITIES, item)))
    return fail('UNDECLARED_CAPABILITY', 'Unknown capability in connector manifest.');
  if (!isKnown(NETWORK_REQUIREMENTS, raw.networkRequirement))
    return fail('INVALID_MANIFEST', 'Invalid networkRequirement.');
  if (raw.accountModel !== 'none' && raw.accountModel !== 'per-connection')
    return fail('INVALID_MANIFEST', 'Invalid accountModel.');
  return ok(
    sealVerifiedConnectorManifest({
      schemaVersion: CONNECTOR_MANIFEST_SCHEMA_VERSION,
      connectorId: connectorParsed.value,
      title: raw.title,
      description: raw.description,
      version: raw.version,
      declaredCapabilities: raw.declaredCapabilities,
      networkRequirement: raw.networkRequirement,
      accountModel: raw.accountModel,
    }),
  );
};

export const validateToolManifest = (
  raw: unknown,
  connector?: VerifiedConnectorManifest,
): Result<VerifiedToolManifest, ManifestFailure> => {
  if (!isRecord(raw)) return fail('INVALID_MANIFEST', 'Tool manifest must be an object.');
  if (raw.schemaVersion !== CONNECTOR_TOOL_MANIFEST_SCHEMA_VERSION)
    return fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported tool manifest schema version.');
  const toolParsed = parseToolId(raw.toolId);
  if (!toolParsed.ok) return fail('INVALID_MANIFEST', 'Invalid toolId.');
  const connectorParsed = parseConnectorId(raw.connectorId);
  if (!connectorParsed.ok) return fail('INVALID_MANIFEST', 'Invalid connectorId.');
  const versionParsed = parseToolVersion(raw.version);
  if (!versionParsed.ok) return fail('INVALID_MANIFEST', 'Invalid version.');
  if (typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 256)
    return fail('INVALID_MANIFEST', 'Invalid title.');
  if (typeof raw.description !== 'string' || raw.description.length > 4_096)
    return fail('INVALID_MANIFEST', 'Invalid description.');
  if (!isKnown(TOOL_CAPABILITIES, raw.capability))
    return fail('UNDECLARED_CAPABILITY', 'Unknown tool capability.');
  if (!isKnown(TOOL_RISK_CLASSES, raw.riskClass))
    return fail('INVALID_MANIFEST', 'Invalid riskClass.');
  if (!isKnown(TOOL_SIDE_EFFECT_CLASSES, raw.sideEffectClass))
    return fail('INVALID_MANIFEST', 'Invalid sideEffectClass.');
  if (!isKnown(APPROVAL_REQUIREMENTS, raw.approvalRequirement))
    return fail('INVALID_MANIFEST', 'Invalid approvalRequirement.');
  if (!isKnown(IDEMPOTENCY_SUPPORTS, raw.idempotencySupport))
    return fail('INVALID_MANIFEST', 'Invalid idempotencySupport.');
  if (!isKnown(CANCELLATION_SUPPORTS, raw.cancellationSupport))
    return fail('INVALID_MANIFEST', 'Invalid cancellationSupport.');
  if (!isKnown(DATA_SENSITIVITY_LEVELS, raw.dataSensitivity))
    return fail('INVALID_MANIFEST', 'Invalid dataSensitivity.');
  if (!isKnown(NETWORK_REQUIREMENTS, raw.networkRequirement))
    return fail('INVALID_MANIFEST', 'Invalid networkRequirement.');
  if (!isKnown(ACCOUNT_REQUIREMENTS, raw.accountRequirement))
    return fail('INVALID_MANIFEST', 'Invalid accountRequirement.');
  if (
    typeof raw.timeoutMs !== 'number' ||
    !Number.isInteger(raw.timeoutMs) ||
    raw.timeoutMs < CONNECTOR_MIN_TIMEOUT_MS ||
    raw.timeoutMs > CONNECTOR_MAX_MANIFEST_TIMEOUT_MS
  )
    return fail('INVALID_TIMEOUT', 'timeoutMs is out of bounds.');
  const inputSchema = validateJsonSchemaDefinition(raw.inputSchema);
  if (!inputSchema.ok) return fail('INVALID_SCHEMA', 'Invalid inputSchema.');
  const outputSchema = validateJsonSchemaDefinition(raw.outputSchema);
  if (!outputSchema.ok) return fail('INVALID_SCHEMA', 'Invalid outputSchema.');
  const sideEffect = raw.sideEffectClass;
  const approvalRequirement = raw.approvalRequirement;
  if (isWriteLikeSideEffect(sideEffect) && approvalRequirement === 'never')
    return fail(
      'UNSAFE_COMBINATION',
      'Write-like side effect cannot use approvalRequirement=never.',
    );
  if (isFinancialAction(sideEffect))
    return fail('UNSAFE_COMBINATION', 'FINANCIAL tools cannot be configured in Build 3.5B.');
  if (raw.idempotencySupport === 'keyed' && sideEffect === 'READ_ONLY')
    return fail('UNSAFE_COMBINATION', 'Keyed idempotency requires write semantics.');
  if (
    raw.accountRequirement === 'required' &&
    connector !== undefined &&
    connector.accountModel !== 'per-connection'
  )
    return fail(
      'UNSAFE_COMBINATION',
      'Account-required tool needs per-connection connector model.',
    );
  if (
    raw.networkRequirement === 'egress-allowlisted' &&
    connector !== undefined &&
    connector.networkRequirement === 'none'
  )
    return fail('UNSAFE_COMBINATION', 'Network-requiring tool on no-network connector.');
  if (connector !== undefined) {
    if (connector.connectorId !== connectorParsed.value)
      return fail('CONNECTOR_MISMATCH', 'Tool connectorId does not match registered connector.');
    if (!connector.declaredCapabilities.includes(raw.capability))
      return fail('UNDECLARED_CAPABILITY', 'Tool capability is not declared by connector.');
  }
  return ok(
    sealVerifiedToolManifest({
      schemaVersion: CONNECTOR_TOOL_MANIFEST_SCHEMA_VERSION,
      toolId: toolParsed.value,
      connectorId: connectorParsed.value,
      version: versionParsed.value,
      title: raw.title,
      description: raw.description,
      inputSchema: inputSchema.value,
      outputSchema: outputSchema.value,
      capability: raw.capability,
      riskClass: raw.riskClass,
      sideEffectClass: sideEffect,
      approvalRequirement,
      timeoutMs: raw.timeoutMs,
      idempotencySupport: raw.idempotencySupport,
      cancellationSupport: raw.cancellationSupport,
      dataSensitivity: raw.dataSensitivity,
      networkRequirement: raw.networkRequirement,
      accountRequirement: raw.accountRequirement,
    }),
  );
};

export const validateToolAgainstConnector = (
  tool: VerifiedToolManifest,
  connector: VerifiedConnectorManifest,
): Result<void, ManifestFailure> => {
  if (tool.connectorId !== connector.connectorId)
    return fail('CONNECTOR_MISMATCH', 'Tool connectorId mismatch.');
  if (!connector.declaredCapabilities.includes(tool.capability))
    return fail('UNDECLARED_CAPABILITY', 'Tool capability not declared by connector.');
  if (tool.accountRequirement === 'required' && connector.accountModel !== 'per-connection')
    return fail('UNSAFE_COMBINATION', 'Account-required tool needs per-connection connector.');
  if (tool.networkRequirement === 'egress-allowlisted' && connector.networkRequirement === 'none')
    return fail('UNSAFE_COMBINATION', 'Network tool on no-network connector.');
  return ok(undefined);
};
