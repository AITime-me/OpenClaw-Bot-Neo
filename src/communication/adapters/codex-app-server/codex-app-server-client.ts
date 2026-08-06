import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { LlmCompletionResult } from '../../../core/communication/domain/llm-completion.js';
import type { CodexAppServerTimeouts } from './codex-app-server-config.js';
import { resolveTimeouts } from './codex-app-server-config.js';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import { createSpawnSpec, type CodexExecutablePin } from './codex-app-server-executable-pin.js';
import {
  FIXED_PROBE_PROMPT,
  isAllowedServerNotification,
  isExactOkTrueOutput,
  isForbiddenPostDispatchMethod,
  parseJsonlFrame,
  serializeNotification,
  serializeRequest,
  type JsonRpcId,
  type ParsedFrame,
} from './codex-app-server-protocol.js';

export type CodexAppServerTransport = {
  writeLine(line: string): void;
  onLine(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  isExited(): boolean;
  kill(signal?: NodeJS.Signals): void;
  closeStdin(): void;
  dispose(): void;
};

type CleanupState =
  | 'process-spawned-thread-absent'
  | 'thread-created-turn-not-dispatched'
  | 'active-dispatched-turn'
  | 'child-already-crashed-exited';

type ProbeInternalResult =
  | { readonly kind: 'result'; readonly value: LlmCompletionResult }
  | { readonly kind: 'config-error'; readonly reason: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createChildProcessTransport = (
  pin: CodexExecutablePin,
  envInput: CodexAppServerChildEnvInput,
):
  | { readonly ok: true; readonly transport: CodexAppServerTransport }
  | { readonly ok: false; readonly reason: string } => {
  const spec = createSpawnSpec(pin, envInput);
  if (!spec.ok) return spec;
  const child: ChildProcessWithoutNullStreams = spawn(spec.spec.command, [...spec.spec.args], {
    shell: false,
    env: spec.spec.options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    for (const handler of lineHandlers) handler(line);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    for (const handler of exitHandlers) handler(code, signal);
  });
  const transport: CodexAppServerTransport = {
    writeLine(line) {
      if (exited || child.stdin.destroyed) return;
      child.stdin.write(`${line}\n`);
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
  };
  return { ok: true, transport };
};

type Pending = {
  readonly resolve: (frame: ParsedFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

export type RunCapabilityProbeInput = {
  readonly transport: CodexAppServerTransport;
  readonly timeouts?: Partial<CodexAppServerTimeouts>;
  readonly abortSignal?: AbortSignal | null;
};

export const runCapabilityProbeOnTransport = async (
  input: RunCapabilityProbeInput,
): Promise<ProbeInternalResult> => {
  const timeouts = resolveTimeouts(input.timeouts);
  const transport = input.transport;
  let nextId = 1;
  let threadId: string | null = null;
  const dispatchState = { dispatched: false };
  let classified: LlmCompletionResult | null = null;
  const pending = new Map<string, Pending>();
  const notifications: ParsedFrame[] = [];
  let notifyWaiters: Array<() => void> = [];

  const wake = (): void => {
    const waiters = notifyWaiters;
    notifyWaiters = [];
    for (const w of waiters) w();
  };

  transport.onLine((line) => {
    const frame = parseJsonlFrame(line);
    if (frame.kind === 'success' || frame.kind === 'failure') {
      const key = String(frame.value.id);
      const waiter = pending.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(key);
        waiter.resolve(frame);
        return;
      }
    }
    if (frame.kind === 'malformed') {
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('malformed'));
      }
      pending.clear();
    }
    notifications.push(frame);
    wake();
  });

  transport.onExit(() => {
    wake();
    for (const [, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('child-exited'));
    }
    pending.clear();
  });

  const request = async (
    method: string,
    params: unknown,
    timeoutMs: number,
    options?: { readonly markDispatched?: boolean },
  ): Promise<ParsedFrame> => {
    const id: JsonRpcId = nextId;
    nextId += 1;
    return await new Promise<ParsedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error('timeout'));
      }, timeoutMs);
      pending.set(String(id), { resolve, reject, timer });
      if (options?.markDispatched === true) dispatchState.dispatched = true;
      transport.writeLine(serializeRequest({ method, id, params }));
    });
  };

  const waitNotification = async (
    predicate: (frame: ParsedFrame) => boolean,
    timeoutMs: number,
  ): Promise<ParsedFrame> => {
    const started = Date.now();
    for (;;) {
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
  };

  const stateDependentCleanup = async (): Promise<void> => {
    const state = cleanupState();
    if (state === 'child-already-crashed-exited') {
      await sleep(0);
      transport.dispose();
      return;
    }
    if (state === 'process-spawned-thread-absent') {
      await boundedClose();
      return;
    }
    if (state === 'thread-created-turn-not-dispatched') {
      try {
        await request('thread/unsubscribe', { threadId }, timeouts.unsubscribeBudgetMs);
      } catch {
        /* best-effort */
      }
      await boundedClose();
      return;
    }
    const started = Date.now();
    try {
      if (Date.now() - started < timeouts.totalActiveCleanupBudgetMs)
        await request(
          'turn/interrupt',
          { threadId },
          Math.min(timeouts.interruptBudgetMs, timeouts.totalActiveCleanupBudgetMs),
        );
    } catch {
      /* best-effort */
    }
    try {
      if (Date.now() - started < timeouts.totalActiveCleanupBudgetMs)
        await request(
          'thread/unsubscribe',
          { threadId },
          Math.min(timeouts.unsubscribeBudgetMs, timeouts.totalActiveCleanupBudgetMs),
        );
    } catch {
      /* best-effort */
    }
    await boundedClose();
  };

  const finish = async (result: LlmCompletionResult): Promise<ProbeInternalResult> => {
    if (classified === null) classified = result;
    await stateDependentCleanup();
    return { kind: 'result', value: classified };
  };

  try {
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const init = await request(
      'initialize',
      {
        clientInfo: { name: 'neo-codex-probe', title: 'Neo Codex Probe', version: '3.7E1' },
      },
      timeouts.preflightTimeoutMs,
    );
    if (init.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (init.kind === 'failure') return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    transport.writeLine(serializeNotification({ method: 'initialized', params: {} }));

    const configRead = await request('config/read', {}, timeouts.preflightTimeoutMs);
    if (configRead.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (configRead.kind !== 'success') return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const configReq = await request('configRequirements/read', {}, timeouts.preflightTimeoutMs);
    if (configReq.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (configReq.kind !== 'success') return await finish(known('provider-unavailable'));

    const effective = {
      ...(typeof configRead.value.result === 'object' && configRead.value.result !== null
        ? (configRead.value.result as Record<string, unknown>)
        : {}),
      ...(typeof configReq.value.result === 'object' && configReq.value.result !== null
        ? (configReq.value.result as Record<string, unknown>)
        : {}),
    };
    if (hasEffectiveConfigViolation(effective)) return await finish(known('policy-rejected'));

    const account = await request(
      'account/read',
      { refreshToken: false },
      timeouts.preflightTimeoutMs,
    );
    if (account.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (account.kind !== 'success') return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const accountResult = account.value.result;
    if (accountResult === null || accountResult === undefined)
      return await finish(known('provider-unavailable'));
    if (typeof accountResult !== 'object') return await finish(known('provider-unavailable'));
    const accountType = (accountResult as { type?: unknown }).type;
    if (accountType === undefined || accountType === null)
      return await finish(known('provider-unavailable'));
    if (accountType !== 'chatgpt') return await finish(known('policy-rejected'));

    const limits = await request('account/rateLimits/read', {}, timeouts.preflightTimeoutMs);
    if (limits.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (limits.kind !== 'success') return await finish(known('provider-unavailable'));
    if (isQuotaUnavailable(limits.value.result)) return await finish(known('quota-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const models = await request('model/list', { limit: 32 }, timeouts.preflightTimeoutMs);
    if (models.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (models.kind !== 'success') return await finish(known('provider-unavailable'));
    const modelId = selectSingleTextModel(models.value.result);
    if (modelId === null) return await finish(known('policy-rejected'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const thread = await request(
      'thread/start',
      {
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'readOnly',
        model: modelId,
      },
      timeouts.threadStartTimeoutMs,
    );
    if (thread.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (thread.kind === 'failure') return await finish(known('provider-unavailable'));
    if (thread.kind !== 'success') return await finish(known('provider-unavailable'));
    threadId = extractThreadId(thread.value.result);
    if (threadId === null) return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    // Decision 13: dispatch is the write of turn/start (mark immediately before write inside request).
    let turnResponse: ParsedFrame;
    try {
      turnResponse = await request(
        'turn/start',
        {
          threadId,
          input: [{ type: 'text', text: FIXED_PROBE_PROMPT }],
        },
        timeouts.turnTimeoutMs,
        { markDispatched: true },
      );
    } catch (error) {
      if (aborted()) return await finish(known('outcome-unknown'));
      if (error instanceof Error && error.message === 'timeout')
        return await finish(known('outcome-unknown'));
      if (error instanceof Error && error.message === 'child-exited')
        return await finish(known('outcome-unknown'));
      return await finish(known('outcome-unknown'));
    }
    if (turnResponse.kind === 'malformed') return await finish(known('outcome-unknown'));
    if (turnResponse.kind === 'failure') return await finish(known('outcome-unknown'));

    const deadline = Date.now() + timeouts.turnTimeoutMs;
    let agentText: string | null = null;
    while (Date.now() < deadline) {
      if (aborted()) return await finish(known('outcome-unknown'));
      if (transport.isExited()) return await finish(known('outcome-unknown'));
      let frame: ParsedFrame;
      try {
        frame = await waitNotification(() => true, Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (error instanceof Error && error.message === 'timeout')
          return await finish(known('outcome-unknown'));
        return await finish(known('outcome-unknown'));
      }
      if (frame.kind === 'malformed') return await finish(known('outcome-unknown'));
      if (frame.kind === 'notification') {
        const method = frame.value.method;
        if (method === 'model/rerouted' || isForbiddenPostDispatchMethod(method))
          return await finish(known('policy-rejected'));
        if (!isAllowedServerNotification(method) && method !== 'model/rerouted')
          return await finish(known('policy-rejected'));
        if (method === 'item/completed') {
          const text = extractAgentText(frame.value.params);
          if (text !== null) agentText = text;
        }
        if (method === 'turn/completed') {
          if (agentText === null) return await finish(known('invalid-response'));
          if (!isExactOkTrueOutput(agentText)) return await finish(known('invalid-response'));
          return await finish({ kind: 'completed', outcome: 'completed', text: agentText.trim() });
        }
      }
    }
    return await finish(known('outcome-unknown'));
  } catch (error) {
    if (!dispatchState.dispatched) {
      if (aborted()) return await finish(known('cancelled-before-invocation'));
      if (error instanceof Error && error.message === 'timeout')
        return await finish(known('known-timeout'));
      if (error instanceof Error && error.message === 'malformed')
        return await finish(known('provider-unavailable'));
      if (error instanceof Error && error.message === 'child-exited')
        return await finish(known('provider-unavailable'));
      return await finish(known('provider-unavailable'));
    }
    if (error instanceof Error && error.message === 'malformed')
      return await finish(known('outcome-unknown'));
    return await finish(known('outcome-unknown'));
  }
};

const hasEffectiveConfigViolation = (config: Record<string, unknown>): boolean => {
  const serialized = JSON.stringify(config).toLowerCase();
  if (serialized.includes('base_url') || serialized.includes('baseurl')) return true;
  if (serialized.includes('customprovider') || serialized.includes('custom_provider')) return true;
  if (
    /"mcp"\s*:/.test(serialized) &&
    !serialized.includes('"mcp":[]') &&
    !serialized.includes('"mcp":{}')
  )
    return true;
  if (serialized.includes('"web":true') || serialized.includes('"shell":true')) return true;
  if (serialized.includes('"apps":true') || serialized.includes('"hooks":true')) return true;
  if (config.mcpServers && typeof config.mcpServers === 'object') {
    if (Object.keys(config.mcpServers).length > 0) return true;
  }
  if (config.web === true || config.shell === true || config.apps === true || config.hooks === true)
    return true;
  return false;
};

const isQuotaUnavailable = (result: unknown): boolean => {
  if (result === null || typeof result !== 'object') return false;
  const record = result as Record<string, unknown>;
  if (record.exhausted === true || record.quotaExceeded === true) return true;
  if (record.remaining === 0) return true;
  return false;
};

const selectSingleTextModel = (result: unknown): string | null => {
  if (result === null || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const list = Array.isArray(record.models)
    ? record.models
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(result)
        ? result
        : null;
  if (list === null) return null;
  const textModels = list.filter((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    const model = entry as Record<string, unknown>;
    if (model.textCapable === false) return false;
    if (typeof model.id !== 'string' || model.id.length === 0) return false;
    return true;
  });
  if (textModels.length !== 1) return null;
  const only = textModels[0] as { id: string };
  return only.id;
};

const extractThreadId = (result: unknown): string | null => {
  if (result === null || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  const thread = record.thread;
  if (
    thread !== null &&
    typeof thread === 'object' &&
    typeof (thread as { id?: unknown }).id === 'string'
  )
    return (thread as { id: string }).id;
  return null;
};

const extractAgentText = (params: unknown): string | null => {
  if (params === null || typeof params !== 'object') return null;
  const record = params as Record<string, unknown>;
  const item = record.item;
  if (item !== null && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string')
      return itemRecord.text;
    if (typeof itemRecord.text === 'string') return itemRecord.text;
  }
  if (typeof record.text === 'string') return record.text;
  return null;
};
