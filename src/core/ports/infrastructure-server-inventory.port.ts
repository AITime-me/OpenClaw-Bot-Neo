import type { Result } from '../domain/result.js';
import type {
  ServerInventoryFailure,
  ServerRecord,
  ServerRegistrationInput,
} from '../domain/infrastructure/server.js';
import type { ServerId } from '../domain/infrastructure/identity.js';

export interface ServerInventoryPort {
  registerDeclared(
    input: ServerRegistrationInput,
    now: string,
  ): Result<ServerRecord, ServerInventoryFailure>;
  updateDeclared(
    serverId: ServerId,
    update: Partial<Omit<ServerRegistrationInput, 'serverId'>>,
    now: string,
  ): Result<ServerRecord, ServerInventoryFailure>;
  get(serverId: ServerId): ServerRecord | null;
  list(): readonly ServerRecord[];
}
