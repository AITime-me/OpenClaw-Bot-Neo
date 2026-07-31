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
  | 'SCHEMA_MISMATCH'
  | 'INVALID_STORAGE_PLAN'
  | 'INVALID_STORAGE_POLICY'
  | 'PLATFORM_UNSUPPORTED'
  | 'STORAGE_ROOT_NOT_FOUND'
  | 'STORAGE_ROOT_NOT_DIRECTORY'
  | 'STORAGE_ROOT_SYMLINKED'
  | 'STORAGE_ROOT_UNSAFE_PARENT'
  | 'STORAGE_ROOT_PERMISSION_DENIED'
  | 'STORAGE_ROOT_OWNER_MISMATCH'
  | 'STORAGE_ROOT_MODE_UNSAFE'
  | 'STORAGE_ROOT_IS_REPOSITORY'
  | 'STORAGE_ROOT_CHANGED_DURING_OPEN'
  | 'STORAGE_ROOT_OPEN_FAILED'
  | 'STORAGE_ROOT_CLOSE_FAILED'
  | 'STORAGE_ROOT_CAPABILITY_INVALID'
  | 'STORAGE_ROOT_CAPABILITY_UNAVAILABLE'
  | 'STORAGE_ROOT_CAPABILITY_INTERNAL'
  | 'SQLITE_OPEN_FAILED'
  | 'SQLITE_PRAGMA_FAILED'
  | 'SQLITE_INTEGRITY_FAILED'
  | 'SQLITE_SCHEMA_MISMATCH'
  | 'SQLITE_CLOSE_FAILED';

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
