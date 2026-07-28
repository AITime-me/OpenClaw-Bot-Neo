import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { CapabilityStatus } from '../domain/index.js';
export interface CapabilityRegistryPort {
  resolve(
    capability: string,
    context: OperationContext,
  ): Promise<Result<CapabilityStatus, DomainError>>;
}
