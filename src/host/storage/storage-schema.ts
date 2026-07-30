import { type Result } from '../../core/domain/result.js';
import { failStorage, okStorage } from './storage-failure.js';
import type { StorageFailure } from './storage-failure.js';

/**
 * Current app-private storage schema version. Sole production source of truth.
 * Not a claim that a disk schema exists. Immutable binding; callers cannot override it.
 */
export const CURRENT_STORAGE_SCHEMA_VERSION = 1 as const;

export type StorageSchemaCompatibility = {
  readonly status: 'compatible';
  readonly observedVersion: number;
  readonly currentVersion: typeof CURRENT_STORAGE_SCHEMA_VERSION;
  readonly migrationEnabled: false;
};

/**
 * Pure schema compatibility evaluation against {@link CURRENT_STORAGE_SCHEMA_VERSION} only.
 * Does not read disk, migrate, create backups, or accept a caller-supplied current version.
 *
 * With CURRENT=1, `MIGRATION_REQUIRED` is prepared for a future CURRENT bump: no valid positive
 * safe integer is older than 1, so that branch is unreachable until CURRENT increases.
 */
export const evaluateStorageSchemaCompatibility = (
  observedVersion: unknown,
): Result<StorageSchemaCompatibility, StorageFailure> => {
  const observed = parseSchemaVersion(observedVersion);
  if (!observed.ok) return observed;

  if (observed.value < CURRENT_STORAGE_SCHEMA_VERSION)
    return failStorage(
      'MIGRATION_REQUIRED',
      'Observed storage schema version is older than the current contract.',
    );
  if (observed.value > CURRENT_STORAGE_SCHEMA_VERSION)
    return failStorage(
      'SCHEMA_MISMATCH',
      'Observed storage schema version is newer than the current contract.',
    );

  return okStorage(
    Object.freeze({
      status: 'compatible' as const,
      observedVersion: observed.value,
      currentVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      migrationEnabled: false as const,
    }),
  );
};

const parseSchemaVersion = (value: unknown): Result<number, StorageFailure> => {
  if (value === undefined || value === null)
    return failStorage('INVALID_SCHEMA_VERSION', 'Schema version is required.', 'observedVersion');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    return failStorage(
      'INVALID_SCHEMA_VERSION',
      'Schema version must be a positive safe integer.',
      'observedVersion',
    );
  return okStorage(value);
};
