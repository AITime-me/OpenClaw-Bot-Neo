import type { ISO8601 } from '../identity.js';
import { deepFreeze } from '../immutable.js';
import type { ServerId, ServiceId, ReleaseId } from './identity.js';
import type { ServerRecord } from './server.js';
import type { ServiceRecord } from './service.js';
import type { InfrastructureObservation } from './observations.js';
import type { ResourceSnapshot } from './resources.js';
import { DEFAULT_OBSERVATION_STALE_MS } from './constants.js';

export const DRIFT_KINDS = Object.freeze([
  'no-drift',
  'lifecycle-mismatch',
  'service-state-mismatch',
  'release-mismatch',
  'capacity-pressure',
  'host-unreachable',
  'provider-state-unknown',
  'observation-stale',
] as const);

export type DriftKind = (typeof DRIFT_KINDS)[number];

export interface DriftObservation {
  readonly kind: DriftKind;
  readonly serverId: ServerId | null;
  readonly serviceId: ServiceId | null;
  readonly releaseId: ReleaseId | null;
  readonly reason: string;
  readonly evidenceSource: 'declared' | 'provider' | 'host' | 'inferred';
  readonly contentTrust: 'untrusted';
}

export const sealDriftObservation = (observation: DriftObservation): DriftObservation =>
  deepFreeze({ ...observation });

export interface DriftComparisonInput {
  readonly declaredServer: ServerRecord | null;
  readonly declaredService: ServiceRecord | null;
  readonly providerObservation: InfrastructureObservation | null;
  readonly hostObservation: InfrastructureObservation | null;
  readonly resourceSnapshot: ResourceSnapshot | null;
  readonly nowMs: number;
  readonly staleAfterMs?: number;
}

const isStale = (observedAt: ISO8601, nowMs: number, staleAfterMs: number): boolean => {
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return true;
  return nowMs - observedMs > staleAfterMs;
};

export const compareDrift = (input: DriftComparisonInput): readonly DriftObservation[] => {
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_OBSERVATION_STALE_MS;
  const results: DriftObservation[] = [];

  const push = (observation: DriftObservation): void => {
    results.push(sealDriftObservation(observation));
  };

  if (
    input.providerObservation !== null &&
    isStale(input.providerObservation.observedAt, input.nowMs, staleAfterMs)
  ) {
    push({
      kind: 'observation-stale',
      serverId: 'serverId' in input.providerObservation ? input.providerObservation.serverId : null,
      serviceId:
        'serviceId' in input.providerObservation ? input.providerObservation.serviceId : null,
      releaseId: null,
      reason: 'Provider observation is stale.',
      evidenceSource: 'provider',
      contentTrust: 'untrusted',
    });
  }

  if (
    input.hostObservation !== null &&
    isStale(input.hostObservation.observedAt, input.nowMs, staleAfterMs)
  ) {
    push({
      kind: 'observation-stale',
      serverId: 'serverId' in input.hostObservation ? input.hostObservation.serverId : null,
      serviceId: 'serviceId' in input.hostObservation ? input.hostObservation.serviceId : null,
      releaseId: null,
      reason: 'Host observation is stale.',
      evidenceSource: 'host',
      contentTrust: 'untrusted',
    });
  }

  if (
    input.declaredServer !== null &&
    input.providerObservation?.kind === 'provider-server-state' &&
    input.providerObservation.lifecycleStatus !== input.declaredServer.lifecycleStatus
  ) {
    push({
      kind: 'lifecycle-mismatch',
      serverId: input.declaredServer.serverId,
      serviceId: null,
      releaseId: null,
      reason: 'Declared lifecycle differs from provider observation.',
      evidenceSource: 'provider',
      contentTrust: 'untrusted',
    });
  }

  if (
    input.declaredService !== null &&
    input.hostObservation?.kind === 'host-service-state' &&
    input.hostObservation.activeState !== input.declaredService.desiredState
  ) {
    push({
      kind: 'service-state-mismatch',
      serverId: input.declaredService.serverId,
      serviceId: input.declaredService.serviceId,
      releaseId: null,
      reason: 'Declared desired state differs from host observation.',
      evidenceSource: 'host',
      contentTrust: 'untrusted',
    });
  }

  if (input.hostObservation?.kind === 'host-server-state' && !input.hostObservation.reachable) {
    push({
      kind: 'host-unreachable',
      serverId: input.hostObservation.serverId,
      serviceId: null,
      releaseId: null,
      reason: 'Host reported unreachable.',
      evidenceSource: 'host',
      contentTrust: 'untrusted',
    });
  }

  if (
    input.providerObservation?.kind === 'provider-server-state' &&
    input.providerObservation.lifecycleStatus === 'unknown'
  ) {
    push({
      kind: 'provider-state-unknown',
      serverId: input.providerObservation.serverId,
      serviceId: null,
      releaseId: null,
      reason: 'Provider lifecycle is unknown.',
      evidenceSource: 'provider',
      contentTrust: 'untrusted',
    });
  }

  if (input.resourceSnapshot !== null) {
    const cpu = input.resourceSnapshot.cpuUtilizationPercent;
    const memUsed = input.resourceSnapshot.memoryUsedBytes;
    const memTotal = input.resourceSnapshot.memoryTotalBytes;
    const diskUsed = input.resourceSnapshot.diskUsedBytes;
    const diskTotal = input.resourceSnapshot.diskTotalBytes;
    const memoryPressure =
      memUsed !== null && memTotal !== null && memTotal > 0 && memUsed / memTotal >= 0.9;
    const diskPressure =
      diskUsed !== null && diskTotal !== null && diskTotal > 0 && diskUsed / diskTotal >= 0.9;
    if ((cpu !== null && cpu >= 90) || memoryPressure || diskPressure) {
      push({
        kind: 'capacity-pressure',
        serverId: input.resourceSnapshot.serverId,
        serviceId: null,
        releaseId: null,
        reason: 'Resource utilization indicates capacity pressure.',
        evidenceSource: 'inferred',
        contentTrust: 'untrusted',
      });
    }
  }

  if (results.length === 0) {
    return Object.freeze([
      sealDriftObservation({
        kind: 'no-drift',
        serverId: input.declaredServer?.serverId ?? null,
        serviceId: input.declaredService?.serviceId ?? null,
        releaseId: null,
        reason: 'No drift detected.',
        evidenceSource: 'declared',
        contentTrust: 'untrusted',
      }),
    ]);
  }

  return Object.freeze(results);
};

export const compareReleaseDrift = (options: {
  readonly declaredReleaseId: ReleaseId | null;
  readonly observedReleaseId: ReleaseId | null;
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
}): DriftObservation | null => {
  if (options.declaredReleaseId === null || options.observedReleaseId === null) return null;
  if (options.declaredReleaseId === options.observedReleaseId) return null;
  return sealDriftObservation({
    kind: 'release-mismatch',
    serverId: options.serverId,
    serviceId: options.serviceId,
    releaseId: options.declaredReleaseId,
    reason: 'Declared release differs from observed release.',
    evidenceSource: 'host',
    contentTrust: 'untrusted',
  });
};
