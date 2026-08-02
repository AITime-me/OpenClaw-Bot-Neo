import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildRole, ProtocolEvent } from './constants.ts';
import { GATE_PROTOCOL_VERSION } from './constants.ts';
import { buildChildEnvironment } from './child-env.ts';
import { EXIT_PROTOCOL_FAILURE, mapEventToExpectedExit } from './exit-codes.ts';
import { globalProcessRegistry } from './process-registry.ts';
import { createProtocolEventStream, type ProtocolEventStream } from './protocol-event-stream.ts';
import {
  parseProtocolLine,
  ProtocolStateTracker,
  serializeParentCommand,
  type ParentCommand,
  type ProtocolMessage,
} from './protocol.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CHILD_SCRIPT_PATH = join(__dirname, '..', 'durable-composition-linux-child.ts');
export const FLOCK_HOLDER_SCRIPT_PATH = join(
  __dirname,
  '..',
  'durable-composition-linux-flock-holder.ts',
);

const MAX_STDOUT_BYTES = 1_048_576;

export type ChildSessionOptions = {
  readonly runId: string;
  readonly role: ChildRole;
  readonly storageRoot: string;
  readonly executionRoot: string;
  readonly repositoryRoot: string;
  readonly expectedUid: number;
  readonly capability: string;
  readonly realStorageRootPath: string;
  readonly storageInode: number;
  readonly storageDevice: number;
  readonly realExecutionRootPath: string;
  readonly executionInode: number;
  readonly executionDevice: number;
  readonly markerInode: number;
  readonly markerDevice: number;
  readonly homePath: string;
  readonly tmpPath: string;
  readonly gateEnv: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly scenario?: string;
  readonly useTestHooks?: boolean;
  readonly recordId?: string;
  readonly ownerId?: string;
  /** Shared abort signal — rejects pending event waiters immediately. */
  readonly abortSignal?: AbortSignal;
};

export type ChildSessionResult = {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly messages: readonly ProtocolMessage[];
  readonly protocolError: string | null;
  readonly timedOut: boolean;
  readonly registryId: string;
};

export type ChildSessionHandle = {
  readonly process: ChildProcess;
  readonly registryId: string;
  /** Strict: consume next protocol event and require exact type. */
  readonly waitForEvent: (event: ProtocolEvent) => Promise<ProtocolMessage>;
  /** Strict: consume next protocol event and require exact type (fail-fast). */
  readonly waitForNextEvent: (event: ProtocolEvent) => Promise<ProtocolMessage>;
  /** Consume the next protocol event in arrival order (caller validates). */
  readonly waitForNextProtocolEvent: () => Promise<ProtocolMessage>;
  /** Alias of waitForNextEvent with explicit naming. */
  readonly expectNextEvent: (event: ProtocolEvent) => Promise<ProtocolMessage>;
  readonly waitForCompletion: () => Promise<ChildSessionResult>;
  readonly sendCommand: (command: ParentCommand) => void;
  readonly isAlive: () => boolean;
  readonly pendingEventWaiterCount: () => number;
  readonly eventStream: ProtocolEventStream;
};

