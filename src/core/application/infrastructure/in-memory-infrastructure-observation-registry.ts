import { err, ok } from '../../domain/result.js';
import type { InfrastructureObservationRegistryPort } from '../../ports/infrastructure-observation-registry.port.js';
import type { InfrastructureObservation } from '../../domain/infrastructure/observations.js';
import { infrastructureError } from '../../domain/infrastructure/errors.js';
import type { InfrastructureObservationId } from '../../domain/infrastructure/identity.js';
import { parseInfrastructureObservationInput } from '../../domain/infrastructure/record-parsers.js';

export const createInMemoryInfrastructureObservationRegistry =
  (): InfrastructureObservationRegistryPort => {
    const records = new Map<InfrastructureObservationId, InfrastructureObservation>();

    return {
      record(observation) {
        if (records.has(observation.observationId))
          return err(
            infrastructureError('duplicate-registration', 'Observation already recorded.'),
          );
        const validated = parseInfrastructureObservationInput(observation);
        if (!validated.ok) return validated;
        records.set(validated.value.observationId, validated.value);
        return ok(undefined);
      },
      get(observationId: InfrastructureObservationId) {
        return records.get(observationId) ?? null;
      },
      list() {
        return Object.freeze([...records.values()]);
      },
    };
  };
