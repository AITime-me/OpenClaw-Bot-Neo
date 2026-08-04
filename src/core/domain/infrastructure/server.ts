import type { ISO8601 } from '../identity.js';
import type { OwnerId } from '../identity.js';
import type { SecretReferenceId } from '../connector/identity.js';
import { deepFreeze } from '../immutable.js';
import type {
  EnvironmentId,
  HostConnectionReferenceId,
  ProviderId,
  ProviderServerId,
  RegionId,
  ServerDisplayName,
  ServerId,
} from './identity.js';
import type { ServerLifecycleStatus, ServerManagementCapability } from './capabilities.js';
import type { InfrastructureError } from './errors.js';

export interface OperatingSystemMetadata {
  readonly family: string;
  readonly version: string;
  readonly architecture: string;
}

export interface ResourceCapacity {
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly storageBytes: number;
}

export interface AddressingMetadata {
  readonly primaryHostname: string | null;
  readonly primaryIpv4: string | null;
  readonly primaryIpv6: string | null;
}

export interface HostConnectionReference {
  readonly connectionReferenceId: HostConnectionReferenceId;
  readonly secretReferenceId: SecretReferenceId;
  readonly pinnedHostFingerprint: string;
}

export interface ServerRecord {
  readonly serverId: ServerId;
  readonly providerId: ProviderId;
  readonly providerServerId: ProviderServerId | null;
  readonly environmentId: EnvironmentId;
  readonly regionId: RegionId | null;
  readonly displayName: ServerDisplayName;
  readonly purpose: string;
  readonly lifecycleStatus: ServerLifecycleStatus;
  readonly os: OperatingSystemMetadata;
  readonly capacity: ResourceCapacity;
  readonly addressing: AddressingMetadata;
  readonly managementCapabilities: readonly ServerManagementCapability[];
  readonly hostConnection: HostConnectionReference | null;
  readonly ownerId: OwnerId;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}

export const sealServerRecord = (record: ServerRecord): ServerRecord =>
  deepFreeze({
    ...record,
    os: deepFreeze({ ...record.os }),
    capacity: deepFreeze({ ...record.capacity }),
    addressing: deepFreeze({ ...record.addressing }),
    managementCapabilities: Object.freeze([...record.managementCapabilities]),
    hostConnection:
      record.hostConnection === null ? null : deepFreeze({ ...record.hostConnection }),
  });

export type ServerRegistrationInput = Omit<ServerRecord, 'createdAt' | 'updatedAt'>;

export type ServerInventoryFailure = InfrastructureError;
