import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MemoryRecord, MemoryWriteDecision } from '../domain/index.js';
export interface MemoryPolicyPort {
  evaluate(
    record: MemoryRecord,
    context: OperationContext,
  ): Promise<Result<MemoryWriteDecision, DomainError>>;
}
