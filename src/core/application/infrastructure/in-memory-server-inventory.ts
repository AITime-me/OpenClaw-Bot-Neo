import { err, ok } from '../../domain/result.js';
import type { ISO8601 } from '../../domain/identity.js';
import type { EnvironmentRegistryPort } from '../../ports/infrastructure-environment-registry.port.js';
import type { ServerInventoryPort } from '../../ports/infrastructure-server-inventory.port.js';
import {
  sealServerRecord,
  type ServerRecord,
  type ServerRegistrationInput,
} from '../../domain/infrastructure/server.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import type { ServerId } from '../../domain/infrastructure/identity.js';
import { parseServerRegistrationInput } from '../../domain/infrastructure/record-parsers.js';

export const createInMemoryServerInventory = (
  environments: EnvironmentRegistryPort,
): ServerInventoryPort => {
  const records = new Map<ServerId, ServerRecord>();

  const validateInput = (
    input: ServerRegistrationInput,
  ):
    | ReturnType<typeof ok<ServerRegistrationInput>>
    | ReturnType<
        typeof err<import('../../domain/infrastructure/errors.js').InfrastructureError>
      > => {
    if (environments.get(input.environmentId) === null)
      return err(infrastructureError('environment-not-found', 'Environment does not exist.'));
    return parseServerRegistrationInput(input);
  };

  return {
    registerDeclared(input, now) {
      if (records.has(input.serverId))
        return err(infrastructureError('duplicate-registration', 'Server already registered.'));
      const validated = validateInput(input);
      if (!validated.ok) return validated;
      const record = sealServerRecord({
        ...validated.value,
        createdAt: now as ISO8601,
        updatedAt: now as ISO8601,
      });
      records.set(validated.value.serverId, record);
      return ok(record);
    },
    updateDeclared(serverId, update, now) {
      const existing = records.get(serverId);
      if (existing === undefined)
        return err(infrastructureError('server-not-found', 'Server not found.'));
      const merged: ServerRegistrationInput = {
        serverId: existing.serverId,
        providerId: update.providerId ?? existing.providerId,
        providerServerId: update.providerServerId ?? existing.providerServerId,
        environmentId: update.environmentId ?? existing.environmentId,
        regionId: update.regionId ?? existing.regionId,
        displayName: update.displayName ?? existing.displayName,
        purpose: update.purpose ?? existing.purpose,
        lifecycleStatus: update.lifecycleStatus ?? existing.lifecycleStatus,
        os: update.os ?? existing.os,
        capacity: update.capacity ?? existing.capacity,
        addressing: update.addressing ?? existing.addressing,
        managementCapabilities: update.managementCapabilities ?? existing.managementCapabilities,
        hostConnection: update.hostConnection ?? existing.hostConnection,
        ownerId: update.ownerId ?? existing.ownerId,
      };
      const validated = validateInput(merged);
      if (!validated.ok) return validated;
      const record = sealServerRecord({
        ...validated.value,
        createdAt: existing.createdAt,
        updatedAt: now as ISO8601,
      });
      records.set(serverId, record);
      return ok(record);
    },
    get(serverId) {
      return records.get(serverId) ?? null;
    },
    list() {
      return Object.freeze([...records.values()]);
    },
  };
};
