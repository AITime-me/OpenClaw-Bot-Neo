import { describe, expect, it } from 'vitest';
import { parseProcStat } from '../src/neo-runtime/process-identity/parse-proc-stat.js';

const buildStatLine = (
  pid: number,
  comm: string,
  state: string,
  startTimeTicks: string,
): string => {
  const prefix = `${String(pid)} (${comm}) ${state}`;
  const filler = Array.from({ length: 18 }, () => '0').join(' ');
  return `${prefix} ${filler} ${startTimeTicks}`;
};

describe('neo proc stat parser', () => {
  it('parses an ordinary command name', () => {
    const parsed = parseProcStat(buildStatLine(42, 'node', 'R', '12345'), 42);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe('12345');
  });

  it('parses comm with spaces', () => {
    const parsed = parseProcStat(buildStatLine(7, 'my process name', 'S', '99'), 7);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe('99');
  });

  it('parses comm with parentheses', () => {
    const parsed = parseProcStat(buildStatLine(8, 'foo (bar)', 'R', '100'), 8);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe('100');
  });

  it('parses comm with multiple closing parentheses', () => {
    const parsed = parseProcStat(buildStatLine(9, 'a) b) c', 'R', '101'), 9);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe('101');
  });

  it('parses comm with misleading suffix-like text inside comm', () => {
    const parsed = parseProcStat(buildStatLine(11, 'R 0 0 0 fake', 'S', '202'), 11);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe('202');
  });

  it('rejects pid mismatch', () => {
    const parsed = parseProcStat(buildStatLine(10, 'node', 'R', '1'), 11);
    expect(parsed).toEqual({ ok: false, reason: 'pid-mismatch' });
  });

  it('rejects truncated fields', () => {
    const parsed = parseProcStat('42 (node) R', 42);
    expect(parsed.ok).toBe(false);
  });

  it('rejects missing start time', () => {
    const parsed = parseProcStat('42 (node) R 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', 42);
    expect(parsed).toEqual({ ok: false, reason: 'missing-start-time' });
  });

  it('preserves huge decimal start-time ticks as string', () => {
    const huge = '99999999999999999999999999999999';
    const parsed = parseProcStat(buildStatLine(42, 'node', 'R', huge), 42);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.startTimeTicks).toBe(huge);
  });

  it('rejects non-decimal ticks', () => {
    const parsed = parseProcStat(buildStatLine(42, 'node', 'R', '12ab'), 42);
    expect(parsed).toEqual({ ok: false, reason: 'invalid-start-time' });
  });

  it('rejects negative ticks', () => {
    const parsed = parseProcStat(buildStatLine(42, 'node', 'R', '-1'), 42);
    expect(parsed).toEqual({ ok: false, reason: 'invalid-start-time' });
  });

  it('rejects zombie state', () => {
    const parsed = parseProcStat(buildStatLine(42, 'node', 'Z', '1'), 42);
    expect(parsed).toEqual({ ok: false, reason: 'zombie-state' });
  });

  it('rejects oversized stat input', () => {
    const parsed = parseProcStat('x'.repeat(5000), 42);
    expect(parsed).toEqual({ ok: false, reason: 'oversized-input' });
  });
});
