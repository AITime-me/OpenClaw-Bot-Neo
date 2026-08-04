import { describe, expect, it } from 'vitest';
import {
  createInfrastructureHarness,
  invoke,
  asToolId,
  asIdempotency,
  asInvocation,
} from './harness.js';
import { createInfrastructureToolPolicyEngine } from '../../src/core/application/infrastructure/infrastructure-policy-engine.js';
import { INFRASTRUCTURE_HARD_DENIED_TOOL_IDS } from '../../src/core/domain/infrastructure/constants.js';
import { INFRASTRUCTURE_TOOLS } from '../../src/core/application/infrastructure/infrastructure-tool-manifests.js';
import type { ToolPolicyContext } from '../../src/core/domain/connector/policy.js';
import type { JsonObject } from '../../src/core/domain/connector/json.js';
import { invocationContext } from './harness.js';
import { seedInfrastructureFixtures } from './fixtures.js';

const approveAndInvoke = async (
  harness: ReturnType<typeof createInfrastructureHarness>,
  pending: Extract<Awaited<ReturnType<typeof invoke>>, { kind: 'approval-required' }>,
  input: JsonObject,
  idempotencyKey = asIdempotency('restart-key'),
) => {
  const granted = await harness.decisionPort.grant(
    pending.approvalRequest.approvalId,
    'approver-1' as never,
  );
  expect(granted.ok).toBe(true);
  return invoke(harness, {
    invocationId: pending.invocationId,
    toolId: pending.toolId,
    input,
    idempotencyKey,
    approvalId: pending.approvalRequest.approvalId,
    approvalNonce: pending.approvalRequest.nonce,
  });
};

describe('infrastructure tools and policy', () => {
  it('allows read-only inspection and treats logs as confidential manifest', () => {
    const harness = createInfrastructureHarness();
    const read = invoke(harness, {
      toolId: asToolId('infrastructure.servers.list'),
      input: {},
    });
    return read.then((result) => {
      expect(result.kind).toBe('success');
      const logsTool = INFRASTRUCTURE_TOOLS.find(
        (tool) => tool.toolId === asToolId('infrastructure.service.logs.read'),
      );
      expect(logsTool?.dataSensitivity).toBe('confidential');
    });
  });

  it('requires approval for restart and blocks unapproved mutation', async () => {
    const harness = createInfrastructureHarness();
    seedInfrastructureFixtures(harness);
    const restartInput: JsonObject = {
      serverId: 'srv-1',
      serviceId: 'svc-1',
      environmentId: 'env-1',
    };
    const pending = await invoke(harness, {
      toolId: asToolId('infrastructure.service.restart'),
      input: restartInput,
      idempotencyKey: asIdempotency('k1'),
    });
    expect(pending.kind).toBe('approval-required');
    if (pending.kind !== 'approval-required') return;
    const approved = await approveAndInvoke(harness, pending, restartInput, asIdempotency('k1'));
    expect(approved.kind).toBe('success');
  });

  it('hard-denies destructive, financial, firewall and credential tools', () => {
    const engine = createInfrastructureToolPolicyEngine();
    for (const toolId of INFRASTRUCTURE_HARD_DENIED_TOOL_IDS) {
      const decision = engine.evaluate(
        {
          invocationId: asInvocation(),
          toolId: asToolId(toolId),
          connectorId: 'infrastructure' as never,
          connectionId: null,
          sideEffectClass: 'DESTRUCTIVE',
          capability: 'delete',
          connectionActive: true,
          capabilityAllowed: true,
          cancellationSupport: 'cooperative',
        } satisfies ToolPolicyContext,
        invocationContext(),
      );
      expect(decision.decision).toBe('deny');
    }
  });

  it('does not expose unrestricted shell tool manifests', () => {
    const toolIds = INFRASTRUCTURE_TOOLS.map((tool) => tool.toolId as string);
    expect(toolIds.some((id) => id.includes('shell'))).toBe(false);
    expect(toolIds.some((id) => id.includes('ssh'))).toBe(false);
    expect(toolIds.some((id) => id.includes('execute'))).toBe(false);
  });
});

describe('infrastructure bounded logs', () => {
  it('redacts secrets, caps output and keeps content untrusted', async () => {
    const harness = createInfrastructureHarness({ simulation: { logFixture: 'secrets' } });
    seedInfrastructureFixtures(harness);
    const result = await invoke(harness, {
      toolId: asToolId('infrastructure.service.logs.read'),
      input: {
        serverId: 'srv-1',
        serviceId: 'svc-1',
        maximumLines: 5,
        maximumBytes: 200,
      },
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.contentTrust).toBe('untrusted');
    const lines = result.output.lines as string[];
    expect(lines.join('\n')).not.toMatch(/secret123/);
    expect(result.output.redactionCount).toBeGreaterThan(0);
  });
});
