import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNeoReadinessDocument } from '../src/neo-runtime/cli/parse-neo-readiness-document.js';
import { readNeoReadinessFile } from '../src/neo-runtime/cli/read-neo-readiness-file.js';
import {
  NEO_STATUS_EXIT_INVALID,
  NEO_STATUS_EXIT_NOT_READY,
  NEO_STATUS_EXIT_SUCCESS,
  NEO_STATUS_EXIT_TIMEOUT,
  readNeoStatus,
} from '../src/neo-runtime/cli/read-neo-status.js';
import { createNodeNeoReadinessFileReader } from '../src/neo-runtime/cli/read-neo-readiness-file.js';
import {
  createMatchingProcessInstanceProvider,
  fixedIdentity,
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
} from './support/neo-runtime-fixtures.js';

const validReadyPayload = () =>
  JSON.stringify({
    schemaVersion: '2',
    pid: 4242,
    lifecycle: 'running',
    runtimeReady: true,
    durableHostOpened: true,
    startedAtUtc: '2026-08-02T12:00:00.000Z',
    bootId: NEO_TEST_BOOT_ID,
    startTimeTicks: NEO_TEST_START_TIME_TICKS,
  });

const tempRoots: string[] = [];

const createExecutionRoot = (mode = 0o750): string => {
  const root = mkdtempSync(join(tmpdir(), 'neo-readiness-'));
  tempRoots.push(root);
  chmodSync(root, mode);
  return root;
};

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('neo readiness file reader', () => {
  it('returns absent when ready.json is missing in a safe execution root', async () => {
    const executionRoot = createExecutionRoot();
    const result = await readNeoReadinessFile(executionRoot);
    expect(result).toEqual({ ok: false, reason: 'absent' });
  });

  it('returns unreadable when execution root is missing', async () => {
    const executionRoot = join(tmpdir(), 'neo-readiness-missing-root');
    const result = await readNeoReadinessFile(executionRoot);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('parses a valid regular readiness file', async () => {
    const executionRoot = createExecutionRoot();
    writeFileSync(join(executionRoot, 'ready.json'), validReadyPayload(), { mode: 0o600 });
    const result = await readNeoReadinessFile(executionRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe('2');
    expect(result.document.runtimeReady).toBe(true);
    expect(result.document.bootId).toBe(NEO_TEST_BOOT_ID);
  });

  it('rejects unknown readiness fields', () => {
    const parsed = parseNeoReadinessDocument({
      schemaVersion: '2',
      pid: 1,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: '2026-08-02T12:00:00.000Z',
      bootId: NEO_TEST_BOOT_ID,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
      extra: true,
    });
    expect(parsed.ok).toBe(false);
  });

  it('returns legacy-unbound for schema v1', async () => {
    const executionRoot = createExecutionRoot();
    writeFileSync(
      join(executionRoot, 'ready.json'),
      JSON.stringify({
        schemaVersion: '1',
        pid: 4242,
        lifecycle: 'running',
        runtimeReady: true,
        durableHostOpened: true,
        startedAtUtc: '2026-08-02T12:00:00.000Z',
      }),
      { mode: 0o600 },
    );
    const result = await readNeoReadinessFile(executionRoot);
    expect(result).toEqual({ ok: false, reason: 'legacy-unbound' });
  });

  it('returns invalid for malformed readiness schema', async () => {
    const executionRoot = createExecutionRoot();
    writeFileSync(join(executionRoot, 'ready.json'), '{"schemaVersion":"9"}', { mode: 0o600 });
    const result = await readNeoReadinessFile(executionRoot);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it.skipIf(process.platform === 'win32')(
    'returns unreadable for readiness leaf symlink',
    async () => {
      const executionRoot = createExecutionRoot();
      const target = join(executionRoot, 'ready-target.json');
      writeFileSync(target, validReadyPayload(), { mode: 0o600 });
      symlinkSync(target, join(executionRoot, 'ready.json'));
      const result = await readNeoReadinessFile(executionRoot);
      expect(result).toEqual({ ok: false, reason: 'unreadable' });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'returns unreadable when an ancestor is a symlink',
    async () => {
      const parent = createExecutionRoot();
      const linked = join(parent, 'linked-root');
      mkdirSync(linked, { mode: 0o750 });
      symlinkSync(linked, join(parent, 'exec-link'));
      const executionRoot = join(parent, 'exec-link');
      const result = await readNeoReadinessFile(executionRoot);
      expect(result).toEqual({ ok: false, reason: 'unreadable' });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not treat permission errors as absent readiness',
    async () => {
      const executionRoot = createExecutionRoot(0o750);
      writeFileSync(join(executionRoot, 'ready.json'), validReadyPayload(), { mode: 0o600 });
      chmodSync(executionRoot, 0o000);
      const result = await readNeoReadinessFile(executionRoot);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).not.toBe('absent');
      chmodSync(executionRoot, 0o750);
    },
  );
});

describe('neo status wait-ready with production reader', () => {
  it('polls through absent readiness and succeeds when ready.json appears', async () => {
    const executionRoot = createExecutionRoot();
    let now = 0;
    const waitPromise = readNeoStatus({
      argv: ['--execution-root', executionRoot, '--wait-ready', '--timeout-ms', '1000'],
      reader: createNodeNeoReadinessFileReader(),
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity()),
      nowMs: () => now,
      sleep: async (ms) => {
        await Promise.resolve();
        now += ms;
        if (now >= 200) {
          writeFileSync(join(executionRoot, 'ready.json'), validReadyPayload(), { mode: 0o600 });
        }
      },
      writeStdout: () => undefined,
    });
    const result = await waitPromise;
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
  });

  it('returns timeout exit 3 when readiness stays absent', async () => {
    const executionRoot = createExecutionRoot();
    const sleepCalls: number[] = [];
    let now = 0;
    const result = await readNeoStatus({
      argv: ['--execution-root', executionRoot, '--wait-ready', '--timeout-ms', '250'],
      reader: createNodeNeoReadinessFileReader(),
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity()),
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
  });

  it('returns invalid exit 2 immediately for invalid readiness schema', async () => {
    const executionRoot = createExecutionRoot();
    writeFileSync(join(executionRoot, 'ready.json'), '{"schemaVersion":"9"}', { mode: 0o600 });
    const result = await readNeoStatus({
      argv: ['--execution-root', executionRoot, '--wait-ready', '--timeout-ms', '1000'],
      reader: createNodeNeoReadinessFileReader(),
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity()),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_INVALID);
  });

  it('returns not-ready exit 1 for absent readiness without wait flag', async () => {
    const executionRoot = createExecutionRoot();
    const result = await readNeoStatus({
      argv: ['--execution-root', executionRoot],
      reader: createNodeNeoReadinessFileReader(),
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity()),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
  });
});
