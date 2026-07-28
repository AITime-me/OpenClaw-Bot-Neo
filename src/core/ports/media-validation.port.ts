import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset } from '../domain/index.js';
export interface MediaValidationPort {
  validate(
    input: Uint8Array,
    declaredType: string,
    context: OperationContext,
  ): Promise<Result<MediaAsset, DomainError>>;
}
