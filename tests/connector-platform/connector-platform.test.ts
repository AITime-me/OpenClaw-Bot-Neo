import { describe, expect, it } from 'vitest';
import {
  createPlatformHarness,
  invoke,
  asToolId,
  asInvocation,
  asIdempotency,
  asConnection,
  iso,
  NOW,
} from './harness.js';
import {
  validateConnectorManifest,
  validateToolManifest,
  computeInputDigest,
} from '../../src/core/domain/connector/index.js';
import {
  createInMemoryConnectorRegistry,
  createInMemoryToolRegistry,
  createInMemoryToolAuditPort,
} from '../../src/core/application/connector/index.js';
import {
  createReferenceConnector,
  createReferenceConnectorManifest,
  REFERENCE_TOOLS,
} from '../../src/connectors/reference/index.js';
import { readFileSync } from 'node:fs';

describe('connector platform registration and manifests', () => {
  it('registers connector and tools with validation', () => {
    const connectorRegistry = createInMemoryConnectorRegistry();
    const manifest = createReferenceConnectorManifest();
    expect(connectorRegistry.register(manifest, createReferenceConnector()).ok).toBe(true);
    expect(connectorRegistry.register(manifest, createReferenceConnector()).ok).toBe(false);
    const toolRegistry = createInMemoryToolRegistry(connectorRegistry);
    const echoTool = REFERENCE_TOOLS.find(
      (tool) => tool.toolId === asToolId('reference.echo.read'),
    );
    expect(echoTool).toBeDefined();
    if (echoTool === undefined) return;
    expect(toolRegistry.register(echoTool).ok).toBe(true);
    expect(toolRegistry.register(echoTool).ok).toBe(false);
  });

  it('rejects missing connector, mismatch and unsafe combinations', () => {
    const connectorRegistry = createInMemoryConnectorRegistry();
    const toolRegistry = createInMemoryToolRegistry(connectorRegistry);
    const echoTool = REFERENCE_TOOLS.find(
      (tool) => tool.toolId === asToolId('reference.echo.read'),
    );
    if (echoTool === undefined) throw new Error('missing echo tool');
    expect(toolRegistry.register(echoTool).ok).toBe(false);
    const manifest = createReferenceConnectorManifest();
    connectorRegistry.register(manifest, createReferenceConnector());
    const mismatch = validateToolManifest({
      ...JSON.parse(JSON.stringify(echoTool)),
      connectorId: 'other',
    });
    expect(mismatch.ok).toBe(true);
    if (mismatch.ok) expect(toolRegistry.register(mismatch.value).ok).toBe(false);
    const financial = validateToolManifest({
      schemaVersion: 'connector-tool/1',
      toolId: 'bad.financial',
      connectorId: 'reference',
      version: '1.0.0',
      title: 'Bad',
      description: 'Bad',
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
  });

  it('returns frozen manifests', () => {
    const harness = createPlatformHarness();
    const listed = harness.toolRegistry.get(asToolId('reference.echo.read'));
    expect(listed).not.toBeNull();
    expect(() => {
      Object.assign(listed as object, { title: 'mutated' });
    }).toThrow();
  });
});

describe('connector platform policy and execution', () => {
  it('allows read-only and blocks unapproved write', async () => {
    const harness = createPlatformHarness();
    const read = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'hello' },
    });
    expect(read.kind).toBe('success');
    if (read.kind === 'success') {
      expect(read.contentTrust).toBe('untrusted');
      expect(read.output).toEqual({ echoed: 'hello' });
    }
    const write = await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'test' },
      idempotencyKey: asIdempotency(),
    });
    expect(write.kind).toBe('approval-required');
  });

  it('allows approved write and finance read-only', async () => {
    const harness = createPlatformHarness();
    const pending = await invoke(harness, {
      invocationId: asInvocation('inv-write'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'approved' },
      idempotencyKey: asIdempotency('k1'),
    });
    expect(pending.kind).toBe('approval-required');
    if (pending.kind !== 'approval-required') return;
    const approved = await invoke(harness, {
      invocationId: asInvocation('inv-write'),
      toolId: asToolId('reference.note.write'),
      input: { note: 'approved' },
      idempotencyKey: asIdempotency('k1'),
      approvalId: pending.approvalRequest.approvalId,
    });
    expect(approved.kind).toBe('success');
    const finance = await invoke(harness, {
      toolId: asToolId('reference.finance.read'),
      input: { account: 'acct' },
    });
    expect(finance.kind).toBe('success');
  });
});

