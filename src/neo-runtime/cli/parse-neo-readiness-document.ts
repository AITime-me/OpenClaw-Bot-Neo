import { NEO_READINESS_SCHEMA_VERSION } from '../readiness/neo-runtime-readiness-file.js';

export type NeoReadinessStatusDocument = {
  readonly schemaVersion: '1';
  readonly pid: number;
  readonly lifecycle: 'running';
  readonly runtimeReady: true;
  readonly durableHostOpened: true;
  readonly startedAtUtc: string;
};

export type NeoReadinessStatusOutput = {
  readonly ready: true;
  readonly schemaVersion: '1';
  readonly pid: number;
  readonly lifecycle: 'running';
  readonly runtimeReady: true;
  readonly durableHostOpened: true;
  readonly startedAtUtc: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const FIELD_KEYS = [
  'schemaVersion',
  'pid',
  'lifecycle',
  'runtimeReady',
  'durableHostOpened',
  'startedAtUtc',
] as const;

export const parseNeoReadinessDocument = (
  input: unknown,
):
  | { readonly ok: true; readonly value: NeoReadinessStatusDocument }
  | { readonly ok: false; readonly reason: string } => {
  if (!isPlainObject(input))
    return { ok: false, reason: 'Readiness document must be a plain object.' };

  const ownNames = Reflect.ownKeys(input);
  for (const key of ownNames) {
    if (typeof key !== 'string' || !FIELD_KEYS.includes(key as (typeof FIELD_KEYS)[number])) {
      return { ok: false, reason: 'Readiness document contains an unknown field.' };
    }
  }
  for (const key of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return { ok: false, reason: 'Readiness document is missing a required field.' };
    }
  }

  if (input['schemaVersion'] !== NEO_READINESS_SCHEMA_VERSION) {
    return { ok: false, reason: 'Readiness schema version is invalid.' };
  }
  const pid = input['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, reason: 'Readiness pid is invalid.' };
  }
  if (input['lifecycle'] !== 'running') {
    return { ok: false, reason: 'Readiness lifecycle is invalid.' };
  }
  if (input['runtimeReady'] !== true || input['durableHostOpened'] !== true) {
    return { ok: false, reason: 'Readiness flags are invalid.' };
  }
  const startedAtUtc = input['startedAtUtc'];
  if (typeof startedAtUtc !== 'string' || startedAtUtc.length === 0 || startedAtUtc.length > 64) {
    return { ok: false, reason: 'Readiness startedAtUtc is invalid.' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: '1',
      pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc,
    },
  };
};

export const toNeoReadinessStatusOutput = (
  document: NeoReadinessStatusDocument,
): NeoReadinessStatusOutput =>
  Object.freeze({
    ready: true,
    schemaVersion: document.schemaVersion,
    pid: document.pid,
    lifecycle: document.lifecycle,
    runtimeReady: document.runtimeReady,
    durableHostOpened: document.durableHostOpened,
    startedAtUtc: document.startedAtUtc,
  });
