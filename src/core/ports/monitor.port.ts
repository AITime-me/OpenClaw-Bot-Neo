import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { Alert } from '../domain/index.js';
export interface MonitorPort {
  check(context: OperationContext): Promise<Result<readonly Alert[], DomainError>>;
}
