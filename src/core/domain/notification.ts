import type { ISO8601 } from './identity.js';
export interface Notification {
  readonly content: string;
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
  readonly expiresAt: ISO8601;
}
