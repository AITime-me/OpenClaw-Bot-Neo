import { join } from 'node:path';
import { lstat, open } from 'node:fs/promises';
import type { NeoProcessConfigFileReaderPort } from '../ports/neo-process-ports.js';

export const NEO_CONFIG_MAX_FILE_BYTES = 256 * 1024;

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

export const createNodeProductionConfigFileReader = (): NeoProcessConfigFileReaderPort => ({
  readJsonFile: async (absolutePath: string) => {
    if (absolutePath.includes('\0')) {
      return { ok: false, reason: 'Config path contains NUL.' };
    }
    try {
      if (await hasSymlinkInPath(absolutePath)) {
        return { ok: false, reason: 'Config path must not traverse symlinks.' };
      }
      const handle = await open(absolutePath, 'r');
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) return { ok: false, reason: 'Config path must be a regular file.' };
        if (stats.size > NEO_CONFIG_MAX_FILE_BYTES) {
          return { ok: false, reason: 'Config file exceeds size limit.' };
        }
        const buffer = Buffer.alloc(stats.size);
        await handle.read(buffer, 0, stats.size, 0);
        const text = buffer.toString('utf8');
        if (text.includes('${')) {
          return { ok: false, reason: 'Config interpolation is not allowed.' };
        }
        const json: unknown = JSON.parse(text);
        return { ok: true, json };
      } finally {
        await handle.close();
      }
    } catch {
      return { ok: false, reason: 'Config file could not be read or parsed.' };
    }
  },
});

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
