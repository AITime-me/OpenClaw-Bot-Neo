import type { AccountConnection, ConnectionFailure } from '../../domain/connector/connection.js';
import type { ConnectionId } from '../../domain/connector/identity.js';
import type { Result } from '../../domain/result.js';

export interface AccountConnectionRegistry {
  register(connection: AccountConnection): Result<void, ConnectionFailure>;
  get(connectionId: ConnectionId): AccountConnection | null;
  list(): readonly AccountConnection[];
}
