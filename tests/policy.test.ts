import { describe, expect, it } from 'vitest';
import {
  checkNamespaceAccess,
  checkRecipient,
  checkUrlSafety,
  confirmationGate,
  evaluateQuietHours,
} from '../src/core/policy/index.js';

describe('recipient and confirmation policies', () => {
  it('allows only a whitelisted recipient', () => {
    expect(checkRecipient('owner', new Set(['owner'])).ok).toBe(true);
    expect(checkRecipient('third-party', new Set(['owner'])).ok).toBe(false);
  });

  it('requires confirmation for writes and denies payments', () => {
    expect(confirmationGate('write', false).decision).toBe('approval-required');
    expect(confirmationGate('write', true).decision).toBe('allow');
    expect(confirmationGate('payment', true).decision).toBe('deny');
  });
});

describe('namespace isolation', () => {
  it('denies access without an active namespace', () => {
    expect(checkNamespaceAccess(null, 'tvoe-vremya', false).allowed).toBe(false);
  });

  it('allows access within the active namespace', () => {
    expect(checkNamespaceAccess('tvoe-vremya', 'tvoe-vremya', false).allowed).toBe(true);
  });

  it('denies cross-project access without approval', () => {
    expect(checkNamespaceAccess('tvoe-vremya', 'ai-my-time', false).allowed).toBe(false);
  });

  it('isolates security-restricted memory even with cross-project approval', () => {
    expect(checkNamespaceAccess('tvoe-vremya', 'security-restricted', true).allowed).toBe(false);
  });
});

describe('quiet hours', () => {
  it('detects a normal interval', () => {
    expect(
      evaluateQuietHours(
        new Date('2026-01-01T13:00:00Z'),
        { start: '12:00', end: '14:00', timezone: 'UTC' },
        'normal',
        false,
      ),
    ).toEqual({ ok: true, quiet: true });
  });

  it('detects an interval across midnight', () => {
    expect(
      evaluateQuietHours(
        new Date('2026-01-01T23:00:00Z'),
        { start: '22:00', end: '07:00', timezone: 'UTC' },
        'normal',
        false,
      ),
    ).toEqual({ ok: true, quiet: true });
  });

  it('allows explicit critical override', () => {
    expect(
      evaluateQuietHours(
        new Date('2026-01-01T23:00:00Z'),
        { start: '22:00', end: '07:00', timezone: 'UTC' },
        'critical',
        true,
      ),
    ).toEqual({ ok: true, quiet: false });
  });

  it('fails safely for an invalid timezone', () => {
    expect(
      evaluateQuietHours(
        new Date(),
        { start: '22:00', end: '07:00', timezone: 'Invalid/Timezone' },
        'normal',
        false,
      ).ok,
    ).toBe(false);
  });
});

describe('URL safety', () => {
  it.each([
    'https://localhost/path',
    'https://127.0.0.1/path',
    'https://10.1.2.3/path',
    'https://192.168.1.2/path',
    'https://169.254.169.254/latest/meta-data',
  ])('blocks local, private, or metadata URL %s', (url) => {
    expect(checkUrlSafety(url).safe).toBe(false);
  });

  it('blocks credentials in a URL', () => {
    const credentialUrl = ['https://', 'alice', ':', 'secret', '@', 'example.com'].join('');
    expect(checkUrlSafety(credentialUrl).safe).toBe(false);
  });

  it('allows public HTTPS hostname syntax', () => {
    expect(checkUrlSafety('https://example.com/resource').safe).toBe(true);
  });
});
