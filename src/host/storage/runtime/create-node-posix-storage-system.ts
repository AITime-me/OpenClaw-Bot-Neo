import fs from 'node:fs';
import os from 'node:os';
import { posix as pathPosix } from 'node:path';
import { err, ok } from '../../../core/domain/result.js';
import type {
  PosixDirectoryHandle,
  PosixDirectoryPendingCleanup,
  PosixFsFailure,
  PosixFsResult,
  PosixOpenDirectoryResult,
  PosixPathIdentity,
  PosixStorageSystem,
  RuntimeOsFamily,
} from './posix-storage-system.js';

/**
 * Exact sync primitives used by the production Node POSIX storage adapter.
 * App-private injection point for focused adapter-mechanic tests only — not a general
 * filesystem facade and not reachable from the host package export surface.
 */
export interface NodePosixStorageFsPrimitives {
  readonly openSync: (path: string, flags: number) => number;
  readonly fstatSync: (fd: number) => fs.Stats;
  readonly closeSync: (fd: number) => void;
  readonly lstatSync: (path: string) => fs.Stats;
  readonly realpathSyncNative: (path: string) => string;
  readonly constants: {
    readonly O_RDONLY: number;
    readonly O_DIRECTORY?: number;
  };
}

export interface NodePosixStorageSystemOptions {
  readonly getRuntimeOsFamily?: () => RuntimeOsFamily;
  readonly getCurrentUid?: () => number;
  /** Test-only hook invoked after directory validation, before opaque handle transfer. */
  readonly beforeTransfer?: () => void;
}

/**
 * Pre-transfer dual-failure: primary programmer error plus failed cleanup close.
 * Carries opaque pendingCleanup so ownership is never lost. Not an ordinary StorageFailure.
 */
export class NodePosixPreTransferOwnershipError extends Error {
  readonly pendingCleanup: PosixDirectoryPendingCleanup;
  readonly originalError: unknown;

  constructor(pendingCleanup: PosixDirectoryPendingCleanup, originalError: unknown) {
    super('POSIX storage fd remains open after a pre-transfer programmer-error path.');
    this.name = 'NodePosixPreTransferOwnershipError';
    this.pendingCleanup = pendingCleanup;
    this.originalError = originalError;
  }
}

export const isNodePosixPreTransferOwnershipError = (
  value: unknown,
): value is NodePosixPreTransferOwnershipError =>
  value instanceof NodePosixPreTransferOwnershipError;

type FdControllerState = 'open' | 'closed';

/**
 * Exclusive owner of a raw fd from successful openSync until closed or transferred.
 * Raw fd never appears on returned handles or pendingCleanup objects.
 */
const createFdController = (
  initialFd: number,
  closeSync: (fd: number) => void,
): {
  readonly pendingCleanup: PosixDirectoryPendingCleanup;
  readonly getFd: () => number | null;
  readonly retryClose: () => PosixFsResult<void>;
} => {
  let state: FdControllerState = 'open';
  let fd: number | undefined = initialFd;

  const retryClose = (): PosixFsResult<void> => {
    if (state === 'closed') return ok(undefined);
    if (fd === undefined) return err({ code: 'IO' });
    try {
      closeSync(fd);
      fd = undefined;
      state = 'closed';
      return ok(undefined);
    } catch (error) {
      if (!isErrnoException(error)) throw error;
      return err(mapErrno(error));
    }
  };

  const pendingCleanup: PosixDirectoryPendingCleanup = Object.freeze({
    retryClose,
  });

  return Object.freeze({
    pendingCleanup,
    getFd: (): number | null => (state === 'open' && fd !== undefined ? fd : null),
    retryClose,
  });
};

type LiveController = ReturnType<typeof createFdController>;

const identityFromStats = (stats: fs.Stats): PosixPathIdentity =>
  Object.freeze({
    dev: String(stats.dev),
    ino: String(stats.ino),
    mode: stats.mode & 0o7777,
    uid: stats.uid,
    gid: stats.gid,
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    isFile: stats.isFile(),
  });

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string';
};

