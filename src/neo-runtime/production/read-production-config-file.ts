import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import type { NeoProcessConfigFileReaderPort } from '../ports/neo-process-ports.js';
import {
  createNodeConfigFileOpenDriver,
  type ConfigFileOpenDriver,
} from './config-file-open-driver.js';

export const NEO_CONFIG_MAX_FILE_BYTES = 256 * 1024;

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

const hasSymlinkInPath = async (absolutePath: string): Promise<boolean> => {
  const segments = absolutePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let current = absolutePath.startsWith('/') ? '/' : '';
  for (const segment of segments) {
    if (current === '/') current = `/${segment}`;
    else if (/^[A-Za-z]:$/.test(current)) current = `${current}\\${segment}`;
    else current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
};

const readBoundedFromHandle = async (
  handle: Awaited<ReturnType<ConfigFileOpenDriver['openConfigFile']>>,
  byteLength: number,
): Promise<string> => {
  const buffer = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, byteLength - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== byteLength) {
    const error = new Error('Config file short read.');
    Object.defineProperty(error, 'code', { value: 'EIO' });
    throw error;
  }
  return buffer.toString('utf8');
};

export function createNodeProductionConfigFileReaderWithOpenDriver(
  openDriver: ConfigFileOpenDriver,
): NeoProcessConfigFileReaderPort {
  return {
    readJsonFile: async (absolutePath: string) => {
      if (absolutePath.includes('\0')) {
        return { ok: false, reason: 'Config path contains NUL.' };
      }
      try {
        if (openDriver.requiresNoFollow && (await hasSymlinkInPath(absolutePath))) {
          return { ok: false, reason: 'Config path must not traverse symlinks.' };
        }
        const handle = await openDriver.openConfigFile(absolutePath);
        try {
          const stats = await handle.stat();
          if (!stats.isFile()) {
            return { ok: false, reason: 'Config path must be a regular file.' };
          }
          if (stats.size > NEO_CONFIG_MAX_FILE_BYTES) {
            return { ok: false, reason: 'Config file exceeds size limit.' };
          }
          const text = await readBoundedFromHandle(handle, stats.size);
          if (text.includes('${')) {
            return { ok: false, reason: 'Config interpolation is not allowed.' };
          }
          const json: unknown = JSON.parse(text);
          return { ok: true, json };
        } finally {
          await handle.close();
        }
      } catch (error: unknown) {
        if (
          openDriver.requiresNoFollow &&
          isErrnoException(error) &&
          error.code === 'CONFIG_OPEN_FLAGS_UNAVAILABLE'
        ) {
          return { ok: false, reason: 'Config secure open is unavailable on this runtime.' };
        }
        return { ok: false, reason: 'Config file could not be read or parsed.' };
      }
    },
  };
}

export const createNodeProductionConfigFileReader = (): NeoProcessConfigFileReaderPort =>
  createNodeProductionConfigFileReaderWithOpenDriver(createNodeConfigFileOpenDriver());

export const createInMemoryProductionConfigFileReader = (
  files: Readonly<Record<string, unknown>>,
): NeoProcessConfigFileReaderPort => ({
  readJsonFile: (absolutePath: string) => {
    const value = files[absolutePath];
    if (value === undefined)
      return Promise.resolve({ ok: false, reason: 'Config file is missing.' });
    return Promise.resolve({ ok: true as const, json: structuredClone(value) });
  },
});
