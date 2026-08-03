import { describe, expect, it } from 'vitest';
import { createLinuxProcfsProcessInstanceProvider } from '../src/neo-runtime/process-identity/linux-procfs-process-instance-provider.js';
import type {
  ProcfsOpenFn,
  ProcfsReadableHandle,
} from '../src/neo-runtime/process-identity/read-bounded-procfs-utf8.js';

const BOOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' as const;
const START_TICKS = '9876543210123' as const;

const buildStatLine = (pid: number, state: string, startTimeTicks: string): string => {
  const prefix = `${String(pid)} (node) ${state}`;
  const filler = Array.from({ length: 18 }, () => '0').join(' ');
  return `${prefix} ${filler} ${startTimeTicks}`;
};

const createSequentialHandle = (content: string): ProcfsReadableHandle => {
  const bytes = Buffer.from(content, 'utf8');
  let position = 0;
  return {
    read: async (buffer, offset, length, readPosition) => {
      await Promise.resolve();
      if (readPosition !== position) {
        return { bytesRead: 0 };
      }
      const remaining = bytes.length - position;
      if (remaining <= 0) {
        return { bytesRead: 0 };
      }
      const toRead = Math.min(length, remaining);
      bytes.copy(buffer, offset, position, position + toRead);
      position += toRead;
      return { bytesRead: toRead };
    },
    close: async () => {
      await Promise.resolve();
    },
  };
};

const createProcfsOpenFn = (pid: number): ProcfsOpenFn => {
  const statPath = `/proc/${String(pid)}/stat`;
  const bootPath = '/proc/sys/kernel/random/boot_id';
  return async (absolutePath: string) => {
    await Promise.resolve();
    if (absolutePath === statPath) {
      return createSequentialHandle(buildStatLine(pid, 'R', START_TICKS));
    }
    if (absolutePath === bootPath) {
      return createSequentialHandle(`${BOOT_ID}\n`);
    }
    const missing = new Error('ENOENT') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    throw missing;
  };
};

describe('neo linux procfs process instance provider', () => {
  it('captureSelf succeeds with size-zero procfs fixtures', async () => {
    const provider = createLinuxProcfsProcessInstanceProvider(42, {
      openFn: createProcfsOpenFn(42),
    });
    const captured = await provider.captureSelf();
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value).toEqual({
      pid: 42,
      bootId: BOOT_ID,
      startTimeTicks: START_TICKS,
    });
  });

  it('observe succeeds with size-zero procfs fixtures', async () => {
    const provider = createLinuxProcfsProcessInstanceProvider(42, {
      openFn: createProcfsOpenFn(42),
    });
    const observed = await provider.observe(42);
    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    expect(observed.value.startTimeTicks).toBe(START_TICKS);
    expect(observed.value.bootId).toBe(BOOT_ID);
    expect(observed.value.state).toBe('R');
  });

  it('readCurrentBootId preserves exact boot id from size-zero fixture', async () => {
    const provider = createLinuxProcfsProcessInstanceProvider(42, {
      openFn: createProcfsOpenFn(42),
    });
    const boot = await provider.readCurrentBootId();
    expect(boot).toEqual({ ok: true, value: BOOT_ID });
  });
});
