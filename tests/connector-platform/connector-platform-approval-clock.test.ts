import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemoryToolApprovalPorts } from '../../src/core/application/connector/in-memory-tool-approval-port.js';
import { createInMemoryToolAuditPort } from '../../src/core/application/connector/in-memory-tool-audit-port.js';
import type { ISO8601 } from '../../src/core/domain/identity.js';
import type { ToolSideEffectClass } from '../../src/core/domain/connector/capabilities.js';
import {
  createPlatformHarness,
  createMutableClock,
  fixedClock,
  invoke,
  asToolId,
  asInvocation,
  asIdempotency,
  asApprover,
  asActor,
  asConnection,
  asCorrelation,
  asOwner,
  invocationContext,
  iso,
  NOW,
  createReferenceConnectorManifest,
} from './harness.js';

const APPROVAL_PORT_SOURCE = readFileSync(
  join(process.cwd(), 'src/core/application/connector/in-memory-tool-approval-port.ts'),
  'utf8',
);

const requestWriteApproval = async (harness: ReturnType<typeof createPlatformHarness>) => {
  const pending = await invoke(harness, {
    invocationId: asInvocation('inv-clock'),
    toolId: asToolId('reference.note.write'),
    input: { note: 'clock-test' },
    idempotencyKey: asIdempotency('k-clock'),
  });
  expect(pending.kind).toBe('approval-required');
  if (pending.kind !== 'approval-required') throw new Error('expected approval');
  return pending;
};

