import { join } from 'node:path';
import { lstat, open } from 'node:fs/promises';
import { NEO_READINESS_FILENAME } from '../readiness/neo-runtime-readiness-file.js';
import {
  parseNeoReadinessDocument,
  type NeoReadinessStatusDocument,
} from './parse-neo-readiness-document.js';

export const NEO_STATUS_READINESS_MAX_BYTES = 4096 as const;

const readinessPath = (executionRoot: string): string =>
  join(executionRoot, NEO_READINESS_FILENAME);

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

export type NeoReadinessFileReadResult =
  | { readonly ok: true; readonly document: NeoReadinessStatusDocument }
  | { readonly ok: false; readonly reason: 'absent' | 'invalid' | 'unreadable' };

export const readNeoReadinessFile = async (
  executionRoot: string,
): Promise<NeoReadinessFileReadResult> => {
  const target = readinessPath(executionRoot);
  if (target.includes('\0')) return { ok: false, reason: 'unreadable' };
  try {
    if (await hasSymlinkInPath(target)) return { ok: false, reason: 'unreadable' };
    const handle = await open(target, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) return { ok: false, reason: 'unreadable' };
      if (stats.size > NEO_STATUS_READINESS_MAX_BYTES) return { ok: false, reason: 'invalid' };
      const buffer = Buffer.alloc(stats.size);
      await handle.read(buffer, 0, stats.size, 0);
      const text = buffer.toString('utf8');
      const json: unknown = JSON.parse(text);
      const parsed = parseNeoReadinessDocument(json);
      if (!parsed.ok) return { ok: false, reason: 'invalid' };
      return { ok: true, document: parsed.value };
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    ) {
      return { ok: false, reason: 'absent' };
    }
    return { ok: false, reason: 'unreadable' };
  }
};

export type NeoReadinessFileReaderPort = {
  readonly read: (executionRoot: string) => Promise<NeoReadinessFileReadResult>;
};

export const createNodeNeoReadinessFileReader = (): NeoReadinessFileReaderPort => ({
  read: readNeoReadinessFile,
});

export const createInMemoryNeoReadinessFileReader = (
  files: Readonly<Record<string, NeoReadinessStatusDocument | null>>,
): NeoReadinessFileReaderPort => ({
  read: (executionRoot: string) =>
    Promise.resolve(
      (() => {
        const value = files[executionRoot];
        if (value === null || value === undefined)
          return { ok: false as const, reason: 'absent' as const };
        return { ok: true as const, document: structuredClone(value) };
      })(),
    ),
});
