import { describe, expect, it } from 'vitest';
import { normalizeBootId } from '../src/neo-runtime/process-identity/validate-boot-id.js';

describe('neo boot id validation', () => {
  it('accepts a valid normalized UUID-like value', () => {
    expect(normalizeBootId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBootId('  a1b2c3d4-e5f6-7890-abcd-ef1234567890\n')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('rejects empty input', () => {
    expect(normalizeBootId('   ')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(normalizeBootId('not-a-boot-id')).toBeNull();
    expect(normalizeBootId('a1b2c3d4-e5f6-7890-abcd')).toBeNull();
  });

  it('rejects oversized input', () => {
    expect(normalizeBootId('a'.repeat(65))).toBeNull();
  });
});
