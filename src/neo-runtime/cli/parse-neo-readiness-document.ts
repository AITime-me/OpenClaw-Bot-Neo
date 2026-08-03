import { NEO_READINESS_SCHEMA_VERSION } from '../readiness/neo-runtime-readiness-file.js';
import { normalizeBootId } from '../process-identity/validate-boot-id.js';
import { NEO_PROC_START_TIME_TICKS_MAX_LENGTH } from '../process-identity/parse-proc-stat.js';

export const NEO_READINESS_SCHEMA_LEGACY_VERSION = '1' as const;

export type NeoReadinessStatusDocument = {
  readonly schemaVersion: '2';
  readonly pid: number;
  readonly lifecycle: 'running';
  readonly runtimeReady: true;
  readonly durableHostOpened: true;
  readonly startedAtUtc: string;
  readonly bootId: string;
  readonly startTimeTicks: string;
};

export type NeoReadinessStatusOutput = {
  readonly ready: true;
  readonly schemaVersion: '2';
  readonly pid: number;
  readonly lifecycle: 'running';
  readonly runtimeReady: true;
  readonly durableHostOpened: true;
  readonly startedAtUtc: string;
  readonly bootId: string;
  readonly startTimeTicks: string;
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
  'bootId',
  'startTimeTicks',
] as const;

const MAX_STARTED_AT_UTC_LENGTH = 64 as const;
const MAX_BOOT_ID_FIELD_LENGTH = 64 as const;

const isDecimalTicks = (value: string): boolean =>
  value.length > 0 &&
  value.length <= NEO_PROC_START_TIME_TICKS_MAX_LENGTH &&
  /^[0-9]+$/.test(value);

export type NeoReadinessDocumentParseFailure =
  | 'legacy-unbound'
  | 'invalid-schema'
  | 'unknown-field'
  | 'missing-field'
  | 'invalid-pid'
  | 'invalid-lifecycle'
  | 'invalid-flags'
  | 'invalid-started-at'
  | 'invalid-boot-id'
  | 'invalid-start-time-ticks';

export const parseNeoReadinessDocument = (
  input: unknown,
):
  | { readonly ok: true; readonly value: NeoReadinessStatusDocument }
  | { readonly ok: false; readonly reason: NeoReadinessDocumentParseFailure } => {
  if (!isPlainObject(input)) return { ok: false, reason: 'invalid-schema' };

  const schemaVersion = input['schemaVersion'];
  if (schemaVersion === NEO_READINESS_SCHEMA_LEGACY_VERSION) {
    return { ok: false, reason: 'legacy-unbound' };
  }

  const ownNames = Reflect.ownKeys(input);
  for (const key of ownNames) {
    if (typeof key !== 'string' || !FIELD_KEYS.includes(key as (typeof FIELD_KEYS)[number])) {
      return { ok: false, reason: 'unknown-field' };
    }
  }
  for (const key of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return { ok: false, reason: 'missing-field' };
    }
  }

  if (input['schemaVersion'] !== NEO_READINESS_SCHEMA_VERSION) {
    return { ok: false, reason: 'invalid-schema' };
  }
  const pid = input['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, reason: 'invalid-pid' };
  }
  if (input['lifecycle'] !== 'running') {
    return { ok: false, reason: 'invalid-lifecycle' };
  }
  if (input['runtimeReady'] !== true || input['durableHostOpened'] !== true) {
    return { ok: false, reason: 'invalid-flags' };
  }
  const startedAtUtc = input['startedAtUtc'];
  if (
    typeof startedAtUtc !== 'string' ||
    startedAtUtc.length === 0 ||
    startedAtUtc.length > MAX_STARTED_AT_UTC_LENGTH
  ) {
    return { ok: false, reason: 'invalid-started-at' };
  }
  const bootIdRaw = input['bootId'];
  if (typeof bootIdRaw !== 'string' || bootIdRaw.length > MAX_BOOT_ID_FIELD_LENGTH) {
    return { ok: false, reason: 'invalid-boot-id' };
  }
  const bootId = normalizeBootId(bootIdRaw);
  if (bootId === null) {
    return { ok: false, reason: 'invalid-boot-id' };
  }
  const startTimeTicks = input['startTimeTicks'];
  if (typeof startTimeTicks !== 'string' || !isDecimalTicks(startTimeTicks)) {
    return { ok: false, reason: 'invalid-start-time-ticks' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: '2',
      pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc,
      bootId,
      startTimeTicks,
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
    bootId: document.bootId,
    startTimeTicks: document.startTimeTicks,
  });
