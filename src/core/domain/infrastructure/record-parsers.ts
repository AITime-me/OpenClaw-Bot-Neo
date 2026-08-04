import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import type { IdentityFailure } from '../identity.js';
import { parseOwnerId } from '../identity.js';
import { parseSecretReferenceId } from '../connector/identity.js';
import {
  CONTENT_TRUST_LEVELS,
  ENVIRONMENT_KINDS,
  SERVER_LIFECYCLE_STATUSES,
  SERVER_MANAGEMENT_CAPABILITIES,
  SERVICE_CRITICALITY_LEVELS,
  SERVICE_DESIRED_STATES,
  SERVICE_MANAGEMENT_CAPABILITIES,
  SERVICE_RUNTIME_TYPES,
  SERVICE_TYPES,
} from './capabilities.js';
import {
  MAX_MANAGEMENT_CAPABILITIES,
  MAX_OBSERVATION_METADATA_LENGTH,
  MAX_SERVICE_DEPENDENCIES,
  MAX_SERVICE_PORTS,
  parseAbsolutePosixDeploymentRoot,
  parseBoundedText,
  parseIpv4Address,
  parseIpv6Address,
  parseNonNegativeInteger,
  parseOptionalHealthEndpointPath,
  parseOptionalRelativePosixPath,
  parsePositiveSafeInteger,
} from './bounds.js';
import { infrastructureError, type InfrastructureError } from './errors.js';
import type { EnvironmentRecord, EnvironmentRegistrationInput } from './environment.js';
import type { ServerRecord, ServerRegistrationInput } from './server.js';
import type { ServiceRecord, ServiceRegistrationInput } from './service.js';
import type { InfrastructureObservation } from './observations.js';
import {
  parseEnvironmentDisplayName,
  parseEnvironmentId,
  parseHostConnectionReferenceId,
  parseHostname,
  parseInfrastructureObservationId,
  parseProductIdReference,
  parseProviderId,
  parseProviderServerId,
  parseRegionId,
  parseReleaseId,
  parseServerDisplayName,
  parseServerId,
  parseServiceDisplayName,
  parseServiceId,
  parseServicePort,
  parseSystemdUnitName,
} from './identity.js';
import { sealEnvironmentRecord } from './environment.js';
import { sealServerRecord } from './server.js';
import { sealServiceRecord } from './service.js';
import { sealObservation } from './observations.js';
import { sealValidatedHealthSnapshot, sealValidatedResourceSnapshot } from './snapshot-sealers.js';

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

const parseCapabilityList = <T extends string>(
  values: unknown,
  allowed: readonly T[],
  label: string,
): Result<readonly T[], InfrastructureError> => {
  if (!Array.isArray(values))
    return err(infrastructureError('invalid-input', `${label} must be an array.`));
  if (values.length > MAX_MANAGEMENT_CAPABILITIES)
    return err(infrastructureError('invalid-input', `${label} exceeds maximum entries.`));
  const parsed: T[] = [];
  for (const value of values) {
    const item = parseEnum(value, allowed, label);
    if (!item.ok) return item;
    parsed.push(item.value);
  }
  return ok(Object.freeze(parsed));
};

export const parseEnvironmentRegistrationInput = (
  input: EnvironmentRegistrationInput,
): Result<EnvironmentRegistrationInput, InfrastructureError> => {
  const environmentId = parseEnvironmentId(input.environmentId);
  if (!environmentId.ok) return err(mapFailure(environmentId.error));
  const name = parseEnvironmentDisplayName(input.name);
  if (!name.ok) return err(mapFailure(name.error));
  const kind = parseEnum(input.kind, ENVIRONMENT_KINDS, 'EnvironmentKind');
  if (!kind.ok) return kind;
  const ownerId = parseOwnerId(input.ownerId);
  if (!ownerId.ok) return err(mapFailure(ownerId.error));
  const regionAffinity =
    input.regionAffinity === null ? ok(null) : parseRegionId(input.regionAffinity);
  if (!regionAffinity.ok) return err(mapFailure(regionAffinity.error));
  const policy = parseBoundedText(input.policyProfileReference, {
    max: 128,
    label: 'PolicyProfileReference',
  });
  if (!policy.ok) return err(mapFailure(policy.error));
  return ok({
    environmentId: environmentId.value,
    name: name.value,
    kind: kind.value,
    ownerId: ownerId.value,
    regionAffinity: regionAffinity.value,
    policyProfileReference: policy.value,
  });
};

