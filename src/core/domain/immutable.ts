/**
 * Plain-data deep freeze/copy helpers for security evidence modules.
 * Not a trust registry and not a public sealer.
 */

import { isProxy } from 'node:util/types';

export const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // Host objects must remain mutable for cancellation / binary payload handles.
  if (value instanceof AbortSignal || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }
  for (const nested of Object.values(value as object)) deepFreeze(nested);
  return Object.freeze(value);
};

const MAX_STRING_RECORD_KEYS = 256;
const MAX_STRING_RECORD_TOTAL_KEY_LENGTH = 4_096;
const MAX_STRING_RECORD_KEY_LENGTH = 4_096;
const MAX_STRING_RECORD_VALUE_LENGTH = 65_536;

/** Descriptor-only string-record copy for already-scanned metadata. */
export const copyStringRecord = (entries: unknown): Record<string, string> | null => {
  try {
    if (
      entries === null ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      isProxy(entries)
    )
      return null;
    const protoUnknown: unknown = Object.getPrototypeOf(entries);
    if (protoUnknown !== Object.prototype && protoUnknown !== null) return null;
    if (Object.getOwnPropertySymbols(entries).length > 0) return null;
    const keys = Object.getOwnPropertyNames(entries);
    if (keys.length > MAX_STRING_RECORD_KEYS) return null;
    const copy: Record<string, string> = Object.create(null) as Record<string, string>;
    let totalKeyLength = 0;
    for (const key of keys) {
      totalKeyLength += key.length;
      if (
        key.length === 0 ||
        key.length > MAX_STRING_RECORD_KEY_LENGTH ||
        totalKeyLength > MAX_STRING_RECORD_TOTAL_KEY_LENGTH
      )
        return null;
      const descriptor = Object.getOwnPropertyDescriptor(entries, key);
      if (
        descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !descriptor.enumerable ||
        typeof descriptor.value !== 'string' ||
        descriptor.value.length > MAX_STRING_RECORD_VALUE_LENGTH
      )
        return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
};

export const freezeStringRecord = (entries: unknown): Readonly<Record<string, string>> | null => {
  const copy = copyStringRecord(entries);
  if (copy === null) return null;
  return Object.freeze(copy);
};
