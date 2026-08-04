import type {
  InfrastructureProviderPort,
  InfrastructureProviderRequest,
  InfrastructureProviderResult,
} from '../../core/domain/infrastructure/provider.js';
import { infrastructureError } from '../../core/domain/infrastructure/errors.js';
import type { ServerId } from '../../core/domain/infrastructure/identity.js';
import { sealResourceSnapshot } from '../../core/domain/infrastructure/resources.js';

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

export const REFERENCE_PROVIDER_SCENARIOS = Object.freeze([
  'healthy',
  'degraded',
  'unavailable',
  'resource-pressure',
  'timeout',
  'rate-limited',
  'invalid-response',
] as const);

export type ReferenceProviderScenario = (typeof REFERENCE_PROVIDER_SCENARIOS)[number];

export interface ReferenceProviderOptions {
  readonly scenario?: ReferenceProviderScenario;
  readonly serverId?: ServerId;
}

export const createReferenceInfrastructureProvider = (
  options: ReferenceProviderOptions = {},
): InfrastructureProviderPort => ({
  async execute(
    request: InfrastructureProviderRequest,
    signal: AbortSignal,
  ): Promise<InfrastructureProviderResult> {
    const scenario = options.scenario ?? 'healthy';
    if (scenario === 'timeout') {
      try {
        await delay(60_000, signal);
      } catch {
        return {
          ok: false,
          error: infrastructureError('cancelled', 'Provider operation cancelled.'),
        };
      }
      return {
        ok: false,
        error: infrastructureError('operation-timeout', 'Provider operation timed out.'),
      };
    }
    if (scenario === 'unavailable')
      return {
        ok: false,
        error: infrastructureError('provider-unavailable', 'Reference provider unavailable.'),
      };
    if (scenario === 'rate-limited')
      return {
        ok: false,
        error: infrastructureError('rate-limited', 'Reference provider rate limited.'),
      };
    if (scenario === 'invalid-response')
      return {
        ok: false,
        error: infrastructureError('invalid-provider-response', 'Invalid provider response.'),
      };

    if (request.op === 'list-servers')
      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'server-list',
          serverIds: Object.freeze([(options.serverId ?? 'srv-ref-1') as ServerId]),
        },
      };

    if (request.op === 'get-provider-health')
      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'provider-health',
          health: {
            status: scenario === 'degraded' ? 'degraded' : 'healthy',
            retryAfterMs: null,
          },
        },
      };

    if (request.op === 'get-resource-allocation') {
      const pressure = scenario === 'resource-pressure';
      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'resource-allocation',
          snapshot: sealResourceSnapshot({
            serverId: request.serverId,
            cpuUtilizationPercent: pressure ? 95 : 25,
            memoryUsedBytes: pressure ? 9_000_000_000 : 2_000_000_000,
            memoryTotalBytes: 10_000_000_000,
            diskUsedBytes: pressure ? 90_000_000_000 : 20_000_000_000,
            diskTotalBytes: 100_000_000_000,
            loadAverage1m: pressure ? 4.5 : 0.5,
            loadAverage5m: pressure ? 3.2 : 0.4,
            loadAverage15m: pressure ? 2.1 : 0.3,
            uptimeSeconds: 86_400,
            providerLifecycle: scenario === 'degraded' ? 'degraded' : 'active',
            hostReachable: true,
          }),
        },
      };
    }

    if (request.op === 'get-server-lifecycle')
      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'server-lifecycle',
          lifecycleStatus: scenario === 'degraded' ? 'degraded' : 'active',
        },
      };

    if (request.op === 'get-server-metadata')
      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'server-metadata',
          metadata: {
            serverId: request.serverId,
            lifecycleStatus: scenario === 'degraded' ? 'degraded' : 'active',
            planLabel: 'reference-plan',
            regionLabel: 'reference-region',
          },
        },
      };

    if (request.op === 'delete-server' || request.op === 'create-server')
      return {
        ok: false,
        error: infrastructureError('policy-denied', 'Mutation hard-denied in reference provider.'),
      };

    return {
      ok: false,
      error: infrastructureError('operation-not-supported', 'Unsupported provider operation.'),
    };
  },
});
