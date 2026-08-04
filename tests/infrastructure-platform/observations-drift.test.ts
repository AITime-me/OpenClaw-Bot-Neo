import { describe, expect, it } from 'vitest';
import { compareDrift, compareReleaseDrift } from '../../src/core/domain/infrastructure/drift.js';
import {
  parsePercentage,
  parseNonNegativeInteger,
} from '../../src/core/domain/infrastructure/bounds.js';
import { sealResourceSnapshot } from '../../src/core/domain/infrastructure/resources.js';
import type {
  ServerId,
  ServiceId,
  ReleaseId,
} from '../../src/core/domain/infrastructure/identity.js';
import { iso8601FromDate } from '../../src/core/domain/identity.js';
import { createInfrastructureHarness, NOW } from './harness.js';

describe('infrastructure observations and drift', () => {
  it('keeps declared and observed state separate', () => {
    const harness = createInfrastructureHarness();
    harness.environments.register(
      {
        environmentId: 'env-1' as never,
        name: 'Lab' as never,
        kind: 'lab',
        ownerId: 'owner-1' as never,
        regionAffinity: null,
        policyProfileReference: 'default',
      },
      NOW,
    );
    harness.servers.registerDeclared(
      {
        serverId: 'srv-1' as ServerId,
        providerId: 'provider-1' as never,
        providerServerId: null,
        environmentId: 'env-1' as never,
        regionId: null,
        displayName: 'Server' as never,
        purpose: 'test',
        lifecycleStatus: 'active',
        os: { family: 'linux', version: '24.04', architecture: 'amd64' },
        capacity: { cpuCores: 1, memoryBytes: 1, storageBytes: 1 },
        addressing: { primaryHostname: null, primaryIpv4: null, primaryIpv6: null },
        managementCapabilities: [],
        hostConnection: null,
        ownerId: 'owner-1' as never,
      },
      NOW,
    );
    const declared = harness.servers.get('srv-1' as ServerId);
    harness.observations.record({
      kind: 'provider-server-state',
      observationId: 'obs-1' as never,
      sourceKind: 'provider',
      observedAt: NOW as never,
      contentTrust: 'untrusted',
      serverId: 'srv-1' as ServerId,
      lifecycleStatus: 'degraded',
      providerStatusLabel: 'degraded',
    });
    expect(declared?.lifecycleStatus).toBe('active');
    expect(harness.observations.list()).toHaveLength(1);
  });

  it('detects lifecycle, service, capacity and stale drift without repair', () => {
    const nowMs = Date.parse('2026-08-04T10:00:00.000Z');
    const drift = compareDrift({
      declaredServer: {
        serverId: 'srv-1' as ServerId,
        providerId: 'provider-1' as never,
        providerServerId: null,
        environmentId: 'env-1' as never,
        regionId: null,
        displayName: 'Server' as never,
        purpose: 'test',
        lifecycleStatus: 'active',
        os: { family: 'linux', version: '24.04', architecture: 'amd64' },
        capacity: { cpuCores: 1, memoryBytes: 1, storageBytes: 1 },
        addressing: { primaryHostname: null, primaryIpv4: null, primaryIpv6: null },
        managementCapabilities: [],
        hostConnection: null,
        ownerId: 'owner-1' as never,
        createdAt: NOW as never,
        updatedAt: NOW as never,
      },
      declaredService: {
        serviceId: 'svc-1' as ServiceId,
        serverId: 'srv-1' as ServerId,
        environmentId: 'env-1' as never,
        productIdReference: null,
        displayName: 'Svc' as never,
        serviceType: 'worker',
        runtimeType: 'systemd',
        deployment: { deploymentRoot: '/opt', releaseLabel: null },
        healthCheck: { endpointPath: null, intervalSeconds: null },
        systemdUnit: null,
        compose: null,
        ports: [],
        dependencyServiceIds: [],
        ownerId: 'owner-1' as never,
        criticality: 'low',
        desiredState: 'running',
        managementCapabilities: [],
        lastDeclaredUpdate: NOW as never,
      },
      providerObservation: {
        kind: 'provider-server-state',
        observationId: 'obs-1' as never,
        sourceKind: 'provider',
        observedAt: '2026-08-04T08:00:00.000Z' as never,
        contentTrust: 'untrusted',
        serverId: 'srv-1' as ServerId,
        lifecycleStatus: 'degraded',
        providerStatusLabel: 'degraded',
      },
      hostObservation: {
        kind: 'host-service-state',
        observationId: 'obs-2' as never,
        sourceKind: 'host',
        observedAt: iso8601FromDate(new Date(nowMs)),
        contentTrust: 'untrusted',
        serverId: 'srv-1' as ServerId,
        serviceId: 'svc-1' as ServiceId,
        activeState: 'stopped',
        restartCount: 2,
      },
      resourceSnapshot: sealResourceSnapshot({
        serverId: 'srv-1' as ServerId,
        cpuUtilizationPercent: 95,
        memoryUsedBytes: 9_500_000_000,
        memoryTotalBytes: 10_000_000_000,
        diskUsedBytes: 95_000_000_000,
        diskTotalBytes: 100_000_000_000,
        loadAverage1m: 5,
        loadAverage5m: 4,
        loadAverage15m: 3,
        uptimeSeconds: 100,
        providerLifecycle: 'active',
        hostReachable: true,
      }),
      nowMs,
    });
    expect(drift.some((item) => item.kind === 'lifecycle-mismatch')).toBe(true);
    expect(drift.some((item) => item.kind === 'service-state-mismatch')).toBe(true);
    expect(drift.some((item) => item.kind === 'capacity-pressure')).toBe(true);
    expect(drift.some((item) => item.kind === 'observation-stale')).toBe(true);
    const releaseDrift = compareReleaseDrift({
      declaredReleaseId: 'rel-1' as ReleaseId,
      observedReleaseId: 'rel-2' as ReleaseId,
      serverId: 'srv-1' as ServerId,
      serviceId: 'svc-1' as ServiceId,
    });
    expect(releaseDrift?.kind).toBe('release-mismatch');
  });
});

describe('infrastructure health and resource bounds', () => {
  it('accepts valid bounded values and rejects invalid', () => {
    expect(parsePercentage(50, 'cpu').ok).toBe(true);
    expect(parsePercentage(Number.NaN, 'cpu').ok).toBe(false);
    expect(parsePercentage(Number.POSITIVE_INFINITY, 'cpu').ok).toBe(false);
    expect(parseNonNegativeInteger(100, 'bytes', 1_000_000).ok).toBe(true);
    expect(parseNonNegativeInteger(-1, 'bytes', 1_000_000).ok).toBe(false);
  });
});
