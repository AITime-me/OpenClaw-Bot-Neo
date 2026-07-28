import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset } from '../domain/index.js';
export interface VideoIngestionPort {
  ingest(
    input: Uint8Array | URL,
    context: OperationContext,
  ): Promise<Result<MediaAsset, DomainError>>;
}
