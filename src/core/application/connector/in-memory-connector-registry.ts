import type { Connector } from '../../../connectors/sdk/connector.js';
import type { ConnectorId, VerifiedConnectorManifest } from '../../domain/connector/index.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ConnectorRegistry, ConnectorRegistryFailure } from './connector-registry.port.js';

export const createInMemoryConnectorRegistry = (): ConnectorRegistry => {
  const manifests = new Map<string, VerifiedConnectorManifest>();
  const connectors = new Map<string, Connector>();

  return {
    register(
      manifest: VerifiedConnectorManifest,
      connector: Connector,
    ): Result<void, ConnectorRegistryFailure> {
      const key = manifest.connectorId as string;
      if (manifests.has(key))
        return err({ code: 'DUPLICATE', reason: 'Connector already registered.' });
      manifests.set(key, manifest);
      connectors.set(key, connector);
      return ok(undefined);
    },
    getManifest(connectorId: ConnectorId): VerifiedConnectorManifest | null {
      return manifests.get(connectorId) ?? null;
    },
    getConnector(connectorId: ConnectorId): Connector | null {
      return connectors.get(connectorId) ?? null;
    },
    listManifests(): readonly VerifiedConnectorManifest[] {
      return Object.freeze([...manifests.values()]);
    },
  };
};
