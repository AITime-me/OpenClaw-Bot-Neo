import { createRequire } from 'node:module';
import fs from 'node:fs';

/**
 * Narrow ESM→CJS interop for fs-ext-extra-prebuilt plus lock-file fd I/O.
 * App-private. Only this module may import fs-ext-extra-prebuilt or use node:fs for the
 * exclusive process-lock placeholder. Does not export the raw package, flockSync, fcntlSync,
 * FD_CLOEXEC, fds, or paths.
 *
 * Native binding is loaded lazily on first production CLOEXEC verification or flock call so
 * platform fail-closed paths never touch the native addon. Production does not pass caller-visible
 * O_CLOEXEC (undefined on Node v22.13.0 / Linux); post-open getfd verifies FD_CLOEXEC fail-closed.
 * Production never calls setfd and never hardcodes numeric O_CLOEXEC.
 */

export interface PosixProcessLockFileStat {
  readonly isFile: boolean;
  readonly mode: number;
  readonly uid: number;
  readonly nlink: number;
}

/**
 * Opaque CLOEXEC postcondition outcome. Raw getfd values and FD_CLOEXEC never leave this module.
 */
export type PosixProcessLockCloexecVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'unavailable' }
  | { readonly ok: false; readonly kind: 'verification-failed' };

/**
 * Narrow production lock driver surface. Callers never receive raw package objects or fds
 * outside the owning factory controller.
 */
export interface PosixProcessLockDriver {
  readonly openLockFile: (absoluteLockPath: string) => number;
  readonly verifyCloseOnExec: (fd: number) => PosixProcessLockCloexecVerification;
  readonly fstatLockFd: (fd: number) => PosixProcessLockFileStat;
  readonly flockExclusiveNonblocking: (fd: number) => void;
  readonly closeFd: (fd: number) => void;
}

/**
 * Exact sync primitives used by the process-lock Node driver.
 * App-private injection point for secure-open / CLOEXEC contract tests only — not a general
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
  /**
   * Narrow getfd adapter. Production wires this to native `fcntlSync(fd, "getfd")`.
   * Must not be used for setfd.
   */
  readonly fcntlGetFd: (fd: number) => number;
  /**
   * Resolves native FD_CLOEXEC for verification. May trigger lazy native load.
   * Invalid / missing values fail closed inside verifyCloseOnExec.
   */
  readonly resolveFdCloexec: () => unknown;
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

type ProductionNativeExt = {
  readonly flockSync: (fd: number, flags: 'exnb') => void;
  readonly fcntlGetFd: (fd: number) => number;
  readonly fdCloexec: number;
};

let productionNativeCached: ProductionNativeExt | undefined;

/**
 * Single positive integer bit (power of two). Rejects zero, negative, non-integer, multi-bit.
 */
const isValidCloexecBit = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0 &&
  (value & (value - 1)) === 0;

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);

/** Descriptor flags from getfd must be a non-negative finite integer before bit checks. */
const isValidGetFdResult = (value: unknown): value is number =>
  isFiniteInteger(value) && value >= 0;

const loadProductionNativeExt = (): ProductionNativeExt => {
  if (productionNativeCached !== undefined) return productionNativeCached;
  const require = createRequire(import.meta.url);
  // Literal package name only — never caller-controlled.
  let mod: {
    readonly flockSync?: unknown;
    readonly fcntlSync?: unknown;
    readonly constants?: { readonly FD_CLOEXEC?: unknown };
  };
  try {
    mod = require('fs-ext-extra-prebuilt') as typeof mod;
  } catch {
    const error = new Error('Process lock native binding unavailable.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_NATIVE_UNAVAILABLE' });
    throw error;
  }
  if (typeof mod.flockSync !== 'function' || typeof mod.fcntlSync !== 'function') {
    const error = new Error('Process lock native flock/fcntl binding unavailable.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_NATIVE_UNAVAILABLE' });
    throw error;
  }
  const fdCloexecRaw: unknown = mod.constants?.FD_CLOEXEC;
  if (!isValidCloexecBit(fdCloexecRaw)) {
    const error = new Error('Process lock native FD_CLOEXEC unavailable.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_CLOEXEC_UNAVAILABLE' });
    throw error;
  }
  const flockSync = mod.flockSync.bind(mod) as (fd: number, flags: 'exnb') => void;
  const fcntlSync = mod.fcntlSync.bind(mod) as (fd: number, cmd: 'getfd') => number;
  const fdCloexec = fdCloexecRaw;
  const loaded: ProductionNativeExt = Object.freeze({
    flockSync: (fd: number, flags: 'exnb'): void => {
      flockSync(fd, flags);
    },
    fcntlGetFd: (fd: number): number => fcntlSync(fd, 'getfd'),
    fdCloexec,
  });
  productionNativeCached = loaded;
  return loaded;
};

