import type { ISO8601 } from './identity.js';
export interface Alert {
  readonly severity: 'info' | 'warning' | 'critical';
  readonly summary: string;
  readonly observedAt: ISO8601;
  readonly evidence: readonly string[];
}
