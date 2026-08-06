import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { LlmCompletionResult } from '../../../core/communication/domain/llm-completion.js';
import type { CodexAppServerTimeouts } from './codex-app-server-config.js';
import { validateAndResolveTimeouts } from './codex-app-server-config.js';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import {
  createSpawnSpec,
  type CodexExecutablePin,
  type VersionReader,
} from './codex-app-server-executable-pin.js';
import {
  consumeOwnerSpawnCapability,
  isOwnerSpawnCapability,
  type CodexOwnerSpawnCapability,
} from './codex-app-server-owner-capability.js';
import {
  FIXED_PROBE_PROMPT,
  buildProbeSandboxPolicy,
  decodeAccountReadResult,
  decodeConfigReadResult,
  decodeConfigRequirementsResult,
  decodeModelListResult,
  decodeRateLimitsReadResult,
  decodeTurnCompletedParams,
  extractAgentMessageText,
  extractItemType,
  extractThreadId,
  extractTurnId,
  hasEffectiveConfigViolation,
  isAllowedItemType,
  isAllowedServerNotification,
  isExactOkTrueOutput,
  isForbiddenItemType,
  isForbiddenNotificationMethod,
  parseJsonlFrame,
  serializeNotification,
  serializeRequest,
  type JsonRpcId,
  type ParsedFrame,
} from './codex-app-server-protocol.js';

export type CodexAppServerTransport = {
  writeLine(line: string): Promise<void>;
  onLine(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  isExited(): boolean;
  kill(signal?: NodeJS.Signals): void;
  closeStdin(): void;
  dispose(): void;
  getStderrRedacted(): string;
  awaitReaped(timeoutMs: number): Promise<boolean>;
};

type CleanupState =
  | 'process-spawned-thread-absent'
  | 'thread-created-turn-not-dispatched'
  | 'active-dispatched-turn'
  | 'child-already-crashed-exited';

type ProbeInternalResult =
  | { readonly kind: 'result'; readonly value: LlmCompletionResult }
  | { readonly kind: 'config-error'; readonly reason: string };

const STDERR_CAP = 4_096;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const redactStderrChunk = (chunk: string): string =>
  chunk.replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[redacted]');

export type CreateLiveTransportInput = {
  readonly pin: CodexExecutablePin;
  readonly envInput: CodexAppServerChildEnvInput;
  readonly cwd: string;
  readonly readVersion: VersionReader;
  readonly ownerCapability: CodexOwnerSpawnCapability;
};

export const createChildProcessTransport = (
  input: CreateLiveTransportInput,
):
  | { readonly ok: true; readonly transport: CodexAppServerTransport }
  | { readonly ok: false; readonly reason: string } => {
  if (!isOwnerSpawnCapability(input.ownerCapability))
    return { ok: false, reason: 'live Codex spawn requires owner capability' };
  const consumed = consumeOwnerSpawnCapability(input.ownerCapability);
  if (!consumed.ok) return consumed;

  const spec = createSpawnSpec(input.pin, input.envInput, {
    readVersion: input.readVersion,
    cwd: input.cwd,
  });
  if (!spec.ok) return spec;

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(spec.spec.command, [...spec.spec.args], {
      shell: false,
      cwd: spec.spec.options.cwd,
      env: spec.spec.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `spawn-error:${error.message}` : 'spawn-error',
    };
  }

  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let spawnFailed: string | null = null;
  let stderrBuf = '';
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const rl = createInterface({ input: child.stdout });

  child.stderr.on('data', (chunk: Buffer | string) => {
    const text = redactStderrChunk(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    stderrBuf = `${stderrBuf}${text}`.slice(-STDERR_CAP);
  });

  rl.on('line', (line) => {
    for (const handler of lineHandlers) handler(line);
  });

  child.on('error', (error) => {
    spawnFailed = error.message;
    if (!exited) {
      exited = true;
      for (const handler of exitHandlers) handler(1, null);
    }
  });

  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    for (const handler of exitHandlers) handler(code, signal);
  });

  const transport: CodexAppServerTransport = {
    async writeLine(line) {
      if (spawnFailed !== null) throw new Error(`spawn-error:${spawnFailed}`);
      if (exited || child.stdin.destroyed) throw new Error('stdin-closed');
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(`${line}\n`, (error) => {
          if (error) reject(new Error(`stdin-write-failed:${error.message}`));
          else resolve();
        });
      });
    },
    onLine(handler) {
      lineHandlers.push(handler);
    },
    onExit(handler) {
      exitHandlers.push(handler);
      if (exited) handler(exitCode, exitSignal);
    },
    isExited: () => exited,
    kill(signal = 'SIGTERM') {
      if (!exited) child.kill(signal);
    },
    closeStdin() {
      if (!child.stdin.destroyed) child.stdin.end();
    },
    dispose() {
      rl.close();
      if (!exited) child.kill('SIGKILL');
    },
    getStderrRedacted: () => stderrBuf,
    async awaitReaped(timeoutMs) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (exited) return true;
        await sleep(10);
      }
      return exited;
    },
  };
  return { ok: true, transport };
};

