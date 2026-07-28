import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface SecretsPort {
  resolve(reference: string, context: OperationContext): Promise<Result<string, DomainError>>;
}
