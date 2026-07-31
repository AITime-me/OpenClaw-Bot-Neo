import { posix as pathPosix } from 'node:path';
import type { Result } from '../../../core/domain/result.js';
import { failStorage, okStorage, type StorageFailure } from '../storage-failure.js';
import {
  acquireOpenedPosixStorageRootLease,
  type AcquiredPosixStorageRootLease,
} from './posix-storage-root-lease.internal.js';
import { POSIX_PROCESS_LOCK_FILENAME } from './posix-process-lock-constants.js';
import {
  createNodePosixProcessLockDriver,
  type PosixProcessLockDriver,
  type PosixProcessLockFileStat,
} from './posix-process-lock-driver.js';

export interface PosixProcessLockDiagnostics {
  readonly storageLock: 'flock';
  readonly exclusiveProcessLockHeld: true;
  readonly cooperativeSecondInstanceProtection: true;
  readonly storageRootLeaseCoordinated: true;
  readonly lockFilePolicyVerified: true;
  readonly releaseUsesFdClose: true;
  readonly localHostWired: false;
  readonly processLockWiredToNeo: false;
  readonly secondInstanceProtectionActiveForNeo: false;
  readonly systemdLayerConfigured: false;
  readonly privilegedAttackerResistant: false;
  readonly pathReplacementResistant: false;
  readonly distributedFilesystemSupported: false;
  readonly linuxIntegrationValidatedForPrimitive: false;
  readonly deploymentReady: false;
}

export interface PosixProcessLockPendingCleanup {
  readonly retryRelease: () => Result<void, StorageFailure>;
}

export type PosixProcessLockReleaseFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: 'STORAGE_LOCK_RELEASE_FAILED';
    readonly reason: string;
  };
  readonly pendingCleanup: PosixProcessLockPendingCleanup;
};

export type PosixProcessLockAcquireResult =
  | { readonly ok: true; readonly value: PosixProcessLockHandle }
  | { readonly ok: false; readonly error: StorageFailure }
  | PosixProcessLockReleaseFailure;

export interface PosixProcessLockHandle {
  readonly diagnostics: PosixProcessLockDiagnostics;
  readonly release: () => Result<void, StorageFailure>;
}

/**
 * Test-only hooks for platform/driver/uid injection. Not exported from host barrels / package root.
 * Production {@link acquirePosixProcessLock} never accepts hooks.
 */
export type PosixProcessLockTestHooks = {
  readonly getPlatform?: () => string;
  readonly driver?: PosixProcessLockDriver;
  readonly getEffectiveUid?: () => number;
};

const SUCCESS_DIAGNOSTICS: PosixProcessLockDiagnostics = Object.freeze({
  storageLock: 'flock',
  exclusiveProcessLockHeld: true,
  cooperativeSecondInstanceProtection: true,
  storageRootLeaseCoordinated: true,
  lockFilePolicyVerified: true,
  releaseUsesFdClose: true,
  localHostWired: false,
  processLockWiredToNeo: false,
  secondInstanceProtectionActiveForNeo: false,
  systemdLayerConfigured: false,
  privilegedAttackerResistant: false,
  pathReplacementResistant: false,
  distributedFilesystemSupported: false,
  linuxIntegrationValidatedForPrimitive: false,
  deploymentReady: false,
});

type LockState = 'acquiring' | 'held' | 'release-pending' | 'released';

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string';
};

const errnoCode = (error: unknown): string => {
  if (!isErrnoException(error)) return '';
  return typeof error.code === 'string' ? error.code : '';
};

const unavailable = (reason: string): PosixProcessLockAcquireResult =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'STORAGE_LOCK_UNAVAILABLE' as const,
      reason,
    }),
  });

const acquireFailed = (reason: string): PosixProcessLockAcquireResult =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'STORAGE_LOCK_ACQUIRE_FAILED' as const,
      reason,
    }),
  });

const heldFailure = (): PosixProcessLockAcquireResult =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'STORAGE_LOCK_HELD' as const,
      reason: 'Exclusive process lock is already held.',
    }),
  });

const createPendingCleanup = (
  retryRelease: () => Result<void, StorageFailure>,
): PosixProcessLockPendingCleanup =>
  Object.freeze({
    retryRelease: (): Result<void, StorageFailure> => retryRelease(),
  });

const asReleaseFailure = (
  pendingCleanup: PosixProcessLockPendingCleanup,
): PosixProcessLockReleaseFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'STORAGE_LOCK_RELEASE_FAILED' as const,
      reason: 'Failed to release exclusive process lock.',
    }),
    pendingCleanup,
  });

const mapFlockError = (error: unknown): PosixProcessLockAcquireResult => {
  const code = errnoCode(error);
  if (code === 'EAGAIN' || code === 'EWOULDBLOCK') return heldFailure();
  if (
    code === 'STORAGE_LOCK_NATIVE_UNAVAILABLE' ||
    code === 'STORAGE_LOCK_FLAGS_UNAVAILABLE' ||
    code === 'ERR_DLOPEN_FAILED' ||
    code === 'MODULE_NOT_FOUND'
  ) {
    return unavailable('Exclusive process lock is unavailable on this runtime.');
  }
  return acquireFailed('Exclusive process lock acquisition failed.');
};

