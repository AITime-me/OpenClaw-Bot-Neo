import { describe, expect, it } from 'vitest';
import {
  createPlatformHarness,
  invoke,
  asToolId,
  asInvocation,
  asIdempotency,
  asApprover,
  asActor,
  asConnection,
  invocationContext,
  iso,
  NOW,
} from './harness.js';
import {
  boundJsonValue,
  validateJsonAgainstSchema,
  validateJsonSchemaDefinition,
  validateAccountIdentity,
  computeInputDigest,
} from '../../src/core/domain/connector/index.js';
import {
  createInMemoryConnectorHealthRegistry,
  createInMemoryToolAuditPort,
} from '../../src/core/application/connector/index.js';
import { createInMemoryConnectorRegistries } from '../../src/core/application/connector/in-memory-connector-registries.js';
import { createReferenceConnectorManifest } from '../../src/connectors/reference/index.js';
import type { ConnectorId, ConnectionId } from '../../src/core/domain/connector/identity.js';

describe('approval trusted decision surface', () => {
  it('rejects pending consumption without grant', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'x' },
      idempotencyKey: asIdempotency('k-pending'),
    });
    expect(pending.kind).toBe('approval-required');
    if (pending.kind !== 'approval-required') return;
    const consumed = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'x' },
      idempotencyKey: asIdempotency('k-pending'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(consumed.kind).toBe('failure');
  });

  it('grants via decision port and consumes once', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      invocationId: asInvocation('inv-grant'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'ok' },
      idempotencyKey: asIdempotency('k-grant'),
    });
    if (pending.kind !== 'approval-required') throw new Error('expected approval');
    const granted = await harness.decisionPort.grant(
      pending.approvalRequest.approvalId,
      asApprover(),
    );
    expect(granted.ok).toBe(true);
    const ok = await invoke(harness, {
      invocationId: asInvocation('inv-grant'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'ok' },
      idempotencyKey: asIdempotency('k-grant'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(ok.kind).toBe('success');
    const replay = await invoke(harness, {
      invocationId: asInvocation('inv-grant'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'ok' },
      idempotencyKey: asIdempotency('k-grant'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(replay.kind).toBe('failure');
  });

  it('rejects denied and revoked approvals', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'd' },
      idempotencyKey: asIdempotency('k-deny'),
    });
    if (pending.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.deny(pending.approvalRequest.approvalId, asApprover());
    const denied = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'd' },
      idempotencyKey: asIdempotency('k-deny'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(denied.kind).toBe('failure');
    const pending2 = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'r' },
      idempotencyKey: asIdempotency('k-revoke'),
    });
    if (pending2.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.grant(pending2.approvalRequest.approvalId, asApprover());
    await harness.decisionPort.revoke(pending2.approvalRequest.approvalId, asApprover());
    const revoked = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'r' },
      idempotencyKey: asIdempotency('k-revoke'),
      approvalId: pending2.approvalRequest.approvalId,
      approvalNonce: pending2.approvalRequest.nonce,
    });
    expect(revoked.kind).toBe('failure');
  });

  it('generates nondeterministic approval ids and nonces', async () => {
    const harness = createPlatformHarness();
    const first = await invoke(harness, {
      invocationId: asInvocation('inv-1'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'a' },
      idempotencyKey: asIdempotency('k-1'),
    });
    const second = await invoke(harness, {
      invocationId: asInvocation('inv-1'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'a' },
      idempotencyKey: asIdempotency('k-1'),
    });
    if (first.kind !== 'approval-required' || second.kind !== 'approval-required')
      throw new Error('expected approval');
    expect(first.approvalRequest.approvalId).not.toBe(second.approvalRequest.approvalId);
    expect(first.approvalRequest.nonce).not.toBe(second.approvalRequest.nonce);
  });
});

describe('numeric bounds and schema validation', () => {
  it('rejects NaN and Infinity in JSON bounds', () => {
    expect(boundJsonValue(Number.NaN).ok).toBe(false);
    expect(boundJsonValue(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(boundJsonValue(Number.NEGATIVE_INFINITY).ok).toBe(false);
  });

  it('validates number and integer schemas with min and max', () => {
    const numberSchema = validateJsonSchemaDefinition({
      type: 'number',
      minimum: 0,
      maximum: 10,
    });
    const integerSchema = validateJsonSchemaDefinition({
      type: 'integer',
      minimum: -2,
      maximum: 2,
    });
    if (!numberSchema.ok || !integerSchema.ok) throw new Error('schema invalid');
    expect(validateJsonAgainstSchema(numberSchema.value, 5).ok).toBe(true);
    expect(validateJsonAgainstSchema(numberSchema.value, 5.5).ok).toBe(true);
    expect(validateJsonAgainstSchema(numberSchema.value, 11).ok).toBe(false);
    expect(validateJsonAgainstSchema(integerSchema.value, 1).ok).toBe(true);
    expect(validateJsonAgainstSchema(integerSchema.value, 1.5).ok).toBe(false);
  });

  it('does not digest invalid numbers', () => {
    expect(() => computeInputDigest({ value: Number.NaN })).toThrow();
  });
});

describe('pre-aborted invocation', () => {
  it('fails before secret resolution and connector execution', async () => {
    const harness = createPlatformHarness({
      secretReferences: new Map([['secret-1', 'handle-1' as never]]),
    });
    harness.connectionRegistry.register({
      connectionId: asConnection('conn-abort'),
      connectorId: createReferenceConnectorManifest().connectorId,
      accountIdentity: 'acct-abort',
      status: 'active',
      allowedCapabilities: ['read'],
      secretReference: {
        secretReferenceId: 'secret-1' as never,
        connectorId: createReferenceConnectorManifest().connectorId,
      },
      createdAt: iso(new Date(NOW)),
      updatedAt: iso(new Date(NOW)),
    });
    const controller = new AbortController();
    controller.abort();
    const result = await invoke(
      harness,
      {
        toolId: asToolId('reference.echo.read'),
        input: { message: 'abort' },
        connectionId: asConnection('conn-abort'),
      },
      { signal: controller.signal },
    );
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.error.code).toBe('cancelled');
      expect(result.error.executionState).toBe('not-started');
    }
    expect(harness.secretProvider.resolveCalls).toBe(0);
  });
});

