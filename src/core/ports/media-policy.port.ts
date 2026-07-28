import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaAsset } from '../domain/index.js';
export interface MediaPolicyPort {
  evaluate(
    asset: MediaAsset,
    context: OperationContext,
  ): Promise<Result<'allow' | 'deny' | 'approval-required', DomainError>>;
}
