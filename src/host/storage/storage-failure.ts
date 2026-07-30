import { err, ok, type Result } from '../../core/domain/result.js';

export type StorageFailureCode =
  | 'INVALID_STORAGE_REQUEST'
  | 'UNKNOWN_STORAGE_FIELD'
  | 'MISSING_STORAGE_FIELD'
  | 'UNSAFE_STORAGE_INPUT'
  | 'INVALID_PLATFORM'
  | 'INVALID_STORAGE_ROOT'
  | 'UNSAFE_PATH'
  | 'INVALID_SCHEMA_VERSION'
  | 'MIGRATION_REQUIRED'
  | 'SCHEMA_MISMATCH';

export interface StorageFailure {
  readonly code: StorageFailureCode;
  readonly reason: string;
  readonly field?: string;
}

export const failStorage = (
  code: StorageFailureCode,
  reason: string,
  field?: string,
): Result<never, StorageFailure> =>
  err(field === undefined ? { code, reason } : { code, reason, field });

export const okStorage = ok;
