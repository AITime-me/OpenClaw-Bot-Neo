import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { applyRestrictiveProcessUmask } from '../src/neo-runtime/cli/apply-restrictive-process-umask.js';
import { createNodeNeoRuntimeReadinessPort } from '../src/neo-runtime/readiness/neo-runtime-readiness-file.js';
import {
  NEO_TEST_BOOT_ID,
  NEO_TEST_START_TIME_TICKS,
  fixedIdentity,
} from './support/neo-runtime-fixtures.js';

const isLinux = process.platform === 'linux';

describe('neo runtime owner-only state permissions (R6-L04)', () => {
  it('does not claim POSIX umask enforcement on non-Linux platforms', () => {
    if (isLinux) return;
    const before = process.umask(0o022);
    applyRestrictiveProcessUmask();
    expect(process.umask(before)).toBe(before);
  });

  it('readiness final file is published with mode 0600 on Linux', async () => {
    if (!isLinux) return;
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-perm-ready-'));
    const port = createNodeNeoRuntimeReadinessPort();
    const identity = fixedIdentity();
    const result = await port.publish(executionRoot, {
      schemaVersion: '2',
      pid: identity.pid,
      lifecycle: 'running',
      runtimeReady: true as const,
      durableHostOpened: true as const,
      startedAtUtc: identity.nowUtcIso(),
      bootId: NEO_TEST_BOOT_ID,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
    });
    expect(result.ok).toBe(true);
    const readyPath = join(executionRoot, 'ready.json');
    expect(statSync(readyPath).mode & 0o777).toBe(0o600);
  });

  it('app-managed directories are owner-only under restrictive umask on Linux', () => {
    if (!isLinux) return;
    const before = process.umask(0o077);
    const root = join(tmpdir(), `neo-umask-${String(Date.now())}`);
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o700);
    const nested = join(root, 'nested');
    mkdirSync(nested);
    expect(statSync(nested).mode & 0o077).toBe(0);
    process.umask(before);
  });

  it('does not widen modes when reopening readiness on Linux', async () => {
    if (!isLinux) return;
    const executionRoot = await mkdtemp(join(tmpdir(), 'neo-perm-reopen-'));
    const port = createNodeNeoRuntimeReadinessPort();
    const identity = fixedIdentity();
    const payload = {
      schemaVersion: '2' as const,
      pid: identity.pid,
      lifecycle: 'running' as const,
      runtimeReady: true as const,
      durableHostOpened: true as const,
      startedAtUtc: identity.nowUtcIso(),
      bootId: NEO_TEST_BOOT_ID,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
    };
    await port.publish(executionRoot, payload);
    const readyPath = join(executionRoot, 'ready.json');
    chmodSync(readyPath, 0o600);
    await port.remove(executionRoot);
    await port.publish(executionRoot, payload);
    expect(statSync(readyPath).mode & 0o777).toBe(0o600);
  });
});