export const sealValidatedEnvironmentRecord = (
  record: EnvironmentRecord,
): Result<EnvironmentRecord, InfrastructureError> => {
  const parsed = parseEnvironmentRegistrationInput({
    environmentId: record.environmentId,
    name: record.name,
    kind: record.kind,
    ownerId: record.ownerId,
    regionAffinity: record.regionAffinity,
    policyProfileReference: record.policyProfileReference,
  });
  if (!parsed.ok) return parsed;
  return ok(
    sealEnvironmentRecord({
      ...record,
      ...parsed.value,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }),
  );
};

export const parseServerRegistrationInput = (
  input: ServerRegistrationInput,
): Result<ServerRegistrationInput, InfrastructureError> => {
  const serverId = parseServerId(input.serverId);
  if (!serverId.ok) return err(mapFailure(serverId.error));
  const providerId = parseProviderId(input.providerId);
  if (!providerId.ok) return err(mapFailure(providerId.error));
  const providerServerId =
    input.providerServerId === null ? ok(null) : parseProviderServerId(input.providerServerId);
  if (!providerServerId.ok) return err(mapFailure(providerServerId.error));
  const environmentId = parseEnvironmentId(input.environmentId);
  if (!environmentId.ok) return err(mapFailure(environmentId.error));
  const regionId = input.regionId === null ? ok(null) : parseRegionId(input.regionId);
  if (!regionId.ok) return err(mapFailure(regionId.error));
  const displayName = parseServerDisplayName(input.displayName);
  if (!displayName.ok) return err(mapFailure(displayName.error));
  const purpose = parseBoundedText(input.purpose, { max: 256, label: 'Purpose' });
  if (!purpose.ok) return err(mapFailure(purpose.error));
  const lifecycle = parseEnum(
    input.lifecycleStatus,
    SERVER_LIFECYCLE_STATUSES,
    'ServerLifecycleStatus',
  );
  if (!lifecycle.ok) return lifecycle;
  const osFamily = parseBoundedText(input.os.family, { max: 64, label: 'OS family' });
  if (!osFamily.ok) return err(mapFailure(osFamily.error));
  const osVersion = parseBoundedText(input.os.version, { max: 64, label: 'OS version' });
  if (!osVersion.ok) return err(mapFailure(osVersion.error));
  const osArch = parseBoundedText(input.os.architecture, { max: 32, label: 'OS architecture' });
  if (!osArch.ok) return err(mapFailure(osArch.error));
  const cpuCores = parsePositiveSafeInteger(input.capacity.cpuCores, 'cpuCores', 1024);
  if (!cpuCores.ok) return err(mapFailure(cpuCores.error));
  const memoryBytes = parsePositiveSafeInteger(input.capacity.memoryBytes, 'memoryBytes');
  if (!memoryBytes.ok) return err(mapFailure(memoryBytes.error));
  const storageBytes = parsePositiveSafeInteger(input.capacity.storageBytes, 'storageBytes');
  if (!storageBytes.ok) return err(mapFailure(storageBytes.error));
  const hostname =
    input.addressing.primaryHostname === null
      ? ok(null)
      : parseHostname(input.addressing.primaryHostname);
  if (!hostname.ok) return err(mapFailure(hostname.error));
  const ipv4 =
    input.addressing.primaryIpv4 === null
      ? ok(null)
      : parseIpv4Address(input.addressing.primaryIpv4);
  if (!ipv4.ok) return err(mapFailure(ipv4.error));
  const ipv6 =
    input.addressing.primaryIpv6 === null
      ? ok(null)
      : parseIpv6Address(input.addressing.primaryIpv6);
  if (!ipv6.ok) return err(mapFailure(ipv6.error));
  const capabilities = parseCapabilityList(
    input.managementCapabilities,
    SERVER_MANAGEMENT_CAPABILITIES,
    'ServerManagementCapability',
  );
  if (!capabilities.ok) return capabilities;
  const ownerId = parseOwnerId(input.ownerId);
  if (!ownerId.ok) return err(mapFailure(ownerId.error));
  let hostConnection: ServerRegistrationInput['hostConnection'] = null;
  if (input.hostConnection !== null) {
    const connectionReferenceId = parseHostConnectionReferenceId(
      input.hostConnection.connectionReferenceId,
    );
    if (!connectionReferenceId.ok) return err(mapFailure(connectionReferenceId.error));
    const secretReferenceId = parseSecretReferenceId(input.hostConnection.secretReferenceId);
    if (!secretReferenceId.ok) return err(mapFailure(secretReferenceId.error));
    const fingerprint = parseBoundedText(input.hostConnection.pinnedHostFingerprint, {
      max: 128,
      label: 'PinnedHostFingerprint',
    });
    if (!fingerprint.ok) return err(mapFailure(fingerprint.error));
    hostConnection = {
      connectionReferenceId: connectionReferenceId.value,
      secretReferenceId: secretReferenceId.value,
      pinnedHostFingerprint: fingerprint.value,
    };
  }
  return ok({
    serverId: serverId.value,
    providerId: providerId.value,
    providerServerId: providerServerId.value,
    environmentId: environmentId.value,
    regionId: regionId.value,
    displayName: displayName.value,
    purpose: purpose.value,
    lifecycleStatus: lifecycle.value,
    os: {
      family: osFamily.value,
      version: osVersion.value,
      architecture: osArch.value,
    },
    capacity: {
      cpuCores: cpuCores.value,
      memoryBytes: memoryBytes.value,
      storageBytes: storageBytes.value,
    },
    addressing: {
      primaryHostname: hostname.value,
      primaryIpv4: ipv4.value,
      primaryIpv6: ipv6.value,
    },
    managementCapabilities: capabilities.value,
    hostConnection,
    ownerId: ownerId.value,
  });
};

