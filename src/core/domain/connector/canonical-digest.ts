import { createHash } from 'node:crypto';
import type { InputDigest } from './identity.js';
import type { JsonObject } from './json.js';
import { CONNECTOR_JSON_MAX_DEPTH } from './constants.js';

const canonical = (value: unknown, depth: number, seen: ReadonlySet<object>): string => {
  if (depth > CONNECTOR_JSON_MAX_DEPTH) throw new RangeError('Input is nested too deeply.');
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') {
    if (seen.has(value)) throw new RangeError('Input contains a cycle.');
    const nested = new Set(seen).add(value);
    if (Array.isArray(value))
      return `[${value.map((item) => canonical(item, depth + 1, nested)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, depth + 1, nested)}`);
    return `{${entries.join(',')}}`;
  }
  return 'null';
};

/** Canonical deterministic JSON serialization with sorted object keys before SHA-256 digesting. */
export const computeInputDigest = (input: Readonly<JsonObject>): InputDigest =>
  createHash('sha256')
    .update(canonical(input, 0, new Set<object>()), 'utf8')
    .digest('hex') as InputDigest;
