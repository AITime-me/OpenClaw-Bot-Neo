import { describe, expect, it } from 'vitest';
import { err } from '../src/core/domain/index.js';
import { executeMemoryWrite } from '../src/core/application/index.js';
import {
  authenticatedAccess,
  createHarness,
  externalSource,
  operationContext,
  writeCommand,
} from './support/fixtures.js';
import {
  QUOTED_PASSWORD_LINE,
  QUOTED_PASSWORD_VALUE,
  URL_WITH_CREDENTIALS,
} from './support/synthetic-secrets.js';

describe('memory-write orchestration order', () => {
  it('scans text and metadata before reaching any sink', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
    expect(harness.calls).toEqual([
      'scanText',
      'scanMetadata',
      'policy.evaluate',
      'memory.write',
      'audit.record',
    ]);
    expect(harness.calls.indexOf('scanText')).toBeLessThan(harness.calls.indexOf('memory.write'));
    expect(harness.calls.indexOf('scanMetadata')).toBeLessThan(
      harness.calls.indexOf('audit.record'),
    );
  });

  it('passes only redacted content to the memory sink', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawContent: `Заметка. ${QUOTED_PASSWORD_LINE}` }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanDecision).toBe('redact');
    const written = harness.writes[0];
    expect(written).toBeDefined();
    expect(written?.content.value).not.toContain('staple');
    expect(written?.content.value).toContain('[REDACTED#password]');
    expect(JSON.stringify(harness.writes)).not.toContain(QUOTED_PASSWORD_VALUE);
  });

  it('keeps raw secrets out of the audit sink and stores no raw metadata key list', async () => {
    const harness = createHarness();
    await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({
        rawContent: `Заметка. ${QUOTED_PASSWORD_LINE}`,
        rawMetadata: { origin: 'owner-note', comment: 'safe' },
      }),
    );
    const serialized = JSON.stringify(harness.auditEvents);
    expect(serialized).not.toContain('staple');
    expect(serialized).toContain('password');
    expect(harness.auditEvents[0]?.metadataFieldCount).toBe(2);
    expect(serialized).not.toContain('metadataKeys');
  });
});

describe('memory-write refusals never touch a sink', () => {
  it('denies a critical secret before the policy or sinks run', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawContent: `Ссылка ${URL_WITH_CREDENTIALS}`, source: externalSource() }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCAN_DENIED');
    expect(harness.calls).toEqual(['scanText', 'scanMetadata']);
    expect(harness.writes).toHaveLength(0);
    expect(harness.auditEvents).toHaveLength(0);
  });

  it('stops on scanner failure', async () => {
    const harness = createHarness({
      scanTextResult: err({ code: 'NOT_CONFIGURED', component: 'scanner' }),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'SCANNER_UNAVAILABLE' } });
    expect(harness.calls).toEqual(['scanText']);
  });

  it('stops when metadata scanning fails', async () => {
    const harness = createHarness({
      scanMetadataResult: err({ code: 'NOT_CONFIGURED', component: 'scanner' }),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'SCANNER_UNAVAILABLE' } });
    expect(harness.calls).toEqual(['scanText', 'scanMetadata']);
  });

  it('stops when the memory policy denies the write', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'deny', reason: 'commercial secret' },
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({
      ok: false,
      error: { code: 'POLICY_DENIED', reason: 'commercial secret' },
    });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('stops when the memory policy is unavailable', async () => {
    const harness = createHarness({ policyFails: true });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'POLICY_UNAVAILABLE' } });
  });

  it('refuses an aborted or missing operation context', async () => {
    const controller = new AbortController();
    const harness = createHarness();
    const access = authenticatedAccess({
      operation: operationContext({ signal: controller.signal }),
    });
    controller.abort();
    const result = await executeMemoryWrite(harness.deps, access, writeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_OPERATION_CONTEXT');
    expect(harness.calls).toHaveLength(0);
  });

  it('refuses empty content', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawContent: '   ' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_CONTENT');
    expect(harness.calls).toHaveLength(0);
  });

  it('refuses a write outside the authenticated namespace', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ targetNamespace: 'tvoe-vremya' }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'AUTHORIZATION_DENIED', reason: 'NAMESPACE_ISOLATED' },
    });
    expect(harness.calls).not.toContain('policy.evaluate');
  });
});

describe('sink failures surface as typed results', () => {
  it('returns a typed failure when memory is unavailable', async () => {
    const harness = createHarness({ memoryFails: true });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'MEMORY_UNAVAILABLE' } });
    expect(harness.calls).not.toContain('audit.record');
  });

  it('does not report success when the audit sink fails', async () => {
    const harness = createHarness({ auditFails: true });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'AUDIT_FAILED' } });
  });

  it('marks external material as an untrusted summary', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({
        source: externalSource(),
        rawContent: 'Публичное объявление о поиске подрядчика.',
      }),
    );
    expect(result.ok).toBe(true);
    expect(harness.writes[0]?.trustLevel).toBe('untrusted-summary');
    expect(harness.writes[0]?.provenance.transformation).toBe('untrusted-source-summary');
  });

  it('records a successful write with a sealed contract only', async () => {
    const harness = createHarness();
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
    const written = harness.writes[0];
    expect(written?.content.scanDecision).toBe('allow');
    expect(written?.approvalId).toBeNull();
    expect(harness.auditEvents[0]?.outcome).toBe('allowed');
  });
});
