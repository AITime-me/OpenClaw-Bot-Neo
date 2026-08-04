import type { ConnectorId, ConnectionId } from './identity.js';
import type { ISO8601 } from '../identity.js';

export const HEALTH_STATUSES = Object.freeze(['healthy', 'degraded', 'unavailable'] as const);
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const FAILURE_CATEGORIES = Object.freeze([
  'none',
  'timeout',
  'remote',
  'invalid-response',
  'cancelled',
  'internal',
] as const);
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export interface ConnectorHealthSnapshot {
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly status: HealthStatus;
  readonly lastSuccessAt: ISO8601 | null;
  readonly lastFailureAt: ISO8601 | null;
  readonly failureCategory: FailureCategory;
  readonly retryAfterMs: number | null;
}
