import { deepFreeze } from '../immutable.js';
import type { ServerId } from './identity.js';
import type { ServerLifecycleStatus } from './capabilities.js';

export interface ResourceSnapshot {
  readonly serverId: ServerId;
  readonly cpuUtilizationPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly loadAverage1m: number | null;
  readonly loadAverage5m: number | null;
  readonly loadAverage15m: number | null;
  readonly uptimeSeconds: number | null;
  readonly providerLifecycle: ServerLifecycleStatus | null;
  readonly hostReachable: boolean | null;
}

export const sealResourceSnapshot = (snapshot: ResourceSnapshot): ResourceSnapshot =>
  deepFreeze({ ...snapshot });