const mapErrno = (error: NodeJS.ErrnoException): PosixFsFailure => {
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === 'ENOENT') return { code: 'NOT_FOUND' };
  if (code === 'ENOTDIR') return { code: 'NOT_DIRECTORY' };
  if (code === 'EACCES' || code === 'EPERM') return { code: 'PERMISSION' };
  return { code: 'IO' };
};

const closeFailed = (pendingCleanup: PosixDirectoryPendingCleanup): PosixOpenDirectoryResult =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({ code: 'CLOSE_FAILED' as const }),
    pendingCleanup,
  });

const fsFailed = (failure: PosixFsFailure): PosixOpenDirectoryResult =>
  Object.freeze({
    ok: false as const,
    error: failure,
  });

const defaultPrimitives = (): NodePosixStorageFsPrimitives =>
  Object.freeze({
    openSync: (path: string, flags: number): number => fs.openSync(path, flags),
    fstatSync: (fd: number): fs.Stats => fs.fstatSync(fd),
    closeSync: (fd: number): void => {
      fs.closeSync(fd);
    },
    lstatSync: (path: string): fs.Stats => fs.lstatSync(path),
    realpathSyncNative: (path: string): string => fs.realpathSync.native(path),
    constants: Object.freeze({
      O_RDONLY: fs.constants.O_RDONLY,
      ...(typeof fs.constants.O_DIRECTORY === 'number'
        ? { O_DIRECTORY: fs.constants.O_DIRECTORY }
        : {}),
    }),
  });

/**
 * Production Node adapter for POSIX storage-root safe-open.
 * App-private. Uses only sync, read-oriented fs operations — no permission mutation,
 * directory creation, or file writes.
 * Runtime OS family is taken from process.platform, never from caller binding.
 */
export function createNodePosixStorageSystem(): PosixStorageSystem {
  return createNodePosixStorageSystemWithPrimitives(defaultPrimitives());
}

/**
 * Builds the Node POSIX storage system over exact injected sync primitives.
 * Intended for adapter-mechanic regression tests. Not re-exported from `src/host/index.ts`
 * or the package root. Callers cannot pass this through `openPosixStorageRoot`.
 */
