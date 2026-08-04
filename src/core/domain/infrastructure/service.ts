import type { ISO8601 } from '../identity.js';
import type { OwnerId } from '../identity.js';
import { deepFreeze } from '../immutable.js';
import type {
  EnvironmentId,
  ProductIdReference,
  ServerId,
  ServiceDisplayName,
  ServiceId,
  ServicePort,
  SystemdUnitName,
} from './identity.js';
import type {
  ServiceCriticality,
  ServiceDesiredState,
  ServiceManagementCapability,
  ServiceRuntimeType,
  ServiceType,
} from './capabilities.js';
import type { InfrastructureError } from './errors.js';

export interface DeploymentMetadata {
  readonly deploymentRoot: string;
  readonly releaseLabel: string | null;
}

export interface HealthCheckMetadata {
  readonly endpointPath: string | null;
  readonly intervalSeconds: number | null;
}

export interface ComposeMetadata {
  readonly projectName: string;
  readonly serviceName: string;
}

export interface ServiceRecord {
  readonly serviceId: ServiceId;
  readonly serverId: ServerId;
  readonly environmentId: EnvironmentId;
  readonly productIdReference: ProductIdReference | null;
  readonly displayName: ServiceDisplayName;
  readonly serviceType: ServiceType;
  readonly runtimeType: ServiceRuntimeType;
  readonly deployment: DeploymentMetadata;
  readonly healthCheck: HealthCheckMetadata;
  readonly systemdUnit: SystemdUnitName | null;
  readonly compose: ComposeMetadata | null;
  readonly ports: readonly ServicePort[];
  readonly dependencyServiceIds: readonly ServiceId[];
  readonly ownerId: OwnerId;
  readonly criticality: ServiceCriticality;
  readonly desiredState: ServiceDesiredState;
  readonly managementCapabilities: readonly ServiceManagementCapability[];
  readonly lastDeclaredUpdate: ISO8601;
}

export const sealServiceRecord = (record: ServiceRecord): ServiceRecord =>
  deepFreeze({
    ...record,
    deployment: deepFreeze({ ...record.deployment }),
    healthCheck: deepFreeze({ ...record.healthCheck }),
    compose: record.compose === null ? null : deepFreeze({ ...record.compose }),
    ports: Object.freeze([...record.ports]),
    dependencyServiceIds: Object.freeze([...record.dependencyServiceIds]),
    managementCapabilities: Object.freeze([...record.managementCapabilities]),
  });

export type ServiceRegistrationInput = ServiceRecord;

export type ServiceInventoryFailure = InfrastructureError;
