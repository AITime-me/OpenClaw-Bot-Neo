import {
  CONNECTOR_JSON_MAX_ARRAY_ITEMS,
  CONNECTOR_JSON_MAX_DEPTH,
  CONNECTOR_JSON_MAX_KEY_LENGTH,
  CONNECTOR_JSON_MAX_OBJECT_KEYS,
  CONNECTOR_JSON_MAX_SERIALIZED_INPUT_BYTES,
  CONNECTOR_JSON_MAX_SERIALIZED_OUTPUT_BYTES,
  CONNECTOR_JSON_MAX_STRING_LENGTH,
} from './constants.js';
import type { JsonBoundsFailure, JsonObject, JsonValue } from './json.js';
import { err, ok, type Result } from '../result.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const measureSerialized = (value: JsonValue): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const walk = (
  value: unknown,
  depth: number,
  maxBytes: number,
  seen: WeakSet<object>,
): Result<JsonValue, JsonBoundsFailure> => {
  if (depth > CONNECTOR_JSON_MAX_DEPTH)
    return err({ code: 'TOO_DEEP', reason: 'JSON exceeds maximum nesting depth.' });
  if (value === null) return ok(null);
  if (typeof value === 'boolean') return ok(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      return err({ code: 'UNSUPPORTED_VALUE', reason: 'Unsupported JSON value.' });
    return ok(value);
  }
  if (typeof value === 'string') {
    if (value.length > CONNECTOR_JSON_MAX_STRING_LENGTH)
      return err({ code: 'STRING_TOO_LONG', reason: 'JSON string exceeds maximum length.' });
    return ok(value);
  }
  if (typeof value !== 'object')
    return err({ code: 'UNSUPPORTED_VALUE', reason: 'Unsupported JSON value.' });
  if (seen.has(value)) return err({ code: 'CYCLE', reason: 'JSON contains a cycle.' });
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > CONNECTOR_JSON_MAX_ARRAY_ITEMS)
      return err({ code: 'TOO_MANY_ITEMS', reason: 'JSON array exceeds maximum items.' });
    const items: JsonValue[] = [];
    for (const item of value) {
      const parsed = walk(item, depth + 1, maxBytes, seen);
      if (!parsed.ok) return parsed;
      items.push(parsed.value);
    }
    const array = Object.freeze(items);
    if (measureSerialized(array) > maxBytes)
      return err({ code: 'SERIALIZED_TOO_LARGE', reason: 'Serialized JSON exceeds byte limit.' });
    return ok(array);
  }
  if (!isPlainObject(value))
    return err({ code: 'NON_PLAIN', reason: 'JSON object must be a plain object.' });
  const keys = Object.keys(value);
  if (keys.length > CONNECTOR_JSON_MAX_OBJECT_KEYS)
    return err({ code: 'TOO_MANY_KEYS', reason: 'JSON object exceeds maximum keys.' });
  const copy: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of keys) {
    if (key.length > CONNECTOR_JSON_MAX_KEY_LENGTH)
      return err({ code: 'KEY_TOO_LONG', reason: 'JSON object key exceeds maximum length.' });
    const parsed = walk(value[key], depth + 1, maxBytes, seen);
    if (!parsed.ok) return parsed;
    copy[key] = parsed.value;
  }
  const object = Object.freeze(copy) as JsonObject;
  if (measureSerialized(object) > maxBytes)
    return err({ code: 'SERIALIZED_TOO_LARGE', reason: 'Serialized JSON exceeds byte limit.' });
  return ok(object);
};

export const boundJsonValue = (
  value: unknown,
  maxBytes = CONNECTOR_JSON_MAX_SERIALIZED_INPUT_BYTES,
): Result<JsonValue, JsonBoundsFailure> => walk(value, 0, maxBytes, new WeakSet());

export const boundJsonObject = (
  value: unknown,
  maxBytes = CONNECTOR_JSON_MAX_SERIALIZED_INPUT_BYTES,
): Result<JsonObject, JsonBoundsFailure> => {
  const parsed = boundJsonValue(value, maxBytes);
  if (!parsed.ok) return parsed;
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value))
    return err({ code: 'NON_PLAIN', reason: 'Expected a JSON object.' });
  return ok(parsed.value as JsonObject);
};

export const boundConnectorOutput = (value: unknown): Result<JsonObject, JsonBoundsFailure> =>
  boundJsonObject(value, CONNECTOR_JSON_MAX_SERIALIZED_OUTPUT_BYTES);

export const digestPrefix = (digest: string): string => digest.slice(0, 8);
