import { describe, expect, it } from 'vitest';
import { normalizeRisk, resolveRoute } from '../src/core/routing/index.js';

const strongSubscription = {
  id: 'runtime-validated-strong',
  strength: 'strong' as const,
  auth: 'subscription-oauth' as const,
  available: true,
};

describe('risk-based routing', () => {
  it('treats an unknown risk as high', () => {
    expect(normalizeRisk('unexpected')).toBe('high');
    const result = resolveRoute('unexpected', [strongSubscription]);
    expect(result.ok && result.value.risk).toBe('high');
  });

  it('restricts every dangerous tool for untrusted input', () => {
    const result = resolveRoute('untrusted-input', [strongSubscription]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toolProfile).toMatchObject({
      exec: false,
      write: false,
      secrets: false,
      externalSend: false,
    });
  });

  it('refuses unsafe downgrade for a high-risk task', () => {
    const result = resolveRoute('high', [
      {
        id: 'economy',
        strength: 'economy',
        auth: 'subscription-oauth',
        available: true,
      },
    ]);
    expect(result).toEqual({ ok: false, error: { code: 'NO_SAFE_MODEL', risk: 'high' } });
  });

  it('has no API-key authentication route', () => {
    const result = resolveRoute('high', []);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('api-key');
  });
});
