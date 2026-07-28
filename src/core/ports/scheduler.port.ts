import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { ScheduledJob, ScheduledJobId } from '../domain/index.js';
export interface SchedulerPort {
  schedule(
    job: ScheduledJob,
    context: OperationContext,
  ): Promise<Result<ScheduledJobId, DomainError>>;
  cancel(id: ScheduledJobId, context: OperationContext): Promise<Result<void, DomainError>>;
}
