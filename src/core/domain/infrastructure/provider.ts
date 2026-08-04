import type { ServerId } from './identity.js';
import type { InfrastructureError } from './errors.js';
import type { ServerLifecycleStatus } from './capabilities.js';
import type { ResourceSnapshot } from './resources.js';

export const INFRASTRUCTURE_PROVIDER_READ_OPERATIONS = Object.freeze([
  'list-servers',
  'get-server-metadata',
  'get-server-lifecycle',
  'get-resource-allocation',
  'get-provider-health',
  'get-network-metadata',
  'get-billing-plan-metadata',
] as const);

export type InfrastructureProviderReadOperation =
  (typeof INFRASTRUCTURE_PROVIDER_READ_OPERATIONS)[number];

export const INFRASTRUCTURE_PROVIDER_MUTATION_OPERATIONS = Object.freeze([
  'create-server',
  'resize-server',
  'start-server',
  'stop-server',
  'reboot-server',
  'delete-server',
  'change-network',
  'change-firewall',
  'rotate-credential-reference',
] as const);

export type InfrastructureProviderMutationOperation =
  (typeof INFRASTRUCTURE_PROVIDER_MUTATION_OPERATIONS)[number];

export type InfrastructureProviderRequest =
  | { readonly op: 'list-servers' }
  | { readonly op: 'get-server-metadata'; readonly serverId: ServerId }
  | { readonly op: 'get-server-lifecycle'; readonly serverId: ServerId }
  | { readonly op: 'get-resource-allocation'; readonly serverId: ServerId }
  | { readonly op: 'get-provider-health' }
  | { readonly op: 'get-network-metadata'; readonly serverId: ServerId }
  | { readonly op: 'get-billing-plan-metadata'; readonly serverId: ServerId }
  | { readonly op: 'create-server' }
  | { readonly op: 'resize-server'; readonly serverId: ServerId }
  | { readonly op: 'start-server'; readonly serverId: ServerId }
  | { readonly op: 'stop-server'; readonly serverId: ServerId }
  | { readonly op: 'reboot-server'; readonly serverId: ServerId }
  | { readonly op: 'delete-server'; readonly serverId: ServerId }
  | { readonly op: 'change-network'; readonly serverId: ServerId }
  | { readonly op: 'change-firewall'; readonly serverId: ServerId }
  | { readonly op: 'rotate-credential-reference'; readonly serverId: ServerId };

export interface ProviderServerMetadata {
  readonly serverId: ServerId;
  readonly lifecycleStatus: ServerLifecycleStatus;
  readonly planLabel: string;
  readonly regionLabel: string;
}

export interface ProviderHealthResult {
  readonly status: 'healthy' | 'degraded' | 'unavailable';
  readonly retryAfterMs: number | null;
}

export type InfrastructureProviderResult =
  | { readonly ok: true; readonly contentTrust: 'untrusted'; readonly data: ProviderResultData }
  | { readonly ok: false; readonly error: InfrastructureError };

export type ProviderResultData =
  | { readonly kind: 'server-list'; readonly serverIds: readonly ServerId[] }
  | { readonly kind: 'server-metadata'; readonly metadata: ProviderServerMetadata }
  | { readonly kind: 'server-lifecycle'; readonly lifecycleStatus: ServerLifecycleStatus }
  | { readonly kind: 'resource-allocation'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'provider-health'; readonly health: ProviderHealthResult }
  | { readonly kind: 'network-metadata'; readonly primaryIpv4: string | null }
  | { readonly kind: 'billing-plan-metadata'; readonly planLabel: string }
  | { readonly kind: 'mutation-ack'; readonly outcome: 'completed' | 'outcome-unknown' };

export interface InfrastructureProviderPort {
  execute(
    request: InfrastructureProviderRequest,
    signal: AbortSignal,
  ): Promise<InfrastructureProviderResult>;
}
