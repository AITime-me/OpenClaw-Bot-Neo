import type { ServerId, ServiceId } from './identity.js';
import type { ServiceDesiredState } from './capabilities.js';
import { sealValidatedHealthSnapshot } from './snapshot-sealers.js';

export interface HealthSnapshot {
  readonly serviceState: ServiceDesiredState | null;
  readonly healthEndpointState: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  readonly responseLatencyMs: number | null;
  readonly databaseConnectivity: boolean | null;
  readonly restartCount: number | null;
}

export const sealHealthSnapshot = (snapshot: HealthSnapshot): HealthSnapshot => {
  const validated = sealValidatedHealthSnapshot(snapshot);
  if (!validated.ok) throw new Error(validated.error.reason);
  return validated.value;
};

export interface ServiceHealthTarget {
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
}
