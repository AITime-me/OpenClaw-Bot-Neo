import type { AccountConnection } from '../../domain/connector/connection.js';
import type { ConnectionId } from '../../domain/connector/identity.js';
import { validateAccountIdentity } from '../../domain/connector/account-identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ConnectorCatalog } from './connector-catalog.port.js';
import type { AccountConnectionRegistry } from './account-connection-registry.port.js';
import type { ConnectionFailure } from '../../domain/connector/connection.js';

export const createInMemoryAccountConnectionRegistry = (
  connectorCatalog: ConnectorCatalog,
): AccountConnectionRegistry => {
  const connections = new Map<string, AccountConnection>();

  return {
    register(connection: AccountConnection): Result<void, ConnectionFailure> {
      const identity = validateAccountIdentity(connection.accountIdentity);
      if (!identity.ok)
        return err({
          code: 'INVALID_IDENTITY',
          reason: identity.error.reason.slice(0, 256),
        });
      const connector = connectorCatalog.getManifest(connection.connectorId);
      if (connector === null)
        return err({ code: 'CONNECTOR_NOT_FOUND', reason: 'Connector is not registered.' });
      if (connector.connectorId !== connection.connectorId)
        return err({ code: 'CONNECTOR_MISMATCH', reason: 'Connection connectorId mismatch.' });
      for (const capability of connection.allowedCapabilities) {
        if (!connector.declaredCapabilities.includes(capability))
          return err({
            code: 'UNDECLARED_CAPABILITY',
            reason: 'Capability not declared by connector.',
          });
      }
      const key = connection.connectionId as string;
      if (connections.has(key))
        return err({ code: 'DUPLICATE', reason: 'Connection already registered.' });
      connections.set(key, Object.freeze({ ...connection, accountIdentity: identity.value }));
      return ok(undefined);
    },
    get(connectionId: ConnectionId): AccountConnection | null {
      const value = connections.get(connectionId);
      return value === undefined ? null : Object.freeze({ ...value });
    },
    list(): readonly AccountConnection[] {
      return Object.freeze([...connections.values()].map((item) => Object.freeze({ ...item })));
    },
  };
};
