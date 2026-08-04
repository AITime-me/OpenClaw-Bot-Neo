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
 * Closed trusted SSH template identifiers owned by adapter source code.
 * Model/tool callers must not supply template IDs.
 */
export const RESTRICTED_SSH_TRUSTED_TEMPLATE_IDS = Object.freeze([
  'tpl-inspect-host-identity',
  'tpl-inspect-operating-system',
  'tpl-inspect-resource-usage',
  'tpl-inspect-disk-usage',
  'tpl-inspect-memory-usage',
  'tpl-inspect-load-average',
  'tpl-inspect-process-summary',
  'tpl-inspect-listening-ports',
  'tpl-inspect-service-status',
  'tpl-inspect-systemd-unit',
  'tpl-read-bounded-service-logs',
  'tpl-inspect-directory-metadata',
  'tpl-inspect-release-metadata',
  'tpl-inspect-compose-status',
  'tpl-inspect-database-connectivity',
  'tpl-start-service',
  'tpl-stop-service',
  'tpl-restart-service',
  'tpl-reload-service',
  'tpl-deploy-approved-release',
  'tpl-rollback-approved-release',
  'tpl-prune-approved-artifacts',
  'tpl-update-approved-configuration',
] as const);

export type RestrictedSshTrustedTemplateId = (typeof RESTRICTED_SSH_TRUSTED_TEMPLATE_IDS)[number];

export const mapRestrictedHostOperationToSshTemplate = (
  operation: RestrictedHostOperation['op'],
): RestrictedSshTrustedTemplateId | null => {
  switch (operation) {
    case 'inspect-host-identity':
      return 'tpl-inspect-host-identity';
    case 'inspect-operating-system':
      return 'tpl-inspect-operating-system';
    case 'inspect-resource-usage':
      return 'tpl-inspect-resource-usage';
    case 'inspect-disk-usage':
      return 'tpl-inspect-disk-usage';
    case 'inspect-memory-usage':
      return 'tpl-inspect-memory-usage';
    case 'inspect-load-average':
      return 'tpl-inspect-load-average';
    case 'inspect-process-summary':
      return 'tpl-inspect-process-summary';
    case 'inspect-listening-ports':
      return 'tpl-inspect-listening-ports';
    case 'inspect-service-status':
      return 'tpl-inspect-service-status';
    case 'inspect-systemd-unit':
      return 'tpl-inspect-systemd-unit';
    case 'read-bounded-service-logs':
      return 'tpl-read-bounded-service-logs';
    case 'inspect-directory-metadata':
      return 'tpl-inspect-directory-metadata';
    case 'inspect-release-metadata':
      return 'tpl-inspect-release-metadata';
    case 'inspect-compose-status':
      return 'tpl-inspect-compose-status';
    case 'inspect-database-connectivity':
      return 'tpl-inspect-database-connectivity';
    case 'start-service':
      return 'tpl-start-service';
    case 'stop-service':
      return 'tpl-stop-service';
    case 'restart-service':
      return 'tpl-restart-service';
    case 'reload-service':
      return 'tpl-reload-service';
    case 'deploy-approved-release':
      return 'tpl-deploy-approved-release';
    case 'rollback-approved-release':
      return 'tpl-rollback-approved-release';
    case 'prune-approved-artifacts':
      return 'tpl-prune-approved-artifacts';
    case 'update-approved-configuration':
      return 'tpl-update-approved-configuration';
    case 'change-firewall-rule':
    case 'create-system-user':
    case 'rotate-credential-reference':
      return null;
    default:
      return null;
  }
};

/**
 * Restricted SSH adapter contract only. Trusted template IDs are a closed union;
 * adapters map RestrictedHostOperation internally — callers never supply template IDs.
 */
export interface RestrictedSshAdapterContract {
  readonly adapterId: string;
  readonly secretReference: SecretReferenceMetadata;
  readonly pinnedHostFingerprint: string;
  readonly connectionTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly auditCorrelationId: CorrelationId;
  executeTrustedTemplate(
    templateId: RestrictedSshTrustedTemplateId,
    boundedArguments: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<RestrictedHostResult>;
}