export const sealValidatedServerRecord = (
  record: ServerRecord,
): Result<ServerRecord, InfrastructureError> => {
  const parsed = parseServerRegistrationInput(record);
  if (!parsed.ok) return parsed;
  return ok(
    sealServerRecord({
      ...record,
      ...parsed.value,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }),
  );
};

export const parseServiceRegistrationInput = (
  input: ServiceRegistrationInput,
): Result<ServiceRegistrationInput, InfrastructureError> => {
  const serviceId = parseServiceId(input.serviceId);
  if (!serviceId.ok) return err(mapFailure(serviceId.error));
  const serverId = parseServerId(input.serverId);
  if (!serverId.ok) return err(mapFailure(serverId.error));
  const environmentId = parseEnvironmentId(input.environmentId);
  if (!environmentId.ok) return err(mapFailure(environmentId.error));
  const productId =
    input.productIdReference === null
      ? ok(null)
      : parseProductIdReference(input.productIdReference);
  if (!productId.ok) return err(mapFailure(productId.error));
  const displayName = parseServiceDisplayName(input.displayName);
  if (!displayName.ok) return err(mapFailure(displayName.error));
  const serviceType = parseEnum(input.serviceType, SERVICE_TYPES, 'ServiceType');
  if (!serviceType.ok) return serviceType;
  const runtimeType = parseEnum(input.runtimeType, SERVICE_RUNTIME_TYPES, 'ServiceRuntimeType');
  if (!runtimeType.ok) return runtimeType;
  const deploymentRoot = parseAbsolutePosixDeploymentRoot(input.deployment.deploymentRoot);
  if (!deploymentRoot.ok) return err(mapFailure(deploymentRoot.error));
  const releaseLabel = parseOptionalRelativePosixPath(
    input.deployment.releaseLabel,
    'ReleaseLabel',
  );
  if (!releaseLabel.ok) return err(mapFailure(releaseLabel.error));
  const endpointPath = parseOptionalHealthEndpointPath(
    input.healthCheck.endpointPath,
    'HealthEndpointPath',
  );
  if (!endpointPath.ok) return err(mapFailure(endpointPath.error));
  const interval =
    input.healthCheck.intervalSeconds === null
      ? ok(null)
      : parsePositiveSafeInteger(input.healthCheck.intervalSeconds, 'HealthIntervalSeconds', 86400);
  if (!interval.ok) return err(mapFailure(interval.error));
  const systemdUnit =
    input.systemdUnit === null ? ok(null) : parseSystemdUnitName(input.systemdUnit);
  if (!systemdUnit.ok) return err(mapFailure(systemdUnit.error));
  let compose: ServiceRegistrationInput['compose'] = null;
  if (input.compose !== null) {
    const projectName = parseBoundedText(input.compose.projectName, {
      max: 128,
      label: 'ComposeProjectName',
    });
    if (!projectName.ok) return err(mapFailure(projectName.error));
    const serviceName = parseBoundedText(input.compose.serviceName, {
      max: 128,
      label: 'ComposeServiceName',
    });
    if (!serviceName.ok) return err(mapFailure(serviceName.error));
    compose = { projectName: projectName.value, serviceName: serviceName.value };
  }
  if (!Array.isArray(input.ports) || input.ports.length > MAX_SERVICE_PORTS)
    return err(infrastructureError('invalid-input', 'Service ports are out of bounds.'));
  const ports: ServiceRegistrationInput['ports'][number][] = [];
  const portSet = new Set<number>();
  for (const port of input.ports) {
    const parsedPort = parseServicePort(port);
    if (!parsedPort.ok) return err(mapFailure(parsedPort.error));
    if (portSet.has(parsedPort.value))
      return err(infrastructureError('invalid-input', 'Duplicate service port definition.'));
    portSet.add(parsedPort.value);
    ports.push(parsedPort.value);
  }
  if (
    !Array.isArray(input.dependencyServiceIds) ||
    input.dependencyServiceIds.length > MAX_SERVICE_DEPENDENCIES
  )
    return err(infrastructureError('invalid-input', 'Service dependencies are out of bounds.'));
  const dependencyServiceIds: ServiceRegistrationInput['dependencyServiceIds'][number][] = [];
  for (const dependencyId of input.dependencyServiceIds) {
    const parsedDependency = parseServiceId(dependencyId);
    if (!parsedDependency.ok) return err(mapFailure(parsedDependency.error));
    dependencyServiceIds.push(parsedDependency.value);
  }
  if (dependencyServiceIds.includes(serviceId.value))
    return err(infrastructureError('self-dependency', 'Service cannot depend on itself.'));
  const ownerId = parseOwnerId(input.ownerId);
  if (!ownerId.ok) return err(mapFailure(ownerId.error));
  const criticality = parseEnum(
    input.criticality,
    SERVICE_CRITICALITY_LEVELS,
    'ServiceCriticality',
  );
  if (!criticality.ok) return criticality;
  const desiredState = parseEnum(input.desiredState, SERVICE_DESIRED_STATES, 'ServiceDesiredState');
  if (!desiredState.ok) return desiredState;
  const managementCapabilities = parseCapabilityList(
    input.managementCapabilities,
    SERVICE_MANAGEMENT_CAPABILITIES,
    'ServiceManagementCapability',
  );
  if (!managementCapabilities.ok) return managementCapabilities;
  return ok({
    serviceId: serviceId.value,
    serverId: serverId.value,
    environmentId: environmentId.value,
    productIdReference: productId.value,
    displayName: displayName.value,
    serviceType: serviceType.value,
    runtimeType: runtimeType.value,
    deployment: {
      deploymentRoot: deploymentRoot.value,
      releaseLabel: releaseLabel.value,
    },
    healthCheck: {
      endpointPath: endpointPath.value,
      intervalSeconds: interval.value,
    },
    systemdUnit: systemdUnit.value,
    compose,
    ports: Object.freeze(ports),
    dependencyServiceIds: Object.freeze(dependencyServiceIds),
    ownerId: ownerId.value,
    criticality: criticality.value,
    desiredState: desiredState.value,
    managementCapabilities: managementCapabilities.value,
    lastDeclaredUpdate: input.lastDeclaredUpdate,
  });
};

