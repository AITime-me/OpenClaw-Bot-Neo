import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { QuotaWindow } from '../domain/index.js';
export interface UsageQuotaPort {
  read(
    kind: QuotaWindow['kind'],
    context: OperationContext,
  ): Promise<Result<QuotaWindow, DomainError>>;
}
