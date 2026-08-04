import { err, ok } from '../../domain/result.js';
import type { ISO8601 } from '../../domain/identity.js';
import { iso8601FromDate } from '../../domain/identity.js';
import type { EnvironmentRegistryPort } from '../../ports/infrastructure-environment-registry.port.js';
import {
  sealEnvironmentRecord,
  type EnvironmentRecord,
  type EnvironmentRegistrationInput,
} from '../../domain/infrastructure/environment.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import type { EnvironmentId } from '../../domain/infrastructure/identity.js';
import { parseEnvironmentRegistrationInput } from '../../domain/infrastructure/record-parsers.js';

export const createInMemoryEnvironmentRegistry = (): EnvironmentRegistryPort => {
  const records = new Map<EnvironmentId, EnvironmentRecord>();

  return {
    register(input, now) {
      if (records.has(input.environmentId))
        return err(
          infrastructureError('duplicate-registration', 'Environment already registered.'),
        );
      const validated = parseEnvironmentRegistrationInput(input);
      if (!validated.ok) return validated;
      const record = sealEnvironmentRecord({
        ...validated.value,
        createdAt: now as ISO8601,
        updatedAt: now as ISO8601,
      });
      records.set(validated.value.environmentId, record);
      return ok(record);
    },
    updateDeclared(environmentId, update, now) {
      const existing = records.get(environmentId);
      if (existing === undefined)
        return err(infrastructureError('environment-not-found', 'Environment not found.'));
      const merged: EnvironmentRegistrationInput = {
        environmentId: existing.environmentId,
        name: update.name ?? existing.name,
        kind: update.kind ?? existing.kind,
        ownerId: update.ownerId ?? existing.ownerId,
        regionAffinity: update.regionAffinity ?? existing.regionAffinity,
        policyProfileReference: update.policyProfileReference ?? existing.policyProfileReference,
      };
      const validated = parseEnvironmentRegistrationInput(merged);
      if (!validated.ok) return validated;
      const record = sealEnvironmentRecord({
        ...validated.value,
        createdAt: existing.createdAt,
        updatedAt: now as ISO8601,
      });
      records.set(environmentId, record);
      return ok(record);
    },
    get(environmentId) {
      return records.get(environmentId) ?? null;
    },
    list() {
      return Object.freeze([...records.values()]);
    },
  };
};

export const environmentNow = (): ISO8601 => iso8601FromDate(new Date());
