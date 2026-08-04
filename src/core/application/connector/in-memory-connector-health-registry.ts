import type { ConnectorHealthSnapshot } from '../../domain/connector/health.js';
import type { ConnectorId, ConnectionId } from '../../domain/connector/identity.js';
import type { ConnectorHealthRegistry } from './connector-health-registry.port.js';

export const createInMemoryConnectorHealthRegistry = (): ConnectorHealthRegistry => {
  const snapshots = new Map<string, ConnectorHealthSnapshot>();

  const keyOf = (connectorId: ConnectorId, connectionId: ConnectionId | null | undefined): string =>
    `${connectorId as string}:${connectionId === null || connectionId === undefined ? '_' : (connectionId as string)}`;

  return {
    get(
      connectorId: ConnectorId,
      connectionId?: ConnectionId | null,
    ): ConnectorHealthSnapshot | null {
      const snapshot = snapshots.get(keyOf(connectorId, connectionId ?? null));
      return snapshot === undefined ? null : Object.freeze({ ...snapshot });
    },
    update(snapshot: ConnectorHealthSnapshot): void {
      snapshots.set(
        keyOf(snapshot.connectorId, snapshot.connectionId),
        Object.freeze({ ...snapshot }),
      );
    },
    list(): readonly ConnectorHealthSnapshot[] {
      return Object.freeze([...snapshots.values()].map((item) => Object.freeze({ ...item })));
    },
  };
};
