import fs from 'node:fs';
import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  createNodeReadinessTempOpenDriver,
  createNodeReadinessTempOpenDriverWithPrimitives,
  type ReadinessTempOpenDriverPrimitives,
} from '../src/neo-runtime/readiness/readiness-temp-open-driver.js';
import {
  createNodeNeoRuntimeReadinessPort,
  createNodeNeoRuntimeReadinessPortWithTempDriver,
  NEO_READINESS_FILENAME,
  NEO_READINESS_TEMP_MAX_ATTEMPTS,
} from '../src/neo-runtime/readiness/neo-runtime-readiness-file.js';
import {
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
  fixedIdentity,
} from './support/neo-runtime-fixtures.js';

const BASE_CONSTANTS = Object.freeze({
  O_WRONLY: fs.constants.O_WRONLY,
  O_CREAT: fs.constants.O_CREAT,
  O_EXCL: fs.constants.O_EXCL,
  O_NOFOLLOW: typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0,
});

const snapshot = () => {
  const identity = fixedIdentity();
  return {
    schemaVersion: '2' as const,
    pid: identity.pid,
    lifecycle: 'running' as const,
    runtimeReady: true as const,
    durableHostOpened: true as const,
    startedAtUtc: identity.nowUtcIso(),
    bootId: NEO_TEST_BOOT_ID,
    startTimeTicks: NEO_TEST_START_TIME_TICKS,
  };
};

const isLinux = process.platform === 'linux';
const canSymlink = isLinux || process.platform === 'darwin';

const createCapturingTempDriver = (
  overrides: Partial<ReadinessTempOpenDriverPrimitives> & {
    readonly onOpen?: (path: string) => void;
    readonly failOpens?: number;
  } = {},
) => {
  let openAttempts = 0;
  const openedPaths: string[] = [];
  const platform = overrides.platform ?? process.platform;
  const primitives: ReadinessTempOpenDriverPrimitives = {
    platform,
    constants: overrides.constants ?? BASE_CONSTANTS,
    open:
      overrides.open ??
      (async (path, flags, mode) => {
        openAttempts += 1;
        overrides.onOpen?.(path);
        if (overrides.failOpens !== undefined && openAttempts <= overrides.failOpens) {
          const error = new Error('exists');
          Object.defineProperty(error, 'code', { value: 'EEXIST' });
          throw error;
        }
        openedPaths.push(path);
        const fsp = await import('node:fs/promises');
        return fsp.open(path, flags, mode);
      }),
  };
  const driver = createNodeReadinessTempOpenDriverWithPrimitives(primitives);
  const port = createNodeNeoRuntimeReadinessPortWithTempDriver(driver);
  return { port, openedPaths, driver };
};

describe('neo runtime readiness exclusive temp publication (R6-L02)', () => {
  it('retries when pre-existing candidate temp file exists and succeeds with new suffix', async () => {
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-temp-'));
    const preExisting = join(executionRoot, '.ready-preexisting.tmp');
    writeFileSync(preExisting, 'stale', { mode: 0o600 });
    const { port, openedPaths } = createCapturingTempDriver({ failOpens: 1 });
    const result = await port.publish(executionRoot, snapshot());
    expect(result.ok).toBe(true);
    expect(openedPaths.length).toBe(1);
    expect(openedPaths[0]).not.toBe(preExisting);
    expect(readFileSync(join(executionRoot, NEO_READINESS_FILENAME), 'utf8')).toContain(
      'schemaVersion',
    );
    expect(readFileSync(preExisting, 'utf8')).toBe('stale');
  });

  it('does not follow or truncate a pre-existing symlink candidate', async () => {
    if (!canSymlink) return;
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-symlink-'));
    const outside = join(tmpdir(), `neo-ready-outside-${String(Date.now())}.json`);
    writeFileSync(outside, 'outside', { mode: 0o600 });
    const candidate = join(executionRoot, '.ready-symlink.tmp');
    symlinkSync(outside, candidate);
    const port = createNodeNeoRuntimeReadinessPort();
    const result = await port.publish(executionRoot, snapshot());
    expect(result.ok).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe('outside');
    expect(existsSync(join(executionRoot, NEO_READINESS_FILENAME))).toBe(true);
  });

  it('fails honestly when bounded retry exhaustion occurs', async () => {
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-exhaust-'));
    const { port } = createCapturingTempDriver({
      failOpens: NEO_READINESS_TEMP_MAX_ATTEMPTS,
    });
    const result = await port.publish(executionRoot, snapshot());
    expect(result.ok).toBe(false);
    expect(existsSync(join(executionRoot, NEO_READINESS_FILENAME))).toBe(false);
  });

  it('creates temp files with mode 0600 and final ready.json atomically', async () => {
    if (!isLinux) return;
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-mode-'));
    const port = createNodeNeoRuntimeReadinessPort();
    const result = await port.publish(executionRoot, snapshot());
    expect(result.ok).toBe(true);
    const readyPath = join(executionRoot, NEO_READINESS_FILENAME);
    expect(statSync(readyPath).mode & 0o777).toBe(0o600);
  });

  it('cleans up only publisher-owned temp on failure', async () => {
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-cleanup-'));
    const attacker = join(executionRoot, '.ready-attacker.tmp');
    writeFileSync(attacker, 'owned-by-attacker', { mode: 0o600 });
    let ownedPath: string | undefined;
    const { port } = createCapturingTempDriver({
      open: async (path, flags, mode) => {
        const fsp = await import('node:fs/promises');
        const handle = await fsp.open(path, flags, mode);
        ownedPath = path;
        return Object.assign(handle, {
          write: () => Promise.reject(new Error('write failed')),
        });
      },
    });
    const result = await port.publish(executionRoot, snapshot());
    expect(result.ok).toBe(false);
    expect(readFileSync(attacker, 'utf8')).toBe('owned-by-attacker');
    if (ownedPath !== undefined) {
      expect(existsSync(ownedPath)).toBe(false);
    }
    expect(existsSync(join(executionRoot, NEO_READINESS_FILENAME))).toBe(false);
  });

  it('uses collision-resistant suffixes instead of pid-only names', async () => {
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-ready-suffix-'));
    const { port, openedPaths } = createCapturingTempDriver();
    await port.publish(executionRoot, snapshot());
    const suffix = openedPaths[0]?.replace(/\\/g, '/');
    expect(suffix).toMatch(/\.ready-[0-9a-f]{32}\.tmp$/);
    expect(suffix).not.toMatch(/\.ready-\d+\.tmp$/);
  });

  it('Windows seam does not claim POSIX no-follow enforcement', () => {
    if (process.platform === 'linux') return;
    const driver = createNodeReadinessTempOpenDriver();
    expect(driver.requiresNoFollow).toBe(false);
  });
});