describe('connector platform secret boundary', () => {
  it('does not resolve secret on deny or approval-required paths', async () => {
    const harness = createPlatformHarness({
      secretReferences: new Map([['secret-1', 'handle-1' as never]]),
    });
    harness.connectionRegistry.register({
      connectionId: asConnection(),
      connectorId: createReferenceConnectorManifest().connectorId,
      accountIdentity: 'acct-1',
      status: 'active',
      allowedCapabilities: ['read'],
      secretReference: {
        secretReferenceId: 'secret-1' as never,
        connectorId: createReferenceConnectorManifest().connectorId,
      },
      createdAt: iso(new Date(NOW)),
      updatedAt: iso(new Date(NOW)),
    });
    await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'x', mode: 'unavailable' },
      connectionId: asConnection(),
    });
    expect(harness.secretProvider.resolveCalls).toBe(0);
    await invoke(harness, {
      toolId: asToolId('reference.note.write'),
      input: { note: 'n' },
      idempotencyKey: asIdempotency('k2'),
    });
    expect(harness.secretProvider.resolveCalls).toBe(0);
  });
});

describe('connector platform audit and health', () => {
  it('emits bounded audit without payload secrets', async () => {
    const auditPort = createInMemoryToolAuditPort();
    const harness = createPlatformHarness({ audit: auditPort });
    await invoke(harness, { toolId: asToolId('reference.echo.read'), input: { message: 'audit' } });
    expect(auditPort.events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(auditPort.events);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('handle-1');
    expect(auditPort.events.some((event) => event.kind === 'invocation-requested')).toBe(true);
    expect(auditPort.events.some((event) => event.kind === 'invocation-completed')).toBe(true);
  });

  it('updates health on success and failure', async () => {
    const harness = createPlatformHarness();
    await invoke(harness, { toolId: asToolId('reference.echo.read'), input: { message: 'ok' } });
    const healthy = harness.healthRegistry.get(createReferenceConnectorManifest().connectorId);
    expect(healthy?.status).toBe('healthy');
    await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'bad', mode: 'remote-error' },
    });
    const degraded = harness.healthRegistry.get(createReferenceConnectorManifest().connectorId);
    expect(degraded?.status).toBe('degraded');
    expect(JSON.stringify(degraded)).not.toContain('REDACTED');
  });
});

describe('connector platform approval digest', () => {
  it('is stable across key order', () => {
    const a = computeInputDigest({ b: '2', a: '1' });
    const b = computeInputDigest({ a: '1', b: '2' });
    expect(a).toBe(b);
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

describe('connector platform output bounds', () => {
  it('rejects invalid connector output', async () => {
    const harness = createPlatformHarness();
    const result = await invoke(harness, {
      toolId: asToolId('reference.echo.read'),
      input: { message: 'bad', mode: 'invalid-output' },
    });
    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') expect(result.error.code).toBe('invalid-remote-response');
  });
});

describe('connector manifest validation', () => {
  it('accepts connector manifest', () => {
    const result = validateConnectorManifest({
      schemaVersion: 'connector-platform/1',
      connectorId: 'sample',
      title: 'Sample',
      description: 'Sample connector',
      version: '1.0.0',
      declaredCapabilities: ['read'],
      networkRequirement: 'none',
      accountModel: 'none',
    });
    expect(result.ok).toBe(true);
  });
});
