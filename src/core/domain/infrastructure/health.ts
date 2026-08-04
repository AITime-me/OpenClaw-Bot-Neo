import { deepFreeze } from '../immutable.js';
import type { ServerId, ServiceId } from './identity.js';
import type { ServiceDesiredState } from './capabilities.js';

export interface HealthSnapshot {
  readonly serviceState: ServiceDesiredState | null;
  readonly healthEndpointState: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  readonly responseLatencyMs: number | null;
  readonly databaseConnectivity: boolean | null;
  readonly restartCount: number | null;
}

export const sealHealthSnapshot = (snapshot: HealthSnapshot): HealthSnapshot =>
  deepFreeze({ ...snapshot });

export interface ServiceHealthTarget {
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
}
