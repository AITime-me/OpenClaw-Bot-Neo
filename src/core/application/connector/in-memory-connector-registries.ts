import type { Connector } from '../../../connectors/sdk/connector.js';
import type { ConnectorId, VerifiedConnectorManifest } from '../../domain/connector/index.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ConnectorCatalog, ConnectorCatalogFailure } from './connector-catalog.port.js';
import type { ConnectorExecutionRegistry } from './connector-execution-registry.port.js';

export const createInMemoryConnectorRegistries = (): {
  readonly catalog: ConnectorCatalog;
  readonly execution: ConnectorExecutionRegistry;
} => {
  const manifests = new Map<string, VerifiedConnectorManifest>();
  const connectors = new Map<string, Connector>();

  const catalog: ConnectorCatalog = {
    register(
      manifest: VerifiedConnectorManifest,
      connector: Connector,
    ): Result<void, ConnectorCatalogFailure> {
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
    listManifests(): readonly VerifiedConnectorManifest[] {
      return Object.freeze([...manifests.values()]);
    },
  };

  const execution: ConnectorExecutionRegistry = {
    getConnector(connectorId: ConnectorId): Connector | null {
      return connectors.get(connectorId) ?? null;
    },
  };

  return { catalog, execution };
};