type Pending = {
  readonly id: string;
  readonly resolve: (frame: ParsedFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

export type RunCapabilityProbeInput = {
  readonly transport: CodexAppServerTransport;
  readonly timeouts?: Partial<CodexAppServerTimeouts>;
  readonly abortSignal?: AbortSignal | null;
  readonly probeCwd: string;
  readonly readableRoots: readonly string[];
};

export const runCapabilityProbeOnTransport = async (
  input: RunCapabilityProbeInput,
): Promise<ProbeInternalResult> => {
  const validated = validateAndResolveTimeouts(input.timeouts);
  if (!validated.ok) return { kind: 'config-error', reason: validated.reason };
  const timeouts = validated.timeouts;
  const transport = input.transport;

  let nextId = 1;
  let threadId: string | null = null;
  let turnId: string | null = null;
  const dispatchState = { dispatched: false, turnStartWritten: false };
  let classified: LlmCompletionResult | null = null;
  let pending: Pending | null = null;
  const notifications: ParsedFrame[] = [];
  let notifyWaiters: Array<() => void> = [];
  const protocolFailure: { current: Error | null } = { current: null };

  const wake = (): void => {
    const waiters = notifyWaiters;
    notifyWaiters = [];
    for (const w of waiters) w();
  };

  const failProtocol = (reason: string): void => {
    if (protocolFailure.current !== null) return;
    protocolFailure.current = new Error(`protocol:${reason}`);
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(protocolFailure.current);
      pending = null;
    }
    wake();
  };

  const onAbort = (): void => {
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(new Error('aborted'));
      pending = null;
    }
    wake();
  };
  input.abortSignal?.addEventListener('abort', onAbort, { once: true });

  transport.onLine((line) => {
    const frame = parseJsonlFrame(line);
    if (frame.kind === 'malformed') {
      failProtocol(frame.reason);
      notifications.push(frame);
      wake();
      return;
    }
    if (frame.kind === 'server-request') {
      failProtocol('server-request');
      notifications.push(frame);
      wake();
      return;
    }
    if (frame.kind === 'success' || frame.kind === 'failure') {
      const key = String(frame.value.id);
      if (pending === null) {
        failProtocol('late-or-unknown-response');
        return;
      }
      if (pending.id !== key) {
        failProtocol('duplicate-or-mismatched-response-id');
        return;
      }
      clearTimeout(pending.timer);
      const waiter = pending;
      pending = null;
      waiter.resolve(frame);
      return;
    }
    // Remaining frames are notifications (malformed/server-request handled above).
    if (isForbiddenNotificationMethod(frame.value.method)) {
      failProtocol(`forbidden-notification:${frame.value.method}`);
    } else if (
      !isAllowedServerNotification(frame.value.method) &&
      frame.value.method !== 'model/rerouted'
    ) {
      failProtocol(`unknown-notification:${frame.value.method}`);
    }
    notifications.push(frame);
    wake();
  });

  transport.onExit(() => {
    wake();
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(new Error('child-exited'));
      pending = null;
    }
  });

  const request = async (
    method: string,
    params: unknown,
    timeoutMs: number,
    options?: { readonly markDispatchWrite?: boolean },
  ): Promise<ParsedFrame> => {
    if (protocolFailure.current !== null) throw protocolFailure.current;
    if (pending !== null) throw new Error('protocol:overlapping-request');
    const id: JsonRpcId = nextId;
    nextId += 1;
    const idKey = String(id);
    return await new Promise<ParsedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.id === idKey) pending = null;
        reject(new Error('timeout'));
      }, timeoutMs);
      pending = { id: idKey, resolve, reject, timer };
      void (async () => {
        try {
          await transport.writeLine(serializeRequest({ method, id, params }));
          if (options?.markDispatchWrite === true) {
            dispatchState.turnStartWritten = true;
            dispatchState.dispatched = true;
          }
        } catch (error) {
          clearTimeout(timer);
          pending = null;
          reject(error instanceof Error ? error : new Error('stdin-write-failed'));
        }
      })();
    });
  };

  const waitNotification = async (
    predicate: (frame: ParsedFrame) => boolean,
    timeoutMs: number,
  ): Promise<ParsedFrame> => {
    const started = Date.now();
    for (;;) {
      if (protocolFailure.current !== null) throw protocolFailure.current;
      if (input.abortSignal?.aborted === true) throw new Error('aborted');
      const idx = notifications.findIndex(predicate);
      if (idx >= 0) {
        const [frame] = notifications.splice(idx, 1);
        if (!frame) throw new Error('missing-frame');
        return frame;
      }
      if (transport.isExited()) throw new Error('child-exited');
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('timeout');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        notifyWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };

  const aborted = (): boolean => input.abortSignal?.aborted === true;

  const known = (
    outcome: Exclude<LlmCompletionResult['outcome'], 'completed'>,
  ): LlmCompletionResult =>
    outcome === 'outcome-unknown'
      ? { kind: 'outcome-unknown', outcome: 'outcome-unknown' }
      : { kind: 'known-failure', outcome };

  const cleanupState = (): CleanupState => {
    if (transport.isExited()) return 'child-already-crashed-exited';
    if (dispatchState.dispatched) return 'active-dispatched-turn';
    if (threadId !== null) return 'thread-created-turn-not-dispatched';
    return 'process-spawned-thread-absent';
  };

  const boundedClose = async (): Promise<void> => {
    if (transport.isExited()) {
      transport.dispose();
      await transport.awaitReaped(timeouts.reapBudgetMs);
      return;
    }
    transport.closeStdin();
    const deadline = Date.now() + timeouts.closeBudgetMs;
    await sleep(Math.min(timeouts.exitWaitMs, Math.max(0, deadline - Date.now())));
    if (!transport.isExited()) {
      transport.kill('SIGTERM');
      await sleep(Math.min(timeouts.termGraceMs, Math.max(0, deadline - Date.now())));
    }
    if (!transport.isExited()) transport.kill('SIGKILL');
    transport.dispose();
    await transport.awaitReaped(timeouts.reapBudgetMs);
  };

  const cleanupTrace: string[] = [];

  const stateDependentCleanup = async (): Promise<void> => {
    const state = cleanupState();
    if (state === 'child-already-crashed-exited') {
      transport.dispose();
      await transport.awaitReaped(timeouts.reapBudgetMs);
      cleanupTrace.push('reap-only');
      return;
    }
    if (state === 'process-spawned-thread-absent') {
      cleanupTrace.push('close');
      await boundedClose();
      return;
    }
    if (state === 'thread-created-turn-not-dispatched') {
      try {
        cleanupTrace.push('thread/unsubscribe');
        await request('thread/unsubscribe', { threadId }, timeouts.unsubscribeBudgetMs);
      } catch {
        /* best-effort */
      }
      cleanupTrace.push('close');
      await boundedClose();
      return;
    }
    const started = Date.now();
    try {
      if (Date.now() - started < timeouts.totalActiveCleanupBudgetMs) {
        cleanupTrace.push('turn/interrupt');
        await request(
          'turn/interrupt',
          { threadId, turnId },
          Math.min(timeouts.interruptBudgetMs, timeouts.totalActiveCleanupBudgetMs),
        );
      }
    } catch {
      /* best-effort */
    }
    try {
      if (Date.now() - started < timeouts.totalActiveCleanupBudgetMs) {
        cleanupTrace.push('thread/unsubscribe');
        await request(
          'thread/unsubscribe',
          { threadId },
          Math.min(timeouts.unsubscribeBudgetMs, timeouts.totalActiveCleanupBudgetMs),
        );
      }
    } catch {
      /* best-effort */
    }
    cleanupTrace.push('close');
    await boundedClose();
  };

  const finish = async (result: LlmCompletionResult): Promise<ProbeInternalResult> => {
    if (classified === null) classified = result;
    await stateDependentCleanup();
    input.abortSignal?.removeEventListener('abort', onAbort);
    return { kind: 'result', value: classified };
  };

  // Expose cleanup trace for tests via transport stderr buffer marker (not logged).
  void cleanupTrace;

  try {
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const init = await request(
      'initialize',
      {
        clientInfo: { name: 'neo-codex-probe', title: 'Neo Codex Probe', version: '3.7E1' },
      },
      timeouts.preflightTimeoutMs,
    );
    if (init.kind !== 'success') return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    await transport.writeLine(serializeNotification({ method: 'initialized', params: {} }));

    const configRead = await request('config/read', {}, timeouts.preflightTimeoutMs);
    if (configRead.kind !== 'success') return await finish(known('provider-unavailable'));
    const configDecoded = decodeConfigReadResult(configRead.value.result);
    if (configDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));

    const configReq = await request('configRequirements/read', {}, timeouts.preflightTimeoutMs);
    if (configReq.kind !== 'success') return await finish(known('provider-unavailable'));
    const reqDecoded = decodeConfigRequirementsResult(configReq.value.result);
    if (reqDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));

    if (hasEffectiveConfigViolation(configDecoded.config, reqDecoded.requirements))
      return await finish(known('policy-rejected'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const account = await request(
      'account/read',
      { refreshToken: false },
      timeouts.preflightTimeoutMs,
    );
    if (account.kind !== 'success') return await finish(known('provider-unavailable'));
    const accountDecoded = decodeAccountReadResult(account.value.result);
    if (accountDecoded.kind === 'malformed' || accountDecoded.kind === 'null')
      return await finish(known('provider-unavailable'));
    if (accountDecoded.kind === 'non-chatgpt') return await finish(known('policy-rejected'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const limits = await request('account/rateLimits/read', {}, timeouts.preflightTimeoutMs);
    if (limits.kind !== 'success') return await finish(known('provider-unavailable'));
    const limitsDecoded = decodeRateLimitsReadResult(limits.value.result);
    if (limitsDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (limitsDecoded.exhausted) return await finish(known('quota-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const models = await request('model/list', { limit: 32 }, timeouts.preflightTimeoutMs);
    if (models.kind !== 'success') return await finish(known('provider-unavailable'));
    const modelDecoded = decodeModelListResult(models.value.result);
    if (modelDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (
      modelDecoded.kind === 'empty' ||
      modelDecoded.kind === 'multiple' ||
      modelDecoded.kind === 'unsupported'
    )
      return await finish(known('policy-rejected'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const thread = await request(
      'thread/start',
      {
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'readOnly',
        sandboxPolicy: buildProbeSandboxPolicy({ readableRoots: input.readableRoots }),
        cwd: input.probeCwd,
        model: modelDecoded.modelId,
      },
      timeouts.threadStartTimeoutMs,
    );
    if (thread.kind !== 'success') return await finish(known('provider-unavailable'));
    threadId = extractThreadId(thread.value.result);
    if (threadId === null) return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    let turnResponse: ParsedFrame;
    try {
      turnResponse = await request(
        'turn/start',
        {
          threadId,
          input: [{ type: 'text', text: FIXED_PROBE_PROMPT }],
        },
        timeouts.turnTimeoutMs,
        { markDispatchWrite: true },
      );
    } catch (error) {
      if (!dispatchState.turnStartWritten) {
        if (aborted()) return await finish(known('cancelled-before-invocation'));
        if (error instanceof Error && error.message === 'timeout')
          return await finish(known('known-timeout'));
        return await finish(known('provider-unavailable'));
      }
      if (aborted()) return await finish(known('outcome-unknown'));
      return await finish(known('outcome-unknown'));
    }

    if (turnResponse.kind !== 'success') return await finish(known('outcome-unknown'));
    turnId = extractTurnId(turnResponse.value.result);
    if (turnId === null) return await finish(known('outcome-unknown'));

    const deadline = Date.now() + timeouts.turnTimeoutMs;
    let agentText: string | null = null;
    while (Date.now() < deadline) {
      if (protocolFailure.current !== null) {
        const failureMessage = protocolFailure.current.message;
        if (failureMessage.includes('server-request'))
          return await finish(known('policy-rejected'));
        if (failureMessage.includes('forbidden-notification:model/rerouted'))
          return await finish(known('policy-rejected'));
        if (failureMessage.includes('forbidden-notification'))
          return await finish(known('policy-rejected'));
        return await finish(known('outcome-unknown'));
      }
      if (aborted()) return await finish(known('outcome-unknown'));
      if (transport.isExited()) return await finish(known('outcome-unknown'));
      let frame: ParsedFrame;
      try {
        frame = await waitNotification(() => true, Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (error instanceof Error && error.message === 'timeout')
          return await finish(known('outcome-unknown'));
        if (error instanceof Error && error.message === 'aborted')
          return await finish(known('outcome-unknown'));
        return await finish(known('outcome-unknown'));
      }
      if (frame.kind === 'malformed') return await finish(known('outcome-unknown'));
      if (frame.kind === 'server-request') return await finish(known('policy-rejected'));
      if (frame.kind === 'notification') {
        const method = frame.value.method;
        if (method === 'model/rerouted' || isForbiddenNotificationMethod(method))
          return await finish(known('policy-rejected'));
        if (method === 'item/started' || method === 'item/completed') {
          const itemType = extractItemType(frame.value.params);
          if (itemType === null) return await finish(known('outcome-unknown'));
          if (isForbiddenItemType(itemType) || !isAllowedItemType(itemType))
            return await finish(known('policy-rejected'));
          if (method === 'item/completed') {
            const text = extractAgentMessageText(frame.value.params);
            if (text !== null) agentText = text;
          }
        }
        if (method === 'turn/completed') {
          const decoded = decodeTurnCompletedParams(frame.value.params);
          if (decoded.kind === 'malformed') return await finish(known('outcome-unknown'));
          if (decoded.kind === 'failed-or-interrupted')
            return await finish(known('outcome-unknown'));
          if (decoded.turnId !== turnId) return await finish(known('outcome-unknown'));
          if (decoded.threadId !== null && decoded.threadId !== threadId)
            return await finish(known('outcome-unknown'));
          if (agentText === null) return await finish(known('invalid-response'));
          if (!isExactOkTrueOutput(agentText)) return await finish(known('invalid-response'));
          return await finish({
            kind: 'completed',
            outcome: 'completed',
            text: agentText.trim(),
          });
        }
      }
    }
    return await finish(known('outcome-unknown'));
  } catch (error) {
    if (protocolFailure.current !== null && !dispatchState.dispatched) {
      const failureMessage = protocolFailure.current.message;
      if (failureMessage.includes('forbidden-notification'))
        return await finish(known('policy-rejected'));
      return await finish(known('provider-unavailable'));
    }
    if (!dispatchState.dispatched) {
      if (aborted()) return await finish(known('cancelled-before-invocation'));
      if (error instanceof Error && error.message === 'timeout')
        return await finish(known('known-timeout'));
      if (error instanceof Error && error.message === 'aborted')
        return await finish(known('cancelled-before-invocation'));
      if (error instanceof Error && error.message.startsWith('protocol:'))
        return await finish(known('provider-unavailable'));
      if (error instanceof Error && error.message === 'child-exited')
        return await finish(known('provider-unavailable'));
      return await finish(known('provider-unavailable'));
    }
    return await finish(known('outcome-unknown'));
  }
};

/** Test helper: last cleanup RPC labels when using instrumented fake transports. */
export type CleanupTraceSink = { readonly labels: string[] };
