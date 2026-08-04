import type { ConnectorId, VerifiedConnectorManifest } from '../../domain/connector/index.js';
import type { Result } from '../../domain/result.js';
import type { Connector } from '../../../connectors/sdk/connector.js';

export type ConnectorCatalogFailureCode = 'DUPLICATE' | 'NOT_FOUND';

export interface ConnectorCatalogFailure {
  readonly code: ConnectorCatalogFailureCode;
  readonly reason: string;
}

/** Public connector metadata surface — no execute capability. */
export interface ConnectorCatalog {
  register(
    manifest: VerifiedConnectorManifest,
    connector: Connector,
  ): Result<void, ConnectorCatalogFailure>;
  getManifest(connectorId: ConnectorId): VerifiedConnectorManifest | null;
  listManifests(): readonly VerifiedConnectorManifest[];
}
