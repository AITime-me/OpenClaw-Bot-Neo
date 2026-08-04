import { describe, expect, it } from 'vitest';
import { createPlatformHarness, invoke, asToolId, asInvocation, asIdempotency } from './harness.js';
import { computeInputDigest } from '../../src/core/domain/connector/index.js';
import { validateToolManifest } from '../../src/core/domain/connector/manifest-validation.js';
import { createInMemoryToolAuditPort } from '../../src/core/application/connector/index.js';
import { readFileSync } from 'node:fs';

describe('connector platform approval semantics', () => {
  it('consumes grant once and rejects changed input', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      invocationId: asInvocation('inv-a'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'one' },
      idempotencyKey: asIdempotency('k-a'),
    });
    expect(pending.kind).toBe('approval-required');
    if (pending.kind !== 'approval-required') return;
    const ok = await invoke(harness, {
      invocationId: asInvocation('inv-a'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'one' },
      idempotencyKey: asIdempotency('k-a'),
      approvalId: pending.approvalRequest.approvalId,
    });
    expect(ok.kind).toBe('success');
    const replay = await invoke(harness, {
      invocationId: asInvocation('inv-a'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'one' },
      idempotencyKey: asIdempotency('k-a'),
      approvalId: pending.approvalRequest.approvalId,
    });
    expect(replay.kind).toBe('failure');
    const changed = await invoke(harness, {
      invocationId: asInvocation('inv-b'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'two' },
      idempotencyKey: asIdempotency('k-b'),
      approvalId: pending.approvalRequest.approvalId,
    });
    expect(changed.kind).toBe('failure');
  });
});

describe('connector platform audit failure semantics', () => {
  it('blocks execution when pre-execution audit fails', async () => {
    const auditPort = createInMemoryToolAuditPort({ failBeforeExecution: true });
    const harness = createPlatformHarness({ audit: auditPort });
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'blocked' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') expect(result.error.executionState).toBe('not-started');
  });

  it('returns outcome-unknown when post-execution audit fails', async () => {
    const auditPort = createInMemoryToolAuditPort({ failAfterExecution: true });
    const harness = createPlatformHarness({ audit: auditPort });
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'done' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') expect(result.error.executionState).toBe('outcome-unknown');
  });
});

describe('connector platform execution normalization', () => {
  it('normalizes remote errors without leaking body', async () => {
    const harness = createPlatformHarness();
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'x', mode: 'remote-error' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.error.code).toBe('remote-error');
      expect(result.error.reason).not.toContain('secret');
    }
  });
});

describe('connector platform financial disposition', () => {
  it('rejects FINANCIAL manifest and allows read-only finance tool', async () => {
    const financial = validateToolManifest({
      schemaVersion: 'connector-tool/1',
      toolId: 'bad.pay',
      connectorId: 'reference',
      version: '1.0.0',
      title: 'Pay',
      description: 'Pay',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: false },
      capability: 'create',
      riskClass: 'critical',
      sideEffectClass: 'FINANCIAL',
      approvalRequirement: 'always',
      timeoutMs: 1000,
      idempotencySupport: 'none',
      cancellationSupport: 'cooperative',
      dataSensitivity: 'restricted',
      networkRequirement: 'none',
      accountRequirement: 'none',
    });
    expect(financial.ok).toBe(false);
    const harness = createPlatformHarness();
    const read = await invoke(harness, {
      toolId: asToolId('reference.finance.read'),
      input: { account: 'a' },
    });
    expect(read.kind).toBe('success');
  });
});

describe('connector platform canonical digest', () => {
  it('matches across key order', () => {
    expect(computeInputDigest({ a: '1', b: '2' })).toBe(computeInputDigest({ b: '2', a: '1' }));
  });
});

describe('connector platform reference isolation', () => {
  it('is absent from production composition sources', () => {
    const production = readFileSync(
      'src/neo-runtime/production/create-production-neo-runtime.ts',
      'utf8',
    );
    expect(production.includes('connectors/reference')).toBe(false);
  });
});