export const spawnChildSession = (options: ChildSessionOptions): ChildSessionHandle => {
  const parentEnv = options.parentEnv ?? process.env;
  const childEnv = buildChildEnvironment(
    parentEnv,
    {
      ...options.gateEnv,
      OPENCLAW_B3C4_RUN_ID: options.runId,
      OPENCLAW_B3C4_ROLE: options.role,
      OPENCLAW_B3C4_PROTOCOL_VERSION: String(GATE_PROTOCOL_VERSION),
      OPENCLAW_B3C4_STORAGE_ROOT: options.storageRoot,
      OPENCLAW_B3C4_STORAGE_REALPATH: options.realStorageRootPath,
      OPENCLAW_B3C4_STORAGE_DEV: String(options.storageDevice),
      OPENCLAW_B3C4_STORAGE_INODE: String(options.storageInode),
      OPENCLAW_B3C4_EXECUTION_ROOT: options.executionRoot,
      OPENCLAW_B3C4_EXECUTION_REALPATH: options.realExecutionRootPath,
      OPENCLAW_B3C4_EXECUTION_DEV: String(options.executionDevice),
      OPENCLAW_B3C4_EXECUTION_INODE: String(options.executionInode),
      OPENCLAW_B3C4_MARKER_DEV: String(options.markerDevice),
      OPENCLAW_B3C4_MARKER_INODE: String(options.markerInode),
      OPENCLAW_B3C4_PARENT_CAPABILITY: options.capability,
      OPENCLAW_B3C4_REPOSITORY_ROOT: options.repositoryRoot,
      OPENCLAW_B3C4_EXPECTED_UID: String(options.expectedUid),
      ...(options.scenario !== undefined ? { OPENCLAW_B3C4_SCENARIO: options.scenario } : {}),
      ...(options.useTestHooks === true ? { OPENCLAW_B3C4_USE_TEST_HOOKS: '1' } : {}),
      ...(options.recordId !== undefined ? { OPENCLAW_B3C4_RECORD_ID: options.recordId } : {}),
      ...(options.ownerId !== undefined ? { OPENCLAW_B3C4_OWNER_ID: options.ownerId } : {}),
    },
    { home: options.homePath, tmpdir: options.tmpPath },
  );

  const child = spawn(process.execPath, ['--experimental-strip-types', CHILD_SCRIPT_PATH], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform === 'linux',
  });

  const registryId = globalProcessRegistry.register(child);

  const messages: ProtocolMessage[] = [];
  const tracker = new ProtocolStateTracker();
  const eventStream = createProtocolEventStream();
  let protocolError: string | null = null;
  let timedOut = false;
  let buffer = '';
  let stdoutBytes = 0;
  let completionResolve: ((result: ChildSessionResult) => void) | null = null;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let lifecycleWakeDone = false;
  let completionSettled = false;
  const abortSignal = options.abortSignal;

  const failStream = (
    code: 'PROTOCOL_ERROR' | 'PARTIAL_LINE' | 'TIMED_OUT' | 'CHILD_EXITED' | 'CHILD_CLOSED',
    extra?: {
      readonly exitCode?: number | null;
      readonly signal?: string | null;
      readonly protocolError?: string;
    },
  ): void => {
    if (eventStream.isClosed()) return;
    eventStream.close({
      code,
      timedOut: timedOut || code === 'TIMED_OUT',
      ...(extra?.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
      ...(extra?.signal !== undefined ? { signal: extra.signal } : {}),
      ...(extra?.protocolError !== undefined ? { protocolError: extra.protocolError } : {}),
    });
  };

  const wakeEventWaitersFromLifecycle = (): void => {
    if (lifecycleWakeDone) return;
    lifecycleWakeDone = true;
    if (timedOut) {
      failStream('TIMED_OUT', {
        exitCode,
        signal,
        ...(protocolError !== null ? { protocolError } : {}),
      });
      return;
    }
    if (protocolError !== null) {
      failStream('PROTOCOL_ERROR', {
        exitCode,
        signal,
        protocolError,
      });
      return;
    }
    const code = signal !== null ? 'CHILD_EXITED' : 'CHILD_CLOSED';
    failStream(code, { exitCode, signal });
  };

  const ingestLine = (line: string): void => {
    if (line.length === 0) return;
    const parsed = parseProtocolLine(line, options.runId, options.role);
    if (!parsed.ok) {
      protocolError = parsed.error;
      failStream('PROTOCOL_ERROR', { protocolError: parsed.error });
      return;
    }
    const orderError = tracker.validateOrder(parsed.value.event);
    if (orderError !== null) {
      protocolError = orderError;
      messages.push(parsed.value);
      eventStream.push(parsed.value);
      failStream('PROTOCOL_ERROR', { protocolError: orderError });
      return;
    }
    messages.push(parsed.value);
    eventStream.push(parsed.value);
  };

  child.stdout.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    stdoutBytes += Buffer.byteLength(text, 'utf8');
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      protocolError = 'LINE_TOO_LONG';
      failStream('PROTOCOL_ERROR', { protocolError: 'LINE_TOO_LONG' });
      return;
    }
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      ingestLine(line);
      newline = buffer.indexOf('\n');
    }
  });

  const sendCommand = (command: ParentCommand): void => {
    child.stdin.write(serializeParentCommand(command));
  };

  const buildResult = (): ChildSessionResult => ({
    exitCode,
    signal,
    messages,
    protocolError,
    timedOut,
    registryId,
  });

  const settleCompletion = (): void => {
    if (completionSettled) return;
    completionSettled = true;
    const result = buildResult();
    completionResolve?.(result);
    completionResolve = null;
  };

  const waitForCompletion = (): Promise<ChildSessionResult> => {
    if (completionSettled) return Promise.resolve(buildResult());
    if (completionResolve !== null) {
      return new Promise((resolvePromise) => {
        const prior = completionResolve;
        completionResolve = (result) => {
          prior?.(result);
          resolvePromise(result);
        };
      });
    }
    return new Promise((resolvePromise) => {
      completionResolve = resolvePromise;
    });
  };

  const expectNextEvent = (event: ProtocolEvent): Promise<ProtocolMessage> =>
    eventStream.expectNextEvent(event, abortSignal);

  const waitForNextProtocolEvent = (): Promise<ProtocolMessage> =>
    eventStream.waitForNextProtocolEvent(abortSignal);

  const isAlive = (): boolean =>
    exitCode === null && signal === null && child.exitCode === null && child.signalCode === null;

  const timer = setTimeout(() => {
    timedOut = true;
    // Fail waiters immediately — do not wait for process death.
    failStream('TIMED_OUT', {
      exitCode,
      signal,
      ...(protocolError !== null ? { protocolError } : {}),
    });
    lifecycleWakeDone = true;
    terminateChildGroup(child);
  }, options.timeoutMs);

  child.on('exit', (code, exitSignal) => {
    exitCode = code;
    signal = exitSignal;
    wakeEventWaitersFromLifecycle();
  });

  child.on('close', (code, closeSignal) => {
    clearTimeout(timer);
    exitCode = code ?? exitCode;
    signal = closeSignal ?? signal;
    globalProcessRegistry.markExited(registryId);
    if (buffer.trim().length > 0) {
      ingestLine(buffer.trim());
    } else if (buffer.length > 0) {
      protocolError = protocolError ?? 'PARTIAL_LINE';
      failStream('PARTIAL_LINE', { protocolError: 'PARTIAL_LINE', exitCode, signal });
    }
    wakeEventWaitersFromLifecycle();
    settleCompletion();
  });

  return {
    process: child,
    registryId,
    waitForEvent: expectNextEvent,
    waitForNextEvent: expectNextEvent,
    waitForNextProtocolEvent,
    expectNextEvent,
    waitForCompletion,
    sendCommand,
    isAlive,
    pendingEventWaiterCount: () => eventStream.pendingWaiterCount(),
    eventStream,
  };
};

export const terminateChildGroup = (child: ChildProcess): void => {
  if (child.pid === undefined) return;
  if (process.platform === 'linux') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // fall through
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // best effort
  }
};

export const killChildProcessGroup = (child: ChildProcess): void => {
  if (child.pid === undefined) return;
  if (process.platform === 'linux') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // fall through
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // best effort
  }
};

export const validateChildExit = (
  result: ChildSessionResult,
  terminalEvent: ProtocolEvent | null,
): boolean => {
  if (result.timedOut) return false;
  if (result.protocolError !== null) return false;
  if (result.exitCode === null) return false;
  if (terminalEvent === null) return result.exitCode === EXIT_PROTOCOL_FAILURE;
  return result.exitCode === mapEventToExpectedExit(terminalEvent);
};