const mapOpenOrStatError = (error: unknown): PosixProcessLockAcquireResult => {
  const code = errnoCode(error);
  if (
    code === 'STORAGE_LOCK_FLAGS_UNAVAILABLE' ||
    code === 'STORAGE_LOCK_NATIVE_UNAVAILABLE' ||
    code === 'ERR_DLOPEN_FAILED' ||
    code === 'MODULE_NOT_FOUND'
  ) {
    return unavailable('Exclusive process lock is unavailable on this runtime.');
  }
  // Symlink / no-follow rejection surfaces as ELOOP / EMLINK on Linux with O_NOFOLLOW.
  if (code === 'ELOOP' || code === 'EMLINK')
    return acquireFailed('Exclusive process lock file policy verification failed.');
  return acquireFailed('Exclusive process lock acquisition failed.');
};

/**
 * Lock-file permission policy: owner read+write required; group/other bits must be zero.
 * Hard-link count must be exactly one. Regular file only.
 */
const verifyLockFilePolicy = (
  stats: PosixProcessLockFileStat,
  effectiveUid: number,
): Result<void, StorageFailure> => {
  if (!stats.isFile)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  if (stats.uid !== effectiveUid)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  if ((stats.mode & 0o600) !== 0o600)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  if ((stats.mode & 0o077) !== 0)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  // Reject setuid/setgid/sticky on the lock placeholder (bits outside owner RWX permission mask).
  if ((stats.mode & 0o7000) !== 0)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  if (stats.nlink !== 1)
    return failStorage(
      'STORAGE_LOCK_ACQUIRE_FAILED',
      'Exclusive process lock file policy verification failed.',
    );
  return okStorage(undefined);
};

const resolveEffectiveUid = (hooks?: PosixProcessLockTestHooks): number | null => {
  if (hooks?.getEffectiveUid !== undefined) return hooks.getEffectiveUid();
  if (typeof process.getuid === 'function') return process.getuid();
  return null;
};

const resolvePlatform = (hooks?: PosixProcessLockTestHooks): string => {
  if (hooks?.getPlatform !== undefined) return hooks.getPlatform();
  return process.platform;
};

const closeFdAndReleaseLease = (
  driver: PosixProcessLockDriver,
  fd: number,
  lease: AcquiredPosixStorageRootLease,
): Result<void, StorageFailure> => {
  try {
    driver.closeFd(fd);
  } catch {
    return failStorage('STORAGE_LOCK_RELEASE_FAILED', 'Failed to release exclusive process lock.');
  }
  lease.release();
  return okStorage(undefined);
};

/**
 * Best-effort cleanup after fd open when acquisition cannot complete.
 * Close success → ordinary redacted failure. Close failure → pendingCleanup owns fd + lease.
 */
const failAfterFdOpen = (
  driver: PosixProcessLockDriver,
  fd: number,
  lease: AcquiredPosixStorageRootLease,
  primary: PosixProcessLockAcquireResult,
): PosixProcessLockAcquireResult => {
  let state: LockState = 'release-pending';
  let ownedFd: number | undefined = fd;

  const retryRelease = (): Result<void, StorageFailure> => {
    if (state === 'released') return okStorage(undefined);
    state = 'release-pending';
    if (ownedFd === undefined)
      return failStorage(
        'STORAGE_LOCK_RELEASE_FAILED',
        'Failed to release exclusive process lock.',
      );
    const closed = closeFdAndReleaseLease(driver, ownedFd, lease);
    if (closed.ok) {
      ownedFd = undefined;
      state = 'released';
    }
    return closed;
  };

  const closed = retryRelease();
  if (closed.ok) {
    if (!primary.ok && !('pendingCleanup' in primary)) return primary;
    return acquireFailed('Exclusive process lock acquisition failed.');
  }
  return asReleaseFailure(createPendingCleanup(retryRelease));
};

