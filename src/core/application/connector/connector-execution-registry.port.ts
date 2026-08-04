import type { Connector } from '../../../connectors/sdk/connector.js';
import type { ConnectorId } from '../../domain/connector/index.js';

/** Orchestrator-private executable connector lookup — not exported from public barrels. */
export interface ConnectorExecutionRegistry {
  getConnector(connectorId: ConnectorId): Connector | null;
}
