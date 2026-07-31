import { isProxy } from 'node:util/types';
import type { Result } from '../../../core/domain/result.js';
import { createLocalStoragePlan, type LocalStoragePlan } from '../create-local-storage-plan.js';
import { parseStorageBindingRequest } from '../parse-storage-binding-request.js';
import { CURRENT_STORAGE_SCHEMA_VERSION } from '../storage-schema.js';
import {
  failStorage,
  okStorage,
  type StorageFailure,
  type StorageFailureCode,
} from '../storage-failure.js';
import {
  parsePosixStorageRootPolicy,
  type PosixStorageRootPolicy,
} from './posix-storage-root-policy.js';
import type {
  PosixDirectoryHandle,
  PosixDirectoryPendingCleanup,
  PosixFsFailure,
  PosixPathIdentity,
  PosixStorageSystem,
} from './posix-storage-system.js';
import {
  createNodePosixStorageSystem,
  isNodePosixPreTransferOwnershipError,
} from './create-node-posix-storage-system.js';
import {
  abandonOpenedPosixStorageRootCapability,
  markOpenedPosixStorageRootCapabilityClosed,
  prepareOpenedPosixStorageRootClose,
  registerOpenedPosixStorageRootCapability,
} from './posix-storage-root-capability.internal.js';

export interface PosixStorageRootDiagnostics {
  readonly bindingKind: 'explicit-path';
  readonly platformSource: 'runtime-verified';
  readonly pathValidation: 'lexical-plus-filesystem';
  readonly filesystemProbed: true;
  readonly directoryExistenceVerified: true;
  readonly directoryTypeVerified: true;
  readonly symlinkComponentsChecked: true;
  readonly ownershipVerified: true;
  readonly permissionsVerified: true;
  readonly storageBackend: 'unbound';
  readonly databaseOpened: false;
  readonly writesEnabled: false;
  readonly durability: 'none';
  readonly migrationEnabled: false;
  readonly encryptionEnabled: false;
  readonly credentialsLoaded: false;
  readonly networkClients: 'none';
  readonly storageLock: 'none';
  readonly deploymentReady: false;
  readonly privilegedAttackerResistant: false;
  readonly toctouFullyEliminated: false;
  readonly mountPointGuaranteedSafe: false;
}

export interface OpenedPosixStorageRoot {
  readonly plan: LocalStoragePlan;
  readonly policy: PosixStorageRootPolicy;
  readonly diagnostics: PosixStorageRootDiagnostics;
  readonly close: () => Result<void, StorageFailure>;
}

/**
 * Opaque retryable cleanup for a directory resource that remains open after a failed close.
 *
 * Ownership model:
 * - After successful openSync (adapter) or openDirectory (opener), exactly one owner exists.
 * - Pre-transfer dual failure (fstat/type/transfer + close fail) returns CLOSE_FAILED with
 *   pendingCleanup before an opaque handle exists — composition must retryClose.
 * - Post-open validation failure uses the same close-failure shape after openDirectory succeeds.
 * - Retry is idempotent after success. Not a storage lock. Not GC/FinalizationRegistry.
 */
export interface PosixStorageRootPendingCleanup {
  readonly retryClose: () => Result<void, StorageFailure>;
}

export type StorageFailureExceptClose = StorageFailure & {
  readonly code: Exclude<StorageFailureCode, 'STORAGE_ROOT_CLOSE_FAILED'>;
};

export type OpenPosixStorageRootCloseFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: 'STORAGE_ROOT_CLOSE_FAILED';
    readonly reason: string;
  };
  readonly pendingCleanup: PosixStorageRootPendingCleanup;
};

export type OpenPosixStorageRootResult =
  | { readonly ok: true; readonly value: OpenedPosixStorageRoot }
  | { readonly ok: false; readonly error: StorageFailureExceptClose }
  | OpenPosixStorageRootCloseFailure;

/**
 * Programmer-error path where cleanup close also failed before ownership transfer.
 * Carries opaque pendingCleanup; original error is preserved for trusted diagnostics.
 * Not an ordinary OpenPosixStorageRootResult / StorageFailure.
 */
export class PosixStorageRootOwnershipError extends Error {
  readonly pendingCleanup: PosixStorageRootPendingCleanup;
  readonly originalError: unknown;

