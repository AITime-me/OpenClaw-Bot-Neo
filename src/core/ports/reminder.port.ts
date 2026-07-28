import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { IdempotencyKey, Reminder, ReminderId } from '../domain/index.js';
export interface ReminderPort {
  create(reminder: Reminder, context: OperationContext): Promise<Result<ReminderId, DomainError>>;
  findByIdempotencyKey(
    key: IdempotencyKey,
    context: OperationContext,
  ): Promise<Result<Reminder | null, DomainError>>;
  cancel(id: ReminderId, context: OperationContext): Promise<Result<void, DomainError>>;
}
