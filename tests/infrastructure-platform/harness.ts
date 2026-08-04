import type { ClockPort } from '../../src/core/ports/clock.port.js';
import {
  createInMemoryConnectorRegistries,
  createInMemoryToolRegistry,
  createInMemoryToolAuditPort,
  createInMemoryAccountConnectionRegistry,
  createInMemoryConnectorHealthRegistry,
  createInMemoryToolApprovalPorts,
  createTestConnectorSecretProvider,
  createToolInvocationOrchestrator,
} from '../../src/core/application/connector/index.js';
import {
  createInfrastructureCoordinator,
  createInfrastructureToolPolicyEngine,
  createInMemoryEnvironmentRegistry,
  createInMemoryInfrastructureObservationRegistry,
  createInMemoryServerInventory,
  createInMemoryServiceInventory,
  INFRASTRUCTURE_TOOLS,
} from '../../src/core/application/infrastructure/index.js';
import {
  createInfrastructureConnector,
  createInfrastructureConnectorManifest,
} from '../../src/connectors/infrastructure/index.js';
import type { InfrastructureConnectorSimulation } from '../../src/connectors/infrastructure/infrastructure-connector-simulation.js';
import type {
  ActorId,
  ApprovalId,
  ApprovalNonce,
  CorrelationId,
  IdempotencyKey,
  InvocationId,
  OwnerId,
  ToolInvocationContext,
  ToolInvocationRequest,
} from '../../src/core/domain/connector/index.js';
import { iso8601FromDate } from '../../src/core/domain/identity.js';
import type { ToolId } from '../../src/core/domain/connector/identity.js';
import type { JsonObject } from '../../src/core/domain/connector/json.js';
import { computeInputDigest } from '../../src/core/domain/connector/canonical-digest.js';

export const NOW = '2026-08-04T10:00:00.000Z';

export const fixedClock = (instant = NOW): ClockPort => ({
  now: () => new Date(instant),
});

export const asOwner = (value = 'owner-1'): OwnerId => value as OwnerId;
export const asActor = (value = 'actor-1'): ActorId => value as ActorId;
export const asApprover = (value = 'approver-1'): ActorId => value as ActorId;
export const asCorrelation = (value = 'corr-1'): CorrelationId => value as CorrelationId;
export const asInvocation = (value = 'inv-1'): InvocationId => value as InvocationId;
export const asApproval = (value = 'approval.inv-1'): ApprovalId => value as ApprovalId;
export const asNonce = (value = 'nonce-1'): ApprovalNonce => value as ApprovalNonce;
export const asIdempotency = (value = 'idem-1'): IdempotencyKey => value as IdempotencyKey;
export const asToolId = (value: string): ToolId => value as ToolId;

export const invocationContext = (
  overrides: Partial<ToolInvocationContext> = {},
): ToolInvocationContext => ({
  ownerId: asOwner(),
  actorId: asActor(),
  correlationId: asCorrelation(),
  signal: new AbortController().signal,
  ...overrides,
});

export const createInfrastructureHarness = (options?: {
  readonly simulation?: InfrastructureConnectorSimulation;
}) => {
  const clock = fixedClock();
  const environments = createInMemoryEnvironmentRegistry();
  const servers = createInMemoryServerInventory(environments);
  const services = createInMemoryServiceInventory(servers);
  const observations = createInMemoryInfrastructureObservationRegistry();
  const coordinator = createInfrastructureCoordinator({
    environments,
    servers,
    services,
    observations,
  });
  const { catalog, execution } = createInMemoryConnectorRegistries();
  const manifest = createInfrastructureConnectorManifest();
  catalog.register(
    manifest,
    createInfrastructureConnector({
      coordinator,
      ...(options?.simulation !== undefined ? { simulation: options.simulation } : {}),
    }),
  );
  const toolRegistry = createInMemoryToolRegistry(catalog);
  for (const tool of INFRASTRUCTURE_TOOLS) toolRegistry.register(tool);
  const connectionRegistry = createInMemoryAccountConnectionRegistry(catalog);
  const healthRegistry = createInMemoryConnectorHealthRegistry();
  const { approvalPort, decisionPort } = createInMemoryToolApprovalPorts(clock);
  const auditPort = createInMemoryToolAuditPort();
  const secretProvider = createTestConnectorSecretProvider(new Map());
  const orchestrator = createToolInvocationOrchestrator({
    connectorCatalog: catalog,
    connectorExecution: execution,
    toolRegistry,
    connectionRegistry,
    healthRegistry,
    policyEngine: createInfrastructureToolPolicyEngine(),
    approvalPort,
    auditPort,
    secretProvider,
    clock,
  });
  return {
    environments,
    servers,
    services,
    observations,
    coordinator,
    orchestrator,
    approvalPort,
    decisionPort,
    auditPort,
    secretProvider,
    toolRegistry,
    catalog,
    execution,
    healthRegistry,
    clock,
    simulation: options?.simulation,
  };
};

export const invoke = (
  harness: ReturnType<typeof createInfrastructureHarness>,
  request: Partial<ToolInvocationRequest> & { readonly toolId: ToolId; readonly input: unknown },
) =>
  harness.orchestrator.invoke(
    {
      invocationId: request.invocationId ?? asInvocation(),
      toolId: request.toolId,
      connectionId: request.connectionId ?? null,
      input: request.input as JsonObject,
      approvalId: request.approvalId ?? null,
      approvalNonce: request.approvalNonce ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      timeoutOverrideMs: request.timeoutOverrideMs ?? null,
    },
    invocationContext(),
  );

export const digestFor = (input: JsonObject) => computeInputDigest(input);

export const iso = (date: Date): string => iso8601FromDate(date);
