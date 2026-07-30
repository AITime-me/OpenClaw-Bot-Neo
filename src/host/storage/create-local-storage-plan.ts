import { type Result } from '../../core/domain/result.js';
import { okStorage } from './storage-failure.js';
import type { StorageFailure } from './storage-failure.js';
import {
  parseStorageBindingRequest,
  type StorageBindingRequest,
} from './parse-storage-binding-request.js';
import { CURRENT_STORAGE_SCHEMA_VERSION } from './storage-schema.js';

export interface LocalStorageDiagnostics {
  readonly bindingKind: 'explicit-path';
  readonly platformSource: 'explicit-input';
  readonly pathValidation: 'lexical-only';
  readonly filesystemProbed: false;
  readonly directoryExistenceVerified: false;
  readonly symlinkOrJunctionChecked: false;
  readonly permissionsVerified: false;
  readonly storageBackend: 'unbound';
  readonly writesEnabled: false;
  readonly durability: 'none';
  readonly migrationEnabled: false;
  readonly encryptionEnabled: false;
  readonly credentialsLoaded: false;
  readonly networkClients: 'none';
  readonly deploymentReady: false;
}

export interface LocalStoragePlan {
  readonly binding: StorageBindingRequest;
  readonly schemaVersion: typeof CURRENT_STORAGE_SCHEMA_VERSION;
  readonly diagnostics: LocalStorageDiagnostics;
}

const DIAGNOSTICS: LocalStorageDiagnostics = Object.freeze({
  bindingKind: 'explicit-path',
  platformSource: 'explicit-input',
  pathValidation: 'lexical-only',
  filesystemProbed: false,
  directoryExistenceVerified: false,
  symlinkOrJunctionChecked: false,
  permissionsVerified: false,
  storageBackend: 'unbound',
  writesEnabled: false,
  durability: 'none',
  migrationEnabled: false,
  encryptionEnabled: false,
  credentialsLoaded: false,
  networkClients: 'none',
  deploymentReady: false,
});

/**
 * Pure immutable local storage plan. Validates an explicit binding request and attaches
 * the current schema contract plus honest unbound diagnostics. Does not open, create,
 * probe, or write any storage backend.
 */
export function createLocalStoragePlan(input: unknown): Result<LocalStoragePlan, StorageFailure> {
  const binding = parseStorageBindingRequest(input);
  if (!binding.ok) return binding;

  return okStorage(
    Object.freeze({
      binding: binding.value,
      schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      diagnostics: DIAGNOSTICS,
    }),
  );
}
