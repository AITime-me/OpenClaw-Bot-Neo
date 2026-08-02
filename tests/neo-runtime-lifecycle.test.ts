import { describe, expect, it } from 'vitest';
import {
  buildNeoRuntimeHealth,
  isTerminalLifecycle,
} from '../src/neo-runtime/neo-runtime-lifecycle.js';
import type { NeoRuntimeLifecycleState } from '../src/neo-runtime/neo-runtime.types.js';

describe('neo runtime lifecycle helpers', () => {
  it('marks runtimeReady only in running', () => {
    const states: NeoRuntimeLifecycleState[] = [
      'new',
      'starting',
      'running',
      'stopping',
      'stopped',
      'failed',
    ];
    for (const lifecycle of states) {
      const health = buildNeoRuntimeHealth({
        lifecycle,
        durableHostOpened: lifecycle === 'running',
      });
      expect(health.runtimeReady).toBe(lifecycle === 'running');
      expect(health.lifecycle).toBe(lifecycle);
      expect(health.stopping).toBe(lifecycle === 'stopping');
      expect(health.failed).toBe(lifecycle === 'failed');
    }
  });

  it('freezes health snapshots', () => {
    const health = buildNeoRuntimeHealth({ lifecycle: 'running', durableHostOpened: true });
    expect(Object.isFrozen(health)).toBe(true);
  });

  it('identifies terminal lifecycle states', () => {
    expect(isTerminalLifecycle('stopped')).toBe(true);
    expect(isTerminalLifecycle('failed')).toBe(true);
    expect(isTerminalLifecycle('running')).toBe(false);
  });
});
