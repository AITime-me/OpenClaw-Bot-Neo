import type { ClockPort } from '../../src/core/ports/clock.port.js';
import {
  createDefaultDenyToolPolicyEngine,
  createInMemoryAccountConnectionRegistry,
  createInMemoryConnectorHealthRegistry,
  createInMemoryConnectorRegistry,
  createInMemoryToolApprovalPort,
  createInMemoryToolAuditPort,
  createInMemoryToolRegistry,
  createTestConnectorSecretProvider,
  createToolInvocationOrchestrator,
} from '../../src/core/application/connector/index.js';
import {
  createReferenceConnector,
  createReferenceConnectorManifest,
  REFERENCE_TOOLS,
  asToolId,
} from '../../src/connectors/reference/index.js';
import type {
  ActorId,
  ApprovalId,
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

export const NOW = '2026-08-04T10:00:00.000Z';

export const fixedClock = (instant = NOW): ClockPort => ({
  now: () => new Date(instant),
});

export const asOwner = (value = 'owner-1'): OwnerId => value as OwnerId;
export const asActor = (value = 'actor-1'): ActorId => value as ActorId;
export const asCorrelation = (value = 'corr-1'): CorrelationId => value as CorrelationId;
export const asInvocation = (value = 'inv-1'): InvocationId => value as InvocationId;
export const asConnection = (value = 'conn-1'): ConnectionId => value as ConnectionId;
export const asApproval = (value = 'approval.inv-1'): ApprovalId => value as ApprovalId;
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
    readonly approval?: ReturnType<typeof createInMemoryToolApprovalPort>;
  } = {},
) => {
  const connectorRegistry = createInMemoryConnectorRegistry();
  const connectorManifest = createReferenceConnectorManifest();
  const connector = createReferenceConnector();
  connectorRegistry.register(connectorManifest, connector);
  const toolRegistry = createInMemoryToolRegistry(connectorRegistry);
  for (const tool of REFERENCE_TOOLS) toolRegistry.register(tool);
  const connectionRegistry = createInMemoryAccountConnectionRegistry(connectorRegistry);
  const healthRegistry = createInMemoryConnectorHealthRegistry();
  const policyEngine = createDefaultDenyToolPolicyEngine();
  const approvalPort = options.approval ?? createInMemoryToolApprovalPort();
  const auditPort = options.audit ?? createInMemoryToolAuditPort();
  const secretProvider = createTestConnectorSecretProvider(options.secretReferences ?? new Map());
  const orchestrator = createToolInvocationOrchestrator({
    connectorRegistry,
    toolRegistry,
    connectionRegistry,
    healthRegistry,
    policyEngine,
    approvalPort,
    auditPort,
    secretProvider,
    clock: fixedClock(),
  });
  return {
    connectorRegistry,
    toolRegistry,
    connectionRegistry,
    healthRegistry,
    approvalPort,
    auditPort,
    secretProvider,
    orchestrator,
    connectorManifest,
  };
};

export const invoke = (
  harness: ReturnType<typeof createPlatformHarness>,
  request: Partial<ToolInvocationRequest> & Pick<ToolInvocationRequest, 'toolId'>,
) =>
  harness.orchestrator.invoke(
    {
      invocationId: asInvocation(request.invocationId ?? 'inv-1'),
      toolId: request.toolId,
      connectionId: request.connectionId ?? null,
      input: request.input ?? { message: 'hello' },
      approvalId: request.approvalId ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      timeoutOverrideMs: request.timeoutOverrideMs ?? null,
    },
    invocationContext(),
  );

export const iso = iso8601FromDate;

export { asToolId, REFERENCE_TOOLS, createReferenceConnectorManifest };
