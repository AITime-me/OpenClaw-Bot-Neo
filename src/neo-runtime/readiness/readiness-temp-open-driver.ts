import fs from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import process from 'node:process';

/**
 * Narrow readiness temporary-file open seam. App-private injection point for exclusive temp tests.
 * Not exported from barrels or package root.
 */
export interface ReadinessTempOpenDriverPrimitives {
  readonly open: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  readonly constants: {
    readonly O_WRONLY?: number;
    readonly O_CREAT?: number;
    readonly O_EXCL?: number;
    readonly O_NOFOLLOW?: number;
  };
  readonly platform: string;
}

export interface ReadinessTempOpenDriver {
  readonly requiresNoFollow: boolean;
  readonly openExclusiveTemp: (absolutePath: string) => Promise<FileHandle>;
}

const READINESS_TEMP_MODE = 0o600;

const requireExclusiveTempFlags = (
  constants: ReadinessTempOpenDriverPrimitives['constants'],
): number => {
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = constants;
  if (
    typeof O_WRONLY !== 'number' ||
    typeof O_CREAT !== 'number' ||
    typeof O_EXCL !== 'number' ||
    typeof O_NOFOLLOW !== 'number'
  ) {
    const error = new Error('Readiness temp secure open flags unavailable on this runtime.');
    Object.defineProperty(error, 'code', { value: 'READINESS_TEMP_OPEN_FLAGS_UNAVAILABLE' });
    throw error;
  }
  return O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
};

export function createNodeReadinessTempOpenDriverWithPrimitives(
  primitives: ReadinessTempOpenDriverPrimitives,
): ReadinessTempOpenDriver {
  const isLinux = primitives.platform === 'linux';
  const flags = isLinux
    ? requireExclusiveTempFlags(primitives.constants)
    : (() => {
        const { O_WRONLY, O_CREAT, O_EXCL } = primitives.constants;
        if (
          typeof O_WRONLY !== 'number' ||
          typeof O_CREAT !== 'number' ||
          typeof O_EXCL !== 'number'
        ) {
          const error = new Error('Readiness temp open flags unavailable on this runtime.');
          Object.defineProperty(error, 'code', { value: 'READINESS_TEMP_OPEN_FLAGS_UNAVAILABLE' });
          throw error;
        }
        return O_WRONLY | O_CREAT | O_EXCL;
      })();
  return Object.freeze({
    requiresNoFollow: isLinux,
    openExclusiveTemp: (absolutePath: string): Promise<FileHandle> => {
      if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
        throw new TypeError('Readiness temp path must be a non-empty string.');
      }
      return primitives.open(absolutePath, flags, READINESS_TEMP_MODE);
    },
  });
}

export const createNodeReadinessTempOpenDriver = (): ReadinessTempOpenDriver =>
  createNodeReadinessTempOpenDriverWithPrimitives({
    open: (path, flags, mode) => open(path, flags, mode),
    constants: fs.constants,
    platform: process.platform,
  });
