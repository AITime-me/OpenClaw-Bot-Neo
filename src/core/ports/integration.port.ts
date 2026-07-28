import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface IntegrationPort {
  read(
    operation: string,
    input: unknown,
    context: OperationContext,
  ): Promise<Result<unknown, DomainError>>;
}
