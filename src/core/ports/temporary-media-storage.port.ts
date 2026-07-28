import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset } from '../domain/index.js';
export interface TemporaryMediaStoragePort {
  store(
    bytes: Uint8Array,
    asset: MediaAsset,
    context: OperationContext,
  ): Promise<Result<string, DomainError>>;
  remove(reference: string, context: OperationContext): Promise<Result<void, DomainError>>;
}
