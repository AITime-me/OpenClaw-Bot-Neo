import type {
  ToolCapability,
  ToolId,
  VerifiedToolManifest,
  ConnectorId,
} from '../../domain/connector/index.js';
import { validateToolAgainstConnector } from '../../domain/connector/manifest-validation.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ConnectorCatalog } from './connector-catalog.port.js';
import type { ToolRegistry, ToolRegistryFailure } from './tool-registry.port.js';

export const createInMemoryToolRegistry = (connectorCatalog: ConnectorCatalog): ToolRegistry => {
  const tools = new Map<string, VerifiedToolManifest>();

  return {
    register(manifest: VerifiedToolManifest): Result<void, ToolRegistryFailure> {
      const key = manifest.toolId as string;
      if (tools.has(key)) return err({ code: 'DUPLICATE', reason: 'Tool already registered.' });
      const connector = connectorCatalog.getManifest(manifest.connectorId);
      if (connector === null)
        return err({ code: 'CONNECTOR_NOT_FOUND', reason: 'Connector is not registered.' });
      const relationship = validateToolAgainstConnector(manifest, connector);
      if (!relationship.ok) {
        const code =
          relationship.error.code === 'CONNECTOR_MISMATCH'
            ? 'CONNECTOR_MISMATCH'
            : 'UNDECLARED_CAPABILITY';
        return err({ code, reason: relationship.error.reason });
      }
      tools.set(key, manifest);
      return ok(undefined);
    },
    get(toolId: ToolId): VerifiedToolManifest | null {
      return tools.get(toolId) ?? null;
    },
    listByConnector(connectorId: ConnectorId): readonly VerifiedToolManifest[] {
      return Object.freeze([...tools.values()].filter((tool) => tool.connectorId === connectorId));
    },
    listByCapability(capability: ToolCapability): readonly VerifiedToolManifest[] {
      return Object.freeze([...tools.values()].filter((tool) => tool.capability === capability));
    },
  };
};
