import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface RemoteMediaFetcherPort {
  fetch(
    url: URL,
    maxBytes: number,
    context: OperationContext,
  ): Promise<Result<Uint8Array, DomainError>>;
}