export const sealValidatedServiceRecord = (
  record: ServiceRecord,
): Result<ServiceRecord, InfrastructureError> => {
  const parsed = parseServiceRegistrationInput(record);
  if (!parsed.ok) return parsed;
  return ok(sealServiceRecord({ ...record, ...parsed.value }));
};

export const parseInfrastructureObservationInput = (
  observation: InfrastructureObservation,
): Result<InfrastructureObservation, InfrastructureError> => {
  const observationId = parseInfrastructureObservationId(observation.observationId);
  if (!observationId.ok) return err(mapFailure(observationId.error));
  const contentTrust = parseEnum(observation.contentTrust, CONTENT_TRUST_LEVELS, 'ContentTrust');
  if (!contentTrust.ok) return contentTrust;
  const sourceKind = parseEnum(
    observation.sourceKind,
    ['provider', 'host', 'health-endpoint', 'reference'] as const,
    'ObservationSourceKind',
  );
  if (!sourceKind.ok) return sourceKind;
  if (
    typeof observation.observedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.observedAt))
  )
    return err(infrastructureError('invalid-input', 'Observation timestamp is invalid.'));

  switch (observation.kind) {
    case 'provider-server-state': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const lifecycle = parseEnum(
        observation.lifecycleStatus,
        SERVER_LIFECYCLE_STATUSES,
        'ServerLifecycleStatus',
      );
      if (!lifecycle.ok) return lifecycle;
      const label = parseBoundedText(observation.providerStatusLabel, {
        max: MAX_OBSERVATION_METADATA_LENGTH,
        label: 'ProviderStatusLabel',
      });
      if (!label.ok) return err(mapFailure(label.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          lifecycleStatus: lifecycle.value,
          providerStatusLabel: label.value,
        }),
      );
    }
    case 'host-server-state': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const uptime =
        observation.uptimeSeconds === null
          ? ok(null)
          : parseNonNegativeInteger(
              observation.uptimeSeconds,
              'uptimeSeconds',
              Number.MAX_SAFE_INTEGER,
            );
      if (!uptime.ok) return err(mapFailure(uptime.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          uptimeSeconds: uptime.value,
        }),
      );
    }
    case 'host-service-state': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const serviceId = parseServiceId(observation.serviceId);
      if (!serviceId.ok) return err(mapFailure(serviceId.error));
      const activeState = parseEnum(
        observation.activeState,
        SERVICE_DESIRED_STATES,
        'ServiceDesiredState',
      );
      if (!activeState.ok) return activeState;
      const restartCount = parseNonNegativeInteger(
        observation.restartCount,
        'restartCount',
        Number.MAX_SAFE_INTEGER,
      );
      if (!restartCount.ok) return err(mapFailure(restartCount.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          serviceId: serviceId.value,
          activeState: activeState.value,
          restartCount: restartCount.value,
        }),
      );
    }
    case 'health-snapshot': {
      const asServer = parseServerId(observation.targetId);
      const targetId = asServer.ok ? asServer : parseServiceId(observation.targetId);
      if (!targetId.ok) return err(mapFailure(targetId.error));
      const snapshotResult = sealValidatedHealthSnapshot(observation.snapshot);
      if (!snapshotResult.ok) return snapshotResult;
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          targetId: targetId.value,
          snapshot: snapshotResult.value,
        }),
      );
    }
    case 'resource-snapshot': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const snapshotResult = sealValidatedResourceSnapshot({
        ...observation.snapshot,
        serverId: serverId.value,
      });
      if (!snapshotResult.ok) return snapshotResult;
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          snapshot: snapshotResult.value,
        }),
      );
    }
    case 'release-observation': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const serviceId = parseServiceId(observation.serviceId);
      if (!serviceId.ok) return err(mapFailure(serviceId.error));
      const releaseId = parseReleaseId(observation.releaseId);
      if (!releaseId.ok) return err(mapFailure(releaseId.error));
      const versionLabel = parseBoundedText(observation.versionLabel, {
        max: MAX_OBSERVATION_METADATA_LENGTH,
        label: 'VersionLabel',
      });
      if (!versionLabel.ok) return err(mapFailure(versionLabel.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          serviceId: serviceId.value,
          releaseId: releaseId.value,
          versionLabel: versionLabel.value,
        }),
      );
    }
    case 'backup-metadata': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const statusLabel = parseBoundedText(observation.statusLabel, {
        max: MAX_OBSERVATION_METADATA_LENGTH,
        label: 'BackupStatusLabel',
      });
      if (!statusLabel.ok) return err(mapFailure(statusLabel.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          statusLabel: statusLabel.value,
        }),
      );
    }
    case 'certificate-metadata': {
      const serverId = parseServerId(observation.serverId);
      if (!serverId.ok) return err(mapFailure(serverId.error));
      const serviceId =
        observation.serviceId === null ? ok(null) : parseServiceId(observation.serviceId);
      if (!serviceId.ok) return err(mapFailure(serviceId.error));
      const statusLabel = parseBoundedText(observation.statusLabel, {
        max: MAX_OBSERVATION_METADATA_LENGTH,
        label: 'CertificateStatusLabel',
      });
      if (!statusLabel.ok) return err(mapFailure(statusLabel.error));
      return ok(
        sealObservation({
          ...observation,
          observationId: observationId.value,
          sourceKind: sourceKind.value,
          serverId: serverId.value,
          serviceId: serviceId.value,
          statusLabel: statusLabel.value,
        }),
      );
    }
    default:
      return err(infrastructureError('invalid-input', 'Unknown observation kind.'));
  }
};
