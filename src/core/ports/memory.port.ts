import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MemoryQueryContext, MemoryRecord, MemoryRecordId } from '../domain/index.js';
export interface MemoryPort {
  query(
    query: string,
    queryContext: MemoryQueryContext,
    context: OperationContext,
  ): Promise<Result<readonly MemoryRecord[], DomainError>>;
  write(
    record: MemoryRecord,
    context: OperationContext,
  ): Promise<Result<MemoryRecordId, DomainError>>;
  delete(id: MemoryRecordId, context: OperationContext): Promise<Result<void, DomainError>>;
}
