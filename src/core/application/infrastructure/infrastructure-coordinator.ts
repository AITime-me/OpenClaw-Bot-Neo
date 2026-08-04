import type { EnvironmentRegistryPort } from '../../ports/infrastructure-environment-registry.port.js';
import type { ServerInventoryPort } from '../../ports/infrastructure-server-inventory.port.js';
import type { ServiceInventoryPort } from '../../ports/infrastructure-service-inventory.port.js';
import type { InfrastructureObservationRegistryPort } from '../../ports/infrastructure-observation-registry.port.js';
import { compareDrift } from '../../domain/infrastructure/drift.js';
import type { DriftComparisonInput } from '../../domain/infrastructure/drift.js';
import { MAX_LOG_BYTES, MAX_LOG_LINES } from '../../domain/infrastructure/bounds.js';
import type { InfrastructureLogRequest } from '../../domain/infrastructure/logs.js';
import { sanitizeBoundedLogPayload } from '../../domain/infrastructure/log-sanitization.js';
import type { ISO8601 } from '../../domain/identity.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import { err, ok } from '../../domain/result.js';

export interface InfrastructureCoordinatorDeps {
  readonly environments: EnvironmentRegistryPort;
  readonly servers: ServerInventoryPort;
  readonly services: ServiceInventoryPort;
  readonly observations: InfrastructureObservationRegistryPort;
}

export const createInfrastructureCoordinator = (deps: InfrastructureCoordinatorDeps) => ({
  listServerIds(environmentId?: string) {
    const servers = deps.servers.list();
    if (environmentId === undefined) return servers.map((server) => server.serverId);
    return servers
      .filter((server) => (server.environmentId as string) === environmentId)
      .map((server) => server.serverId);
  },
  listServiceIds(filter?: { readonly serverId?: string; readonly environmentId?: string }) {
    let services = deps.services.list();
    if (filter?.serverId !== undefined)
      services = services.filter((service) => (service.serverId as string) === filter.serverId);
    if (filter?.environmentId !== undefined)
      services = services.filter(
        (service) => (service.environmentId as string) === filter.environmentId,
      );
    return services.map((service) => service.serviceId);
  },
  inspectDeclaredServer(serverId: string) {
    const server = deps.servers.get(serverId as never);
    if (server === null) return err(infrastructureError('server-not-found', 'Server not found.'));
    return ok({
      serverId: server.serverId,
      lifecycleStatus: server.lifecycleStatus,
      displayName: server.displayName,
    });
  },
  compareDrift(
    input: Omit<DriftComparisonInput, 'declaredServer' | 'declaredService'> & {
      readonly serverId: string;
      readonly serviceId?: string;
    },
  ) {
    const declaredServer = deps.servers.get(input.serverId as never);
    const declaredService =
      input.serviceId === undefined ? null : deps.services.get(input.serviceId as never);
    return compareDrift({
      ...input,
      declaredServer,
      declaredService,
    });
  },
  validateLogRequest(request: InfrastructureLogRequest) {
    if (request.maximumLines < 1 || request.maximumLines > MAX_LOG_LINES)
      return err(infrastructureError('invalid-input', 'maximumLines out of bounds.'));
    if (request.maximumBytes < 1 || request.maximumBytes > MAX_LOG_BYTES)
      return err(infrastructureError('invalid-input', 'maximumBytes out of bounds.'));
    const service = deps.services.get(request.serviceId);
    if (service === null)
      return err(infrastructureError('service-not-found', 'Service not found.'));
    if ((service.serverId as string) !== (request.serverId as string))
      return err(infrastructureError('invalid-input', 'Service does not belong to server.'));
    return ok(request);
  },
  sanitizeLogLines(
    rawLines: readonly string[],
    maximumLines: number,
    maximumBytes: number,
    observedAt: ISO8601,
  ) {
    return sanitizeBoundedLogPayload(rawLines, maximumLines, maximumBytes, observedAt);
  },
});

export type InfrastructureCoordinator = ReturnType<typeof createInfrastructureCoordinator>;
