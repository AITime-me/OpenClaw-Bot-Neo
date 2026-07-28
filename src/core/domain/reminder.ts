import type { IdempotencyKey, ISO8601, ReminderId } from './identity.js';
export interface Reminder {
  readonly id: ReminderId;
  readonly content: string;
  readonly dueAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly timezone: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
}
