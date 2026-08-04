/**
 * Timeweb provider contract only. No HTTP client, no credentials, no network calls.
 * Responses are untrusted external data parsed/validated by a future adapter.
 */

import type { ConnectionId } from '../../../core/domain/connector/identity.js';
import type {
  ProviderId,
  ProviderServerId,
  RegionId,
} from '../../../core/domain/infrastructure/identity.js';
import type { ServerLifecycleStatus } from '../../../core/domain/infrastructure/capabilities.js';
import type { InfrastructureProviderRequest } from '../../../core/domain/infrastructure/provider.js';

export const TIMEWEB_PROVIDER_ID = 'timeweb' as ProviderId;

export interface TimewebAccountConnectionRequirements {
  readonly connectionId: ConnectionId;
  readonly providerId: ProviderId;
  readonly accountReference: string;
  readonly requiresSecretReference: true;
}

export interface TimewebProviderAccountReference {
  readonly accountReference: string;
  readonly providerId: ProviderId;
}

export interface TimewebServerIdMapping {
  readonly providerServerId: ProviderServerId;
  readonly internalServerReference: string;
}

export interface TimewebRegionMapping {
  readonly regionId: RegionId;
  readonly providerRegionCode: string;
}

export interface TimewebPlanResourceMapping {
  readonly planLabel: string;
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly storageBytes: number;
}

export interface TimewebNormalizedLifecycle {
  readonly providerStatus: string;
  readonly lifecycleStatus: ServerLifecycleStatus;
}

export interface TimewebRateLimitNormalization {
  readonly retryAfterMs: number | null;
  readonly limited: boolean;
}

export interface TimewebProviderErrorNormalization {
  readonly code: string;
  readonly reason: string;
  readonly category: 'remote' | 'rate-limited' | 'invalid-response' | 'unavailable';
}

export const TIMEWEB_READ_ONLY_OPERATIONS = Object.freeze([
  'list-servers',
  'get-server-metadata',
  'get-server-lifecycle',
  'get-resource-allocation',
  'get-provider-health',
  'get-network-metadata',
  'get-billing-plan-metadata',
] as const);

export type TimewebReadOnlyOperation = (typeof TIMEWEB_READ_ONLY_OPERATIONS)[number];

export const TIMEWEB_FUTURE_MUTATION_OPERATIONS = Object.freeze([
  'create-server',
  'resize-server',
  'start-server',
  'stop-server',
  'reboot-server',
  'delete-server',
] as const);

export type TimewebFutureMutationOperation = (typeof TIMEWEB_FUTURE_MUTATION_OPERATIONS)[number];

export type TimewebProviderRequest = Extract<
  InfrastructureProviderRequest,
  { readonly op: TimewebReadOnlyOperation | TimewebFutureMutationOperation }
>;

/**
 * Contract marker: Timeweb adapter implementation is deferred.
 * This module defines mapping and normalization contracts only.
 */
export interface TimewebProviderContract {
  readonly providerId: ProviderId;
  readonly supportedReadOperations: readonly TimewebReadOnlyOperation[];
  readonly deferredMutationOperations: readonly TimewebFutureMutationOperation[];
  normalizeLifecycle(providerStatus: string): TimewebNormalizedLifecycle;
  normalizeRateLimit(retryAfterHeader: string | null): TimewebRateLimitNormalization;
  normalizeError(untrustedCode: string): TimewebProviderErrorNormalization;
}

export const createTimewebProviderContract = (): TimewebProviderContract => ({
  providerId: TIMEWEB_PROVIDER_ID,
  supportedReadOperations: TIMEWEB_READ_ONLY_OPERATIONS,
  deferredMutationOperations: TIMEWEB_FUTURE_MUTATION_OPERATIONS,
  normalizeLifecycle(providerStatus) {
    const normalized = providerStatus.toLowerCase();
    const lifecycleStatus: ServerLifecycleStatus =
      normalized === 'active'
        ? 'active'
        : normalized === 'stopped'
          ? 'suspended'
          : normalized === 'creating'
            ? 'provisioning'
            : 'unknown';
    return { providerStatus: providerStatus.slice(0, 64), lifecycleStatus };
  },
  normalizeRateLimit(retryAfterHeader) {
    if (retryAfterHeader === null) return { retryAfterMs: null, limited: false };
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return { retryAfterMs: 30_000, limited: true };
    return { retryAfterMs: seconds * 1000, limited: true };
  },
  normalizeError(untrustedCode) {
    return {
      code: untrustedCode.slice(0, 64),
      reason: 'Timeweb provider error.',
      category: untrustedCode === 'rate_limited' ? 'rate-limited' : 'remote',
    };
  },
});
