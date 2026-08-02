import { dirname, join, parse, resolve } from 'node:path';
import { lstat, open } from 'node:fs/promises';
import { NEO_READINESS_FILENAME } from '../readiness/neo-runtime-readiness-file.js';
import {
  parseNeoReadinessDocument,
  type NeoReadinessStatusDocument,
} from './parse-neo-readiness-document.js';

export const NEO_STATUS_READINESS_MAX_BYTES = 4096 as const;

const readinessPath = (executionRoot: string): string =>
  join(executionRoot, NEO_READINESS_FILENAME);

const isNodeErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: string }).code === code;

/**
 * Validates ancestor directories up to and including the readiness parent directory.
 * Does not inspect the readiness leaf file itself.
 */
const isReadinessParentPathUnsafe = async (parentDirectory: string): Promise<boolean> => {
  let current = resolve(parentDirectory);
  const { root } = parse(current);

  for (;;) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return true;
      if (!stats.isDirectory()) return true;
    } catch {
      return true;
    }
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
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

  const parentDirectory = dirname(target);
  if (await isReadinessParentPathUnsafe(parentDirectory)) {
    return { ok: false, reason: 'unreadable' };
  }

  try {
    const leafStats = await lstat(target);
    if (leafStats.isSymbolicLink()) return { ok: false, reason: 'unreadable' };
    if (!leafStats.isFile()) return { ok: false, reason: 'unreadable' };

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
    if (isNodeErrorWithCode(error, 'ENOENT')) {
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
