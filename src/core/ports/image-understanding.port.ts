import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset, MediaDerivative } from '../domain/index.js';
export interface ImageUnderstandingPort {
  analyze(
    assets: readonly MediaAsset[],
    prompt: string,
    context: OperationContext,
  ): Promise<Result<MediaDerivative, DomainError>>;
}
