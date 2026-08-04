import type {
  Connector,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
} from '../sdk/connector.js';
import type { ConnectorId } from '../../core/domain/connector/identity.js';
import { validateConnectorManifest } from '../../core/domain/connector/manifest-validation.js';
import { INFRASTRUCTURE_CONNECTOR_ID } from '../../core/domain/infrastructure/constants.js';
import type { InfrastructureCoordinator } from '../../core/application/infrastructure/infrastructure-coordinator.js';
import { INFRASTRUCTURE_TOOLS } from '../../core/application/infrastructure/infrastructure-tool-manifests.js';
import { iso8601FromDate } from '../../core/domain/identity.js';
import { compareDrift } from '../../core/domain/infrastructure/drift.js';
import type { ServerId, ServiceId } from '../../core/domain/infrastructure/identity.js';

const CONNECTOR_ID = INFRASTRUCTURE_CONNECTOR_ID as ConnectorId;

export interface InfrastructureConnectorDeps {
  readonly coordinator: InfrastructureCoordinator;
}

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

export const createInfrastructureConnector = (deps: InfrastructureConnectorDeps): Connector => ({
  connectorId: CONNECTOR_ID,
  initialize(): Promise<void> {
    return Promise.resolve();
  },
  health(): Promise<import('../sdk/connector.js').ConnectorHealthResult> {
    return Promise.resolve({ status: 'healthy', retryAfterMs: null });
  },
  listTools() {
    return INFRASTRUCTURE_TOOLS;
  },
  discoverCapabilities() {
    return ['read', 'list', 'restart', 'deploy', 'administer'];
  },
  async execute(request: ConnectorExecuteRequest): Promise<ConnectorExecutionResult> {
    const toolId = request.tool.toolId as string;
    const input = request.input as Record<string, unknown>;

    if (toolId === 'infrastructure.servers.list') {
      const environmentId = input.environmentId as string | undefined;
      const serverIds = deps.coordinator.listServerIds(environmentId);
      return { ok: true, output: { serverIds: serverIds.map((id) => id as string) } };
    }

    if (toolId === 'infrastructure.server.inspect') {
      if (input.mode === 'unavailable')
        return {
          ok: false,
          error: { code: 'unavailable', reason: 'Unavailable.', category: 'internal' },
        };
      const inspected = deps.coordinator.inspectDeclaredServer(input.serverId as string);
      if (!inspected.ok)
        return {
          ok: false,
          error: { code: 'remote-error', reason: inspected.error.reason, category: 'remote' },
        };
      return {
        ok: true,
        output: {
          serverId: inspected.value.serverId,
          lifecycleStatus: inspected.value.lifecycleStatus,
          displayName: inspected.value.displayName,
        },
      };
    }

    if (toolId === 'infrastructure.server.resources.read') {
      const scenario = (input.scenario as string | undefined) ?? 'healthy';
      if (scenario === 'unavailable')
        return {
          ok: false,
          error: { code: 'unavailable', reason: 'Unavailable.', category: 'internal' },
        };
      if (scenario === 'invalid') return { ok: true, output: { unexpected: true } };
      const pressure = scenario === 'pressure';
      return {
        ok: true,
        output: {
          serverId: input.serverId as string,
          cpuUtilizationPercent: pressure ? 95 : 20,
          memoryUsedBytes: pressure ? 9_000_000_000 : 1_000_000_000,
          memoryTotalBytes: 10_000_000_000,
        },
      };
    }

    if (toolId === 'infrastructure.services.list') {
      const filter: { serverId?: string; environmentId?: string } = {};
      if (input.serverId !== undefined) filter.serverId = input.serverId as string;
      if (input.environmentId !== undefined) filter.environmentId = input.environmentId as string;
      const serviceIds = deps.coordinator.listServiceIds(filter);
      return { ok: true, output: { serviceIds: serviceIds.map((id) => id as string) } };
    }

    if (toolId === 'infrastructure.service.status.read') {
      const scenario = (input.scenario as string | undefined) ?? 'healthy';
      if (scenario === 'unreachable')
        return {
          ok: false,
          error: { code: 'remote-error', reason: 'Host unreachable.', category: 'remote' },
        };
      return {
        ok: true,
        output: {
          serverId: input.serverId as string,
          serviceId: input.serviceId as string,
          activeState: scenario === 'failed' ? 'stopped' : 'running',
        },
      };
    }

    if (toolId === 'infrastructure.service.logs.read') {
      const scenario = (input.scenario as string | undefined) ?? 'ok';
      const raw =
        scenario === 'secrets'
          ? ['password=secret123', 'started']
          : Array.from(
              { length: scenario === 'truncated' ? 50 : 2 },
              (_, i) => `line-${String(i)}`,
            );
      const sanitized = deps.coordinator.sanitizeLogLines(
        raw,
        input.maximumLines as number,
        input.maximumBytes as number,
        iso8601FromDate(new Date()),
      );
      return {
        ok: true,
        output: {
          lines: [...sanitized.lines],
          truncated: sanitized.truncated,
          redactionCount: sanitized.redactionCount,
          controlCharacterReplacementCount: sanitized.controlCharacterReplacementCount,
        },
      };
    }

    if (toolId === 'infrastructure.drift.inspect') {
      const scenario = (input.scenario as string | undefined) ?? 'no-drift';
      const drift = compareDrift({
        declaredServer: null,
        declaredService: null,
        providerObservation:
          scenario === 'lifecycle'
            ? {
                kind: 'provider-server-state',
                observationId: 'obs-1' as never,
                sourceKind: 'reference',
                observedAt: iso8601FromDate(new Date()),
                contentTrust: 'untrusted',
                serverId: input.serverId as ServerId,
                lifecycleStatus: 'degraded',
                providerStatusLabel: 'degraded',
              }
            : null,
        hostObservation:
          scenario === 'service'
            ? {
                kind: 'host-service-state',
                observationId: 'obs-2' as never,
                sourceKind: 'reference',
                observedAt: iso8601FromDate(new Date()),
                contentTrust: 'untrusted',
                serverId: input.serverId as ServerId,
                serviceId: (input.serviceId ?? 'svc-1') as ServiceId,
                activeState: 'stopped',
                restartCount: 1,
              }
            : null,
        resourceSnapshot:
          scenario === 'capacity'
            ? {
                serverId: input.serverId as ServerId,
                cpuUtilizationPercent: 95,
                memoryUsedBytes: 9_500_000_000,
                memoryTotalBytes: 10_000_000_000,
                diskUsedBytes: 90_000_000_000,
                diskTotalBytes: 100_000_000_000,
                loadAverage1m: 5,
                loadAverage5m: 4,
                loadAverage15m: 3,
                uptimeSeconds: 1000,
                providerLifecycle: 'active',
                hostReachable: true,
              }
            : null,
        nowMs: Date.now(),
      });
      return {
        ok: true,
        output: { driftKinds: drift.map((item) => item.kind) },
      };
    }

    if (toolId === 'infrastructure.service.restart') {
      if (input.scenario === 'cancel') {
        try {
          await delay(100, request.signal);
        } catch {
          return {
            ok: false,
            error: { code: 'cancelled', reason: 'Cancelled.', category: 'cancelled' },
          };
        }
      }
      if (input.scenario === 'outcome-unknown')
        return {
          ok: false,
          error: { code: 'unavailable', reason: 'Outcome unknown.', category: 'internal' },
        };
      if (request.signal.aborted)
        return {
          ok: false,
          error: { code: 'cancelled', reason: 'Cancelled.', category: 'cancelled' },
        };
      return { ok: true, output: { restarted: true } };
    }

    if (toolId === 'infrastructure.release.deploy')
      return {
        ok: true,
        output: {
          deployed: input.scenario !== 'outcome-unknown',
          releaseId: input.releaseId as string,
        },
      };

    if (toolId === 'infrastructure.release.rollback')
      return {
        ok: true,
        output: {
          rolledBack: input.scenario !== 'outcome-unknown',
          releaseId: input.releaseId as string,
        },
      };

    if (toolId === 'infrastructure.server.reboot')
      return {
        ok: true,
        output: { rebooted: input.scenario !== 'outcome-unknown' },
      };

    return {
      ok: false,
      error: { code: 'unavailable', reason: 'Unknown infrastructure tool.', category: 'internal' },
    };
  },
  shutdown(): Promise<void> {
    return Promise.resolve();
  },
});

export const createInfrastructureConnectorManifest = () => {
  const result = validateConnectorManifest({
    schemaVersion: 'connector-platform/1',
    connectorId: CONNECTOR_ID,
    title: 'Infrastructure Connector',
    description: 'Offline infrastructure inventory and restricted operations connector.',
    version: '1.0.0',
    declaredCapabilities: ['read', 'list', 'restart', 'deploy', 'administer'],
    networkRequirement: 'none',
    accountModel: 'none',
  });
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};
