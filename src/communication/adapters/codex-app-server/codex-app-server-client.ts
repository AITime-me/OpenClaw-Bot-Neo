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
  APPROVED_MODEL_PROVIDER,
  APPROVED_SANDBOX_MODE,
  FIXED_PROBE_PROMPT,
  buildProbeInitializeParams,
  buildProbeSandboxPolicy,
  decodeAccountReadResult,
  decodeConfigPreflight,
  decodeConfigReadResult,
  decodeConfigRequirementsResult,
  decodeModelListResult,
  decodeRateLimitsReadResult,
  decodeTurnCompletedParams,
  extractAgentMessageText,
  extractItemType,
  extractThreadId,
  extractThreadModelProvider,
  extractTurnId,
  isAllowedItemType,
  isAllowedServerNotification,
  isExactOkTrueOutput,
  isForbiddenItemType,
  isForbiddenNotificationMethod,
  jsonRpcIdsEqual,
  parseJsonlFrame,
  serializeNotification,
  serializeRequest,
  type JsonRpcId,
  type ParsedFrame,
} from './codex-app-server-protocol.js';
import {
  pathEquals,
  validateModelReadableRoots,
  type IsolationPaths,
} from './codex-app-server-isolation.js';

export type CodexAppServerTransport = {
  writeLine(line: string): Promise<void>;
  onLine(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  isExited(): boolean;
  kill(signal?: NodeJS.Signals): void;
  closeStdin(): void;
  dispose(): void;
  /** Hard-stop: destroy stdin, kill child, reject further writes (ambiguous dispatch). */
  poison(): void;
  isPoisoned(): boolean;
  getStderrRedacted(): string;
  awaitReaped(timeoutMs: number): Promise<boolean>;
};

type CleanupState =
  | 'process-spawned-thread-absent'
  | 'thread-created-turn-not-dispatched'
  | 'active-dispatched-turn'
  | 'child-already-crashed-exited';

type ProbeInternalResult =
  | {
      readonly kind: 'result';
      readonly value: LlmCompletionResult;
      readonly cleanupTrace: readonly string[];
    }
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
  let poisoned = false;
  let stderrBuf = '';
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const pendingWriteRejects = new Set<(error: Error) => void>();
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

  const hardStop = (markPoisoned: boolean): void => {
    if (markPoisoned) {
      if (poisoned) return;
      poisoned = true;
    }
    for (const reject of pendingWriteRejects) reject(new Error('stdin-poisoned'));
    pendingWriteRejects.clear();
    try {
      if (!child.stdin.destroyed) child.stdin.destroy();
    } catch {
      /* ignore */
    }
    try {
      rl.close();
    } catch {
      /* ignore */
    }
    try {
      if (!exited) child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  };

  const poison = (): void => {
    hardStop(true);
  };

  const transport: CodexAppServerTransport = {
    async writeLine(line) {
      if (poisoned) throw new Error('stdin-poisoned');
      if (spawnFailed !== null) throw new Error(`spawn-error:${spawnFailed}`);
      if (exited || child.stdin.destroyed) throw new Error('stdin-closed');
      await new Promise<void>((resolve, reject) => {
        if (poisoned) {
          reject(new Error('stdin-poisoned'));
          return;
        }
        pendingWriteRejects.add(reject);
        child.stdin.write(`${line}\n`, (error) => {
          pendingWriteRejects.delete(reject);
          if (poisoned) reject(new Error('stdin-poisoned'));
          else if (error) reject(new Error(`stdin-write-failed:${error.message}`));
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
      hardStop(false);
    },
    poison,
    isPoisoned: () => poisoned,
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
  readonly id: JsonRpcId;
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
  readonly isolationPaths?: IsolationPaths;
};

const notificationThreadId = (params: unknown): string | null => {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null;
  const record = params as Record<string, unknown>;
  if (typeof record.threadId === 'string') return record.threadId;
  if (
    record.thread !== null &&
    typeof record.thread === 'object' &&
    !Array.isArray(record.thread)
  ) {
    const id = (record.thread as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
};

const notificationTurnId = (params: unknown): string | null => {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null;
  const record = params as Record<string, unknown>;
  if (typeof record.turnId === 'string') return record.turnId;
  if (record.turn !== null && typeof record.turn === 'object' && !Array.isArray(record.turn)) {
    const id = (record.turn as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
};

export const runCapabilityProbeOnTransport = async (
  input: RunCapabilityProbeInput,
): Promise<ProbeInternalResult> => {
  const validated = validateAndResolveTimeouts(input.timeouts);
  if (!validated.ok) return { kind: 'config-error', reason: validated.reason };
  const timeouts = validated.timeouts;
  const transport = input.transport;

  if (input.isolationPaths !== undefined) {
    const rootsCheck = validateModelReadableRoots(input.readableRoots, input.isolationPaths);
    if (!rootsCheck.ok) return { kind: 'config-error', reason: rootsCheck.reason };
    if (!pathEquals(input.probeCwd, input.isolationPaths.probeCwd))
      return { kind: 'config-error', reason: 'probe cwd must match isolated contour' };
  }
  if (
    input.readableRoots.length !== 1 ||
    input.readableRoots[0] === undefined ||
    !pathEquals(input.readableRoots[0], input.probeCwd)
  )
    return { kind: 'config-error', reason: 'readable roots must be exactly probe cwd' };

  let nextId = 1;
  let threadId: string | null = null;
  let turnId: string | null = null;
  const dispatchState = { dispatched: false };
  const poisonState = { poisoned: false, reaped: false };
  let classified: LlmCompletionResult | null = null;
  let outcomeLatched = false;
  const pendingRef: { current: Pending | null } = { current: null };
  const notifications: ParsedFrame[] = [];
  let notifyWaiters: Array<() => void> = [];
  const protocolFailure: { current: Error | null } = { current: null };
  const cleanupTrace: string[] = [];

  const wake = (): void => {
    const waiters = notifyWaiters;
    notifyWaiters = [];
    for (const w of waiters) w();
  };

  const failProtocol = (reason: string): void => {
    if (protocolFailure.current !== null) return;
    protocolFailure.current = new Error(`protocol:${reason}`);
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current.reject(protocolFailure.current);
      pendingRef.current = null;
    }
    wake();
  };

  const onAbort = (): void => {
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current.timer);
      const waiter = pendingRef.current;
      pendingRef.current = null;
      waiter.reject(new Error('aborted'));
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
      if (pendingRef.current === null) {
        failProtocol('late-or-unknown-response');
        return;
      }
      if (!jsonRpcIdsEqual(pendingRef.current.id, frame.value.id)) {
        failProtocol('duplicate-or-mismatched-response-id');
        return;
      }
      clearTimeout(pendingRef.current.timer);
      const waiter = pendingRef.current;
      pendingRef.current = null;
      waiter.resolve(frame);
      return;
    }
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
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current.reject(new Error('child-exited'));
      pendingRef.current = null;
    }
  });

  const clearPendingIfMatch = (expectedId: JsonRpcId): void => {
    const current: Pending | null = pendingRef.current;
    if (current === null) return;
    if (!jsonRpcIdsEqual(current.id, expectedId)) return;
    clearTimeout(current.timer);
    pendingRef.current = null;
  };

  const writeLineAbortAware = async (line: string): Promise<void> => {
    if (input.abortSignal?.aborted) throw new Error('aborted');
    const abortFlag = { aborted: false };
    const onWriteAbort = (): void => {
      abortFlag.aborted = true;
    };
    input.abortSignal?.addEventListener('abort', onWriteAbort, { once: true });
    try {
      await transport.writeLine(line);
    } finally {
      input.abortSignal?.removeEventListener('abort', onWriteAbort);
    }
    if (abortFlag.aborted) throw new Error('aborted');
  };

  /** Normal request path — blocked once protocolFailure is latched. */
  const request = async (
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<ParsedFrame> => {
    if (protocolFailure.current !== null) throw protocolFailure.current;
    if (pendingRef.current !== null) throw new Error('protocol:overlapping-request');
    if (input.abortSignal?.aborted) throw new Error('aborted');
    const id: JsonRpcId = nextId;
    nextId += 1;
    const line = serializeRequest({ method, id, params });
    const response = new Promise<ParsedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRef.current !== null && jsonRpcIdsEqual(pendingRef.current.id, id))
          pendingRef.current = null;
        reject(new Error('timeout'));
      }, timeoutMs);
      pendingRef.current = { id, resolve, reject, timer };
    });
    try {
      await writeLineAbortAware(line);
    } catch (error) {
      clearPendingIfMatch(id);
      throw error;
    }
    return await response;
  };

  /**
   * Bounded best-effort cleanup RPC transport that still works after latched protocolFailure.
   * Does not clear protocolFailure; impossible after child exit.
   */
  const cleanupRequest = async (
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<void> => {
    if (poisonState.poisoned || transport.isPoisoned()) return;
    if (transport.isExited()) return;
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
    const id: JsonRpcId = nextId;
    nextId += 1;
    try {
      await transport.writeLine(serializeRequest({ method, id, params }));
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingRef.current !== null && jsonRpcIdsEqual(pendingRef.current.id, id))
          pendingRef.current = null;
        resolve();
      }, timeoutMs);
      pendingRef.current = {
        id,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: () => {
          clearTimeout(timer);
          resolve();
        },
        timer,
      };
    });
  };

  /** FIFO notification wait — never skips earlier frames (strict correlation order). */
  const waitNextNotification = async (timeoutMs: number): Promise<ParsedFrame> => {
    const started = Date.now();
    for (;;) {
      if (protocolFailure.current !== null) throw protocolFailure.current;
      if (input.abortSignal?.aborted === true) throw new Error('aborted');
      if (notifications.length > 0) {
        const frame = notifications.shift();
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

  const waitNotification = async (
    predicate: (frame: ParsedFrame) => boolean,
    timeoutMs: number,
  ): Promise<ParsedFrame> => {
    const started = Date.now();
    for (;;) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('timeout');
      const frame = await waitNextNotification(remaining);
      if (predicate(frame)) return frame;
      failProtocol('out-of-order-notification');
      throw protocolFailure.current ?? new Error('protocol:out-of-order-notification');
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
    if (poisonState.poisoned || transport.isPoisoned()) return 'child-already-crashed-exited';
    if (transport.isExited()) return 'child-already-crashed-exited';
    if (dispatchState.dispatched) return 'active-dispatched-turn';
    if (threadId !== null) return 'thread-created-turn-not-dispatched';
    return 'process-spawned-thread-absent';
  };

  const poisonAndReap = async (): Promise<void> => {
    poisonState.poisoned = true;
    // Never mark dispatched on ambiguous write — late prompt must not be possible.
    dispatchState.dispatched = false;
    transport.poison();
    if (!poisonState.reaped) {
      cleanupTrace.push('poison-reap');
      await transport.awaitReaped(timeouts.reapBudgetMs);
      poisonState.reaped = true;
    }
  };

  const boundedClose = async (): Promise<void> => {
    if (poisonState.poisoned || transport.isPoisoned()) {
      await poisonAndReap();
      return;
    }
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

  const stateDependentCleanup = async (): Promise<void> => {
    if (poisonState.poisoned || transport.isPoisoned()) {
      await poisonAndReap();
      return;
    }
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
      if (threadId !== null) {
        cleanupTrace.push('thread/unsubscribe');
        await cleanupRequest('thread/unsubscribe', { threadId }, timeouts.unsubscribeBudgetMs);
      }
      cleanupTrace.push('close');
      await boundedClose();
      return;
    }
    const started = Date.now();
    if (
      threadId !== null &&
      turnId !== null &&
      Date.now() - started < timeouts.totalActiveCleanupBudgetMs
    ) {
      cleanupTrace.push('turn/interrupt');
      await cleanupRequest(
        'turn/interrupt',
        { threadId, turnId },
        Math.min(timeouts.interruptBudgetMs, timeouts.totalActiveCleanupBudgetMs),
      );
    }
    if (threadId !== null && Date.now() - started < timeouts.totalActiveCleanupBudgetMs) {
      cleanupTrace.push('thread/unsubscribe');
      await cleanupRequest(
        'thread/unsubscribe',
        { threadId },
        Math.min(timeouts.unsubscribeBudgetMs, timeouts.totalActiveCleanupBudgetMs),
      );
    }
    cleanupTrace.push('close');
    await boundedClose();
  };

  const finish = async (result: LlmCompletionResult): Promise<ProbeInternalResult> => {
    if (!outcomeLatched) {
      classified = result;
      outcomeLatched = true;
    }
    await stateDependentCleanup();
    input.abortSignal?.removeEventListener('abort', onAbort);
    return {
      kind: 'result',
      value: classified ?? result,
      cleanupTrace: [...cleanupTrace],
    };
  };

  const dispatchTurnStart = async (): Promise<ParsedFrame> => {
    if (threadId === null) throw new Error('protocol:missing-thread');
    if (protocolFailure.current !== null) throw protocolFailure.current;
    if (pendingRef.current !== null) throw new Error('protocol:overlapping-request');
    const id: JsonRpcId = nextId;
    nextId += 1;
    const params = {
      threadId,
      input: [{ type: 'text', text: FIXED_PROBE_PROMPT }],
      sandboxPolicy: buildProbeSandboxPolicy(),
    };
    const line = serializeRequest({ method: 'turn/start', id, params });
    const deadline = Date.now() + timeouts.turnTimeoutMs;

    type WriteOutcome = 'proven' | 'failed' | 'aborted';
    const writeState: { outcome: WriteOutcome | null } = { outcome: null };

    // Register waiter before write so microtask responses cannot race as late/unknown.
    const response = new Promise<ParsedFrame>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (pendingRef.current !== null && jsonRpcIdsEqual(pendingRef.current.id, id))
            pendingRef.current = null;
          reject(new Error('timeout'));
        },
        Math.max(1, deadline - Date.now()),
      );
      pendingRef.current = { id, resolve, reject, timer };
    });
    // Prevent unhandled rejection if abort rejects before await.
    void response.catch(() => undefined);

    const ambiguousState = { ambiguous: false };

    const writePromise = transport.writeLine(line).then(
      () => {
        if (poisonState.poisoned || transport.isPoisoned() || ambiguousState.ambiguous) {
          if (writeState.outcome === null) writeState.outcome = 'failed';
          return;
        }
        writeState.outcome = 'proven';
        // Proven full-frame write → irreversibly post-dispatch.
        dispatchState.dispatched = true;
      },
      (error: unknown) => {
        if (writeState.outcome === null) {
          writeState.outcome = input.abortSignal?.aborted ? 'aborted' : 'failed';
        }
        throw error instanceof Error ? error : new Error('stdin-write-failed');
      },
    );
    void writePromise.catch(() => undefined);

    const settleWrite = async (budgetMs: number): Promise<void> => {
      const settleFlag = { settled: false };
      await Promise.race([
        writePromise.then(
          () => {
            settleFlag.settled = true;
          },
          () => {
            settleFlag.settled = true;
          },
        ),
        sleep(Math.max(1, budgetMs)).then(() => undefined),
      ]);
      if (!settleFlag.settled && writeState.outcome === null) {
        // Ambiguous hung write: do not mark dispatched; poison stdin so late prompt cannot run.
        ambiguousState.ambiguous = true;
        writeState.outcome = 'failed';
      }
    };

    while (writeState.outcome === null) {
      if (input.abortSignal?.aborted || Date.now() >= deadline) {
        await settleWrite(Math.max(1, Math.min(timeouts.interruptBudgetMs, deadline - Date.now())));
        break;
      }
      await Promise.race([writePromise.catch(() => undefined), sleep(5)]);
    }
    if (writeState.outcome === null) {
      await settleWrite(Math.max(1, Math.min(timeouts.interruptBudgetMs, deadline - Date.now())));
    }

    if (writeState.outcome !== 'proven') {
      clearPendingIfMatch(id);
      if (ambiguousState.ambiguous) {
        await poisonAndReap();
      }
      if (outcomeLatched) throw new Error('outcome-latched');
      if (writeState.outcome === 'aborted' || Boolean(input.abortSignal?.aborted))
        throw new Error('aborted');
      if (ambiguousState.ambiguous) throw new Error('timeout');
      if (writeState.outcome === 'failed') throw new Error('stdin-write-failed');
      throw new Error('timeout');
    }

    if (outcomeLatched) throw new Error('outcome-latched');
    return await response;
  };

  try {
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    const init = await request(
      'initialize',
      buildProbeInitializeParams(),
      timeouts.preflightTimeoutMs,
    );
    if (init.kind !== 'success') return await finish(known('provider-unavailable'));
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    await writeLineAbortAware(serializeNotification({ method: 'initialized', params: {} }));

    const configRead = await request('config/read', {}, timeouts.preflightTimeoutMs);
    if (configRead.kind !== 'success') return await finish(known('provider-unavailable'));
    const configDecoded = decodeConfigReadResult(configRead.value.result);
    if (configDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));

    const configReq = await request('configRequirements/read', {}, timeouts.preflightTimeoutMs);
    if (configReq.kind !== 'success') return await finish(known('provider-unavailable'));
    const reqDecoded = decodeConfigRequirementsResult(configReq.value.result);
    if (reqDecoded.kind === 'malformed') return await finish(known('provider-unavailable'));

    const preflight = decodeConfigPreflight(configDecoded.config, reqDecoded.requirements);
    if (preflight.kind === 'malformed') return await finish(known('provider-unavailable'));
    if (preflight.kind === 'policy-rejected') return await finish(known('policy-rejected'));
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
        sandbox: APPROVED_SANDBOX_MODE,
        cwd: input.probeCwd,
        runtimeWorkspaceRoots: [input.probeCwd],
        model: modelDecoded.modelId,
      },
      timeouts.threadStartTimeoutMs,
    );
    if (thread.kind !== 'success') return await finish(known('provider-unavailable'));
    threadId = extractThreadId(thread.value.result);
    if (threadId === null) return await finish(known('provider-unavailable'));
    const modelProvider = extractThreadModelProvider(thread.value.result);
    if (modelProvider !== APPROVED_MODEL_PROVIDER) return await finish(known('policy-rejected'));

    try {
      await waitNotification(
        (frame) =>
          frame.kind === 'notification' &&
          frame.value.method === 'thread/started' &&
          notificationThreadId(frame.value.params) === threadId,
        timeouts.threadStartTimeoutMs,
      );
    } catch {
      if (protocolFailure.current !== null) {
        const failureMessage = protocolFailure.current.message;
        if (
          failureMessage.includes('server-request') ||
          failureMessage.includes('forbidden-notification')
        )
          return await finish(known('policy-rejected'));
        return await finish(known('provider-unavailable'));
      }
      if (aborted()) return await finish(known('cancelled-before-invocation'));
      return await finish(known('provider-unavailable'));
    }
    if (aborted()) return await finish(known('cancelled-before-invocation'));

    let turnResponse: ParsedFrame;
    try {
      turnResponse = await dispatchTurnStart();
    } catch (error) {
      if (!dispatchState.dispatched) {
        if (aborted() || (error instanceof Error && error.message === 'aborted'))
          return await finish(known('cancelled-before-invocation'));
        if (error instanceof Error && error.message === 'timeout')
          return await finish(known('known-timeout'));
        return await finish(known('provider-unavailable'));
      }
      return await finish(known('outcome-unknown'));
    }

    if (turnResponse.kind !== 'success') return await finish(known('outcome-unknown'));
    turnId = extractTurnId(turnResponse.value.result);
    if (turnId === null) return await finish(known('outcome-unknown'));

    try {
      await waitNotification(
        (frame) =>
          frame.kind === 'notification' &&
          frame.value.method === 'turn/started' &&
          notificationTurnId(frame.value.params) === turnId &&
          notificationThreadId(frame.value.params) === threadId,
        timeouts.turnTimeoutMs,
      );
    } catch {
      if (protocolFailure.current !== null) {
        const failureMessage = protocolFailure.current.message;
        if (
          failureMessage.includes('server-request') ||
          failureMessage.includes('forbidden-notification') ||
          failureMessage.includes('unknown-notification')
        )
          return await finish(known('policy-rejected'));
        return await finish(known('outcome-unknown'));
      }
      return await finish(known('outcome-unknown'));
    }

    const deadline = Date.now() + timeouts.turnTimeoutMs;
    let agentText: string | null = null;
    while (Date.now() < deadline) {
      if (protocolFailure.current !== null) {
        const failureMessage = protocolFailure.current.message;
        if (
          failureMessage.includes('server-request') ||
          failureMessage.includes('forbidden-notification') ||
          failureMessage.includes('unknown-notification')
        )
          return await finish(known('policy-rejected'));
        return await finish(known('outcome-unknown'));
      }
      if (aborted()) return await finish(known('outcome-unknown'));
      if (transport.isExited()) return await finish(known('outcome-unknown'));
      let frame: ParsedFrame;
      try {
        frame = await waitNextNotification(Math.max(1, deadline - Date.now()));
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
        if (method === 'item/agentMessage/delta') continue;
        if (method === 'item/started' || method === 'item/completed') {
          const itemType = extractItemType(frame.value.params);
          if (itemType === null) return await finish(known('outcome-unknown'));
          // Forbidden types outrank correlation: missing/mismatched IDs still policy-rejected.
          if (isForbiddenItemType(itemType)) return await finish(known('policy-rejected'));
          const itemThread = notificationThreadId(frame.value.params);
          const itemTurn = notificationTurnId(frame.value.params);
          if (itemThread !== threadId || itemTurn !== turnId)
            return await finish(known('outcome-unknown'));
          if (!isAllowedItemType(itemType)) return await finish(known('policy-rejected'));
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
          if (decoded.threadId !== threadId) return await finish(known('outcome-unknown'));
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
      if (
        failureMessage.includes('forbidden-notification') ||
        failureMessage.includes('server-request')
      )
        return await finish(known('policy-rejected'));
      return await finish(known('provider-unavailable'));
    }
    if (!dispatchState.dispatched) {
      if (aborted()) return await finish(known('cancelled-before-invocation'));
      if (error instanceof Error && error.message === 'timeout')
        return await finish(known('known-timeout'));
      if (error instanceof Error && error.message === 'aborted')
        return await finish(known('cancelled-before-invocation'));
      if (error instanceof Error && error.message.startsWith('protocol:')) {
        if (
          error.message.includes('forbidden-notification') ||
          error.message.includes('server-request')
        )
          return await finish(known('policy-rejected'));
        return await finish(known('provider-unavailable'));
      }
      if (error instanceof Error && error.message === 'child-exited')
        return await finish(known('provider-unavailable'));
      return await finish(known('provider-unavailable'));
    }
    return await finish(known('outcome-unknown'));
  }
};

/** Test helper type for cleanup RPC labels. */
export type CleanupTraceSink = { readonly labels: string[] };
