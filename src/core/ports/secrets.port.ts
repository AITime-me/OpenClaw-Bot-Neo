import type { DomainError, Result, SecretData } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export interface SecretsPort {
  resolve(reference: string, context: OperationContext): Promise<Result<SecretData, DomainError>>;
}
