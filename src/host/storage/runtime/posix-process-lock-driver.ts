import { createRequire } from 'node:module';
import fs from 'node:fs';

/**
 * Narrow ESM→CJS interop for fs-ext-extra-prebuilt plus lock-file fd I/O.
 * App-private. Only this module may import fs-ext-extra-prebuilt or use node:fs for the
 * exclusive process-lock placeholder. Does not export the raw package, flockSync, fds, or paths.
 *
 * Native flock binding is loaded lazily on first production flock call so platform fail-closed
 * paths never touch the native addon.
 */

export interface PosixProcessLockFileStat {
  readonly isFile: boolean;
  readonly mode: number;
  readonly uid: number;
  readonly nlink: number;
}

/**
 * Narrow production lock driver surface. Callers never receive raw package objects or fds
 * outside the owning factory controller.
 */
export interface PosixProcessLockDriver {
  readonly openLockFile: (absoluteLockPath: string) => number;
  readonly fstatLockFd: (fd: number) => PosixProcessLockFileStat;
  readonly flockExclusiveNonblocking: (fd: number) => void;
  readonly closeFd: (fd: number) => void;
}

/**
 * Exact sync primitives used by the process-lock Node driver.
 * App-private injection point for secure-open flag/mode contract tests only — not a general
 * filesystem facade and not reachable from host/package barrels.
 */
export interface PosixProcessLockDriverPrimitives {
  readonly openSync: (path: string, flags: number, mode?: number) => number;
  readonly fstatSync: (fd: number) => {
    readonly isFile: () => boolean;
    readonly mode: number;
    readonly uid: number;
    readonly nlink: number;
  };
  readonly closeSync: (fd: number) => void;
  readonly flockSync: (fd: number, flags: 'exnb') => void;
  readonly constants: {
    readonly O_RDWR?: number;
    readonly O_CREAT?: number;
    readonly O_NOFOLLOW?: number;
    readonly O_CLOEXEC?: number;
    readonly O_TRUNC?: number;
    readonly O_APPEND?: number;
    readonly O_EXCL?: number;
  };
}

type FlockSync = (fd: number, flags: 'exnb') => void;

let flockSyncCached: FlockSync | undefined;

const loadProductionFlockSync = (): FlockSync => {
  if (flockSyncCached !== undefined) return flockSyncCached;
  const require = createRequire(import.meta.url);
  // Literal package name only — never caller-controlled.
  const mod = require('fs-ext-extra-prebuilt') as { readonly flockSync?: unknown };
  if (typeof mod.flockSync !== 'function') {
    const error = new Error('Process lock native flock binding unavailable.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_NATIVE_UNAVAILABLE' });
    throw error;
  }
  const flockSync = mod.flockSync.bind(mod) as FlockSync;
  flockSyncCached = flockSync;
  return flockSync;
};

const requireSecureOpenFlags = (
  constants: PosixProcessLockDriverPrimitives['constants'],
): number => {
  const { O_RDWR, O_CREAT, O_NOFOLLOW, O_CLOEXEC } = constants;
  if (
    typeof O_RDWR !== 'number' ||
    typeof O_CREAT !== 'number' ||
    typeof O_NOFOLLOW !== 'number' ||
    typeof O_CLOEXEC !== 'number'
  ) {
    const error = new Error('Process lock secure open flags unavailable on this runtime.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_FLAGS_UNAVAILABLE' });
    throw error;
  }
  return O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC;
};

/**
 * Builds the process-lock driver over exact injected sync primitives.
 * Intended for secure-open flag/mode contract tests. Not re-exported from barrels or package root.
 * Production {@link createNodePosixProcessLockDriver} never accepts caller primitives.
 */
export function createNodePosixProcessLockDriverWithPrimitives(
  primitives: PosixProcessLockDriverPrimitives,
): PosixProcessLockDriver {
  return Object.freeze({
    openLockFile: (absoluteLockPath: string): number => {
      if (typeof absoluteLockPath !== 'string' || absoluteLockPath.length === 0)
        throw new TypeError('Process lock path must be a non-empty string.');
      const flags = requireSecureOpenFlags(primitives.constants);
      return primitives.openSync(absoluteLockPath, flags, 0o600);
    },
    fstatLockFd: (fd: number): PosixProcessLockFileStat => {
      const stats = primitives.fstatSync(fd);
      return Object.freeze({
        isFile: stats.isFile(),
        mode: stats.mode & 0o7777,
        uid: stats.uid,
        nlink: stats.nlink,
      });
    },
    flockExclusiveNonblocking: (fd: number): void => {
      primitives.flockSync(fd, 'exnb');
    },
    closeFd: (fd: number): void => {
      primitives.closeSync(fd);
    },
  });
}

/**
 * Production Node driver for the Linux exclusive process-lock placeholder.
 * Open uses RDWR|CREAT|NOFOLLOW|CLOEXEC and mode 0600. Does not truncate, unlink, chmod, or write
 * PID/metadata. flock is exclusive nonblocking (`exnb`) only — no production unlock call.
 */
export const createNodePosixProcessLockDriver = (): PosixProcessLockDriver => {
  const constants = fs.constants as typeof fs.constants & {
    readonly O_NOFOLLOW?: number;
    readonly O_CLOEXEC?: number;
    readonly O_TRUNC?: number;
    readonly O_APPEND?: number;
    readonly O_EXCL?: number;
  };
  return createNodePosixProcessLockDriverWithPrimitives(
    Object.freeze({
      openSync: (path: string, flags: number, mode?: number): number =>
        fs.openSync(path, flags, mode),
      fstatSync: (fd: number) => fs.fstatSync(fd),
      closeSync: (fd: number): void => {
        fs.closeSync(fd);
      },
      flockSync: (fd: number, flags: 'exnb'): void => {
        loadProductionFlockSync()(fd, flags);
      },
      constants: Object.freeze({
        O_RDWR: constants.O_RDWR,
        O_CREAT: constants.O_CREAT,
        ...(typeof constants.O_NOFOLLOW === 'number' ? { O_NOFOLLOW: constants.O_NOFOLLOW } : {}),
        ...(typeof constants.O_CLOEXEC === 'number' ? { O_CLOEXEC: constants.O_CLOEXEC } : {}),
        ...(typeof constants.O_TRUNC === 'number' ? { O_TRUNC: constants.O_TRUNC } : {}),
        ...(typeof constants.O_APPEND === 'number' ? { O_APPEND: constants.O_APPEND } : {}),
        ...(typeof constants.O_EXCL === 'number' ? { O_EXCL: constants.O_EXCL } : {}),
      }),
    }),
  );
};
