import { describe, expect, it, vi } from 'vitest';
import { readBoundedProcfsUtf8 } from '../src/neo-runtime/process-identity/read-bounded-procfs-utf8.js';
import type {
  ProcfsOpenFn,
  ProcfsReadableHandle,
} from '../src/neo-runtime/process-identity/read-bounded-procfs-utf8.js';

const createSequentialHandle = (
  content: string,
  options: {
    readonly chunkSize?: number;
    readonly onClose?: () => void;
  } = {},
): ProcfsReadableHandle => {
  const bytes = Buffer.from(content, 'utf8');
  let position = 0;
  const chunkSize = options.chunkSize ?? bytes.length;

  return {
    read: async (buffer, offset, length, readPosition) => {
      await Promise.resolve();
      expect(readPosition).toBe(position);
      const remaining = bytes.length - position;
      if (remaining <= 0) {
        return { bytesRead: 0 };
      }
      const toRead = Math.min(length, chunkSize, remaining);
      bytes.copy(buffer, offset, position, position + toRead);
      position += toRead;
      return { bytesRead: toRead };
    },
    close: async () => {
      await Promise.resolve();
      options.onClose?.();
    },
  };
};

const openFromHandles = (
  handles: Readonly<Record<string, ProcfsReadableHandle>>,
  errors: Readonly<Record<string, Error>> = {},
): ProcfsOpenFn =>
  vi.fn(async (absolutePath: string) => {
    await Promise.resolve();
    const error = errors[absolutePath];
    if (error !== undefined) throw error;
    const handle = handles[absolutePath];
    if (handle === undefined) {
      const missing = new Error('ENOENT') as NodeJS.ErrnoException;
      missing.code = 'ENOENT';
      throw missing;
    }
    return handle;
  });

describe('neo bounded procfs read', () => {
  it('reads non-empty boot id when stat size would be zero', async () => {
    const path = '/proc/sys/kernel/random/boot_id';
    const openFn = openFromHandles({
      [path]: createSequentialHandle('a1b2c3d4-e5f6-7890-abcd-ef1234567890\n'),
    });
    const result = await readBoundedProcfsUtf8(path, 128, openFn);
    expect(result).toEqual({
      ok: true,
      text: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890\n',
    });
  });

  it('reads non-empty proc stat when stat size would be zero', async () => {
    const path = '/proc/42/stat';
    const stat = '42 (node) R 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345';
    const openFn = openFromHandles({ [path]: createSequentialHandle(stat) });
    const result = await readBoundedProcfsUtf8(path, 4096, openFn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(stat);
  });

  it('supports short reads followed by another read', async () => {
    const path = '/proc/7/stat';
    const content = '7 (node) R 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 99';
    const openFn = openFromHandles({
      [path]: createSequentialHandle(content, { chunkSize: 8 }),
    });
    const result = await readBoundedProcfsUtf8(path, 4096, openFn);
    expect(result).toEqual({ ok: true, text: content });
  });

  it('stops at EOF after valid content', async () => {
    const path = '/proc/8/stat';
    const content = '8 (node) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1';
    const openFn = openFromHandles({ [path]: createSequentialHandle(content) });
    const result = await readBoundedProcfsUtf8(path, 128, openFn);
    expect(result).toEqual({ ok: true, text: content });
  });

  it('accepts exactly maxBytes', async () => {
    const path = '/proc/exact';
    const content = 'x'.repeat(16);
    const openFn = openFromHandles({ [path]: createSequentialHandle(content) });
    const result = await readBoundedProcfsUtf8(path, 16, openFn);
    expect(result).toEqual({ ok: true, text: content });
  });

  it('rejects maxBytes plus one', async () => {
    const path = '/proc/oversize';
    const content = 'y'.repeat(17);
    const openFn = openFromHandles({ [path]: createSequentialHandle(content) });
    const result = await readBoundedProcfsUtf8(path, 16, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-invalid' });
  });

  it('rejects oversized content split across multiple reads', async () => {
    const path = '/proc/chunked-oversize';
    const content = 'z'.repeat(20);
    const openFn = openFromHandles({
      [path]: createSequentialHandle(content, { chunkSize: 5 }),
    });
    const result = await readBoundedProcfsUtf8(path, 16, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-invalid' });
  });

  it('classifies ENOENT as process absent', async () => {
    const missing = new Error('ENOENT') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    const openFn = vi.fn(async () => {
      await Promise.resolve();
      throw missing;
    });
    const result = await readBoundedProcfsUtf8('/proc/missing/stat', 128, openFn);
    expect(result).toEqual({ ok: false, failure: 'process-absent' });
  });

  it('classifies EACCES as probe unavailable', async () => {
    const denied = new Error('EACCES') as NodeJS.ErrnoException;
    denied.code = 'EACCES';
    const openFn = vi.fn(async () => {
      await Promise.resolve();
      throw denied;
    });
    const result = await readBoundedProcfsUtf8('/proc/denied/stat', 128, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-unavailable' });
  });

  it('classifies EPERM as probe unavailable', async () => {
    const denied = new Error('EPERM') as NodeJS.ErrnoException;
    denied.code = 'EPERM';
    const openFn = vi.fn(async () => {
      await Promise.resolve();
      throw denied;
    });
    const result = await readBoundedProcfsUtf8('/proc/denied/stat', 128, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-unavailable' });
  });

  it('closes the handle after success', async () => {
    const path = '/proc/close-success';
    let closed = false;
    const openFn = openFromHandles({
      [path]: createSequentialHandle('ok', { onClose: () => (closed = true) }),
    });
    await readBoundedProcfsUtf8(path, 8, openFn);
    expect(closed).toBe(true);
  });

  it('closes the handle after read failure', async () => {
    const path = '/proc/close-read-failure';
    let closed = false;
    const handle: ProcfsReadableHandle = {
      read: async () => {
        await Promise.resolve();
        throw new Error('EIO');
      },
      close: async () => {
        await Promise.resolve();
        closed = true;
      },
    };
    const openFn = openFromHandles({ [path]: handle });
    const result = await readBoundedProcfsUtf8(path, 8, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-unavailable' });
    expect(closed).toBe(true);
  });

  it('closes the handle after oversize rejection', async () => {
    const path = '/proc/close-oversize';
    let closed = false;
    const openFn = openFromHandles({
      [path]: createSequentialHandle('a'.repeat(5), {
        onClose: () => (closed = true),
      }),
    });
    const result = await readBoundedProcfsUtf8(path, 4, openFn);
    expect(result).toEqual({ ok: false, failure: 'probe-invalid' });
    expect(closed).toBe(true);
  });
});
