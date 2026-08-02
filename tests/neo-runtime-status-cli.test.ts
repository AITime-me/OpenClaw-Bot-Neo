import { describe, expect, it, vi } from 'vitest';
import { parseNeoStatusCliArguments } from '../src/neo-runtime/cli/parse-neo-status-cli-arguments.js';
import { parseNeoReadinessDocument } from '../src/neo-runtime/cli/parse-neo-readiness-document.js';
import {
  NEO_STATUS_EXIT_INVALID,
  NEO_STATUS_EXIT_NOT_READY,
  NEO_STATUS_EXIT_SUCCESS,
  NEO_STATUS_EXIT_TIMEOUT,
  readNeoStatus,
} from '../src/neo-runtime/cli/read-neo-status.js';
import { createInMemoryNeoReadinessFileReader } from '../src/neo-runtime/cli/read-neo-readiness-file.js';

const isWindows = process.platform === 'win32';
const EXEC_ROOT = isWindows ? 'C:\\neo-status\\exec' : '/neo-status/exec';

const validDocument = () =>
  Object.freeze({
    schemaVersion: '1' as const,
    pid: 4242,
    lifecycle: 'running' as const,
    runtimeReady: true as const,
    durableHostOpened: true as const,
    startedAtUtc: '2026-08-02T12:00:00.000Z',
  });

describe('neo runtime status CLI', () => {
  it('help does not read filesystem', async () => {
    const reader = {
      read: vi.fn(),
    };
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--help'],
      reader,
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('valid ready schema returns 0', async () => {
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader: createInMemoryNeoReadinessFileReader({ [EXEC_ROOT]: validDocument() }),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    const payload = JSON.parse(lines[0] ?? '{}') as { ready: boolean };
    expect(payload.ready).toBe(true);
  });

  it('missing ready returns 1', async () => {
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader: createInMemoryNeoReadinessFileReader({}),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
  });

  it('invalid CLI returns 2', async () => {
    const result = await readNeoStatus({
      argv: ['--execution-root', 'relative'],
      reader: createInMemoryNeoReadinessFileReader({}),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_INVALID);
  });

  it('invalid readiness schema returns 2', async () => {
    const parsed = parseNeoReadinessDocument({ schemaVersion: '9', pid: 1 });
    expect(parsed.ok).toBe(false);
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader: {
        read: () => Promise.resolve({ ok: false as const, reason: 'invalid' as const }),
      },
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_INVALID);
  });

  it('wait timeout returns 3 without busy spin', async () => {
    const sleepCalls: number[] = [];
    let now = 0;
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT, '--wait-ready', '--timeout-ms', '250'],
      reader: createInMemoryNeoReadinessFileReader({}),
      nowMs: () => {
        now += 100;
        return now;
      },
      sleep: async (ms) => {
        await Promise.resolve();
        sleepCalls.push(ms);
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_TIMEOUT);
    expect(sleepCalls.length).toBeGreaterThan(0);
    expect(Math.max(...sleepCalls)).toBeLessThanOrEqual(250);
  });

  it('parses exact valid argument set', () => {
    const parsed = parseNeoStatusCliArguments([
      '--execution-root',
      EXEC_ROOT,
      '--wait-ready',
      '--timeout-ms',
      '1000',
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      kind: 'read',
      executionRoot: EXEC_ROOT,
      waitReady: true,
      timeoutMs: 1000,
    });
  });
});
