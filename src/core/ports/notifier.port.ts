import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { Notification } from '../domain/index.js';
export interface NotifierPort {
  notify(notification: Notification, context: OperationContext): Promise<Result<void, DomainError>>;
}
