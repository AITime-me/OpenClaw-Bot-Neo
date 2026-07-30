import type { Result } from '../../../core/domain/result.js';

/** Trusted runtime OS family from a system adapter — never from caller binding alone. */
export type RuntimeOsFamily = 'linux' | 'other';

/**
 * Narrow filesystem identity snapshot. Mode is the POSIX permission bits (st_mode & 0o7777).
 * Callers must not treat Windows ACL semantics as POSIX mode bits.
 */
export interface PosixPathIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly isFile: boolean;
}

/** Opaque directory reservation handle. Only the owning system adapter may interpret it. */
export type PosixDirectoryHandle = {
  readonly __brand: 'PosixDirectoryHandle';
};

export type PosixFsFailureCode = 'NOT_FOUND' | 'NOT_DIRECTORY' | 'PERMISSION' | 'IO';

export interface PosixFsFailure {
  readonly code: PosixFsFailureCode;
}

export type PosixFsResult<T> = Result<T, PosixFsFailure>;

/**
 * Opaque retryable cleanup for a directory fd that remains open after a failed close.
 * Raw fd is never exposed.
 */
export interface PosixDirectoryPendingCleanup {
  readonly retryClose: () => PosixFsResult<void>;
}

/**
 * openDirectory outcome. CLOSE_FAILED always carries pendingCleanup; ordinary fs failures do not.
 */
export type PosixOpenDirectoryResult =
  | { readonly ok: true; readonly value: PosixDirectoryHandle }
  | { readonly ok: false; readonly error: PosixFsFailure }
  | {
      readonly ok: false;
      readonly error: { readonly code: 'CLOSE_FAILED' };
      readonly pendingCleanup: PosixDirectoryPendingCleanup;
    };

/**
 * Minimal injectable POSIX storage-root system surface for safe-open.
 * Not a general `node:fs` facade. Production implementation is app-private;
 * tests supply a fake. No permission-mutation or directory-create APIs.
 */
export interface PosixStorageSystem {
  readonly getRuntimeOsFamily: () => RuntimeOsFamily;
  readonly getCurrentUid: () => number;
  readonly lstat: (absolutePath: string) => PosixFsResult<PosixPathIdentity>;
  readonly realpath: (absolutePath: string) => PosixFsResult<string>;
  readonly openDirectory: (absolutePath: string) => PosixOpenDirectoryResult;
  readonly fstat: (handle: PosixDirectoryHandle) => PosixFsResult<PosixPathIdentity>;
  readonly closeDirectory: (handle: PosixDirectoryHandle) => PosixFsResult<void>;
}
