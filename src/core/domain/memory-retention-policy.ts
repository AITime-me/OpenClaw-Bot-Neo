import type { ISO8601 } from './identity.js';
export interface MemoryRetentionPolicy {
  readonly expiresAt: ISO8601;
  readonly reviewAt: ISO8601;
  readonly deleteOnExpiry: true;
}
