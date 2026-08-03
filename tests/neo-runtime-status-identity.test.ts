import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNeoStatus } from '../src/neo-runtime/cli/read-neo-status.js';
import {
  NEO_STATUS_EXIT_NOT_READY,
  NEO_STATUS_EXIT_SUCCESS,
} from '../src/neo-runtime/cli/read-neo-status.js';
import { createInMemoryNeoReadinessFileReader } from '../src/neo-runtime/cli/read-neo-readiness-file.js';
import { createFakeProcessInstanceProvider } from '../src/neo-runtime/process-identity/fake-process-instance-provider.js';
import {
  createMatchingProcessInstanceProvider,
  fixedIdentity,
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
  validReadinessIdentity,
} from './support/neo-runtime-fixtures.js';
import { runNeoProcess } from '../src/neo-runtime/cli/run-neo-process.js';
import {
  createRunNeoProcessDeps,
  createSuccessfulMockRuntime,
} from './support/neo-runtime-fixtures.js';

const isWindows = process.platform === 'win32';
const EXEC_ROOT = isWindows ? 'C:\\neo-status\\exec' : '/neo-status/exec';

const validDocument = () => {
  const identity = fixedIdentity();
  return Object.freeze({
    schemaVersion: '2' as const,
    pid: identity.pid,
    lifecycle: 'running' as const,
    runtimeReady: true as const,
    durableHostOpened: true as const,
    startedAtUtc: identity.nowUtcIso(),
    bootId: NEO_TEST_BOOT_ID,
    startTimeTicks: NEO_TEST_START_TIME_TICKS,
  });
};

const statusDeps = (
  files: Readonly<Record<string, ReturnType<typeof validDocument> | null>>,
  processInstance = createMatchingProcessInstanceProvider(),
) => ({
  argv: ['--execution-root', EXEC_ROOT] as const,
  reader: createInMemoryNeoReadinessFileReader(files),
  processInstance,
  nowMs: () => 0,
  sleep: async () => {
    await Promise.resolve();
  },
  writeStdout: () => undefined,
});

describe('neo status process identity verification', () => {
  it('returns ready when boot, pid, ticks and state match', async () => {
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_SUCCESS);
    const payload = JSON.parse(lines[0] ?? '{}') as { ready: boolean };
    expect(payload.ready).toBe(true);
  });

  it('returns absent when readiness is missing', async () => {
    const result = await readNeoStatus(statusDeps({}));
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
  });

  it('returns process-absent when pid is not live', async () => {
    const identity = validReadinessIdentity();
    const processInstance = createFakeProcessInstanceProvider({
      bootId: identity.bootId,
      self: identity,
      observedByPid: new Map([[identity.pid, { kind: 'absent' }]]),
      platformSupported: true,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ready: false, reason: 'process-absent' });
  });

  it('returns identity mismatch when ticks differ', async () => {
    const identity = validReadinessIdentity();
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
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'process-identity-mismatch',
    });
  });

  it('returns boot mismatch when boot id differs', async () => {
    const processInstance = createMatchingProcessInstanceProvider(fixedIdentity(), {
      bootId: '11111111-1111-1111-1111-111111111111',
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ready: false, reason: 'process-boot-mismatch' });
  });

  it('returns process-zombie for zombie state', async () => {
    const identity = validReadinessIdentity();
    const processInstance = createFakeProcessInstanceProvider({
      bootId: identity.bootId,
      self: identity,
      observedByPid: new Map([[identity.pid, { kind: 'zombie' }]]),
      platformSupported: true,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ready: false, reason: 'process-zombie' });
  });

  it('returns process-zombie for dead state X', async () => {
    const identity = validReadinessIdentity();
    const processInstance = createFakeProcessInstanceProvider({
      bootId: identity.bootId,
      self: identity,
      observedByPid: new Map([
        [
          identity.pid,
          Object.freeze({
            ...identity,
            state: 'X',
          }),
        ],
      ]),
      platformSupported: true,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ready: false, reason: 'process-zombie' });
  });

  it('returns unavailable when procfs probe fails', async () => {
    const identity = validReadinessIdentity();
    const processInstance = createFakeProcessInstanceProvider({
      bootId: identity.bootId,
      self: identity,
      observedByPid: new Map([[identity.pid, { kind: 'unavailable' }]]),
      platformSupported: true,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'process-identity-unavailable',
    });
  });

  it('returns unavailable on unsupported platform provider', async () => {
    const processInstance = createMatchingProcessInstanceProvider(fixedIdentity(), {
      platformSupported: false,
    });
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({ [EXEC_ROOT]: validDocument() }, processInstance),
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'process-identity-unavailable',
    });
  });

  it('never returns ready for schema v1', async () => {
    const lines: string[] = [];
    const result = await readNeoStatus({
      ...statusDeps({}),
      argv: ['--execution-root', EXEC_ROOT],
      reader: {
        read: () => Promise.resolve({ ok: false as const, reason: 'legacy-unbound' as const }),
      },
      writeStdout: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(NEO_STATUS_EXIT_NOT_READY);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ready: false,
      reason: 'readiness-legacy-unbound',
    });
  });
});

describe('neo status read-only guarantee', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not modify readiness after failed liveness verification', async () => {
    const executionRoot = mkdtempSync(join(tmpdir(), 'neo-status-readonly-'));
    tempRoots.push(executionRoot);
    chmodSync(executionRoot, 0o750);
    const payload = JSON.stringify(validDocument());
    const readyPath = join(executionRoot, 'ready.json');
    writeFileSync(readyPath, payload, { mode: 0o600 });
    const before = readFileSync(readyPath, 'utf8');

    const { createNodeNeoReadinessFileReader } =
      await import('../src/neo-runtime/cli/read-neo-readiness-file.js');
    await readNeoStatus({
      argv: ['--execution-root', executionRoot],
      reader: createNodeNeoReadinessFileReader(),
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity(), {
        bootId: '22222222-2222-2222-2222-222222222222',
      }),
      nowMs: () => 0,
      sleep: async () => {
        await Promise.resolve();
      },
      writeStdout: () => undefined,
    });

    expect(readFileSync(readyPath, 'utf8')).toBe(before);
  });
});

describe('neo readiness publisher identity capture', () => {
  it('includes valid identity in published v2 readiness', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, signals } = createRunNeoProcessDeps({ createRuntime: () => runtime });
    const runPromise = runNeoProcess(deps);
    await vi.waitFor(() => {
      expect(readiness.state.published).not.toBeNull();
    });
    expect(readiness.state.published?.schemaVersion).toBe('2');
    expect(readiness.state.published?.bootId).toBe(NEO_TEST_BOOT_ID);
    expect(readiness.state.published?.startTimeTicks).toBe(NEO_TEST_START_TIME_TICKS);
    signals.emitSignal('SIGTERM');
    await runPromise;
  });

  it('prevents publish when identity capture fails', async () => {
    const { runtime } = createSuccessfulMockRuntime();
    const { deps, readiness, log } = createRunNeoProcessDeps({
      createRuntime: () => runtime,
      processInstance: createMatchingProcessInstanceProvider(fixedIdentity(), {
        platformSupported: false,
      }),
    });
    await runNeoProcess(deps);
    expect(readiness.state.published).toBeNull();
    expect(log.events.some((event) => event.event === 'neo.runtime.ready')).toBe(false);
  });
});
