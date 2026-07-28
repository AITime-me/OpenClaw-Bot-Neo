import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface MediaAuditLogPort {
  record(
    metadata: Readonly<Record<string, unknown>>,
    context: OperationContext,
  ): Promise<Result<void, DomainError>>;
}
