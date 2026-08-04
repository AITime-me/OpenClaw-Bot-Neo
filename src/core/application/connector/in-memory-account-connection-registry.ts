import type { AccountConnection } from '../../domain/connector/connection.js';
import type { ConnectionId } from '../../domain/connector/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ConnectorRegistry } from './connector-registry.port.js';
import type { AccountConnectionRegistry } from './account-connection-registry.port.js';
import type { ConnectionFailure } from '../../domain/connector/connection.js';

const CREDENTIAL_FIELD_PATTERN =
  /^(password|secret|token|apiKey|api_key|credential|privateKey|cookie)$/i;

export const createInMemoryAccountConnectionRegistry = (
  connectorRegistry: ConnectorRegistry,
): AccountConnectionRegistry => {
  const connections = new Map<string, AccountConnection>();

  return {
    register(connection: AccountConnection): Result<void, ConnectionFailure> {
      const connector = connectorRegistry.getManifest(connection.connectorId);
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
      if (CREDENTIAL_FIELD_PATTERN.test(connection.accountIdentity))
        return err({
          code: 'CREDENTIAL_FIELD',
          reason: 'Account identity looks like a credential field.',
        });
      const key = connection.connectionId as string;
      if (connections.has(key))
        return err({ code: 'DUPLICATE', reason: 'Connection already registered.' });
      connections.set(key, Object.freeze({ ...connection }));
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
