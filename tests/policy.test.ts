import { describe, expect, it } from 'vitest';
import {
  checkNamespaceAccess,
  checkRecipient,
  classifyEffect,
  evaluateQuietHours,
} from '../src/core/policy/index.js';

describe('recipient and effect policies', () => {
  it('allows only a whitelisted recipient', () => {
    expect(checkRecipient('owner', new Set(['owner'])).ok).toBe(true);
    expect(checkRecipient('third-party', new Set(['owner'])).ok).toBe(false);
  });

  it('requires a scoped grant for writes and refuses payments', () => {
    expect(classifyEffect('write')).toEqual({ decision: 'approval-required', effect: 'write' });
    expect(classifyEffect('payment').decision).toBe('deny');
    expect(classifyEffect('read').decision).toBe('allow');
  });
});

describe('namespace isolation rules', () => {
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
