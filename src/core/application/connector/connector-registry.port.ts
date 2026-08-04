import type { Connector } from '../../../connectors/sdk/connector.js';
import type { ConnectorId, VerifiedConnectorManifest } from '../../domain/connector/index.js';
import type { Result } from '../../domain/result.js';

export type ConnectorRegistryFailureCode = 'DUPLICATE' | 'NOT_FOUND';

export interface ConnectorRegistryFailure {
  readonly code: ConnectorRegistryFailureCode;
  readonly reason: string;
}

export interface ConnectorRegistry {
  register(
    manifest: VerifiedConnectorManifest,
    connector: Connector,
  ): Result<void, ConnectorRegistryFailure>;
  getManifest(connectorId: ConnectorId): VerifiedConnectorManifest | null;
  getConnector(connectorId: ConnectorId): Connector | null;
  listManifests(): readonly VerifiedConnectorManifest[];
}
