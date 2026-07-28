import type { IdempotencyKey, ISO8601, ScheduledJobId } from './identity.js';
export interface ScheduledJob {
  readonly id: ScheduledJobId;
  readonly runAt: ISO8601;
  readonly timezone: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly status: 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
}
