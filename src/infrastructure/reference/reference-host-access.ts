import type {
  RestrictedHostAccessPort,
  RestrictedHostOperation,
  RestrictedHostResult,
} from '../../core/domain/infrastructure/host-access.js';
import { infrastructureError } from '../../core/domain/infrastructure/errors.js';
import { sealResourceSnapshot } from '../../core/domain/infrastructure/resources.js';
import { sealHealthSnapshot } from '../../core/domain/infrastructure/health.js';
import type { ISO8601 } from '../../core/domain/identity.js';

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

export const REFERENCE_HOST_SCENARIOS = Object.freeze([
  'healthy',
  'host-unreachable',
  'host-identity-mismatch',
  'healthy-service',
  'failed-service',
  'bounded-logs',
  'truncated-logs',
  'redacted-logs',
  'restart-approval',
  'deploy-approval',
  'outcome-unknown',
] as const);

export type ReferenceHostScenario = (typeof REFERENCE_HOST_SCENARIOS)[number];

export interface ReferenceHostAccessOptions {
  readonly scenario?: ReferenceHostScenario;
  readonly observedAt?: ISO8601;
}

export const createReferenceRestrictedHostAccess = (
  options: ReferenceHostAccessOptions = {},
): RestrictedHostAccessPort => {
  const scenario = options.scenario ?? 'healthy';
  const observedAt = options.observedAt ?? ('2026-08-04T10:00:00.000Z' as ISO8601);

  return {
    async execute(
      operation: RestrictedHostOperation,
      signal: AbortSignal,
    ): Promise<RestrictedHostResult> {
      if (scenario === 'host-unreachable')
        return {
          ok: false,
          error: infrastructureError('host-unreachable', 'Reference host unreachable.'),
        };
      if (scenario === 'host-identity-mismatch')
        return {
          ok: false,
          error: infrastructureError('host-identity-mismatch', 'Host fingerprint mismatch.'),
        };

      if (operation.op === 'inspect-host-identity')
        return {
          ok: true,
          contentTrust: 'untrusted',
          data: { kind: 'host-identity', fingerprint: 'sha256:reference-fingerprint' },
        };

      if (operation.op === 'inspect-resource-usage')
        return {
          ok: true,
          contentTrust: 'untrusted',
          data: {
            kind: 'resource-snapshot',
            snapshot: sealResourceSnapshot({
              serverId: operation.serverId,
              cpuUtilizationPercent: 20,
              memoryUsedBytes: 1_000_000_000,
              memoryTotalBytes: 4_000_000_000,
              diskUsedBytes: 10_000_000_000,
              diskTotalBytes: 50_000_000_000,
              loadAverage1m: 0.2,
              loadAverage5m: 0.3,
              loadAverage15m: 0.4,
              uptimeSeconds: 100_000,
              providerLifecycle: null,
              hostReachable: true,
            }),
          },
        };

      if (operation.op === 'inspect-service-status')
        return {
          ok: true,
          contentTrust: 'untrusted',
          data: {
            kind: 'service-status',
            target: { serverId: operation.serverId, serviceId: operation.serviceId },
            state: scenario === 'failed-service' ? 'stopped' : 'running',
          },
        };

      if (operation.op === 'read-bounded-service-logs') {
        const raw =
          scenario === 'redacted-logs'
            ? ['token=super-secret-value', 'normal line']
            : scenario === 'truncated-logs'
              ? Array.from({ length: 20 }, (_, index) => `line-${String(index)}`)
              : ['service started', 'listening on port 3000'];
        return {
          ok: true,
          contentTrust: 'untrusted',
          data: {
            kind: 'bounded-logs',
            result: {
              lines: Object.freeze(raw),
              contentTrust: 'untrusted',
              truncated: scenario === 'truncated-logs',
              originalSizeKnown: true,
              returnedBytes: raw.join('\n').length,
              redactionCount: scenario === 'redacted-logs' ? 1 : 0,
              controlCharacterReplacementCount: 0,
              observedAt,
            },
          },
        };
      }

      if (
        operation.op === 'restart-service' ||
        operation.op === 'deploy-approved-release' ||
        operation.op === 'rollback-approved-release'
      ) {
        if (scenario === 'outcome-unknown')
          return {
            ok: true,
            contentTrust: 'untrusted',
            data: { kind: 'mutation-ack', outcome: 'outcome-unknown' },
          };
        try {
          await delay(50, signal);
        } catch {
          return {
            ok: false,
            error: infrastructureError('cancelled', 'Host operation cancelled.'),
          };
        }
        return {
          ok: true,
          contentTrust: 'untrusted',
          data: { kind: 'mutation-ack', outcome: 'completed' },
        };
      }

      if (operation.op === 'change-firewall-rule' || operation.op === 'rotate-credential-reference')
        return {
          ok: false,
          error: infrastructureError('policy-denied', 'Host mutation hard-denied.'),
        };

      return {
        ok: true,
        contentTrust: 'untrusted',
        data: {
          kind: 'health-snapshot',
          snapshot: sealHealthSnapshot({
            serviceState: 'running',
            healthEndpointState: 'healthy',
            responseLatencyMs: 12,
            databaseConnectivity: true,
            restartCount: 0,
          }),
        },
      };
    },
  };
};
