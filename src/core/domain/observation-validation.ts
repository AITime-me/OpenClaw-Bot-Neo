/**
 * Exact plain-data observation validation for untrusted port results.
 * Does not execute accessors, methods, or user-defined iterators.
 */

import { snapshotPlainJsonDto, type JsonDto } from './json-dto-snapshot.js';
import { parseISO8601 } from './identity.js';

const observationSnapshot = (value: unknown): JsonDto | null => {
  const snapshot = snapshotPlainJsonDto(value, {
    maxNodes: 256,
    maxDepth: 8,
    maxObjectKeys: 64,
    maxArrayLength: 128,
    maxStringLength: 2_048,
    maxKeyLength: 128,
  });
  return snapshot.ok ? snapshot.value : null;
};

/** Reads one own data property without invoking getters. */
export const readOwnData = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
  if (typeof descriptor.value === 'function') return undefined;
  return descriptor.value;
};

/**
 * Accepts only exact plain records with the listed own data fields.
 * Rejects symbols, getters, methods, inherited properties, proxies and extra keys.
 */
export const exactPlainObservation = (
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null => {
  const snapshot = observationSnapshot(value);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const ownKeys = Object.keys(snapshot);
  if (ownKeys.length !== fields.length) return null;
  const allowed = new Set(fields);
  for (const key of ownKeys) if (!allowed.has(key)) return null;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) return null;
  }
  return snapshot as Readonly<Record<string, unknown>>;
};

/**
 * Exact plain record with required fields and an optional allowlist.
 * Own keys must be a subset of required∪optional; every required key must be present.
 */
export const exactPlainRecord = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> | null => {
  const snapshot = observationSnapshot(value);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const allowed = new Set<string>([...required, ...optional]);
  const ownKeys = Object.keys(snapshot);
  for (const key of ownKeys) if (!allowed.has(key)) return null;
  for (const field of required)
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) return null;
  return snapshot as Readonly<Record<string, unknown>>;
};

export const filledString = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const exactStringArray = (
  value: unknown,
  allowed?: ReadonlySet<string> | readonly string[],
): readonly string[] | null => {
  const snapshot = observationSnapshot(value);
  if (!Array.isArray(snapshot) || snapshot.length > 128) return null;
  const copy: string[] = [];
  const seen = new Set<string>();
  for (const item of snapshot) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 128) return null;
    if (allowed !== undefined) {
      const ok = Array.isArray(allowed)
        ? allowed.includes(item)
        : (allowed as ReadonlySet<string>).has(item);
      if (!ok) return null;
    }
    if (seen.has(item)) return null;
    seen.add(item);
    copy.push(item);
  }
  return Object.freeze(copy);
};

export const parseIsoInstant = (value: unknown): number | null => {
  const parsed = parseISO8601(value);
  if (!parsed.ok) return null;
  return new Date(parsed.value).getTime();
};

export const isFreshWindow = (issuedAt: number, expiresAt: number, now: Date): boolean => {
  const current = now.getTime();
  return (
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(current) &&
    expiresAt > issuedAt &&
    current >= issuedAt &&
    current < expiresAt
  );
};
