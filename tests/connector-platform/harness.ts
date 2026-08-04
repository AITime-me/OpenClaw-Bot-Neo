import type { ClockPort } from '../../src/core/ports/clock.port.js';
import {
  createDefaultDenyToolPolicyEngine,
  createInMemoryAccountConnectionRegistry,
  createInMemoryConnectorHealthRegistry,
  createInMemoryToolApprovalPorts,
  createInMemoryToolAuditPort,
  createInMemoryToolRegistry,
  createTestConnectorSecretProvider,
  createToolInvocationOrchestrator,
} from '../../src/core/application/connector/index.js';
import { createInMemoryConnectorRegistries } from '../../src/core/application/connector/in-memory-connector-registries.js';
import type { ToolApprovalDecisionPort } from '../../src/core/ports/tool-approval-decision.port.js';
import type { ToolApprovalPort } from '../../src/core/ports/tool-approval.port.js';
import {
  createReferenceConnector,
  createReferenceConnectorManifest,
  REFERENCE_TOOLS,
  asToolId,
} from '../../src/connectors/reference/index.js';
import type {
  ActorId,
  ApprovalId,
  ApprovalNonce,
  ConnectionId,
  CorrelationId,
  IdempotencyKey,
  InvocationId,
  OwnerId,
  ToolInvocationContext,
  ToolInvocationRequest,
} from '../../src/core/domain/connector/index.js';
import { iso8601FromDate } from '../../src/core/domain/identity.js';
import type { SecretHandleId } from '../../src/core/domain/connector/identity.js';
import type { ConnectorCatalog } from '../../src/core/application/connector/connector-catalog.port.js';
import type { ConnectorExecutionRegistry } from '../../src/core/application/connector/connector-execution-registry.port.js';

export const NOW = '2026-08-04T10:00:00.000Z';

export const fixedClock = (instant = NOW): ClockPort => ({
  now: () => new Date(instant),
});

export const createMutableClock = (initial = NOW) => {
  let instant = initial;
  const clock: ClockPort = {
    now: () => new Date(instant),
  };
  return {
    clock,
    set: (value: string) => {
      instant = value;
    },
    advanceMs: (ms: number) => {
      instant = iso8601FromDate(new Date(Date.parse(instant) + ms));
    },
  };
};

export const asOwner = (value = 'owner-1'): OwnerId => value as OwnerId;
export const asActor = (value = 'actor-1'): ActorId => value as ActorId;
export const asApprover = (value = 'approver-1'): ActorId => value as ActorId;
export const asCorrelation = (value = 'corr-1'): CorrelationId => value as CorrelationId;
export const asInvocation = (value = 'inv-1'): InvocationId => value as InvocationId;
export const asConnection = (value = 'conn-1'): ConnectionId => value as ConnectionId;
export const asApproval = (value = 'approval.inv-1'): ApprovalId => value as ApprovalId;
export const asNonce = (value = 'nonce-1'): ApprovalNonce => value as ApprovalNonce;
export const asIdempotency = (value = 'idem-1'): IdempotencyKey => value as IdempotencyKey;

export const invocationContext = (
  overrides: Partial<ToolInvocationContext> = {},
): ToolInvocationContext => ({
  ownerId: asOwner(),
  actorId: asActor(),
  correlationId: asCorrelation(),
  signal: new AbortController().signal,
  ...overrides,
});

export const createPlatformHarness = (
  options: {
    readonly secretReferences?: ReadonlyMap<string, SecretHandleId>;
    readonly audit?: ReturnType<typeof createInMemoryToolAuditPort>;
    readonly approval?: ToolApprovalPort;
    readonly decision?: ToolApprovalDecisionPort;
    readonly clock?: ClockPort;
  } = {},
) => {
  const clock = options.clock ?? fixedClock();
  const { catalog, execution } = createInMemoryConnectorRegistries();
  const connectorManifest = createReferenceConnectorManifest();
  const connector = createReferenceConnector();
  catalog.register(connectorManifest, connector);
  const toolRegistry = createInMemoryToolRegistry(catalog);
  for (const tool of REFERENCE_TOOLS) toolRegistry.register(tool);
  const connectionRegistry = createInMemoryAccountConnectionRegistry(catalog);
  const healthRegistry = createInMemoryConnectorHealthRegistry();
  const policyEngine = createDefaultDenyToolPolicyEngine();
  const approvalBundle =
    options.approval !== undefined && options.decision !== undefined
      ? { approvalPort: options.approval, decisionPort: options.decision }
      : createInMemoryToolApprovalPorts(clock);
  const approvalPort = options.approval ?? approvalBundle.approvalPort;
  const decisionPort = options.decision ?? approvalBundle.decisionPort;
  const auditPort = options.audit ?? createInMemoryToolAuditPort();
  const secretProvider = createTestConnectorSecretProvider(options.secretReferences ?? new Map());
  const orchestrator = createToolInvocationOrchestrator({
    connectorCatalog: catalog,
    connectorExecution: execution,
    toolRegistry,
    connectionRegistry,
    healthRegistry,
    policyEngine,
    approvalPort,
    auditPort,
    secretProvider,
    clock,
  });
  return {
    catalog,
    execution,
    toolRegistry,
    connectionRegistry,
    healthRegistry,
    approvalPort,
    decisionPort,
    auditPort,
    secretProvider,
    orchestrator,
    connectorManifest,
    clock,
  };
};

export const invoke = (
  harness: ReturnType<typeof createPlatformHarness>,
  request: Partial<ToolInvocationRequest> & Pick<ToolInvocationRequest, 'toolId'>,
  contextOverrides: Partial<ToolInvocationContext> = {},
) =>
  harness.orchestrator.invoke(
    {
      invocationId: asInvocation(request.invocationId ?? 'inv-1'),
      toolId: request.toolId,
      connectionId: request.connectionId ?? null,
      input: request.input ?? { message: 'hello' },
      approvalId: request.approvalId ?? null,
      approvalNonce: request.approvalNonce ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      timeoutOverrideMs: request.timeoutOverrideMs ?? null,
    },
    invocationContext(contextOverrides),
  );

export const iso = iso8601FromDate;

export { asToolId, REFERENCE_TOOLS, createReferenceConnectorManifest };
export type { ConnectorCatalog, ConnectorExecutionRegistry };