export function createNodePosixStorageSystemWithPrimitives(
  primitives: NodePosixStorageFsPrimitives,
  options: NodePosixStorageSystemOptions = {},
): PosixStorageSystem {
  const live = new WeakMap<object, LiveController>();

  const toHandle = (controller: LiveController): PosixDirectoryHandle => {
    const handle: PosixDirectoryHandle = Object.freeze({
      __brand: 'PosixDirectoryHandle',
    });
    live.set(handle, controller);
    return handle;
  };

  const controllerOf = (handle: PosixDirectoryHandle): LiveController | null => {
    const controller = live.get(handle);
    return controller === undefined ? null : controller;
  };

  const getRuntimeOsFamily = (): RuntimeOsFamily => {
    if (options.getRuntimeOsFamily !== undefined) return options.getRuntimeOsFamily();
    return process.platform === 'linux' ? 'linux' : 'other';
  };

  const getCurrentUid = (): number => {
    if (options.getCurrentUid !== undefined) return options.getCurrentUid();
    if (typeof process.getuid === 'function') return process.getuid();
    return os.userInfo().uid;
  };

  const lstat = (absolutePath: string): PosixFsResult<PosixPathIdentity> => {
    if (typeof absolutePath !== 'string' || !pathPosix.isAbsolute(absolutePath))
      return err({ code: 'IO' });
    try {
      return ok(identityFromStats(primitives.lstatSync(absolutePath)));
    } catch (error) {
      if (!isErrnoException(error)) throw error;
      return err(mapErrno(error));
    }
  };

  const realpath = (absolutePath: string): PosixFsResult<string> => {
    if (typeof absolutePath !== 'string' || !pathPosix.isAbsolute(absolutePath))
      return err({ code: 'IO' });
    try {
      const resolved = primitives.realpathSyncNative(absolutePath);
      return ok(resolved.split('\\').join('/'));
    } catch (error) {
      if (!isErrnoException(error)) throw error;
      return err(mapErrno(error));
    }
  };

  /**
   * Ownership state machine after successful openSync:
   * pre-transfer-owned (controller) → transferred-to-opaque-handle | cleanup-pending | closed.
   * Never returns an ordinary fs failure while an fd remains open without pendingCleanup.
   */
  const openDirectory = (absolutePath: string): PosixOpenDirectoryResult => {
    if (typeof absolutePath !== 'string' || !pathPosix.isAbsolute(absolutePath))
      return fsFailed({ code: 'IO' });

    let controller: LiveController | undefined;
    try {
      const flags =
        primitives.constants.O_RDONLY |
        (typeof primitives.constants.O_DIRECTORY === 'number'
          ? primitives.constants.O_DIRECTORY
          : 0);
      const fd = primitives.openSync(absolutePath, flags);
      controller = createFdController(fd, primitives.closeSync);

      let stats: fs.Stats;
      try {
        const ownedFd = controller.getFd();
        if (ownedFd === null) return fsFailed({ code: 'IO' });
        stats = primitives.fstatSync(ownedFd);
      } catch (error) {
        const closed = controller.retryClose();
        if (!closed.ok) {
          if (!isErrnoException(error))
            throw new NodePosixPreTransferOwnershipError(controller.pendingCleanup, error);
          return closeFailed(controller.pendingCleanup);
        }
        if (!isErrnoException(error)) throw error;
        return fsFailed(mapErrno(error));
      }

      if (!stats.isDirectory()) {
        const closed = controller.retryClose();
        if (!closed.ok) return closeFailed(controller.pendingCleanup);
        return fsFailed({ code: 'NOT_DIRECTORY' });
      }

      try {
        if (options.beforeTransfer !== undefined) options.beforeTransfer();
        const handle = toHandle(controller);
        controller = undefined;
        return Object.freeze({ ok: true as const, value: handle });
      } catch (error) {
        // Transfer incomplete — controller still owns the fd.
        if (controller === undefined) throw error;
        const closed = controller.retryClose();
        if (!closed.ok) {
          if (!isErrnoException(error))
            throw new NodePosixPreTransferOwnershipError(controller.pendingCleanup, error);
          return closeFailed(controller.pendingCleanup);
        }
        if (!isErrnoException(error)) throw error;
        return fsFailed(mapErrno(error));
      }
    } catch (error) {
      if (error instanceof NodePosixPreTransferOwnershipError) throw error;
      if (controller !== undefined) {
        const closed = controller.retryClose();
        if (!closed.ok) {
          if (!isErrnoException(error))
            throw new NodePosixPreTransferOwnershipError(controller.pendingCleanup, error);
          return closeFailed(controller.pendingCleanup);
        }
      }
      if (!isErrnoException(error)) throw error;
      return fsFailed(mapErrno(error));
    }
  };

  const fstat = (handle: PosixDirectoryHandle): PosixFsResult<PosixPathIdentity> => {
    const controller = controllerOf(handle);
    if (controller === null) return err({ code: 'IO' });
    const fd = controller.getFd();
    if (fd === null) return err({ code: 'IO' });
    try {
      return ok(identityFromStats(primitives.fstatSync(fd)));
    } catch (error) {
      if (!isErrnoException(error)) throw error;
      return err(mapErrno(error));
    }
  };

  const closeDirectory = (handle: PosixDirectoryHandle): PosixFsResult<void> => {
    const controller = controllerOf(handle);
    if (controller === null) return err({ code: 'IO' });
    const closed = controller.retryClose();
    if (closed.ok) live.delete(handle);
    return closed;
  };

  return Object.freeze({
    getRuntimeOsFamily,
    getCurrentUid,
    lstat,
    realpath,
    openDirectory,
    fstat,
    closeDirectory,
  });
}
