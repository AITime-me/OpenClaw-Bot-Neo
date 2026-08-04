import { err, ok } from '../../domain/result.js';
import type { ISO8601 } from '../../domain/identity.js';
import { iso8601FromDate } from '../../domain/identity.js';
import type { EnvironmentRegistryPort } from '../../ports/infrastructure-environment-registry.port.js';
import {
  sealEnvironmentRecord,
  type EnvironmentRecord,
} from '../../domain/infrastructure/environment.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import type { EnvironmentId } from '../../domain/infrastructure/identity.js';
import { parseBoundedText } from '../../domain/infrastructure/bounds.js';

export const createInMemoryEnvironmentRegistry = (): EnvironmentRegistryPort => {
  const records = new Map<EnvironmentId, EnvironmentRecord>();

  return {
    register(input, now) {
      if (records.has(input.environmentId))
        return err(
          infrastructureError('duplicate-registration', 'Environment already registered.'),
        );
      const policy = parseBoundedText(input.policyProfileReference, {
        max: 128,
        label: 'PolicyProfileReference',
      });
      if (!policy.ok) return err(infrastructureError('invalid-input', policy.error.reason));
      const record = sealEnvironmentRecord({
        ...input,
        policyProfileReference: policy.value,
        createdAt: now as ISO8601,
        updatedAt: now as ISO8601,
      });
      records.set(input.environmentId, record);
      return ok(record);
    },
    updateDeclared(environmentId, update, now) {
      const existing = records.get(environmentId);
      if (existing === undefined)
        return err(infrastructureError('environment-not-found', 'Environment not found.'));
      const next = sealEnvironmentRecord({
        ...existing,
        ...update,
        environmentId: existing.environmentId,
        createdAt: existing.createdAt,
        updatedAt: now as ISO8601,
      });
      records.set(environmentId, next);
      return ok(next);
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
