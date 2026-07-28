import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface ApprovalPort {
  request(
    action: string,
    context: OperationContext,
  ): Promise<Result<'approved' | 'denied' | 'expired', DomainError>>;
}
