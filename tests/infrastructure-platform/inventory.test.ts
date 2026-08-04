import { describe, expect, it } from 'vitest';
import { createInfrastructureHarness, NOW } from './harness.js';
import {
  createInMemoryEnvironmentRegistry,
  createInMemoryServerInventory,
  createInMemoryServiceInventory,
  environmentNow,
} from '../../src/core/application/infrastructure/index.js';
import type {
  EnvironmentId,
  ServerId,
  ServiceId,
} from '../../src/core/domain/infrastructure/identity.js';

const registerEnvironment = (harness: ReturnType<typeof createInfrastructureHarness>) =>
  harness.environments.register(
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

const registerServer = (harness: ReturnType<typeof createInfrastructureHarness>) =>
  harness.servers.registerDeclared(
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
      addressing: { primaryHostname: 'srv-1.example', primaryIpv4: '10.0.0.1', primaryIpv6: null },
      managementCapabilities: ['inspect-host', 'read-logs'],
      hostConnection: null,
      ownerId: 'owner-1' as never,
    },
    NOW,
  );

const registerService = (harness: ReturnType<typeof createInfrastructureHarness>) =>
  harness.services.registerDeclared({
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

describe('infrastructure inventories', () => {
  it('registers environment and rejects duplicate', () => {
    const harness = createInfrastructureHarness();
    expect(registerEnvironment(harness).ok).toBe(true);
    expect(registerEnvironment(harness).ok).toBe(false);
  });

  it('registers server and rejects missing environment and duplicate', () => {
    const harness = createInfrastructureHarness();
    const missingEnv = harness.servers.registerDeclared(
      {
        serverId: 'srv-1' as ServerId,
        providerId: 'provider-1' as never,
        providerServerId: null,
        environmentId: 'missing' as EnvironmentId,
        regionId: null,
        displayName: 'X' as never,
        purpose: 'test',
        lifecycleStatus: 'planned',
        os: { family: 'linux', version: '24.04', architecture: 'amd64' },
        capacity: { cpuCores: 1, memoryBytes: 1, storageBytes: 1 },
        addressing: { primaryHostname: null, primaryIpv4: null, primaryIpv6: null },
        managementCapabilities: [],
        hostConnection: null,
        ownerId: 'owner-1' as never,
      },
      NOW,
    );
    expect(missingEnv.ok).toBe(false);
    expect(registerEnvironment(harness).ok).toBe(true);
    expect(registerServer(harness).ok).toBe(true);
    expect(registerServer(harness).ok).toBe(false);
  });

  it('registers service with validation and immutability', () => {
    const harness = createInfrastructureHarness();
    registerEnvironment(harness);
    registerServer(harness);
    expect(registerService(harness).ok).toBe(true);
    const record = harness.services.get('svc-1' as ServiceId);
    expect(record).not.toBeNull();
    expect(() => Object.assign(record as object, { displayName: 'mutated' })).toThrow();
    const mismatch = harness.services.registerDeclared({
      serviceId: 'svc-2' as ServiceId,
      serverId: 'srv-1' as ServerId,
      environmentId: 'env-2' as EnvironmentId,
      productIdReference: null,
      displayName: 'Bad' as never,
      serviceType: 'worker',
      runtimeType: 'systemd',
      deployment: { deploymentRoot: '/opt/worker', releaseLabel: null },
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
    });
    expect(mismatch.ok).toBe(false);
  });

  it('rejects self-dependency and duplicate service', () => {
    const harness = createInfrastructureHarness();
    registerEnvironment(harness);
    registerServer(harness);
    registerService(harness);
    const selfDep = harness.services.registerDeclared({
      serviceId: 'svc-self' as ServiceId,
      serverId: 'srv-1' as ServerId,
      environmentId: 'env-1' as EnvironmentId,
      productIdReference: null,
      displayName: 'Self' as never,
      serviceType: 'worker',
      runtimeType: 'systemd',
      deployment: { deploymentRoot: '/opt/self', releaseLabel: null },
      healthCheck: { endpointPath: null, intervalSeconds: null },
      systemdUnit: null,
      compose: null,
      ports: [],
      dependencyServiceIds: ['svc-self' as ServiceId],
      ownerId: 'owner-1' as never,
      criticality: 'low',
      desiredState: 'running',
      managementCapabilities: [],
      lastDeclaredUpdate: NOW as never,
    });
    expect(selfDep.ok).toBe(false);
    expect(registerService(harness).ok).toBe(false);
  });

  it('keeps inventories isolated from adapter mutation', () => {
    const environments = createInMemoryEnvironmentRegistry();
    const servers = createInMemoryServerInventory(environments);
    const services = createInMemoryServiceInventory(servers);
    environments.register(
      {
        environmentId: 'env-1' as EnvironmentId,
        name: 'Lab' as never,
        kind: 'lab',
        ownerId: 'owner-1' as never,
        regionAffinity: null,
        policyProfileReference: 'default',
      },
      environmentNow(),
    );
    servers.registerDeclared(
      {
        serverId: 'srv-1' as ServerId,
        providerId: 'provider-1' as never,
        providerServerId: null,
        environmentId: 'env-1' as EnvironmentId,
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
      environmentNow(),
    );
    const before = servers.get('srv-1' as ServerId);
    expect(before?.lifecycleStatus).toBe('active');
    expect((servers as { mutateFromAdapter?: () => void }).mutateFromAdapter).toBeUndefined();
    expect(services.list()).toHaveLength(0);
  });
});