describe('approval clock consistency', () => {
  it('grants and consumes successfully before expiry on a fixed clock', async () => {
    const harness = createPlatformHarness({ clock: fixedClock('2099-06-01T00:00:00.000Z') });
    const pending = await requestWriteApproval(harness);
    const granted = await harness.decisionPort.grant(
      pending.approvalRequest.approvalId,
      asApprover(),
    );
    expect(granted.ok).toBe(true);
    const consumed = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(consumed.kind).toBe('success');
  });

  it('rejects grant exactly at expiresAt', async () => {
    const mutable = createMutableClock('2099-06-01T00:00:00.000Z');
    const harness = createPlatformHarness({ clock: mutable.clock });
    const pending = await requestWriteApproval(harness);
    mutable.advanceMs(300_000);
    const granted = await harness.decisionPort.grant(
      pending.approvalRequest.approvalId,
      asApprover(),
    );
    expect(granted.ok).toBe(false);
    if (!granted.ok) expect(granted.error.code).toBe('EXPIRED');
  });

  it('rejects consume after mutable clock advances past expiry', async () => {
    const mutable = createMutableClock('2099-06-01T00:00:00.000Z');
    const harness = createPlatformHarness({ clock: mutable.clock });
    const pending = await requestWriteApproval(harness);
    const granted = await harness.decisionPort.grant(
      pending.approvalRequest.approvalId,
      asApprover(),
    );
    expect(granted.ok).toBe(true);
    mutable.advanceMs(300_001);
    const consumed = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(consumed.kind).toBe('failure');
    if (consumed.kind === 'failure') expect(consumed.error.code).toBe('approval-expired');
  });

  it('remains valid regardless of real wall-clock passage', async () => {
    const harness = createPlatformHarness({ clock: fixedClock('2099-12-31T23:50:00.000Z') });
    const pending = await requestWriteApproval(harness);
    const granted = await harness.decisionPort.grant(
      pending.approvalRequest.approvalId,
      asApprover(),
    );
    expect(granted.ok).toBe(true);
    const consumed = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(consumed.kind).toBe('success');
  });

  it('rejects pending consumption without grant', async () => {
    const harness = createPlatformHarness();
    const pending = await requestWriteApproval(harness);
    const consumed = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(consumed.kind).toBe('failure');
  });

  it('rejects single-use replay after successful consume', async () => {
    const harness = createPlatformHarness();
    const pending = await requestWriteApproval(harness);
    await harness.decisionPort.grant(pending.approvalRequest.approvalId, asApprover());
    const first = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(first.kind).toBe('success');
    const replay = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(replay.kind).toBe('failure');
  });

  it('rejects denied and revoked approvals at consume time', async () => {
    const harness = createPlatformHarness();
    const pending = await requestWriteApproval(harness);
    await harness.decisionPort.deny(pending.approvalRequest.approvalId, asApprover());
    const denied = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'clock-test' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(denied.kind).toBe('failure');

    const pendingRevoked = await invoke(harness, {
      invocationId: asInvocation('inv-revoked'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'revoked' },
      idempotencyKey: asIdempotency('k-revoked'),
    });
    if (pendingRevoked.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.grant(pendingRevoked.approvalRequest.approvalId, asApprover());
    await harness.decisionPort.revoke(pendingRevoked.approvalRequest.approvalId, asApprover());
    const revoked = await invoke(harness, {
      invocationId: asInvocation('inv-revoked'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'revoked' },
      idempotencyKey: asIdempotency('k-revoked'),
      approvalId: pendingRevoked.approvalRequest.approvalId,
      approvalNonce: pendingRevoked.approvalRequest.nonce,
    });
    expect(revoked.kind).toBe('failure');
  });

  it('rejects binding mismatch and financial hard deny', async () => {
    const harness = createPlatformHarness();
    const pending = await requestWriteApproval(harness);
    await harness.decisionPort.grant(pending.approvalRequest.approvalId, asApprover());
    const mismatch = await invoke(harness, {
      invocationId: asInvocation('inv-clock'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'different-input' },
      idempotencyKey: asIdempotency('k-clock'),
      approvalId: pending.approvalRequest.approvalId,
      approvalNonce: pending.approvalRequest.nonce,
    });
    expect(mismatch.kind).toBe('failure');

    const clock = fixedClock();
    const { approvalPort, decisionPort } = createInMemoryToolApprovalPorts(clock);
    const financial = await approvalPort.createRequest(
      {
        invocationId: asInvocation('inv-fin'),
        toolId: asToolId('reference.note.write'),
        connectorId: createReferenceConnectorManifest().connectorId,
        connectionId: null,
        inputDigest: 'digest' as never,
        sideEffectClass: 'FINANCIAL' satisfies ToolSideEffectClass,
        expiresAt: iso(new Date(NOW)),
        requestingActorId: asActor(),
      },
      invocationContext(),
    );
    expect(financial.ok).toBe(false);
    if (!financial.ok) expect(financial.error.code).toBe('FINANCIAL_DENIED');
    if (financial.ok) {
      const grantFinancial = await decisionPort.grant(financial.value.approvalId, asApprover());
      expect(grantFinancial.ok).toBe(false);
    }
  });

  it('fails closed on malformed stored expiry and unavailable clock', async () => {
    const clock = fixedClock();
    const { approvalPort, decisionPort } = createInMemoryToolApprovalPorts(clock);
    const created = await approvalPort.createRequest(
      {
        invocationId: asInvocation('inv-malformed-expiry'),
        toolId: asToolId('reference.note.write'),
        connectorId: createReferenceConnectorManifest().connectorId,
        connectionId: null,
        inputDigest: 'digest' as never,
        sideEffectClass: 'LOW_RISK_WRITE' satisfies ToolSideEffectClass,
        expiresAt: 'not-a-timestamp' as ISO8601,
        requestingActorId: asActor(),
      },
      invocationContext(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const expired = await decisionPort.grant(created.value.approvalId, asApprover());
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe('EXPIRED');

    const badClock = { now: () => new Date(Number.NaN) };
    const unavailable = createInMemoryToolApprovalPorts(badClock);
    const valid = await unavailable.approvalPort.createRequest(
      {
        invocationId: asInvocation('inv-bad-clock'),
        toolId: asToolId('reference.note.write'),
        connectorId: createReferenceConnectorManifest().connectorId,
        connectionId: null,
        inputDigest: 'digest' as never,
        sideEffectClass: 'LOW_RISK_WRITE' satisfies ToolSideEffectClass,
        expiresAt: '2099-01-01T00:05:00.000Z' as ISO8601,
        requestingActorId: asActor(),
      },
      invocationContext(),
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const malformedClock = await unavailable.decisionPort.grant(
      valid.value.approvalId,
      asApprover(),
    );
    expect(malformedClock.ok).toBe(false);
    if (!malformedClock.ok) expect(malformedClock.error.code).toBe('MALFORMED');
  });

  it('does not resolve secrets or execute connector for expired grants', async () => {
    const mutable = createMutableClock('2099-06-01T00:00:00.000Z');
    const auditPort = createInMemoryToolAuditPort();
    const harness = createPlatformHarness({
      clock: mutable.clock,
      audit: auditPort,
      secretReferences: new Map([['secret-1', 'handle-1' as never]]),
    });
    harness.connectionRegistry.register({
      connectionId: asConnection('conn-expired'),
      connectorId: createReferenceConnectorManifest().connectorId,
      accountIdentity: 'acct-expired',
      status: 'active',
      allowedCapabilities: ['read'],
      secretReference: {
        secretReferenceId: 'secret-1' as never,
        connectorId: createReferenceConnectorManifest().connectorId,
      },
      createdAt: iso(new Date(NOW)),
      updatedAt: iso(new Date(NOW)),
    });
    const pending = await invoke(
      harness,
      {
        invocationId: asInvocation('inv-expired-secret'),
        toolId: asToolId('reference.note.write'),
        input: { note: 'expired' },
        connectionId: asConnection('conn-expired'),
        idempotencyKey: asIdempotency('k-expired-secret'),
      },
      invocationContext({
        ownerId: asOwner(),
        actorId: asActor(),
        correlationId: asCorrelation('corr-expired'),
      }),
    );
    if (pending.kind !== 'approval-required') throw new Error('expected approval');
    await harness.decisionPort.grant(pending.approvalRequest.approvalId, asApprover());
    mutable.advanceMs(300_001);
    const result = await invoke(
      harness,
      {
        invocationId: asInvocation('inv-expired-secret'),
        toolId: asToolId('reference.note.write'),
        input: { note: 'expired' },
        connectionId: asConnection('conn-expired'),
        idempotencyKey: asIdempotency('k-expired-secret'),
        approvalId: pending.approvalRequest.approvalId,
        approvalNonce: pending.approvalRequest.nonce,
      },
      invocationContext({
        ownerId: asOwner(),
        actorId: asActor(),
        correlationId: asCorrelation('corr-expired'),
      }),
    );
    expect(result.kind).toBe('failure');
    expect(harness.secretProvider.resolveCalls).toBe(0);
    expect(auditPort.events.some((event) => event.kind === 'execution-started')).toBe(false);
  });

  it('uses injected ClockPort only in the approval state machine', () => {
    expect(APPROVAL_PORT_SOURCE).toContain('ClockPort');
    expect(APPROVAL_PORT_SOURCE).not.toMatch(/Date\.now\(/);
    expect(APPROVAL_PORT_SOURCE).not.toMatch(/new Date\(/);
  });
});
