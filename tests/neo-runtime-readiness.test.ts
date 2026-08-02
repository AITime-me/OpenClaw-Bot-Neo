import { describe, expect, it } from 'vitest';
import { createInMemoryNeoRuntimeReadinessPort } from '../src/neo-runtime/readiness/neo-runtime-readiness-file.js';
import { NEO_TEST_PATHS, fixedIdentity } from './support/neo-runtime-fixtures.js';

describe('neo runtime readiness file', () => {
  it('publishes bounded readiness snapshot without secrets or config', async () => {
    const port = createInMemoryNeoRuntimeReadinessPort();
    const identity = fixedIdentity();
    await port.publish(NEO_TEST_PATHS.executionRoot, {
      schemaVersion: '1',
      pid: identity.pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: identity.nowUtcIso(),
    });
    expect(port.state.published).not.toBeNull();
    const serialized = port.state.tempWrites[0] ?? '';
    expect(serialized).toContain('"schemaVersion":"1"');
    expect(serialized).not.toMatch(/password|token|secret|storageRoot|\/var\//i);
    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: '1',
      pid: identity.pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: identity.nowUtcIso(),
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
