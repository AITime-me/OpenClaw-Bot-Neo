import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset, MediaDerivative } from '../domain/index.js';
export interface DocumentProcessingPort {
  process(
    assets: readonly MediaAsset[],
    context: OperationContext,
  ): Promise<Result<readonly MediaDerivative[], DomainError>>;
}
