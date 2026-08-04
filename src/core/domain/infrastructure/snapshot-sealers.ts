import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import { deepFreeze } from '../immutable.js';
import type { IdentityFailure } from '../identity.js';
import { parseServerId, type ServerId } from './identity.js';
import {
  SERVER_LIFECYCLE_STATUSES,
  SERVICE_DESIRED_STATES,
  type ServerLifecycleStatus,
  type ServiceDesiredState,
} from './capabilities.js';
import {
  parseLatencyMs,
  parseNonNegativeFiniteNumber,
  parseNonNegativeInteger,
  parsePercentage,
} from './bounds.js';
import { infrastructureError, type InfrastructureError } from './errors.js';

const mapFailure = (failure: IdentityFailure): InfrastructureError =>
  infrastructureError('invalid-input', failure.reason);

const parseEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): Result<T, InfrastructureError> => {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    return err(infrastructureError('invalid-input', `${label} is invalid.`));
  return ok(value as T);
};

export type ValidatedHealthSnapshotFields = {
  readonly serviceState: ServiceDesiredState | null;
  readonly healthEndpointState: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  readonly responseLatencyMs: number | null;
  readonly databaseConnectivity: boolean | null;
  readonly restartCount: number | null;
};

export type ValidatedResourceSnapshotFields = {
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
};

export const sealValidatedHealthSnapshot = (
  snapshot: ValidatedHealthSnapshotFields,
): Result<ValidatedHealthSnapshotFields, InfrastructureError> => {
  const serviceState =
    snapshot.serviceState === null
      ? ok(null)
      : parseEnum(snapshot.serviceState, SERVICE_DESIRED_STATES, 'ServiceDesiredState');
  if (!serviceState.ok) return serviceState;
  const healthEndpointState = parseEnum(
    snapshot.healthEndpointState,
    ['healthy', 'degraded', 'unhealthy', 'unknown'] as const,
    'HealthEndpointState',
  );
  if (!healthEndpointState.ok) return healthEndpointState;
  const latency =
    snapshot.responseLatencyMs === null ? ok(null) : parseLatencyMs(snapshot.responseLatencyMs);
  if (!latency.ok) return err(mapFailure(latency.error));
  const restartCount =
    snapshot.restartCount === null
      ? ok(null)
      : parseNonNegativeInteger(snapshot.restartCount, 'restartCount', Number.MAX_SAFE_INTEGER);
  if (!restartCount.ok) return err(mapFailure(restartCount.error));
  return ok(
    deepFreeze({
      serviceState: serviceState.value,
      healthEndpointState: healthEndpointState.value,
      responseLatencyMs: latency.value,
      databaseConnectivity: snapshot.databaseConnectivity,
      restartCount: restartCount.value,
    }),
  );
};

export const sealValidatedResourceSnapshot = (
  snapshot: ValidatedResourceSnapshotFields,
): Result<ValidatedResourceSnapshotFields, InfrastructureError> => {
  const serverId = parseServerId(snapshot.serverId);
  if (!serverId.ok) return err(mapFailure(serverId.error));
  const cpu =
    snapshot.cpuUtilizationPercent === null
      ? ok(null)
      : parsePercentage(snapshot.cpuUtilizationPercent, 'cpuUtilizationPercent');
  if (!cpu.ok) return err(mapFailure(cpu.error));
  const memoryUsed =
    snapshot.memoryUsedBytes === null
      ? ok(null)
      : parseNonNegativeInteger(
          snapshot.memoryUsedBytes,
          'memoryUsedBytes',
          Number.MAX_SAFE_INTEGER,
        );
  if (!memoryUsed.ok) return err(mapFailure(memoryUsed.error));
  const memoryTotal =
    snapshot.memoryTotalBytes === null
      ? ok(null)
      : parseNonNegativeInteger(
          snapshot.memoryTotalBytes,
          'memoryTotalBytes',
          Number.MAX_SAFE_INTEGER,
        );
  if (!memoryTotal.ok) return err(mapFailure(memoryTotal.error));
  if (
    memoryUsed.value !== null &&
    memoryTotal.value !== null &&
    memoryUsed.value > memoryTotal.value
  )
    return err(infrastructureError('invalid-input', 'memoryUsedBytes exceeds memoryTotalBytes.'));
  const diskUsed =
    snapshot.diskUsedBytes === null
      ? ok(null)
      : parseNonNegativeInteger(snapshot.diskUsedBytes, 'diskUsedBytes', Number.MAX_SAFE_INTEGER);
  if (!diskUsed.ok) return err(mapFailure(diskUsed.error));
  const diskTotal =
    snapshot.diskTotalBytes === null
      ? ok(null)
      : parseNonNegativeInteger(snapshot.diskTotalBytes, 'diskTotalBytes', Number.MAX_SAFE_INTEGER);
  if (!diskTotal.ok) return err(mapFailure(diskTotal.error));
  if (diskUsed.value !== null && diskTotal.value !== null && diskUsed.value > diskTotal.value)
    return err(infrastructureError('invalid-input', 'diskUsedBytes exceeds diskTotalBytes.'));
  const load1 =
    snapshot.loadAverage1m === null
      ? ok(null)
      : parseNonNegativeFiniteNumber(snapshot.loadAverage1m, 'loadAverage1m', 10_000);
  if (!load1.ok) return err(mapFailure(load1.error));
  const load5 =
    snapshot.loadAverage5m === null
      ? ok(null)
      : parseNonNegativeFiniteNumber(snapshot.loadAverage5m, 'loadAverage5m', 10_000);
  if (!load5.ok) return err(mapFailure(load5.error));
  const load15 =
    snapshot.loadAverage15m === null
      ? ok(null)
      : parseNonNegativeFiniteNumber(snapshot.loadAverage15m, 'loadAverage15m', 10_000);
  if (!load15.ok) return err(mapFailure(load15.error));
  const uptime =
    snapshot.uptimeSeconds === null
      ? ok(null)
      : parseNonNegativeInteger(snapshot.uptimeSeconds, 'uptimeSeconds', Number.MAX_SAFE_INTEGER);
  if (!uptime.ok) return err(mapFailure(uptime.error));
  const providerLifecycle =
    snapshot.providerLifecycle === null
      ? ok(null)
      : parseEnum(snapshot.providerLifecycle, SERVER_LIFECYCLE_STATUSES, 'ProviderLifecycle');
  if (!providerLifecycle.ok) return providerLifecycle;
  return ok(
    deepFreeze({
      serverId: serverId.value,
      cpuUtilizationPercent: cpu.value,
      memoryUsedBytes: memoryUsed.value,
      memoryTotalBytes: memoryTotal.value,
      diskUsedBytes: diskUsed.value,
      diskTotalBytes: diskTotal.value,
      loadAverage1m: load1.value,
      loadAverage5m: load5.value,
      loadAverage15m: load15.value,
      uptimeSeconds: uptime.value,
      providerLifecycle: providerLifecycle.value,
      hostReachable: snapshot.hostReachable,
    }),
  );
};
