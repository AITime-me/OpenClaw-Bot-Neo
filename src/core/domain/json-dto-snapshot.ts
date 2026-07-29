/**
 * Trusted plain JSON DTO snapshot for untrusted inputs (scanner metadata, configs).
 *
 * Plain objects with accessors are rejected via property descriptors without invoking getters.
 * Proxy instances are rejected via Node `util.types.isProxy` without invoking traps.
 * Universal Proxy detection without engine help is impossible; callers must prefer JSON.parse
 * wire input or this snapshot boundary before scanning.
 */

import { isProxy } from 'node:util/types';

export type JsonDto =
  null | boolean | number | string | readonly JsonDto[] | { readonly [key: string]: JsonDto };

export type JsonDtoFailureCode =
  | 'UNSUPPORTED_VALUE'
  | 'ACCESSOR'
  | 'PROXY'
  | 'CYCLE'
  | 'SYMBOL_KEY'
  | 'SPARSE_ARRAY'
  | 'NON_PLAIN'
  | 'FUNCTION'
  | 'TOO_COMPLEX';

export interface JsonDtoFailure {
  readonly code: JsonDtoFailureCode;
  readonly reason: string;
}

export interface JsonDtoSnapshotLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxObjectKeys?: number;
  readonly maxArrayLength?: number;
  readonly maxStringLength?: number;
  readonly maxKeyLength?: number;
}

type WalkResult =
  | { readonly ok: true; readonly value: JsonDto }
  | { readonly ok: false; readonly error: JsonDtoFailure };

const isPlainPrototype = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isForbiddenHostObject = (value: object): boolean => {
  if (value instanceof Date) return true;
  if (value instanceof Map || value instanceof Set) return true;
  if (value instanceof WeakMap || value instanceof WeakSet) return true;
  if (value instanceof RegExp) return true;
  if (ArrayBuffer.isView(value)) return true;
  if (value instanceof ArrayBuffer) return true;
  return false;
};

const fail = (code: JsonDtoFailureCode, reason: string): WalkResult => ({
  ok: false,
  error: { code, reason },
});

/**
 * Builds an immutable plain JSON-compatible snapshot without executing getters, setters,
 * toJSON, valueOf, or user iterators. Fail-closed on unsupported shapes.
 */
export const snapshotPlainJsonDto = (
  input: unknown,
  limits: JsonDtoSnapshotLimits = {
    maxNodes: 512,
    maxDepth: 8,
  },
): WalkResult => {
  let nodes = 0;
  const seen = new WeakSet();
  const maxObjectKeys = limits.maxObjectKeys ?? 128;
  const maxArrayLength = limits.maxArrayLength ?? 128;
  const maxStringLength = limits.maxStringLength ?? 16_384;
  const maxKeyLength = limits.maxKeyLength ?? 256;

  const walk = (value: unknown, depth: number): WalkResult => {
    if (depth > limits.maxDepth) return fail('TOO_COMPLEX', 'JSON DTO exceeds depth limits.');
    if (value === null) return { ok: true, value: null };
    if (typeof value === 'boolean') return { ok: true, value };
    if (typeof value === 'number')
      return Number.isFinite(value)
        ? { ok: true, value }
        : fail('UNSUPPORTED_VALUE', 'JSON DTO numbers must be finite.');
    if (typeof value === 'string')
      return value.length <= maxStringLength
        ? { ok: true, value }
        : fail('TOO_COMPLEX', 'JSON DTO string exceeds limits.');
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'undefined')
      return fail('UNSUPPORTED_VALUE', 'JSON DTO contains an unsupported primitive.');
    if (typeof value === 'function')
      return fail('FUNCTION', 'JSON DTO must not contain functions.');
    if (typeof value !== 'object')
      return fail('UNSUPPORTED_VALUE', 'JSON DTO contains an unsupported value.');
    if (isProxy(value))
      return fail('PROXY', 'Proxy metadata must be rejected at the DTO boundary.');
    if (seen.has(value)) return fail('CYCLE', 'JSON DTO must not contain cycles.');
    seen.add(value);
    if (nodes >= limits.maxNodes) return fail('TOO_COMPLEX', 'JSON DTO exceeds node limits.');
    nodes += 1;

    if (Array.isArray(value)) {
      const length = value.length;
      if (length > maxArrayLength)
        return fail('TOO_COMPLEX', 'JSON DTO array exceeds length limits.');
      if (Object.getOwnPropertySymbols(value).length > 0)
        return fail('SYMBOL_KEY', 'Symbol keys are not admitted.');
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== length + 1 || !names.includes('length'))
        return fail('NON_PLAIN', 'Arrays must not contain custom properties.');
      const copy: JsonDto[] = [];
      for (let index = 0; index < length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index))
          return fail('SPARSE_ARRAY', 'Sparse arrays are not admitted.');
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined)
          return fail('SPARSE_ARRAY', 'Sparse arrays are not admitted.');
        if (descriptor.get !== undefined || descriptor.set !== undefined)
          return fail('ACCESSOR', 'Array accessors are not admitted.');
        if (typeof descriptor.value === 'function')
          return fail('FUNCTION', 'JSON DTO must not contain functions.');
        const nested = walk(descriptor.value, depth + 1);
        if (!nested.ok) return nested;
        copy.push(nested.value);
      }
      return { ok: true, value: Object.freeze(copy) };
    }

    if (isForbiddenHostObject(value) || !isPlainPrototype(value))
      return fail('NON_PLAIN', 'Only plain JSON objects are admitted.');
    if (Object.getOwnPropertySymbols(value).length > 0)
      return fail('SYMBOL_KEY', 'Symbol keys are not admitted.');

    const names = Object.getOwnPropertyNames(value);
    if (names.length > maxObjectKeys)
      return fail('TOO_COMPLEX', 'JSON DTO object exceeds key limits.');
    const snapshot: Record<string, JsonDto> = Object.create(null) as Record<string, JsonDto>;
    for (const key of names) {
      if (key.length === 0 || key.length > maxKeyLength)
        return fail('TOO_COMPLEX', 'JSON DTO key exceeds limits.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined)
        return fail('UNSUPPORTED_VALUE', 'Missing property descriptor.');
      if (descriptor.get !== undefined || descriptor.set !== undefined)
        return fail('ACCESSOR', 'Object accessors are not admitted.');
      if (typeof descriptor.value === 'function')
        return fail('FUNCTION', 'JSON DTO must not contain functions.');
      if (!descriptor.enumerable)
        return fail('NON_PLAIN', 'Non-enumerable JSON DTO properties are not admitted.');
      const nested = walk(descriptor.value, depth + 1);
      if (!nested.ok) return nested;
      snapshot[key] = nested.value;
    }
    return { ok: true, value: Object.freeze(snapshot) };
  };

  return walk(input, 0);
};
