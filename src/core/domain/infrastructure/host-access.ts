import type { CorrelationId } from '../identity.js';
import type { SecretReferenceMetadata } from '../connector/secret.js';
import type { InfrastructureLogRequest, InfrastructureLogResult } from './logs.js';
import type { HealthSnapshot, ServiceHealthTarget } from './health.js';
import type { ResourceSnapshot } from './resources.js';
import type { ReleaseId, ServerId, ServiceId } from './identity.js';
import type { InfrastructureError } from './errors.js';
import type { ServiceDesiredState } from './capabilities.js';

export const RESTRICTED_HOST_READ_OPERATIONS = Object.freeze([
  'inspect-host-identity',
  'inspect-operating-system',
  'inspect-resource-usage',
  'inspect-disk-usage',
  'inspect-memory-usage',
  'inspect-load-average',
  'inspect-process-summary',
  'inspect-listening-ports',
  'inspect-service-status',
  'inspect-systemd-unit',
  'read-bounded-service-logs',
  'inspect-directory-metadata',
  'inspect-release-metadata',
  'inspect-compose-status',
  'inspect-database-connectivity',
] as const);

export type RestrictedHostReadOperation = (typeof RESTRICTED_HOST_READ_OPERATIONS)[number];

export const RESTRICTED_HOST_MUTATION_OPERATIONS = Object.freeze([
  'start-service',
  'stop-service',
  'restart-service',
  'reload-service',
  'deploy-approved-release',
  'rollback-approved-release',
  'prune-approved-artifacts',
  'update-approved-configuration',
  'change-firewall-rule',
  'create-system-user',
  'rotate-credential-reference',
] as const);

export type RestrictedHostMutationOperation = (typeof RESTRICTED_HOST_MUTATION_OPERATIONS)[number];

export type RestrictedHostOperation =
  | { readonly op: 'inspect-host-identity'; readonly serverId: ServerId }
  | { readonly op: 'inspect-operating-system'; readonly serverId: ServerId }
  | { readonly op: 'inspect-resource-usage'; readonly serverId: ServerId }
  | { readonly op: 'inspect-disk-usage'; readonly serverId: ServerId }
  | { readonly op: 'inspect-memory-usage'; readonly serverId: ServerId }
  | { readonly op: 'inspect-load-average'; readonly serverId: ServerId }
  | { readonly op: 'inspect-process-summary'; readonly serverId: ServerId }
  | { readonly op: 'inspect-listening-ports'; readonly serverId: ServerId }
  | {
      readonly op: 'inspect-service-status';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'inspect-systemd-unit';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | { readonly op: 'read-bounded-service-logs'; readonly request: InfrastructureLogRequest }
  | {
      readonly op: 'inspect-directory-metadata';
      readonly serverId: ServerId;
      readonly directoryPath: string;
    }
  | {
      readonly op: 'inspect-release-metadata';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'inspect-compose-status';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'inspect-database-connectivity';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'start-service';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'stop-service';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'restart-service';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'reload-service';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'deploy-approved-release';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
      readonly releaseId: ReleaseId;
    }
  | {
      readonly op: 'rollback-approved-release';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
      readonly releaseId: ReleaseId;
    }
  | {
      readonly op: 'prune-approved-artifacts';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
    }
  | {
      readonly op: 'update-approved-configuration';
      readonly serverId: ServerId;
      readonly serviceId: ServiceId;
      readonly configurationReference: string;
    }
  | { readonly op: 'change-firewall-rule'; readonly serverId: ServerId }
  | { readonly op: 'create-system-user'; readonly serverId: ServerId; readonly username: string }
  | { readonly op: 'rotate-credential-reference'; readonly serverId: ServerId };

export interface RestrictedHostOperationMetadata {
  readonly capability: RestrictedHostReadOperation | RestrictedHostMutationOperation;
  readonly sideEffect: 'read' | 'write';
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
  readonly timeoutMs: number;
  readonly requiresApproval: boolean;
  readonly supportsCancellation: boolean;
  readonly idempotency: 'none' | 'keyed';
}

export type RestrictedHostResult =
  | {
      readonly ok: true;
      readonly contentTrust: 'untrusted';
      readonly data: RestrictedHostResultData;
    }
  | { readonly ok: false; readonly error: InfrastructureError };

export type RestrictedHostResultData =
  | { readonly kind: 'host-identity'; readonly fingerprint: string }
  | { readonly kind: 'operating-system'; readonly family: string; readonly version: string }
  | { readonly kind: 'resource-snapshot'; readonly snapshot: ResourceSnapshot }
  | {
      readonly kind: 'service-status';
      readonly target: ServiceHealthTarget;
      readonly state: ServiceDesiredState;
    }
  | { readonly kind: 'bounded-logs'; readonly result: InfrastructureLogResult }
  | {
      readonly kind: 'release-metadata';
      readonly releaseId: ReleaseId;
      readonly versionLabel: string;
    }
  | { readonly kind: 'database-connectivity'; readonly connected: boolean }
  | { readonly kind: 'mutation-ack'; readonly outcome: 'completed' | 'outcome-unknown' }
  | { readonly kind: 'health-snapshot'; readonly snapshot: HealthSnapshot };

export interface RestrictedHostAccessPort {
  execute(operation: RestrictedHostOperation, signal: AbortSignal): Promise<RestrictedHostResult>;
}

/**
 * Restricted SSH adapter contract only. Fixed trusted operation-template identifiers
 * are the preferred future adapter; remote helper is deferred behind the same port.
 */
export interface RestrictedSshAdapterContract {
  readonly adapterId: string;
  readonly secretReference: SecretReferenceMetadata;
  readonly pinnedHostFingerprint: string;
  readonly connectionTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly operationTemplateId: string;
  readonly auditCorrelationId: CorrelationId;
  executeTemplate(
    templateId: string,
    boundedArguments: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<RestrictedHostResult>;
}