/**
 * Required caller-visible Node open flags only. Does not include O_CLOEXEC (undefined on
 * Node v22.13.0 Linux) and never ORs a magic numeric CLOEXEC constant.
 */
const requireSecureOpenFlags = (
  constants: PosixProcessLockDriverPrimitives['constants'],
): number => {
  const { O_RDWR, O_CREAT, O_NOFOLLOW } = constants;
  if (typeof O_RDWR !== 'number' || typeof O_CREAT !== 'number' || typeof O_NOFOLLOW !== 'number') {
    const error = new Error('Process lock secure open flags unavailable on this runtime.');
    Object.defineProperty(error, 'code', { value: 'STORAGE_LOCK_FLAGS_UNAVAILABLE' });
    throw error;
  }
  return O_RDWR | O_CREAT | O_NOFOLLOW;
};

const verifyCloseOnExecWithPrimitives = (
  fd: number,
  primitives: PosixProcessLockDriverPrimitives,
): PosixProcessLockCloexecVerification => {
  let fdCloexec: unknown;
  try {
    fdCloexec = primitives.resolveFdCloexec();
  } catch (error: unknown) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof Reflect.get(error, 'code') === 'string'
        ? (Reflect.get(error, 'code') as string)
        : '';
    if (
      code === 'STORAGE_LOCK_NATIVE_UNAVAILABLE' ||
      code === 'STORAGE_LOCK_CLOEXEC_UNAVAILABLE' ||
      code === 'STORAGE_LOCK_FLAGS_UNAVAILABLE' ||
      code === 'ERR_DLOPEN_FAILED' ||
      code === 'MODULE_NOT_FOUND'
    ) {
      return Object.freeze({ ok: false as const, kind: 'unavailable' as const });
    }
    return Object.freeze({ ok: false as const, kind: 'unavailable' as const });
  }
  if (!isValidCloexecBit(fdCloexec)) {
    return Object.freeze({ ok: false as const, kind: 'unavailable' as const });
  }

  let flags: unknown;
  try {
    flags = primitives.fcntlGetFd(fd);
  } catch {
    return Object.freeze({ ok: false as const, kind: 'verification-failed' as const });
  }
  if (!isValidGetFdResult(flags)) {
    return Object.freeze({ ok: false as const, kind: 'verification-failed' as const });
  }
  if ((flags & fdCloexec) !== fdCloexec) {
    return Object.freeze({ ok: false as const, kind: 'verification-failed' as const });
  }
  return Object.freeze({ ok: true as const });
};

/**
 * Builds the process-lock driver over exact injected sync primitives.
 * Intended for secure-open / CLOEXEC contract tests. Not re-exported from barrels or package root.
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
    verifyCloseOnExec: (fd: number): PosixProcessLockCloexecVerification =>
      verifyCloseOnExecWithPrimitives(fd, primitives),
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
 * Open uses RDWR|CREAT|NOFOLLOW and mode 0600 (no caller-visible O_CLOEXEC). After open, getfd
 * verifies FD_CLOEXEC fail-closed. Does not truncate, unlink, chmod, write PID/metadata, or setfd.
 * flock is exclusive nonblocking (`exnb`) only — no production unlock call.
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
        loadProductionNativeExt().flockSync(fd, flags);
      },
      fcntlGetFd: (fd: number): number => loadProductionNativeExt().fcntlGetFd(fd),
      resolveFdCloexec: (): unknown => loadProductionNativeExt().fdCloexec,
      constants: Object.freeze({
        O_RDWR: constants.O_RDWR,
        O_CREAT: constants.O_CREAT,
        ...(typeof constants.O_NOFOLLOW === 'number' ? { O_NOFOLLOW: constants.O_NOFOLLOW } : {}),
        // O_CLOEXEC may be present or absent on the runtime; production never ORs it into open flags.
        ...(typeof constants.O_CLOEXEC === 'number' ? { O_CLOEXEC: constants.O_CLOEXEC } : {}),
        ...(typeof constants.O_TRUNC === 'number' ? { O_TRUNC: constants.O_TRUNC } : {}),
        ...(typeof constants.O_APPEND === 'number' ? { O_APPEND: constants.O_APPEND } : {}),
        ...(typeof constants.O_EXCL === 'number' ? { O_EXCL: constants.O_EXCL } : {}),
      }),
    }),
  );
};
