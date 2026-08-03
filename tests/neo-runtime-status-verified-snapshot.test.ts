import { describe, expect, it, vi } from 'vitest';
import {
  NEO_STATUS_EXIT_INVALID,
  NEO_STATUS_EXIT_NOT_READY,
  NEO_STATUS_EXIT_SUCCESS,
  NEO_STATUS_EXIT_TIMEOUT,
  readNeoStatus,
} from '../src/neo-runtime/cli/read-neo-status.js';
import type { NeoReadinessStatusDocument } from '../src/neo-runtime/cli/parse-neo-readiness-document.js';
import type {
  NeoReadinessFileReadResult,
  NeoReadinessFileReaderPort,
} from '../src/neo-runtime/cli/read-neo-readiness-file.js';
import { createFakeProcessInstanceProvider } from '../src/neo-runtime/process-identity/fake-process-instance-provider.js';
import {
  createMatchingProcessInstanceProvider,
  fixedIdentity,
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
  validReadinessIdentity,
} from './support/neo-runtime-fixtures.js';

const isWindows = process.platform === 'win32';
const EXEC_ROOT = isWindows ? 'C:\\neo-status\\exec' : '/neo-status/exec';

const validDocument = (
  overrides: Partial<NeoReadinessStatusDocument> = {},
): NeoReadinessStatusDocument =>
  Object.freeze({
    schemaVersion: '2',
    pid: fixedIdentity().pid,
    lifecycle: 'running',
    runtimeReady: true,
    durableHostOpened: true,
    startedAtUtc: fixedIdentity().nowUtcIso(),
    bootId: NEO_TEST_BOOT_ID,
    startTimeTicks: NEO_TEST_START_TIME_TICKS,
    ...overrides,
  });

const createSequentialReader = (
  results: readonly NeoReadinessFileReadResult[],
): NeoReadinessFileReaderPort & {
  readonly read: ReturnType<
    typeof vi.fn<(executionRoot: string) => Promise<NeoReadinessFileReadResult>>
  >;
} => {
  let index = 0;
  const read = vi.fn(async (executionRoot: string): Promise<NeoReadinessFileReadResult> => {
    void executionRoot;
    await Promise.resolve();
    const result = results[index];
    index += 1;
    if (result === undefined) {
      return { ok: false as const, reason: 'absent' as const };
    }
    return result;
  });
  return { read };
};

describe('neo status verified readiness snapshot', () => {
  it('emits document A and never emits swapped document B on a second read', async () => {
    const documentA = validDocument();
    const documentB = validDocument({ startTimeTicks: '9999999999999' });
    const reader = createSequentialReader([
      { ok: true, document: documentA },
      { ok: true, document: documentB },
    ]);
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      ready: true,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
      bootId: NEO_TEST_BOOT_ID,
    });
  });

  it('never becomes ready when only the second read would match identity', async () => {
    const documentB = validDocument();
    const reader = createSequentialReader([
      { ok: false, reason: 'absent' },
      { ok: true, document: documentB },
    ]);
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('rejects changed startTimeTicks when reader would return mismatched second document', async () => {
    const documentA = validDocument();
    const documentB = validDocument({ startTimeTicks: '111' });
    const reader = createSequentialReader([
      { ok: true, document: documentA },
      { ok: true, document: documentB },
    ]);
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    const payload = JSON.parse(lines[0] ?? '{}') as { startTimeTicks: string };
    expect(payload.startTimeTicks).toBe(NEO_TEST_START_TIME_TICKS);
  });

  it('rejects changed bootId when reader would return mismatched second document', async () => {
    const documentA = validDocument();
    const documentB = validDocument({ bootId: '11111111-1111-1111-1111-111111111111' });
    const reader = createSequentialReader([
      { ok: true, document: documentA },
      { ok: true, document: documentB },
    ]);
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    const payload = JSON.parse(lines[0] ?? '{}') as { bootId: string };
    expect(payload.bootId).toBe(NEO_TEST_BOOT_ID);
  });

  it('never becomes ready when schema v1 would appear on a second read', async () => {
    const documentA = validDocument();
    const reader = createSequentialReader([
      { ok: true, document: documentA },
      { ok: false, reason: 'legacy-unbound' },
    ]);
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('never becomes ready when malformed v2 would appear on a second read', async () => {
    const documentA = validDocument();
    const reader = createSequentialReader([
      { ok: true, document: documentA },
      { ok: false, reason: 'invalid' },
    ]);
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('wait-ready emits the exact verified document from the successful poll', async () => {
    const documentA = validDocument({ startedAtUtc: '2026-08-03T10:00:00.000Z' });
    const documentB = validDocument({ startedAtUtc: '2026-08-03T11:00:00.000Z' });
    const reader = createSequentialReader([
      { ok: false, reason: 'absent' },
      { ok: true, document: documentA },
      { ok: true, document: documentB },
    ]);
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT, '--wait-ready', '--timeout-ms', '1000'],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      ready: true,
      startedAtUtc: '2026-08-03T10:00:00.000Z',
    });
  });

  it('preserves exit code mapping for invalid readiness', async () => {
    const reader = createSequentialReader([{ ok: false, reason: 'invalid' }]);
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT, '--wait-ready', '--timeout-ms', '1000'],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_INVALID);
  });

  it('preserves timeout exit code 3', async () => {
    const reader = createSequentialReader([{ ok: false, reason: 'absent' }]);
    let now = 0;
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT, '--wait-ready', '--timeout-ms', '100'],
      reader,
      processInstance: createMatchingProcessInstanceProvider(),
      nowMs: () => {
        now += 50;
        return now;
      },
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_TIMEOUT);
  });

  it('returns boot mismatch for mismatched boot without a second read', async () => {
    const reader = createSequentialReader([{ ok: true, document: validDocument() }]);
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity(), {
        bootId: '22222222-2222-2222-2222-222222222222',
      }),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'process-boot-mismatch',
    });
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('returns identity mismatch for reused pid ticks without a second read', async () => {
    const identity = validReadinessIdentity();
    const reader = createSequentialReader([{ ok: true, document: validDocument() }]);
    const processInstance = createFakeProcessInstanceProvider({
      bootId: identity.bootId,
      self: identity,
      observedByPid: new Map([
        [identity.pid, Object.freeze({ ...identity, state: 'R', startTimeTicks: '999' })],
      ]),
      platformSupported: true,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      argv: ['--execution-root', EXEC_ROOT],
      reader,
      processInstance,
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'process-identity-mismatch',
    });
    expect(reader.read).toHaveBeenCalledTimes(1);
  });
});
