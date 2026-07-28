import { createHash } from 'node:crypto';
import type { PayloadDigest } from '../domain/index.js';

const MAX_PAYLOAD_DEPTH = 16;

const canonical = (value: unknown, depth: number, seen: ReadonlySet<object>): string => {
  if (depth > MAX_PAYLOAD_DEPTH) throw new RangeError('Approval payload is nested too deeply.');
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'object') {
    if (seen.has(value)) throw new RangeError('Approval payload contains a cycle.');
    const nested = new Set(seen).add(value);
    if (Array.isArray(value))
      return `[${value.map((item) => canonical(item, depth + 1, nested)).join(',')}]`;
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, depth + 1, nested)}`);
    return `{${entries.join(',')}}`;
  }
  return 'null';
};

/**
 * Order-independent digest of the exact payload an owner approved. Any later payload change
 * produces a different digest, which invalidates the grant. A cyclic or excessively nested payload
 * is rejected instead of exhausting the stack, and the error carries no payload content.
 */
export function computePayloadDigest(payload: Readonly<Record<string, unknown>>): PayloadDigest {
  return createHash('sha256')
    .update(canonical(payload, 0, new Set<object>()), 'utf8')
    .digest('hex') as PayloadDigest;
}
