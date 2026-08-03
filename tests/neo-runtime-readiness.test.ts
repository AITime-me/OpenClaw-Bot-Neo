import { describe, expect, it } from 'vitest';
import { createInMemoryNeoRuntimeReadinessPort } from '../src/neo-runtime/readiness/neo-runtime-readiness-file.js';
import {
  fixedIdentity,
  NEO_TEST_BOOT_ID,
  NEO_TEST_PATHS,
  NEO_TEST_START_TIME_TICKS,
} from './support/neo-runtime-fixtures.js';

describe('neo runtime readiness file', () => {
  it('publishes bounded readiness snapshot without secrets or config', async () => {
    const port = createInMemoryNeoRuntimeReadinessPort();
    const identity = fixedIdentity();
    await port.publish(NEO_TEST_PATHS.executionRoot, {
      schemaVersion: '2',
      pid: identity.pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: identity.nowUtcIso(),
      bootId: NEO_TEST_BOOT_ID,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
    });
    expect(port.state.published).not.toBeNull();
    const serialized = port.state.tempWrites[0] ?? '';
    expect(serialized).toContain('"schemaVersion":"2"');
    expect(serialized).toContain('"bootId"');
    expect(serialized).toContain('"startTimeTicks"');
    expect(serialized).not.toMatch(/password|token|secret|storageRoot|\/var\//i);
    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: '2',
      pid: identity.pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: identity.nowUtcIso(),
      bootId: NEO_TEST_BOOT_ID,
      startTimeTicks: NEO_TEST_START_TIME_TICKS,
    });
  });

  it('removeStale and remove are idempotent', async () => {
    const port = createInMemoryNeoRuntimeReadinessPort();
    await port.removeStale(NEO_TEST_PATHS.executionRoot);
    await port.removeStale(NEO_TEST_PATHS.executionRoot);
    await port.remove(NEO_TEST_PATHS.executionRoot);
    await port.remove(NEO_TEST_PATHS.executionRoot);
    expect(port.state.removed).toBeGreaterThanOrEqual(2);
    expect(port.state.published).toBeNull();
  });
});
