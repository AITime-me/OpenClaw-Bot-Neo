import { describe, expect, it } from 'vitest';
import {
  createPlatformHarness,
  invoke,
  asToolId,
  asIdempotency,
  asApprover,
  asInvocation,
  fixedClock,
  invocationContext,
} from './harness.js';
import {
  createInMemoryConnectorRegistries,
  createInMemoryToolRegistry,
  createDefaultDenyToolPolicyEngine,
  createInMemoryAccountConnectionRegistry,
  createInMemoryConnectorHealthRegistry,
  createInMemoryToolApprovalPorts,
  createInMemoryToolAuditPort,
  createTestConnectorSecretProvider,
  createToolInvocationOrchestrator,
} from '../../src/core/application/connector/index.js';
import {
  validateToolManifest,
  validateConnectorManifest,
} from '../../src/core/domain/connector/manifest-validation.js';
import {
  connectorExecutionFailure,
  type Connector,
  type ConnectorExecuteRequest,
  type ConnectorExecutionResult,
} from '../../src/connectors/sdk/connector.js';
import type { ConnectorId } from '../../src/core/domain/connector/identity.js';
import type { ToolInvocationRequest } from '../../src/core/domain/connector/invocation.js';

const CONNECTOR_ID = 'typed-outcome' as ConnectorId;

const buildTool = (raw: Record<string, unknown>) => {
  const result = validateToolManifest(raw);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

const READ_TOOL = buildTool({
  schemaVersion: 'connector-tool/1',
  toolId: 'typed-outcome.read',
  connectorId: CONNECTOR_ID,
  version: '1.0.0',
  title: 'Typed Read',
  description: 'Read-only tool for outcome mapping.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { claim: { type: 'string', enum: ['none', 'outcome-unknown', 'malformed'] } },
    required: ['claim'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
  capability: 'read',
  riskClass: 'low',
  sideEffectClass: 'READ_ONLY',
  approvalRequirement: 'never',
  timeoutMs: 5_000,
  idempotencySupport: 'none',
  cancellationSupport: 'cooperative',
  dataSensitivity: 'internal',
  networkRequirement: 'none',
  accountRequirement: 'none',
});

const WRITE_TOOL = buildTool({
  schemaVersion: 'connector-tool/1',
  toolId: 'typed-outcome.write',
  connectorId: CONNECTOR_ID,
  version: '1.0.0',
  title: 'Typed Write',
  description: 'Write-like tool for outcome mapping.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      claim: { type: 'string', enum: ['none', 'outcome-unknown', 'magic-reason', 'malformed'] },
    },
    required: ['claim'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { stored: { type: 'boolean' } },
    required: ['stored'],
  },
  capability: 'create',
  riskClass: 'medium',
  sideEffectClass: 'LOW_RISK_WRITE',
  approvalRequirement: 'always',
  timeoutMs: 5_000,
  idempotencySupport: 'keyed',
  cancellationSupport: 'cooperative',
  dataSensitivity: 'internal',
  networkRequirement: 'none',
  accountRequirement: 'none',
});

const createTypedOutcomeConnector = (): Connector & {
  readonly executeCount: { value: number };
} => {
  const executeCount = { value: 0 };
  return {
    connectorId: CONNECTOR_ID,
    executeCount,
    initialize: () => Promise.resolve(),
    health: () => Promise.resolve({ status: 'healthy', retryAfterMs: null }),
    listTools: () => [READ_TOOL, WRITE_TOOL],
    discoverCapabilities: () => ['read', 'create'],
    execute(request: ConnectorExecuteRequest): Promise<ConnectorExecutionResult> {
      executeCount.value += 1;
      const claim = (request.input as { claim?: string }).claim ?? 'none';
      if (claim === 'outcome-unknown')
        return Promise.resolve(
          connectorExecutionFailure({
            code: 'unavailable',
            reason: 'Mutation outcome is unknown.',
            category: 'internal',
            executionOutcome: 'outcome-unknown',
          }),
        );
      if (claim === 'magic-reason')
        return Promise.resolve({
          ok: false,
          error: {
            code: 'unavailable',
            reason: 'Outcome unknown.',
            category: 'internal',
          },
        });
      if (claim === 'malformed')
        return Promise.resolve({
          ok: false,
          error: {
            code: 'unavailable',
            reason: 'Unavailable.',
            category: 'internal',
            executionOutcome: 'not-a-real-outcome' as never,
          },
        });
      if ((request.tool.toolId as string) === 'typed-outcome.write')
        return Promise.resolve({ ok: true, output: { stored: true } });
      return Promise.resolve({ ok: true, output: { ok: true } });
    },
    shutdown: () => Promise.resolve(),
  };
};

const createTypedHarness = () => {
  const clock = fixedClock();
  const { catalog, execution } = createInMemoryConnectorRegistries();
  const manifestResult = validateConnectorManifest({
    schemaVersion: 'connector-platform/1',
    connectorId: CONNECTOR_ID,
    title: 'Typed Outcome Connector',
    description: 'Test-only connector for executionOutcome mapping.',
    version: '1.0.0',
    declaredCapabilities: ['read', 'create'],
    networkRequirement: 'none',
    accountModel: 'none',
  });
  if (!manifestResult.ok) throw new Error(manifestResult.error.reason);
  const connector = createTypedOutcomeConnector();
  catalog.register(manifestResult.value, connector);
  const toolRegistry = createInMemoryToolRegistry(catalog);
  toolRegistry.register(READ_TOOL);
  toolRegistry.register(WRITE_TOOL);
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
    policyEngine: createDefaultDenyToolPolicyEngine(),
    approvalPort,
    auditPort,
    secretProvider,
    clock,
  });
  return {
    orchestrator,
    auditPort,
    healthRegistry,
    decisionPort,
    secretProvider,
    connector,
    invoke: (
      request: Partial<ToolInvocationRequest> & Pick<ToolInvocationRequest, 'toolId' | 'input'>,
    ) =>
      orchestrator.invoke(
        {
          invocationId: request.invocationId ?? asInvocation(),
          toolId: request.toolId,
          connectionId: request.connectionId ?? null,
          input: request.input,
          approvalId: request.approvalId ?? null,
          approvalNonce: request.approvalNonce ?? null,
          idempotencyKey: request.idempotencyKey ?? null,
          timeoutOverrideMs: request.timeoutOverrideMs ?? null,
        },
        invocationContext(),
      ),
  };
};