  constructor(pendingCleanup: PosixStorageRootPendingCleanup, originalError: unknown) {
    super('Storage root resource remains open after a pre-transfer programmer-error path.');
    this.name = 'PosixStorageRootOwnershipError';
    this.pendingCleanup = pendingCleanup;
    this.originalError = originalError;
  }
}

export const isPosixStorageRootOwnershipError = (
  value: unknown,
): value is PosixStorageRootOwnershipError => value instanceof PosixStorageRootOwnershipError;

const PLAN_FIELD_KEYS = Object.freeze(['binding', 'schemaVersion', 'diagnostics'] as const);

const OWNER_RWX = 0o700;

const SUCCESS_DIAGNOSTICS: PosixStorageRootDiagnostics = Object.freeze({
  bindingKind: 'explicit-path',
  platformSource: 'runtime-verified',
  pathValidation: 'lexical-plus-filesystem',
  filesystemProbed: true,
  directoryExistenceVerified: true,
  directoryTypeVerified: true,
  symlinkComponentsChecked: true,
  ownershipVerified: true,
  permissionsVerified: true,
  storageBackend: 'unbound',
  databaseOpened: false,
  writesEnabled: false,
  durability: 'none',
  migrationEnabled: false,
  encryptionEnabled: false,
  credentialsLoaded: false,
  networkClients: 'none',
  storageLock: 'none',
  deploymentReady: false,
  privilegedAttackerResistant: false,
  toctouFullyEliminated: false,
  mountPointGuaranteedSafe: false,
});

const mapFsFailure = (failure: PosixFsFailure): StorageFailureExceptClose => {
  switch (failure.code) {
    case 'NOT_FOUND':
      return { code: 'STORAGE_ROOT_NOT_FOUND', reason: 'Storage root path was not found.' };
    case 'NOT_DIRECTORY':
      return {
        code: 'STORAGE_ROOT_NOT_DIRECTORY',
        reason: 'Storage root path is not a directory.',
      };
    case 'PERMISSION':
      return {
        code: 'STORAGE_ROOT_PERMISSION_DENIED',
        reason: 'Storage root path is not accessible.',
      };
    case 'IO':
      return { code: 'STORAGE_ROOT_OPEN_FAILED', reason: 'Storage root open failed.' };
  }
};

const adaptDirectoryCleanup = (
  cleanup: PosixDirectoryPendingCleanup,
): PosixStorageRootPendingCleanup =>
  Object.freeze({
    retryClose: (): Result<void, StorageFailure> => {
      const closed = cleanup.retryClose();
      if (!closed.ok)
        return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
      return okStorage(undefined);
    },
  });

const asCloseFailure = (
  pendingCleanup: PosixStorageRootPendingCleanup,
): OpenPosixStorageRootCloseFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'STORAGE_ROOT_CLOSE_FAILED' as const,
      reason: 'Failed to close storage root handle.',
    }),
    pendingCleanup,
  });

const asFailure = (failure: StorageFailureExceptClose): OpenPosixStorageRootResult =>
  Object.freeze({
    ok: false as const,
    error: failure,
  });

const fromFailResult = (result: Result<never, StorageFailure>): OpenPosixStorageRootResult => {
  if (result.ok) throw new TypeError('Expected a storage failure result.');
  if (result.error.code === 'STORAGE_ROOT_CLOSE_FAILED')
    throw new TypeError('CLOSE_FAILED requires asCloseFailure with pendingCleanup.');
  return asFailure(result.error as StorageFailureExceptClose);
};

const isPlainObject = (value: object): boolean => {
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof RegExp) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const readOwnDataProperty = (container: object, key: string): Result<unknown, StorageFailure> => {
  if (Object.getOwnPropertySymbols(container).length > 0)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage plan must not contain symbol keys.');
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined)
    return failStorage('MISSING_STORAGE_FIELD', 'Required storage plan field is missing.', key);
  if (descriptor.get !== undefined || descriptor.set !== undefined)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage plan accessors are denied.', key);
  if (typeof descriptor.value === 'function')
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage plan methods are denied.', key);
  return okStorage(descriptor.value);
};

/**
 * Accepts a Build 3.2 LocalStoragePlan envelope without invoking getters or Proxy traps.
 * Re-parses binding and rebuilds the plan; input diagnostics are never trusted.
 */
