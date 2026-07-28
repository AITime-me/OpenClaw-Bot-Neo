import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { IdempotencyKey, JobId, MediaJob } from '../domain/index.js';
export interface MediaJobQueuePort {
  enqueue(job: MediaJob, context: OperationContext): Promise<Result<JobId, DomainError>>;
  findByIdempotencyKey(
    key: IdempotencyKey,
    context: OperationContext,
  ): Promise<Result<MediaJob | null, DomainError>>;
  cancel(id: JobId, context: OperationContext): Promise<Result<void, DomainError>>;
}
