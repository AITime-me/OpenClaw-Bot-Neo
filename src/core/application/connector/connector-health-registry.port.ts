import type { ConnectorHealthSnapshot } from '../../domain/connector/health.js';
import type { ConnectorId, ConnectionId } from '../../domain/connector/identity.js';

export interface ConnectorHealthRegistry {
  get(connectorId: ConnectorId, connectionId?: ConnectionId | null): ConnectorHealthSnapshot | null;
  update(snapshot: ConnectorHealthSnapshot): void;
  list(): readonly ConnectorHealthSnapshot[];
}