const approveWrite = async (
  harness: ReturnType<typeof createTypedHarness>,
  claim: string,
  invocationId: string,
  idempotencyKey: string,
) => {
  const pending = await harness.invoke({
    invocationId: asInvocation(invocationId),
    toolId: asToolId('typed-outcome.write'),
    input: { claim },
    idempotencyKey: asIdempotency(idempotencyKey),
  });
  expect(pending.kind).toBe('approval-required');
  if (pending.kind !== 'approval-required') throw new Error('expected approval');
  const granted = await harness.decisionPort.grant(
    pending.approvalRequest.approvalId,
    asApprover(),
  );
  expect(granted.ok).toBe(true);
  return harness.invoke({
    invocationId: asInvocation(invocationId),
    toolId: pending.toolId,
    input: { claim },
    idempotencyKey: asIdempotency(idempotencyKey),
    approvalId: pending.approvalRequest.approvalId,
    approvalNonce: pending.approvalRequest.nonce,
  });
};

describe('typed connector local executionOutcome (IF-CR02)', () => {
  it('maps write-like typed outcome-unknown to failure without success audit', async () => {
    const harness = createTypedHarness();
    const result = await approveWrite(harness, 'outcome-unknown', 'inv-ou', 'k-ou');
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.error.executionState).toBe('outcome-unknown');
    expect(result.error.code).toBe('internal-error');
    expect(harness.connector.executeCount.value).toBe(1);
    expect(
      harness.auditPort.events.filter((event) => event.kind === 'execution-started'),
    ).toHaveLength(1);
    expect(
      harness.auditPort.events.some(
        (event) =>
          (event.kind === 'execution-finished' || event.kind === 'invocation-completed') &&
          event.outcome === 'success',
      ),
    ).toBe(false);
    expect(
      harness.auditPort.events.some(
        (event) =>
          (event.kind === 'execution-finished' || event.kind === 'invocation-completed') &&
          event.outcome === 'failure',
      ),
    ).toBe(true);
    const health = harness.healthRegistry.get(CONNECTOR_ID, null);
    expect(health?.status).not.toBe('healthy');
  });

  it('does not grant special meaning to the former magic reason string', async () => {
    const harness = createTypedHarness();
    const result = await approveWrite(harness, 'magic-reason', 'inv-magic', 'k-magic');
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.error.executionState).toBe('completed');
    expect(result.error.code).toBe('connector-unavailable');
  });

  it('treats READ_ONLY typed outcome-unknown as ordinary failure', async () => {
    const harness = createTypedHarness();
    const result = await harness.invoke({
      toolId: asToolId('typed-outcome.read'),
      input: { claim: 'outcome-unknown' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.error.executionState).toBe('completed');
    expect(result.error.code).toBe('connector-unavailable');
  });

  it('fails closed on malformed executionOutcome', async () => {
    const harness = createTypedHarness();
    const result = await approveWrite(harness, 'malformed', 'inv-malformed', 'k-malformed');
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.error.executionState).toBe('completed');
    expect(result.error.code).toBe('connector-unavailable');
  });

  it('preserves ordinary reference connector unavailable mapping', async () => {
    const harness = createPlatformHarness();
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'x', mode: 'unavailable' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.error.code).toBe('connector-unavailable');
    expect(result.error.executionState).toBe('completed');
    expect(result.error.reason).toBe('Connector is unavailable.');
  });
});
