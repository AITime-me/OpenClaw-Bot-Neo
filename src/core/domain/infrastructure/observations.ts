import type { ISO8601 } from '../identity.js';
import { deepFreeze } from '../immutable.js';
import type {
  EnvironmentId,
  InfrastructureObservationId,
  ReleaseId,
  ServerId,
  ServiceId,
} from './identity.js';
import type {
  ContentTrust,
  ObservationSourceKind,
  ServerLifecycleStatus,
  ServiceDesiredState,
} from './capabilities.js';
import type { ResourceSnapshot } from './resources.js';
import type { HealthSnapshot } from './health.js';

export interface ObservationBase {
  readonly observationId: InfrastructureObservationId;
  readonly sourceKind: ObservationSourceKind;
  readonly observedAt: ISO8601;
  readonly contentTrust: ContentTrust;
}

export interface ProviderObservedServerState extends ObservationBase {
  readonly kind: 'provider-server-state';
  readonly serverId: ServerId;
  readonly lifecycleStatus: ServerLifecycleStatus;
  readonly providerStatusLabel: string;
}

export interface HostObservedServerState extends ObservationBase {
  readonly kind: 'host-server-state';
  readonly serverId: ServerId;
  readonly reachable: boolean;
  readonly uptimeSeconds: number | null;
}

export interface HostObservedServiceState extends ObservationBase {
  readonly kind: 'host-service-state';
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
  readonly activeState: ServiceDesiredState;
  readonly restartCount: number;
}

export interface HealthSnapshotObservation extends ObservationBase {
  readonly kind: 'health-snapshot';
  readonly targetId: ServerId | ServiceId;
  readonly snapshot: HealthSnapshot;
}

export interface ResourceSnapshotObservation extends ObservationBase {
  readonly kind: 'resource-snapshot';
  readonly serverId: ServerId;
  readonly snapshot: ResourceSnapshot;
}

export interface ReleaseObservation extends ObservationBase {
  readonly kind: 'release-observation';
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
  readonly releaseId: ReleaseId;
  readonly deployed: boolean;
  readonly versionLabel: string;
}

export interface BackupMetadataObservation extends ObservationBase {
  readonly kind: 'backup-metadata';
  readonly serverId: ServerId;
  readonly lastBackupAt: ISO8601 | null;
  readonly statusLabel: string;
}

export interface CertificateMetadataObservation extends ObservationBase {
  readonly kind: 'certificate-metadata';
  readonly serverId: ServerId;
  readonly serviceId: ServiceId | null;
  readonly expiresAt: ISO8601 | null;
  readonly statusLabel: string;
}

export type InfrastructureObservation =
  | ProviderObservedServerState
  | HostObservedServerState
  | HostObservedServiceState
  | HealthSnapshotObservation
  | ResourceSnapshotObservation
  | ReleaseObservation
  | BackupMetadataObservation
  | CertificateMetadataObservation;

export const sealObservation = (
  observation: InfrastructureObservation,
): InfrastructureObservation => deepFreeze(observation);

export interface EnvironmentObservationContext {
  readonly environmentId: EnvironmentId;
}
