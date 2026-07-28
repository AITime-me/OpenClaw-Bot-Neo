import type { ISO8601 } from './identity.js';
export type Subscription =
  | {
      readonly kind: 'chatgpt-codex';
      readonly renewsAt: ISO8601;
      readonly status: 'active' | 'unknown';
    }
  | {
      readonly kind: 'business-service';
      readonly service: string;
      readonly dueAt: ISO8601;
      readonly status: 'active' | 'due' | 'overdue';
    };
