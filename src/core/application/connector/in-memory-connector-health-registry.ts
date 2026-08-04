import type { ConnectorHealthSnapshot } from '../../domain/connector/health.js';
import type { ConnectorId, ConnectionId } from '../../domain/connector/identity.js';
import type { ConnectorHealthRegistry } from './connector-health-registry.port.js';

const CONNECTOR_ONLY = Symbol('connector-only');

export const createInMemoryConnectorHealthRegistry = (): ConnectorHealthRegistry => {
  const byConnector = new Map<
    string,
    Map<typeof CONNECTOR_ONLY | string, ConnectorHealthSnapshot>
  >();

  const bucketFor = (
    connectorId: ConnectorId,
  ): Map<typeof CONNECTOR_ONLY | string, ConnectorHealthSnapshot> => {
    const connectorKey = String(connectorId);
    let bucket = byConnector.get(connectorKey);
    if (bucket === undefined) {
      bucket = new Map();
      byConnector.set(connectorKey, bucket);
    }
    return bucket;
  };

  const keyFor = (connectionId: ConnectionId | null | undefined): typeof CONNECTOR_ONLY | string =>
    connectionId === null || connectionId === undefined ? CONNECTOR_ONLY : String(connectionId);

  return {
    get(
      connectorId: ConnectorId,
      connectionId?: ConnectionId | null,
    ): ConnectorHealthSnapshot | null {
      const bucket = byConnector.get(String(connectorId));
      if (bucket === undefined) return null;
      const snapshot = bucket.get(keyFor(connectionId));
      return snapshot === undefined ? null : Object.freeze({ ...snapshot });
    },
    update(snapshot: ConnectorHealthSnapshot): void {
      const bucket = bucketFor(snapshot.connectorId);
      bucket.set(keyFor(snapshot.connectionId), Object.freeze({ ...snapshot }));
    },
    list(): readonly ConnectorHealthSnapshot[] {
      const all: ConnectorHealthSnapshot[] = [];
      for (const bucket of byConnector.values()) {
        for (const snapshot of bucket.values()) all.push(Object.freeze({ ...snapshot }));
      }
      return Object.freeze(all);
    },
  };
};
