import { expect } from 'vitest';
import type { createInfrastructureHarness } from './harness.js';
import { NOW } from './harness.js';
import type {
  EnvironmentId,
  ServerId,
  ServiceId,
} from '../../src/core/domain/infrastructure/identity.js';

export const seedInfrastructureFixtures = (
  harness: ReturnType<typeof createInfrastructureHarness>,
): void => {
  if (harness.environments.get('env-1' as EnvironmentId) === null) {
    const env = harness.environments.register(
      {
        environmentId: 'env-1' as EnvironmentId,
        name: 'Lab' as never,
        kind: 'lab',
        ownerId: 'owner-1' as never,
        regionAffinity: null,
        policyProfileReference: 'default',
      },
      NOW,
    );
    expect(env.ok).toBe(true);
  }
  if (harness.servers.get('srv-1' as ServerId) === null) {
    const server = harness.servers.registerDeclared(
      {
        serverId: 'srv-1' as ServerId,
        providerId: 'provider-1' as never,
        providerServerId: 'psrv-1' as never,
        environmentId: 'env-1' as EnvironmentId,
        regionId: null,
        displayName: 'Server One' as never,
        purpose: 'test',
        lifecycleStatus: 'active',
        os: { family: 'linux', version: '24.04', architecture: 'amd64' },
        capacity: { cpuCores: 2, memoryBytes: 4_000_000_000, storageBytes: 50_000_000_000 },
        addressing: {
          primaryHostname: 'srv-1.example',
          primaryIpv4: '10.0.0.1',
          primaryIpv6: null,
        },
        managementCapabilities: ['inspect-host', 'read-logs'],
        hostConnection: null,
        ownerId: 'owner-1' as never,
      },
      NOW,
    );
    expect(server.ok).toBe(true);
  }
  if (harness.services.get('svc-1' as ServiceId) === null) {
    const service = harness.services.registerDeclared({
      serviceId: 'svc-1' as ServiceId,
      serverId: 'srv-1' as ServerId,
      environmentId: 'env-1' as EnvironmentId,
      productIdReference: null,
      displayName: 'Neo' as never,
      serviceType: 'neo-runtime',
      runtimeType: 'systemd',
      deployment: { deploymentRoot: '/opt/neo', releaseLabel: 'v1' },
      healthCheck: { endpointPath: '/health', intervalSeconds: 30 },
      systemdUnit: 'neo.service' as never,
      compose: null,
      ports: [3000 as never],
      dependencyServiceIds: [],
      ownerId: 'owner-1' as never,
      criticality: 'high',
      desiredState: 'running',
      managementCapabilities: ['inspect-status', 'restart-service'],
      lastDeclaredUpdate: NOW as never,
    });
    expect(service.ok).toBe(true);
  }
};
