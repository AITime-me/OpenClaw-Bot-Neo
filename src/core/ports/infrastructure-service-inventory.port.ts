import type { Result } from '../domain/result.js';
import type {
  ServiceInventoryFailure,
  ServiceRecord,
  ServiceRegistrationInput,
} from '../domain/infrastructure/service.js';
import type { EnvironmentId, ServerId, ServiceId } from '../domain/infrastructure/identity.js';

export interface ServiceInventoryPort {
  registerDeclared(input: ServiceRegistrationInput): Result<ServiceRecord, ServiceInventoryFailure>;
  addDependency(
    serviceId: ServiceId,
    dependencyServiceId: ServiceId,
  ): Result<ServiceRecord, ServiceInventoryFailure>;
  updateDeclared(
    serviceId: ServiceId,
    update: Partial<Omit<ServiceRegistrationInput, 'serviceId'>>,
    now: string,
  ): Result<ServiceRecord, ServiceInventoryFailure>;
  get(serviceId: ServiceId): ServiceRecord | null;
  list(): readonly ServiceRecord[];
  listByServer(serverId: ServerId): readonly ServiceRecord[];
  listByEnvironment(environmentId: EnvironmentId): readonly ServiceRecord[];
}
