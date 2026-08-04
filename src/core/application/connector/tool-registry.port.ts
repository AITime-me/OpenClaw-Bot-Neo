import type {
  ToolCapability,
  ToolId,
  VerifiedToolManifest,
  ConnectorId,
} from '../../domain/connector/index.js';
import type { Result } from '../../domain/result.js';

export type ToolRegistryFailureCode =
  | 'DUPLICATE'
  | 'NOT_FOUND'
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_MISMATCH'
  | 'UNDECLARED_CAPABILITY';

export interface ToolRegistryFailure {
  readonly code: ToolRegistryFailureCode;
  readonly reason: string;
}

export interface ToolRegistry {
  register(manifest: VerifiedToolManifest): Result<void, ToolRegistryFailure>;
  get(toolId: ToolId): VerifiedToolManifest | null;
  listByConnector(connectorId: ConnectorId): readonly VerifiedToolManifest[];
  listByCapability(capability: ToolCapability): readonly VerifiedToolManifest[];
}
