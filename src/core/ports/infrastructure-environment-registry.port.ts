import type { Result } from '../domain/result.js';
import type {
  EnvironmentRecord,
  EnvironmentRegistrationInput,
  EnvironmentRegistryFailure,
} from '../domain/infrastructure/environment.js';
import type { EnvironmentId } from '../domain/infrastructure/identity.js';

export interface EnvironmentRegistryPort {
  register(
    input: EnvironmentRegistrationInput,
    now: string,
  ): Result<EnvironmentRecord, EnvironmentRegistryFailure>;
  updateDeclared(
    environmentId: EnvironmentId,
    update: Partial<Omit<EnvironmentRegistrationInput, 'environmentId'>>,
    now: string,
  ): Result<EnvironmentRecord, EnvironmentRegistryFailure>;
  get(environmentId: EnvironmentId): EnvironmentRecord | null;
  list(): readonly EnvironmentRecord[];
}
