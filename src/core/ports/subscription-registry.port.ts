import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { Subscription } from '../domain/index.js';
export interface SubscriptionRegistryPort {
  list(context: OperationContext): Promise<Result<readonly Subscription[], DomainError>>;
}