const acquirePosixProcessLockInternal = (
  openedRoot: unknown,
  hooks?: PosixProcessLockTestHooks,
): PosixProcessLockAcquireResult => {
  if (resolvePlatform(hooks) !== 'linux') {
    return unavailable('Exclusive process lock requires Linux.');
  }

  const acquired = acquireOpenedPosixStorageRootLease(openedRoot);
  if (!acquired.ok) return Object.freeze({ ok: false as const, error: acquired.error });
  const lease = acquired.value;

  const storageRootPath = lease.storageRootPath;
  const lockPath = pathPosix.join(storageRootPath, POSIX_PROCESS_LOCK_FILENAME);
  if (lockPath === storageRootPath || !lockPath.startsWith(`${storageRootPath}/`)) {
    lease.release();
    return acquireFailed('Exclusive process lock path escaped the storage root.');
  }

  const effectiveUid = resolveEffectiveUid(hooks);
  if (effectiveUid === null) {
    lease.release();
    return unavailable('Exclusive process lock cannot verify file ownership on this runtime.');
  }

  const driver = hooks?.driver ?? createNodePosixProcessLockDriver();

  let fd: number;
  try {
    fd = driver.openLockFile(lockPath);
  } catch (error) {
    lease.release();
    if (!isErrnoException(error) && !(error instanceof TypeError)) throw error;
    return mapOpenOrStatError(error);
  }

  let stats: PosixProcessLockFileStat;
  try {
    stats = driver.fstatLockFd(fd);
  } catch (error) {
    return failAfterFdOpen(driver, fd, lease, mapOpenOrStatError(error));
  }

  const policy = verifyLockFilePolicy(stats, effectiveUid);
  if (!policy.ok) {
    return failAfterFdOpen(
      driver,
      fd,
      lease,
      Object.freeze({ ok: false as const, error: policy.error }),
    );
  }

  try {
    driver.flockExclusiveNonblocking(fd);
  } catch (error) {
    if (!isErrnoException(error)) {
      const closed = closeFdAndReleaseLease(driver, fd, lease);
      if (!closed.ok) {
        let state: LockState = 'release-pending';
        let ownedFd: number | undefined = fd;
        const retryRelease = (): Result<void, StorageFailure> => {
          if (state === 'released') return okStorage(undefined);
          state = 'release-pending';
          if (ownedFd === undefined)
            return failStorage(
              'STORAGE_LOCK_RELEASE_FAILED',
              'Failed to release exclusive process lock.',
            );
          const result = closeFdAndReleaseLease(driver, ownedFd, lease);
          if (result.ok) {
            ownedFd = undefined;
            state = 'released';
          }
          return result;
        };
        throw new PosixProcessLockOwnershipError(createPendingCleanup(retryRelease), error);
      }
      throw error;
    }
    return failAfterFdOpen(driver, fd, lease, mapFlockError(error));
  }

  let state: LockState = 'held';
  let ownedFd: number | undefined = fd;

  const release = (): Result<void, StorageFailure> => {
    if (state === 'released') return okStorage(undefined);
    // First release (or retry): never return to held.
    state = 'release-pending';
    if (ownedFd === undefined)
      return failStorage(
        'STORAGE_LOCK_RELEASE_FAILED',
        'Failed to release exclusive process lock.',
      );
    const closed = closeFdAndReleaseLease(driver, ownedFd, lease);
    if (closed.ok) {
      ownedFd = undefined;
      state = 'released';
      return closed;
    }
    return closed;
  };

  try {
    return okStorage(
      Object.freeze({
        diagnostics: SUCCESS_DIAGNOSTICS,
        release,
      }),
    );
  } catch (error) {
    const closed = closeFdAndReleaseLease(driver, fd, lease);
    if (!closed.ok) {
      let cleanupState: LockState = 'release-pending';
      let cleanupFd: number | undefined = fd;
      const retryRelease = (): Result<void, StorageFailure> => {
        if (cleanupState === 'released') return okStorage(undefined);
        cleanupState = 'release-pending';
        if (cleanupFd === undefined)
          return failStorage(
            'STORAGE_LOCK_RELEASE_FAILED',
            'Failed to release exclusive process lock.',
          );
        const result = closeFdAndReleaseLease(driver, cleanupFd, lease);
        if (result.ok) {
          cleanupFd = undefined;
          cleanupState = 'released';
        }
        return result;
      };
      throw new PosixProcessLockOwnershipError(createPendingCleanup(retryRelease), error);
    }
    throw error;
  }
};

/**
 * Acquires an app-private Linux exclusive process lock on a fixed placeholder file inside a
 * genuine open POSIX storage-root capability.
 *
 * Does not accept raw paths, filenames, env, cwd, home, or fake capabilities.
 * Does not wire LocalHost. Holds a same-process root child lease while the lock fd is open or
 * release-pending. Kernel flock is advisory and cooperative only.
 */
export function acquirePosixProcessLock(openedRoot: unknown): PosixProcessLockAcquireResult {
  return acquirePosixProcessLockInternal(openedRoot);
}

/**
 * Test-only acquire with optional platform/driver/uid injection.
 * Not re-exported from `src/host/index.ts` or the package root.
 */
export function acquirePosixProcessLockWithTestHooks(
  openedRoot: unknown,
  hooks: PosixProcessLockTestHooks,
): PosixProcessLockAcquireResult {
  return acquirePosixProcessLockInternal(openedRoot, hooks);
}

/**
 * Programmer-error path where acquisition cleanup close also failed.
 * Not an ordinary StorageFailure Result. Pending cleanup retains lock fd and root lease.
 */
export class PosixProcessLockOwnershipError extends Error {
  readonly pendingCleanup: PosixProcessLockPendingCleanup;
  readonly originalError: unknown;

  constructor(pendingCleanup: PosixProcessLockPendingCleanup, originalError: unknown) {
    super('Process lock fd remains open after a programmer-error cleanup path.');
    this.name = 'PosixProcessLockOwnershipError';
    this.pendingCleanup = pendingCleanup;
    this.originalError = originalError;
  }
}

export const isPosixProcessLockOwnershipError = (
  value: unknown,
): value is PosixProcessLockOwnershipError => value instanceof PosixProcessLockOwnershipError;
