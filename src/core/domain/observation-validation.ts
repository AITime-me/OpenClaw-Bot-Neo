/**
 * Exact plain-data observation validation for untrusted port results.
 * Does not execute accessors, methods, or user-defined iterators.
 */

const isPlainPrototype = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
 * Rejects symbols, getters, methods, inherited properties and extra keys.
 */
export const exactPlainObservation = (
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!isPlainPrototype(value)) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;

  const ownKeys = Object.getOwnPropertyNames(value);
  if (ownKeys.length !== fields.length) return null;
  const allowed = new Set(fields);
  for (const key of ownKeys) if (!allowed.has(key)) return null;

  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined) return null;
    if (descriptor.get !== undefined || descriptor.set !== undefined) return null;
    if (typeof descriptor.value === 'function') return null;
    snapshot[field] = descriptor.value;
  }
  return snapshot;
};

export const filledString = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const exactStringArray = (
  value: unknown,
  allowed?: ReadonlySet<string> | readonly string[],
): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const copy: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 128) return null;
    if (allowed !== undefined) {
      const ok = Array.isArray(allowed)
        ? allowed.includes(item)
        : (allowed as ReadonlySet<string>).has(item);
      if (!ok) return null;
    }
    copy.push(item);
  }
  return Object.freeze(copy);
};

export const parseIsoInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
