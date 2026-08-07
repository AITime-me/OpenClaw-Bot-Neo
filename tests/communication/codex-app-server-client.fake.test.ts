import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCapabilityProbeOnTransport } from '../../src/communication/adapters/codex-app-server/codex-app-server-client.js';
import {
  createFakeCodexAppServerTransport,
  type FakeCodexAppServerScenario,
} from '../../src/communication/adapters/codex-app-server/fake/fake-codex-app-server.js';
import {
  buildIsolatedProbeContour,
  readableRootsForProbe,
  validateModelReadableRoots,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-isolation.js';

const probeCwd = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'neo-fake-contour-'));
  return join(root, 'cwd');
};

const shortTimeouts = {
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
} as const;

const expectOutcome = (
  result: Awaited<ReturnType<typeof runCapabilityProbeOnTransport>>,
  outcome: string,
  label: string,
): void => {
  expect(result.kind, label).toBe('result');
  if (result.kind !== 'result') throw new Error(`${label}: expected result`);
  expect(result.value.outcome, label).toBe(outcome);
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
    timeouts: { ...shortTimeouts },
  });
  return { result, fake, cwd };
};

describe('codex-app-server client fake matrix', () => {
  it('1. sandboxPolicy only on turn/start; readable root is probe cwd only', async () => {
    const nested = mkdtempSync(join(tmpdir(), 'neo-iso-client-'));
    const isolated = buildIsolatedProbeContour({
      codexHome: nested,
      repositoryRoot: resolve(process.cwd()),
    });
    expect(isolated.ok).toBe(true);
    if (!isolated.ok) return;
    const roots = readableRootsForProbe(isolated.paths);
    expect(validateModelReadableRoots(roots, isolated.paths).ok).toBe(true);
    expect(validateModelReadableRoots([isolated.paths.codexHome], isolated.paths).ok).toBe(false);

    const fake = createFakeCodexAppServerTransport('happy-path');
    const result = await runCapabilityProbeOnTransport({
      transport: fake.transport,
      abortSignal: null,
      probeCwd: isolated.paths.probeCwd,
      readableRoots: roots,
      isolationPaths: isolated.paths,
      timeouts: { ...shortTimeouts },
    });
    expectOutcome(result, 'completed', 'isolated-happy');
    const threadParams = fake.controller.threadStartParams[0] as Record<string, unknown>;
    const turnParams = fake.controller.turnStartParams[0] as Record<string, unknown>;
    expect(threadParams.sandboxPolicy).toBeUndefined();
    expect(threadParams.cwd).toBe(isolated.paths.probeCwd);
    expect(threadParams.sandbox).toBe('read-only');
    expect(threadParams.runtimeWorkspaceRoots).toEqual([isolated.paths.probeCwd]);
    expect(turnParams.sandboxPolicy).toEqual({
      type: 'readOnly',
      networkAccess: false,
    });
    const initParams = fake.controller.initializeParams[0] as {
      capabilities: { optOutNotificationMethods: string[] };
    };
    expect(initParams.capabilities.optOutNotificationMethods).toEqual([
      'remoteControl/status/changed',
    ]);
  });

  it('2. config allowlist / modelProvider / quota map to exact outcomes', async () => {
    for (const scenario of [
      'effective-config-violation',
      'unknown-config-key',
      'codex-0147-observed-config',
      'empty-models',
      'multiple-models',
      'unsupported-models',
      'wrong-model-provider',
    ] as const) {
      const { result } = await run(scenario);
      expectOutcome(result, 'policy-rejected', scenario);
    }
    const quota = await run('quota-exhausted');
    expectOutcome(quota.result, 'quota-unavailable', 'quota-exhausted');

    const remote = await run('remote-control-status-changed');
    expectOutcome(remote.result, 'provider-unavailable', 'remote-control-status-changed');
  });

  it('4. cleanup after protocol failure and crash paths', async () => {
    const protocolFail = await run('protocol-failure-cleanup');
    expectOutcome(protocolFail.result, 'outcome-unknown', 'protocol-failure-cleanup');
    expect(protocolFail.fake.controller.rpcTrace).toContain('turn/interrupt');
    expect(protocolFail.fake.controller.interruptParams[0]).toEqual({
      threadId: 'thr_fake_1',
      turnId: 'turn_1',
    });
    expect(JSON.stringify(protocolFail.fake.controller.interruptParams)).not.toContain(
      '"turnId":null',
    );

    const crashed = await run('cleanup-child-crashed');
    expectOutcome(crashed.result, 'provider-unavailable', 'cleanup-child-crashed');
    expect(crashed.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
    expect(crashed.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(false);

    const spawned = await run('cleanup-spawned-no-thread');
    expectOutcome(spawned.result, 'provider-unavailable', 'cleanup-spawned-no-thread');
    expect(spawned.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
    expect(spawned.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(false);

    const threadOnly = await run('cleanup-thread-no-dispatch');
    expect(threadOnly.fake.controller.rpcTrace.includes('turn/start')).toBe(false);
    expect(threadOnly.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(true);
    expect(threadOnly.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
  });

  it('5. dispatch/write race: delayed write, hung write, stdin fail', async () => {
    const delayed = await run('delayed-stdin-write');
    expectOutcome(delayed.result, 'cancelled-before-invocation', 'delayed-stdin-write');
    expect(delayed.fake.controller.rpcTrace.includes('turn/start')).toBe(false);
    expect(delayed.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
    expect(delayed.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(false);
    expect(delayed.fake.transport.isPoisoned()).toBe(true);
    expect(delayed.fake.transport.isExited()).toBe(true);
    if (delayed.result.kind === 'result') {
      expect(delayed.result.cleanupTrace).toContain('poison-reap');
      expect(delayed.result.cleanupTrace.includes('turn/interrupt')).toBe(false);
      expect(delayed.result.cleanupTrace.includes('thread/unsubscribe')).toBe(false);
    }

    const hungStarted = Date.now();
    const hung = await run('hung-stdin-write');
    expect(Date.now() - hungStarted).toBeLessThan(2_000);
    expectOutcome(hung.result, 'known-timeout', 'hung-stdin-write');
    expect(hung.fake.controller.rpcTrace.includes('turn/start')).toBe(false);
    expect(hung.fake.controller.rpcTrace.includes('turn/interrupt')).toBe(false);
    expect(hung.fake.controller.rpcTrace.includes('thread/unsubscribe')).toBe(false);
    expect(hung.fake.transport.isPoisoned()).toBe(true);
    expect(hung.fake.transport.isExited()).toBe(true);
    if (hung.result.kind === 'result') {
      expect(hung.result.cleanupTrace).toContain('poison-reap');
      expect(hung.result.cleanupTrace.includes('turn/interrupt')).toBe(false);
      expect(hung.result.cleanupTrace.includes('thread/unsubscribe')).toBe(false);
    }

    const fail = await run('stdin-write-fail');
    expectOutcome(fail.result, 'provider-unavailable', 'stdin-write-fail');
    expect(fail.fake.transport.isPoisoned()).toBe(false);
    if (fail.result.kind === 'result') {
      expect(fail.result.cleanupTrace.includes('poison-reap')).toBe(false);
    }
  });

  it('5b. forbidden item types outrank correlation (correct/missing/mismatched ids)', async () => {
    const forbiddenTypes = ['command', 'file', 'web', 'mcp'] as const;
    const idVariants = ['', '-missing-ids', '-mismatched-ids'] as const;
    for (const type of forbiddenTypes) {
      for (const variant of idVariants) {
        const scenario = `forbidden-item-${type}${variant}` as FakeCodexAppServerScenario;
        const { result } = await run(scenario);
        expectOutcome(result, 'policy-rejected', scenario);
      }
    }
  });

  it('7. protocol correlation: typed ids, order, forbidden exact policy-rejected', async () => {
    for (const scenario of [
      'duplicate-response-id',
      'late-response',
      'result-and-error',
      'unknown-response-id',
      'typed-id-mismatch',
    ] as const) {
      const { result } = await run(scenario);
      expectOutcome(result, 'provider-unavailable', scenario);
    }

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
      expectOutcome(result, 'policy-rejected', scenario);
    }

    for (const scenario of [
      'turn-failed',
      'turn-interrupted',
      'wrong-turn-id',
      'wrong-thread-id',
      'wrong-event-order',
      'item-before-turn-started',
    ] as const) {
      const { result } = await run(scenario);
      expectOutcome(result, 'outcome-unknown', scenario);
    }
  });

  it('maps auth / abort / timeout / crash by dispatch boundary', async () => {
    expectOutcome((await run('account-null')).result, 'provider-unavailable', 'account-null');
    expectOutcome((await run('non-chatgpt-auth')).result, 'policy-rejected', 'non-chatgpt-auth');
    expectOutcome(
      (await run('abort-before-dispatch')).result,
      'cancelled-before-invocation',
      'abort-before',
    );
    expectOutcome((await run('abort-after-dispatch')).result, 'outcome-unknown', 'abort-after');
    expectOutcome(
      (await run('malformed-before-dispatch')).result,
      'provider-unavailable',
      'malformed-before',
    );
    expectOutcome((await run('crash-after-dispatch')).result, 'outcome-unknown', 'crash-after');
    expectOutcome((await run('initialize-timeout')).result, 'known-timeout', 'initialize-timeout');
    expectOutcome(
      (await run('thread-start-timeout')).result,
      'known-timeout',
      'thread-start-timeout',
    );

    const happy = await run('happy-path');
    expect(happy.result.kind).toBe('result');
    if (happy.result.kind !== 'result') throw new Error('happy');
    expect(happy.result.value).toEqual({
      kind: 'completed',
      outcome: 'completed',
      text: '{"ok":true}',
    });
  });
});
