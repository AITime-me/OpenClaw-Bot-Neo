import type { Result } from '../domain/result.js';
import type { InfrastructureObservation } from '../domain/infrastructure/observations.js';
import type { InfrastructureObservationId } from '../domain/infrastructure/identity.js';
import type { InfrastructureError } from '../domain/infrastructure/errors.js';

export interface InfrastructureObservationRegistryPort {
  record(observation: InfrastructureObservation): Result<void, InfrastructureError>;
  get(observationId: InfrastructureObservationId): InfrastructureObservation | null;
  list(): readonly InfrastructureObservation[];
}
