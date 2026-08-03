import fs from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import process from 'node:process';

/**
 * Narrow ESM config-file open seam. App-private injection point for descriptor-safe read tests.
 * Not exported from barrels or package root.
 */
export interface ConfigFileOpenDriverPrimitives {
  readonly open: (path: string, flags: number) => Promise<FileHandle>;
  readonly constants: {
    readonly O_RDONLY?: number;
    readonly O_NOFOLLOW?: number;
  };
  readonly platform: string;
}

export interface ConfigFileOpenDriver {
  readonly requiresNoFollow: boolean;
  readonly openConfigFile: (absolutePath: string) => Promise<FileHandle>;
}

const requireSecureReadFlags = (constants: ConfigFileOpenDriverPrimitives['constants']): number => {
  const { O_RDONLY, O_NOFOLLOW } = constants;
  if (typeof O_RDONLY !== 'number' || typeof O_NOFOLLOW !== 'number') {
    const error = new Error('Config secure open flags unavailable on this runtime.');
    Object.defineProperty(error, 'code', { value: 'CONFIG_OPEN_FLAGS_UNAVAILABLE' });
    throw error;
  }
  return O_RDONLY | O_NOFOLLOW;
};

export function createNodeConfigFileOpenDriverWithPrimitives(
  primitives: ConfigFileOpenDriverPrimitives,
): ConfigFileOpenDriver {
  const isLinux = primitives.platform === 'linux';
  if (isLinux) {
    try {
      const flags = requireSecureReadFlags(primitives.constants);
      return Object.freeze({
        requiresNoFollow: true,
        openConfigFile: (absolutePath: string): Promise<FileHandle> => {
          if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
            throw new TypeError('Config path must be a non-empty string.');
          }
          return primitives.open(absolutePath, flags);
        },
      });
    } catch (error: unknown) {
      const unavailable = error instanceof Error ? error : new Error('Config open unavailable.');
      return Object.freeze({
        requiresNoFollow: true,
        openConfigFile: (): Promise<FileHandle> => Promise.reject(unavailable),
      });
    }
  }
  const flags =
    typeof primitives.constants.O_RDONLY === 'number'
      ? primitives.constants.O_RDONLY
      : fs.constants.O_RDONLY;
  return Object.freeze({
    requiresNoFollow: false,
    openConfigFile: (absolutePath: string): Promise<FileHandle> => {
      if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
        throw new TypeError('Config path must be a non-empty string.');
      }
      return primitives.open(absolutePath, flags);
    },
  });
}

export const createNodeConfigFileOpenDriver = (): ConfigFileOpenDriver =>
  createNodeConfigFileOpenDriverWithPrimitives({
    open: (path, flags) => open(path, flags),
    constants: fs.constants,
    platform: process.platform,
  });
