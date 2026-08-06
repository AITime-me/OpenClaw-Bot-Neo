import { describe, expect, it } from 'vitest';
import { runCapabilityProbeOnTransport } from '../../src/communication/adapters/codex-app-server/codex-app-server-client.js';
import {
  createFakeCodexAppServerTransport,
  type FakeCodexAppServerScenario,
} from '../../src/communication/adapters/codex-app-server/fake/fake-codex-app-server.js';

const run = async (scenario: FakeCodexAppServerScenario, abort?: AbortSignal) => {
  const fake = createFakeCodexAppServerTransport(scenario);
  const signal =
    abort ??
    (scenario.startsWith('abort') || scenario === 'cleanup-thread-no-dispatch'
      ? fake.getAbortSignal()
      : null);
  if (scenario === 'abort-before-dispatch') {
    fake.controller.triggerAbort();
  }
  if (scenario === 'abort-after-dispatch') {
    setTimeout(() => {
      fake.controller.triggerAbort();
    }, 20);
  }
  return runCapabilityProbeOnTransport({
    transport: fake.transport,
    abortSignal: signal,
    timeouts: {
      preflightTimeoutMs: 200,
      threadStartTimeoutMs: 200,
      turnTimeoutMs: 200,
      exitWaitMs: 20,
      termGraceMs: 20,
      closeBudgetMs: 100,
      unsubscribeBudgetMs: 100,
      interruptBudgetMs: 100,
      totalActiveCleanupBudgetMs: 200,
      reapBudgetMs: 20,
    },
  });
};

describe('codex-app-server client fake matrix', () => {
  it('happy-path returns completed exact ok:true', async () => {
    const result = await run('happy-path');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value).toEqual({
      kind: 'completed',
      outcome: 'completed',
      text: '{"ok":true}',
    });
  });

  it('maps account null to provider-unavailable', async () => {
    const result = await run('account-null');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('provider-unavailable');
  });

  it('maps non-chatgpt auth to policy-rejected', async () => {
    const result = await run('non-chatgpt-auth');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('policy-rejected');
  });

  it('maps config violation and model discovery failures to policy-rejected', async () => {
    for (const scenario of [
      'effective-config-violation',
      'empty-models',
      'multiple-models',
      'unsupported-models',
    ] as const) {
      const result = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('policy-rejected');
    }
  });

  it('maps quota exhaustion uniquely', async () => {
    const result = await run('quota-exhausted');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('quota-unavailable');
  });

  it('treats model/rerouted as post-dispatch policy-rejected', async () => {
    const result = await run('model-rerouted');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('policy-rejected');
  });

  it('maps forbidden post-dispatch events to policy-rejected', async () => {
    for (const scenario of [
      'web-event-after-dispatch',
      'file-event-after-dispatch',
      'shell-event-after-dispatch',
      'mcp-event-after-dispatch',
    ] as const) {
      const result = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('policy-rejected');
    }
  });

  it('maps abort before dispatch and post-dispatch uncertainty', async () => {
    const before = await run('abort-before-dispatch');
    expect(before.kind).toBe('result');
    if (before.kind === 'result') expect(before.value.outcome).toBe('cancelled-before-invocation');

    const after = await run('abort-after-dispatch');
    expect(after.kind).toBe('result');
    if (after.kind === 'result') expect(after.value.outcome).toBe('outcome-unknown');
  });

  it('maps malformed frames by dispatch boundary', async () => {
    const before = await run('malformed-before-dispatch');
    expect(before.kind).toBe('result');
    if (before.kind === 'result') expect(before.value.outcome).toBe('provider-unavailable');

    const after = await run('malformed-after-dispatch');
    expect(after.kind).toBe('result');
    if (after.kind === 'result') expect(after.value.outcome).toBe('outcome-unknown');
  });

  it('maps crash/timeout after dispatch to outcome-unknown', async () => {
    const crash = await run('crash-after-dispatch');
    expect(crash.kind).toBe('result');
    if (crash.kind === 'result') expect(crash.value.outcome).toBe('outcome-unknown');

    const timeout = await run('timeout-after-dispatch');
    expect(timeout.kind).toBe('result');
    if (timeout.kind === 'result') expect(timeout.value.outcome).toBe('outcome-unknown');
  });

  it('maps initialize/thread-start timeout to known-timeout', async () => {
    const init = await run('initialize-timeout');
    expect(init.kind).toBe('result');
    if (init.kind === 'result') expect(init.value.outcome).toBe('known-timeout');

    const thread = await run('thread-start-timeout');
    expect(thread.kind).toBe('result');
    if (thread.kind === 'result') expect(thread.value.outcome).toBe('known-timeout');
  });

  it('maps invalid output to invalid-response', async () => {
    const result = await run('invalid-output');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('invalid-response');
  });

  it('covers Decision 16 cleanup scenarios without changing classified outcome', async () => {
    for (const scenario of [
      'cleanup-spawned-no-thread',
      'cleanup-thread-no-dispatch',
      'cleanup-active-turn',
      'cleanup-child-crashed',
    ] as const) {
      const result = await run(scenario);
      expect(result.kind, scenario).toBe('result');
    }
  });
});
