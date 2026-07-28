import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset, MediaDerivative } from '../domain/index.js';
export interface ImageOcrPort {
  extractText(
    asset: MediaAsset,
    context: OperationContext,
  ): Promise<Result<MediaDerivative, DomainError>>;
}