describe('late completion after abort', () => {
  it('does not return success when caller aborts during slow read', async () => {
    const harness = createPlatformHarness();
    const controller = new AbortController();
    const promise = invoke(
      harness,
      {
        toolId: asToolId('reference.echo.read'),
        input: { message: 'late', mode: 'slow-success' },
        timeoutOverrideMs: 5_000,
      },
      { signal: controller.signal },
    );
    setTimeout(() => {
      controller.abort();
    }, 20);
    const result = await promise;
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.error.code).toBe('cancelled');
      expect(result.error.executionState).toBe('completed');
    }
    const health = harness.healthRegistry.get(createReferenceConnectorManifest().connectorId);
    expect(health?.status).not.toBe('healthy');
  });

  it('returns outcome-unknown for write-like tools aborted during execution', async () => {
    const auditPort = createInMemoryToolAuditPort();
    const harness = createPlatformHarness({ audit: auditPort });
    const pending = await invoke(harness, {
      invocationId: asInvocation('inv-write-abort'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'late-write', slowMs: 500 },
      idempotencyKey: asIdempotency('k-write-abort'),
    });
    if (pending.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.grant(pending.approvalRequest.approvalId, asApprover());
    const controller = new AbortController();
    const promise = invoke(
      harness,
      {
        invocationId: asInvocation('inv-write-abort'),
        toolId: asToolId('reference.note.write'),
        input: { note: 'late-write', slowMs: 500 },
        idempotencyKey: asIdempotency('k-write-abort'),
        approvalId: pending.approvalRequest.approvalId,
        approvalNonce: pending.approvalRequest.nonce,
        timeoutOverrideMs: 5_000,
      },
      { signal: controller.signal },
    );
    while (!auditPort.events.some((event) => event.kind === 'execution-started')) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
    }
    controller.abort();
    const result = await promise;
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') expect(result.error.executionState).toBe('outcome-unknown');
  });
});

describe('health registry key safety', () => {
  it('does not collide adversarial connector and connection ids', () => {
    const registry = createInMemoryConnectorHealthRegistry();
    const connectorA = 'a:b' as ConnectorId;
    const connectorB = 'a' as ConnectorId;
    const connection = 'b:c' as ConnectionId;
    registry.update({
      connectorId: connectorA,
      connectionId: null,
      status: 'healthy',
      lastSuccessAt: null,
      lastFailureAt: null,
      failureCategory: 'none',
      retryAfterMs: null,
    });
    registry.update({
      connectorId: connectorB,
      connectionId: connection,
      status: 'degraded',
      lastSuccessAt: null,
      lastFailureAt: iso(new Date(NOW)),
      failureCategory: 'remote',
      retryAfterMs: null,
    });
    expect(registry.get(connectorA)?.status).toBe('healthy');
    expect(registry.get(connectorB, connection)?.status).toBe('degraded');
  });
});

describe('error normalization', () => {
  it('does not leak unavailable connector reason text', async () => {
    const harness = createPlatformHarness();
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'x', mode: 'unavailable' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.error.reason).not.toContain('secret');
      expect(result.error.reason).toBe('Connector is unavailable.');
    }
  });
});

describe('account identity bounds', () => {
  it('rejects empty oversized and control-character identities', () => {
    expect(validateAccountIdentity('').ok).toBe(false);
    expect(validateAccountIdentity('a\u0001b').ok).toBe(false);
    expect(validateAccountIdentity('x'.repeat(300)).ok).toBe(false);
    expect(validateAccountIdentity('valid-аккаунт').ok).toBe(true);
  });

  it('rejects invalid identity at connection registration', () => {
    const harness = createPlatformHarness();
    const result = harness.connectionRegistry.register({
      connectionId: asConnection('bad-id'),
      connectorId: createReferenceConnectorManifest().connectorId,
      accountIdentity: '',
      status: 'active',
      allowedCapabilities: ['read'],
      secretReference: null,
      createdAt: iso(new Date(NOW)),
      updatedAt: iso(new Date(NOW)),
    });
    expect(result.ok).toBe(false);
  });
});

describe('executable connector isolation', () => {
  it('cannot execute through public catalog surface', () => {
    const { catalog, execution } = createInMemoryConnectorRegistries();
    expect('getConnector' in catalog).toBe(false);
    expect(typeof execution.getConnector).toBe('function');
  });
});

describe('requesting actor binding', () => {
  it('rejects consume from a different requesting actor', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      invocationId: asInvocation('inv-actor'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'actor' },
      idempotencyKey: asIdempotency('k-actor'),
    });
    if (pending.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.grant(pending.approvalRequest.approvalId, asApprover());
    const result = await harness.orchestrator.invoke(
      {
        invocationId: asInvocation('inv-actor'),
        toolId: asToolId('reference.note.write'),
        connectionId: null,
        input: { note: 'actor' },
        approvalId: pending.approvalRequest.approvalId,
        approvalNonce: pending.approvalRequest.nonce,
        idempotencyKey: asIdempotency('k-actor'),
        timeoutOverrideMs: null,
      },
      invocationContext({ actorId: asActor('other-actor') }),
    );
    expect(result.kind).toBe('failure');
  });
});
