import type { ToolCapability } from './capabilities.js';
import type { ConnectorId } from './identity.js';
import type { JsonSchema } from './schema.js';

export interface CapabilityManifest {
  readonly schemaVersion: string;
  readonly connectorId: ConnectorId;
  readonly declaredCapabilities: readonly ToolCapability[];
  readonly networkRequirement: 'none' | 'egress-allowlisted';
  readonly accountModel: 'none' | 'per-connection';
}

export interface ConnectorManifest {
  readonly schemaVersion: string;
  readonly connectorId: ConnectorId;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly declaredCapabilities: readonly ToolCapability[];
  readonly networkRequirement: 'none' | 'egress-allowlisted';
  readonly accountModel: 'none' | 'per-connection';
}

export interface ToolManifest {
  readonly schemaVersion: string;
  readonly toolId: import('./identity.js').ToolId;
  readonly connectorId: ConnectorId;
  readonly version: import('./identity.js').ToolVersion;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly capability: ToolCapability;
  readonly riskClass: import('./capabilities.js').ToolRiskClass;
  readonly sideEffectClass: import('./capabilities.js').ToolSideEffectClass;
  readonly approvalRequirement: import('./capabilities.js').ApprovalRequirement;
  readonly timeoutMs: number;
  readonly idempotencySupport: import('./capabilities.js').IdempotencySupport;
  readonly cancellationSupport: import('./capabilities.js').CancellationSupport;
  readonly dataSensitivity: import('./capabilities.js').DataSensitivity;
  readonly networkRequirement: import('./capabilities.js').NetworkRequirement;
  readonly accountRequirement: import('./capabilities.js').AccountRequirement;
}

export type ManifestFailureCode =
  | 'INVALID_MANIFEST'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNSAFE_COMBINATION'
  | 'INVALID_SCHEMA'
  | 'INVALID_TIMEOUT'
  | 'CONNECTOR_MISMATCH'
  | 'UNDECLARED_CAPABILITY';

export interface ManifestFailure {
  readonly code: ManifestFailureCode;
  readonly reason: string;
}
