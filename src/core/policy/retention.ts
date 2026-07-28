import type { ISO8601 } from '../domain/index.js';
export const isExpired = (expiresAt: ISO8601, now: Date): boolean =>
  Date.parse(expiresAt) <= now.getTime();
