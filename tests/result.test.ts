import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/core/domain/index.js';

describe('Result helpers', () => {
  it('creates a successful result', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('creates an error result', () => {
    expect(err('denied')).toEqual({ ok: false, error: 'denied' });
  });
});