const acceptLocalStoragePlan = (input: unknown): Result<LocalStoragePlan, StorageFailure> => {
  if (input === null || typeof input !== 'object')
    return failStorage(
      'INVALID_STORAGE_PLAN',
      'Storage open requires a validated LocalStoragePlan.',
    );
  if (isProxy(input)) return failStorage('UNSAFE_STORAGE_INPUT', 'Proxy storage plans are denied.');
  if (!isPlainObject(input))
    return failStorage(
      'INVALID_STORAGE_PLAN',
      'Storage open requires a validated LocalStoragePlan.',
    );

  if (Object.getOwnPropertySymbols(input).length > 0)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage plan must not contain symbol keys.');

  for (const key of Object.getOwnPropertyNames(input)) {
    if (!(PLAN_FIELD_KEYS as readonly string[]).includes(key))
      return failStorage('UNKNOWN_STORAGE_FIELD', 'Unknown storage plan field is denied.', key);
  }

  for (const required of PLAN_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, required))
      return failStorage(
        'MISSING_STORAGE_FIELD',
        'Required storage plan field is missing.',
        required,
      );
  }

  const schemaVersionRaw = readOwnDataProperty(input, 'schemaVersion');
  if (!schemaVersionRaw.ok) return schemaVersionRaw;
  if (schemaVersionRaw.value !== CURRENT_STORAGE_SCHEMA_VERSION)
    return failStorage(
      'INVALID_STORAGE_PLAN',
      'Storage plan schemaVersion does not match the current contract.',
      'schemaVersion',
    );

  const bindingRaw = readOwnDataProperty(input, 'binding');
  if (!bindingRaw.ok) return bindingRaw;
  if (bindingRaw.value === undefined)
    return failStorage(
      'MISSING_STORAGE_FIELD',
      'Required storage plan field is missing.',
      'binding',
    );

  // Require diagnostics as an own data property, then discard — rebuild from binding only.
  const diagnosticsRaw = readOwnDataProperty(input, 'diagnostics');
  if (!diagnosticsRaw.ok) return diagnosticsRaw;
  void diagnosticsRaw.value;

  const rebound = parseStorageBindingRequest(bindingRaw.value);
  if (!rebound.ok) return rebound;

  return createLocalStoragePlan(rebound.value);
};

const pathComponents = (absolutePath: string): string[] => {
  const parts = absolutePath.split('/').filter((part) => part.length > 0);
  const components: string[] = [];
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    components.push(current);
  }
  return components;
};

const sameIdentity = (a: PosixPathIdentity, b: PosixPathIdentity): boolean =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.isDirectory === b.isDirectory &&
  a.isSymbolicLink === b.isSymbolicLink;

