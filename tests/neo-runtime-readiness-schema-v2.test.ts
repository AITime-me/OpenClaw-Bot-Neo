import { describe, expect, it } from 'vitest';
import {
  NEO_READINESS_SCHEMA_LEGACY_VERSION,
  parseNeoReadinessDocument,
} from '../src/neo-runtime/cli/parse-neo-readiness-document.js';
import {
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
  fixedIdentity,
} from './support/neo-runtime-fixtures.js';

const validDocument = () => {
  const identity = fixedIdentity();
  return {
    schemaVersion: '2' as const,
    pid: identity.pid,
    lifecycle: 'running' as const,
    runtimeReady: true as const,
    durableHostOpened: true as const,
    startedAtUtc: identity.nowUtcIso(),
    bootId: NEO_TEST_BOOT_ID,
    startTimeTicks: NEO_TEST_START_TIME_TICKS,
  };
};

describe('neo readiness schema v2 parser', () => {
  it('accepts a valid bound document', () => {
    const parsed = parseNeoReadinessDocument(validDocument());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe('2');
    expect(parsed.value.bootId).toBe(NEO_TEST_BOOT_ID);
  });

  it('rejects schema v1 as legacy unbound', () => {
    const parsed = parseNeoReadinessDocument({
      ...validDocument(),
      schemaVersion: NEO_READINESS_SCHEMA_LEGACY_VERSION,
    });
    expect(parsed).toEqual({ ok: false, reason: 'legacy-unbound' });
  });

  it('rejects missing pid', () => {
    const input = { ...validDocument() };
    Reflect.deleteProperty(input, 'pid');
    const parsed = parseNeoReadinessDocument(input);
    expect(parsed.ok).toBe(false);
  });

  it('rejects invalid pid', () => {
    const parsed = parseNeoReadinessDocument({ ...validDocument(), pid: -1 });
    expect(parsed).toEqual({ ok: false, reason: 'invalid-pid' });
  });

  it('rejects missing boot id', () => {
    const input = { ...validDocument() };
    Reflect.deleteProperty(input, 'bootId');
    const parsed = parseNeoReadinessDocument(input);
    expect(parsed.ok).toBe(false);
  });

  it('rejects malformed boot id', () => {
    const parsed = parseNeoReadinessDocument({ ...validDocument(), bootId: 'bad' });
    expect(parsed).toEqual({ ok: false, reason: 'invalid-boot-id' });
  });

  it('rejects missing start ticks', () => {
    const input = { ...validDocument() };
    Reflect.deleteProperty(input, 'startTimeTicks');
    const parsed = parseNeoReadinessDocument(input);
    expect(parsed.ok).toBe(false);
  });

  it('rejects malformed start ticks', () => {
    const parsed = parseNeoReadinessDocument({ ...validDocument(), startTimeTicks: '-1' });
    expect(parsed).toEqual({ ok: false, reason: 'invalid-start-time-ticks' });
  });

  it('rejects unknown keys', () => {
    const parsed = parseNeoReadinessDocument({ ...validDocument(), extra: true });
    expect(parsed).toEqual({ ok: false, reason: 'unknown-field' });
  });

  it('rejects oversized identity fields', () => {
    const parsed = parseNeoReadinessDocument({
      ...validDocument(),
      bootId: 'a'.repeat(65),
    });
    expect(parsed).toEqual({ ok: false, reason: 'invalid-boot-id' });
  });
});
