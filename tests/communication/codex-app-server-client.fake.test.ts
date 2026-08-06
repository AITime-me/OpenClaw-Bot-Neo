import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCapabilityProbeOnTransport } from '../../src/communication/adapters/codex-app-server/codex-app-server-client.js';
import {
  createFakeCodexAppServerTransport,
  type FakeCodexAppServerScenario,
} from '../../src/communication/adapters/codex-app-server/fake/fake-codex-app-server.js';

const probeCwd = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'neo-fake-contour-'));
  return join(root, 'cwd');
};

const run = async (scenario: FakeCodexAppServerScenario, abort?: AbortSignal) => {
  const fake = createFakeCodexAppServerTransport(scenario);
  const cwd = probeCwd();
  const signal =
    abort ??
    (scenario.startsWith('abort') || scenario === 'delayed-stdin-write'
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
  if (scenario === 'delayed-stdin-write') {
    setTimeout(() => {
      fake.controller.triggerAbort();
    }, 20);
  }
  const result = await runCapabilityProbeOnTransport({
    transport: fake.transport,
    abortSignal: signal,
    probeCwd: cwd,
    readableRoots: [cwd],
    timeouts: {
      preflightTimeoutMs: 200,
      threadStartTimeoutMs: 200,
      turnTimeoutMs: 200,
      exitWaitMs: 20,
      termGraceMs: 20,
      closeBudgetMs: 80,
      unsubscribeBudgetMs: 40,
      interruptBudgetMs: 40,
      totalActiveCleanupBudgetMs: 200,
      reapBudgetMs: 20,
    },
  });
  return { result, fake, cwd };
};

describe('codex-app-server client fake matrix', () => {
  it('happy-path returns completed exact ok:true with official nested frames', async () => {
    const { result, fake } = await run('happy-path');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value).toEqual({
      kind: 'completed',
      outcome: 'completed',
      text: '{"ok":true}',
    });
    expect(fake.controller.rpcTrace).toContain('account/read');
    expect(fake.controller.rpcTrace).toContain('turn/interrupt');
  });

  it('places sandboxPolicy only on turn/start with probe cwd readable roots', async () => {
    const { result, fake, cwd } = await run('happy-path');
    expect(result.kind).toBe('result');
    const threadParams = fake.controller.threadStartParams[0] as Record<string, unknown>;
    const turnParams = fake.controller.turnStartParams[0] as Record<string, unknown>;
    expect(threadParams.sandboxPolicy).toBeUndefined();
    expect(threadParams.cwd).toBe(cwd);
    expect(turnParams.sandboxPolicy).toEqual({
      type: 'readOnly',
      access: {
        type: 'restricted',
        includePlatformDefaults: false,
        readableRoots: [cwd],
      },
    });
    expect(
      (turnParams.sandboxPolicy as { access: { readableRoots: string[] } }).access.readableRoots,
    ).not.toContain(join(cwd, '..'));
  });

  it('maps nested account null / non-chatgpt uniquely', async () => {
    const nullAccount = await run('account-null');
    expect(nullAccount.result.kind).toBe('result');
    if (nullAccount.result.kind === 'result')
      expect(nullAccount.result.value.outcome).toBe('provider-unavailable');

    const nonChat = await run('non-chatgpt-auth');
    expect(nonChat.result.kind).toBe('result');
    if (nonChat.result.kind === 'result')
      expect(nonChat.result.value.outcome).toBe('policy-rejected');
  });

  it('maps config allowlist / modelProvider / model / quota official shapes', async () => {
    for (const scenario of [
      'effective-config-violation',
      'unknown-config-key',
      'empty-models',
      'multiple-models',
      'unsupported-models',
      'wrong-model-provider',
    ] as const) {
      const { result } = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('policy-rejected');
    }
    const quota = await run('quota-exhausted');
    expect(quota.result.kind).toBe('result');
    if (quota.result.kind === 'result')
      expect(quota.result.value.outcome).toBe('quota-unavailable');
  });

  it('rejects unknown/late/duplicate ids, typed id mismatch, and result+error', async () => {
    for (const scenario of [
      'duplicate-response-id',
      'late-response',
      'result-and-error',
      'unknown-response-id',
      'typed-id-mismatch',
    ] as const) {
      const { result } = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('provider-unavailable');
    }
  });

  it('rejects server requests and forbidden item types with exact policy-rejected', async () => {
    for (const scenario of [
      'server-request-before-dispatch',
      'server-request-after-dispatch',
      'forbidden-item-command',
      'forbidden-item-file',
      'forbidden-item-web',
      'forbidden-item-mcp',
      'web-event-after-dispatch',
      'file-event-after-dispatch',
      'shell-event-after-dispatch',
      'mcp-event-after-dispatch',
      'model-rerouted',
    ] as const) {
      const { result } = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('policy-rejected');
    }
  });

  it('rejects failed/interrupted turns, wrong ids, and wrong event order', async () => {
    for (const scenario of [
      'turn-failed',
      'turn-interrupted',
      'wrong-turn-id',
      'wrong-thread-id',
      'wrong-event-order',
    ] as const) {
      const { result } = await run(scenario);
      expect(result.kind).toBe('result');
      if (result.kind !== 'result') return;
      expect(result.value.outcome, scenario).toBe('outcome-unknown');
    }
  });

  it('records exact cleanup RPC traces and interrupt ids after protocol failure', async () => {
    const active = await run('invalid-output');
    expect(active.fake.controller.rpcTrace.filter((m) => m === 'turn/interrupt').length).toBe(1);
    expect(active.fake.controller.rpcTrace.filter((m) => m === 'thread/unsubscribe').length).toBe(
      1,
    );
    expect(active.fake.controller.interruptParams[0]).toEqual({
      threadId: 'thr_fake_1',
      turnId: 'turn_1',
    });

    const protocolFail = await run('protocol-failure-cleanup');
    expect(protocolFail.result.kind).toBe('result');
    if (protocolFail.result.kind === 'result')
      expect(protocolFail.result.value.outcome).toBe('outcome-unknown');
    expect(protocolFail.fake.controller.rpcTrace).toContain('turn/interrupt');
    expect(protocolFail.fake.controller.interruptParams[0]).toEqual({
      threadId: 'thr_fake_1',
      turnId: 'turn_1',
    });
    expect(
      JSON.stringify(protocolFail.fake.controller.interruptParams).includes('"turnId":null'),
    ).toBe(false);

    const threadOnly = await run('cleanup-thread-no-dispatch');
    expect(threadOnly.fake.controller.rpcTrace.includes('turn/start')).toBe(false);
    expect(threadOnly.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(true);
    expect(threadOnly.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
  });

  it('maps abort/timeout/crash/malformed by dispatch boundary', async () => {
    const before = await run('abort-before-dispatch');
    expect(before.result.kind).toBe('result');
    if (before.result.kind === 'result')
      expect(before.result.value.outcome).toBe('cancelled-before-invocation');

    const after = await run('abort-after-dispatch');
    expect(after.result.kind).toBe('result');
    if (after.result.kind === 'result') expect(after.result.value.outcome).toBe('outcome-unknown');

    const delayed = await run('delayed-stdin-write');
    expect(delayed.result.kind).toBe('result');
    if (delayed.result.kind === 'result')
      expect(delayed.result.value.outcome).toBe('outcome-unknown');

    const malformedBefore = await run('malformed-before-dispatch');
    expect(malformedBefore.result.kind).toBe('result');
    if (malformedBefore.result.kind === 'result')
      expect(malformedBefore.result.value.outcome).toBe('provider-unavailable');

    const crash = await run('crash-after-dispatch');
    expect(crash.result.kind).toBe('result');
    if (crash.result.kind === 'result') expect(crash.result.value.outcome).toBe('outcome-unknown');
  });

  it('maps stdin write failure before dispatch', async () => {
    const { result } = await run('stdin-write-fail');
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.value.outcome).toBe('provider-unavailable');
  });

  it('maps initialize/thread-start timeout to known-timeout', async () => {
    const init = await run('initialize-timeout');
    expect(init.result.kind).toBe('result');
    if (init.result.kind === 'result') expect(init.result.value.outcome).toBe('known-timeout');
  });
});
