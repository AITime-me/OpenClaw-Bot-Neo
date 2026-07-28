/**
 * Plain-data deep freeze/copy helpers for security evidence modules.
 * Not a trust registry and not a public sealer.
 */

export const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // Host objects must remain mutable for cancellation / binary payload handles.
  if (value instanceof AbortSignal || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }
  for (const nested of Object.values(value as object)) deepFreeze(nested);
  return Object.freeze(value);
};

/** Shallow-copy string record; rejects non-string values. */
export const copyStringRecord = (entries: unknown): Record<string, string> | null => {
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null;
  const protoUnknown: unknown = Object.getPrototypeOf(entries);
  if (protoUnknown !== Object.prototype && protoUnknown !== null) return null;
  const copy: Record<string, string> = Object.create(null) as Record<string, string>;
  let keys: string[];
  try {
    keys = Object.keys(entries);
  } catch {
    return null;
  }
  for (const key of keys) {
    const value = (entries as Record<string, unknown>)[key];
    if (typeof key !== 'string' || typeof value !== 'string') return null;
    copy[key] = value;
  }
  return copy;
};

export const freezeStringRecord = (entries: unknown): Readonly<Record<string, string>> | null => {
  const copy = copyStringRecord(entries);
  if (copy === null) return null;
  return Object.freeze(copy);
};
