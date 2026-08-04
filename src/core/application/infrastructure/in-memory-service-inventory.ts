import { err, ok } from '../../domain/result.js';
import type { ISO8601 } from '../../domain/identity.js';
import type { ServerInventoryPort } from '../../ports/infrastructure-server-inventory.port.js';
import type { ServiceInventoryPort } from '../../ports/infrastructure-service-inventory.port.js';
import {
  sealServiceRecord,
  type ServiceRecord,
  type ServiceRegistrationInput,
} from '../../domain/infrastructure/service.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import type { EnvironmentId, ServerId, ServiceId } from '../../domain/infrastructure/identity.js';
import { parseServiceRegistrationInput } from '../../domain/infrastructure/record-parsers.js';

export const createInMemoryServiceInventory = (
  servers: ServerInventoryPort,
): ServiceInventoryPort => {
  const records = new Map<ServiceId, ServiceRecord>();

  const validate = (
    input: ServiceRegistrationInput,
  ):
    | ReturnType<typeof ok<ServiceRegistrationInput>>
    | ReturnType<
        typeof err<import('../../domain/infrastructure/errors.js').InfrastructureError>
      > => {
    const server = servers.get(input.serverId);
    if (server === null)
      return err(infrastructureError('server-not-found', 'Server does not exist.'));
    if (server.environmentId !== input.environmentId)
      return err(infrastructureError('environment-mismatch', 'Environment does not match server.'));
    const parsed = parseServiceRegistrationInput(input);
    if (!parsed.ok) return parsed;
    for (const dependencyId of parsed.value.dependencyServiceIds) {
      if (records.get(dependencyId) === undefined)
        return err(infrastructureError('service-not-found', 'Dependency service does not exist.'));
    }
    return parsed;
  };

  return {
    registerDeclared(input) {
      if (records.has(input.serviceId))
        return err(infrastructureError('duplicate-registration', 'Service already registered.'));
      const validated = validate(input);
      if (!validated.ok) return validated;
      const record = sealServiceRecord(validated.value);
      records.set(validated.value.serviceId, record);
      return ok(record);
    },
    addDependency(serviceId, dependencyServiceId) {
      if (serviceId === dependencyServiceId)
        return err(infrastructureError('self-dependency', 'Service cannot depend on itself.'));
      const existing = records.get(serviceId);
      if (existing === undefined)
        return err(infrastructureError('service-not-found', 'Service not found.'));
      if (records.get(dependencyServiceId) === undefined)
        return err(infrastructureError('service-not-found', 'Dependency service not found.'));
      if (existing.dependencyServiceIds.includes(dependencyServiceId)) return ok(existing);
      const merged: ServiceRegistrationInput = {
        ...existing,
        dependencyServiceIds: Object.freeze([
          ...existing.dependencyServiceIds,
          dependencyServiceId,
        ]),
      };
      const validated = validate(merged);
      if (!validated.ok) return validated;
      const record = sealServiceRecord(validated.value);
      records.set(serviceId, record);
      return ok(record);
    },
    updateDeclared(serviceId, update, now) {
      const existing = records.get(serviceId);
      if (existing === undefined)
        return err(infrastructureError('service-not-found', 'Service not found.'));
      const merged: ServiceRegistrationInput = {
        serviceId: existing.serviceId,
        serverId: update.serverId ?? existing.serverId,
        environmentId: update.environmentId ?? existing.environmentId,
        productIdReference: update.productIdReference ?? existing.productIdReference,
        displayName: update.displayName ?? existing.displayName,
        serviceType: update.serviceType ?? existing.serviceType,
        runtimeType: update.runtimeType ?? existing.runtimeType,
        deployment: update.deployment ?? existing.deployment,
        healthCheck: update.healthCheck ?? existing.healthCheck,
        systemdUnit: update.systemdUnit ?? existing.systemdUnit,
        compose: update.compose ?? existing.compose,
        ports: update.ports ?? existing.ports,
        dependencyServiceIds: update.dependencyServiceIds ?? existing.dependencyServiceIds,
        ownerId: update.ownerId ?? existing.ownerId,
        criticality: update.criticality ?? existing.criticality,
        desiredState: update.desiredState ?? existing.desiredState,
        managementCapabilities: update.managementCapabilities ?? existing.managementCapabilities,
        lastDeclaredUpdate: now as ISO8601,
      };
      const validated = validate(merged);
      if (!validated.ok) return validated;
      const record = sealServiceRecord(validated.value);
      records.set(serviceId, record);
      return ok(record);
    },
    get(serviceId) {
      return records.get(serviceId) ?? null;
    },
    list() {
      return Object.freeze([...records.values()]);
    },
    listByServer(serverId: ServerId) {
      return Object.freeze([...records.values()].filter((record) => record.serverId === serverId));
    },
    listByEnvironment(environmentId: EnvironmentId) {
      return Object.freeze(
        [...records.values()].filter((record) => record.environmentId === environmentId),
      );
    },
  };
};
