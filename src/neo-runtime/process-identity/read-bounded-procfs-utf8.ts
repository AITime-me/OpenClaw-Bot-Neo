import { open, type FileHandle } from 'node:fs/promises';
import type { ProcessInstanceProbeFailure } from './process-instance-identity-provider.port.js';

export type ProcfsReadableHandle = {
  readonly read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ readonly bytesRead: number }>;
  readonly close: () => Promise<void>;
};

export type ProcfsOpenFn = (absolutePath: string) => Promise<ProcfsReadableHandle>;

const isNodeErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: string }).code === code;

const defaultOpenFn = async (absolutePath: string): Promise<ProcfsReadableHandle> => {
  const handle: FileHandle = await open(absolutePath, 'r');
  return {
    read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
    close: () => handle.close(),
  };
};

/**
 * Reads bounded UTF-8 text from a procfs seq_file entry without trusting st_size.
 */
export const readBoundedProcfsUtf8 = async (
  absolutePath: string,
  maxBytes: number,
  openFn: ProcfsOpenFn = defaultOpenFn,
): Promise<
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: ProcessInstanceProbeFailure }
> => {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return { ok: false, failure: 'probe-invalid' };
  }

  try {
    const handle = await openFn(absolutePath);
    try {
      const capacity = maxBytes + 1;
      const buffer = Buffer.alloc(capacity);
      let totalBytes = 0;

      while (totalBytes < capacity) {
        const { bytesRead } = await handle.read(
          buffer,
          totalBytes,
          capacity - totalBytes,
          totalBytes,
        );
        if (bytesRead === 0) {
          break;
        }
        totalBytes += bytesRead;
      }

      if (totalBytes > maxBytes) {
        return { ok: false, failure: 'probe-invalid' };
      }

      return { ok: true, text: buffer.subarray(0, totalBytes).toString('utf8') };
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return { ok: false, failure: 'process-absent' };
    }
    if (isNodeErrorWithCode(error, 'EACCES') || isNodeErrorWithCode(error, 'EPERM')) {
      return { ok: false, failure: 'probe-unavailable' };
    }
    return { ok: false, failure: 'probe-unavailable' };
  }
};