const isUnderOrEqual = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}/`);

const validateMode = (mode: number, allowedModeBits: number): Result<void, StorageFailure> => {
  if ((mode & OWNER_RWX) !== OWNER_RWX)
    return failStorage(
      'STORAGE_ROOT_MODE_UNSAFE',
      'Storage root owner read/write/execute bits are incomplete.',
    );
  if ((mode & ~allowedModeBits) !== 0)
    return failStorage(
      'STORAGE_ROOT_MODE_UNSAFE',
      'Storage root mode includes forbidden permission bits.',
    );
  return okStorage(undefined);
};

const closeHandle = (
  system: PosixStorageSystem,
  handle: PosixDirectoryHandle,
): Result<void, StorageFailure> => {
  const closed = system.closeDirectory(handle);
  if (!closed.ok)
    return failStorage('STORAGE_ROOT_CLOSE_FAILED', 'Failed to close storage root handle.');
  return okStorage(undefined);
};

const createPendingCleanup = (
  system: PosixStorageSystem,
  handle: PosixDirectoryHandle,
): PosixStorageRootPendingCleanup => {
  let state: 'pending' | 'closed' = 'pending';
  return Object.freeze({
    retryClose: (): Result<void, StorageFailure> => {
      if (state === 'closed') return okStorage(undefined);
      const result = closeHandle(system, handle);
      if (result.ok) state = 'closed';
      return result;
    },
  });
};

/**
 * Downstream failure after a successful openDirectory:
 * close exactly once; preserve original failure only when cleanup succeeds;
 * otherwise return STORAGE_ROOT_CLOSE_FAILED with required pendingCleanup.
 */
const failAfterOpen = (
  system: PosixStorageSystem,
  handle: PosixDirectoryHandle,
  primary: StorageFailureExceptClose,
): OpenPosixStorageRootResult => {
  const closed = closeHandle(system, handle);
  if (closed.ok) return asFailure(primary);
  return asCloseFailure(createPendingCleanup(system, handle));
};

/**
 * Production POSIX storage-root open.
 * Uses the Node system adapter; callers cannot substitute the runtime platform or filesystem.
 */
export function openPosixStorageRoot(
  plan: LocalStoragePlan,
  policy: PosixStorageRootPolicy,
): OpenPosixStorageRootResult {
  return openPosixStorageRootWithSystem(plan, policy, createNodePosixStorageSystem());
}

/**
 * Filesystem-verified POSIX storage-root open with an injected system adapter.
 * For unit tests only — not re-exported from the host package surface.
 */
export function openPosixStorageRootWithSystem(
  planInput: unknown,
  policyInput: unknown,
  system: PosixStorageSystem,
): OpenPosixStorageRootResult {
  const acceptedPlan = acceptLocalStoragePlan(planInput);
  if (!acceptedPlan.ok) return fromFailResult(acceptedPlan);
  const plan = acceptedPlan.value;

  if (plan.binding.platform !== 'posix')
    return asFailure({
      code: 'PLATFORM_UNSUPPORTED',
      reason: 'POSIX storage-root open requires a posix storage binding.',
      field: 'platform',
    });

  const parsedPolicy = parsePosixStorageRootPolicy(policyInput);
  if (!parsedPolicy.ok) return fromFailResult(parsedPolicy);
  const policy = parsedPolicy.value;

  if (system.getRuntimeOsFamily() !== 'linux')
    return asFailure({
      code: 'PLATFORM_UNSUPPORTED',
      reason: 'POSIX storage-root open requires a Linux runtime.',
    });

  const storageRoot = plan.binding.storageRoot;
  const repositoryRoot = policy.repositoryRoot;

  for (const component of pathComponents(storageRoot)) {
    const st = system.lstat(component);
    if (!st.ok) return asFailure(mapFsFailure(st.error));
    if (st.value.isSymbolicLink) {
      return asFailure({
        code: component === storageRoot ? 'STORAGE_ROOT_SYMLINKED' : 'STORAGE_ROOT_UNSAFE_PARENT',
        reason:
          component === storageRoot
            ? 'Storage root must not be a symbolic link.'
            : 'A storage root path component must not be a symbolic link.',
      });
    }
    if (component !== storageRoot && !st.value.isDirectory)
      return asFailure({
        code: 'STORAGE_ROOT_UNSAFE_PARENT',
        reason: 'A storage root parent component is not a directory.',
      });
  }

  const rootLstat = system.lstat(storageRoot);
  if (!rootLstat.ok) return asFailure(mapFsFailure(rootLstat.error));
  if (rootLstat.value.isSymbolicLink)
    return asFailure({
      code: 'STORAGE_ROOT_SYMLINKED',
      reason: 'Storage root must not be a symbolic link.',
    });
  if (!rootLstat.value.isDirectory)
    return asFailure({
      code: 'STORAGE_ROOT_NOT_DIRECTORY',
      reason: 'Storage root path is not a directory.',
    });

  if (rootLstat.value.uid !== policy.expectedUid)
    return asFailure({
      code: 'STORAGE_ROOT_OWNER_MISMATCH',
      reason: 'Storage root owner does not match the expected UID.',
    });

  const currentUid = system.getCurrentUid();
  if (currentUid !== 0 && rootLstat.value.uid === 0 && policy.expectedUid !== 0)
    return asFailure({
      code: 'STORAGE_ROOT_OWNER_MISMATCH',
      reason: 'Storage root owner does not match the expected UID.',
    });

  const modeCheck = validateMode(rootLstat.value.mode, policy.allowedModeBits);
  if (!modeCheck.ok) return fromFailResult(modeCheck);

  const storageReal = system.realpath(storageRoot);
  if (!storageReal.ok) return asFailure(mapFsFailure(storageReal.error));
  if (storageReal.value !== storageRoot)
    return asFailure({
      code: 'STORAGE_ROOT_UNSAFE_PARENT',
      reason: 'Storage root canonical path diverges from the lexical binding.',
    });

  const repoLstat = system.lstat(repositoryRoot);
  if (!repoLstat.ok)
    return asFailure({
      code: 'INVALID_STORAGE_POLICY',
      reason: 'repositoryRoot is not available for containment comparison.',
      field: 'repositoryRoot',
    });
  if (repoLstat.value.isSymbolicLink)
    return asFailure({
      code: 'INVALID_STORAGE_POLICY',
      reason: 'repositoryRoot must not be a symbolic link.',
      field: 'repositoryRoot',
    });

  const repoReal = system.realpath(repositoryRoot);
  if (!repoReal.ok)
    return asFailure({
      code: 'INVALID_STORAGE_POLICY',
      reason: 'repositoryRoot is not available for containment comparison.',
      field: 'repositoryRoot',
    });

  if (isUnderOrEqual(storageReal.value, repoReal.value))
    return asFailure({
      code: 'STORAGE_ROOT_IS_REPOSITORY',
      reason: 'Storage root must not equal or lie inside the repository root.',
    });

  let opened;
  try {
    opened = system.openDirectory(storageRoot);
  } catch (error) {
    if (isNodePosixPreTransferOwnershipError(error)) {
      throw new PosixStorageRootOwnershipError(
        adaptDirectoryCleanup(error.pendingCleanup),
        error.originalError,
      );
    }
    throw error;
  }
  if (!opened.ok) {
    if ('pendingCleanup' in opened) {
      return asCloseFailure(adaptDirectoryCleanup(opened.pendingCleanup));
    }
    return asFailure(mapFsFailure(opened.error));
  }

  const after = system.fstat(opened.value);
  if (!after.ok) return failAfterOpen(system, opened.value, mapFsFailure(after.error));

  if (
    !sameIdentity(rootLstat.value, after.value) ||
    after.value.isSymbolicLink ||
    !after.value.isDirectory
  ) {
    return failAfterOpen(system, opened.value, {
      code: 'STORAGE_ROOT_CHANGED_DURING_OPEN',
      reason: 'Storage root identity changed during open.',
    });
  }

  const modeRecheck = validateMode(after.value.mode, policy.allowedModeBits);
  if (!modeRecheck.ok) {
    if (modeRecheck.error.code === 'STORAGE_ROOT_CLOSE_FAILED')
      throw new TypeError('validateMode must not return CLOSE_FAILED.');
    return failAfterOpen(system, opened.value, modeRecheck.error as StorageFailureExceptClose);
  }
  if (after.value.uid !== policy.expectedUid) {
    return failAfterOpen(system, opened.value, {
      code: 'STORAGE_ROOT_OWNER_MISMATCH',
      reason: 'Storage root owner does not match the expected UID.',
    });
  }

  let closed = false;
  let capabilityKey: object | undefined;

  const close = (): Result<void, StorageFailure> => {
    // Atomic lease-aware gate: busy leaves capability fully open; zero leases → retired.
    // New storage consumers are fail-closed after retire even if the underlying close later fails.
    if (capabilityKey !== undefined) {
      const prepared = prepareOpenedPosixStorageRootClose(capabilityKey);
      if (!prepared.ok) return prepared;
    }
    if (closed) return okStorage(undefined);
    const result = closeHandle(system, opened.value);
    if (result.ok) {
      closed = true;
      if (capabilityKey !== undefined) markOpenedPosixStorageRootCapabilityClosed(capabilityKey);
    }
    return result;
  };

  let successObject: OpenedPosixStorageRoot | undefined;
  try {
    successObject = Object.freeze({
      plan,
      policy,
      diagnostics: SUCCESS_DIAGNOSTICS,
      close,
    });
    capabilityKey = successObject;
    registerOpenedPosixStorageRootCapability(successObject, storageRoot);
  } catch (error) {
    // Never return a registered capability without a returned success object.
    // Close the directory handle; preserve ownership if close also fails.
    if (successObject !== undefined) abandonOpenedPosixStorageRootCapability(successObject);
    capabilityKey = undefined;
    const cleaned = closeHandle(system, opened.value);
    if (!cleaned.ok) {
      throw new PosixStorageRootOwnershipError(createPendingCleanup(system, opened.value), error);
    }
    throw error;
  }

  return okStorage(successObject);
}
