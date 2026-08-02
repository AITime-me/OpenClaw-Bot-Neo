import {
  parseNeoStatusCliArguments,
  type ParsedNeoStatusCliArguments,
} from './parse-neo-status-cli-arguments.js';
import {
  createNodeNeoReadinessFileReader,
  type NeoReadinessFileReaderPort,
} from './read-neo-readiness-file.js';
import { toNeoReadinessStatusOutput } from './parse-neo-readiness-document.js';

export const NEO_STATUS_EXIT_SUCCESS = 0 as const;
export const NEO_STATUS_EXIT_NOT_READY = 1 as const;
export const NEO_STATUS_EXIT_INVALID = 2 as const;
export const NEO_STATUS_EXIT_TIMEOUT = 3 as const;

export type NeoStatusExitCode =
  | typeof NEO_STATUS_EXIT_SUCCESS
  | typeof NEO_STATUS_EXIT_NOT_READY
  | typeof NEO_STATUS_EXIT_INVALID
  | typeof NEO_STATUS_EXIT_TIMEOUT;

export type ReadNeoStatusResult = {
  readonly exitCode: NeoStatusExitCode;
  readonly output?: string;
};

export type ReadNeoStatusDeps = {
  readonly argv: readonly string[];
  readonly reader: NeoReadinessFileReaderPort;
  readonly nowMs: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly writeStdout: (line: string) => void;
};

const emitStatus = (deps: ReadNeoStatusDeps, payload: unknown): void => {
  deps.writeStdout(JSON.stringify(payload));
};

const readOnce = async (
  deps: ReadNeoStatusDeps,
  executionRoot: string,
): Promise<ReadNeoStatusResult> => {
  const result = await deps.reader.read(executionRoot);
  if (!result.ok) {
    if (result.reason === 'absent') {
      emitStatus(deps, { ready: false, reason: 'readiness-absent' });
      return { exitCode: NEO_STATUS_EXIT_NOT_READY };
    }
    emitStatus(deps, { ready: false, reason: 'readiness-invalid' });
    return { exitCode: NEO_STATUS_EXIT_INVALID };
  }
  emitStatus(deps, toNeoReadinessStatusOutput(result.document));
  return { exitCode: NEO_STATUS_EXIT_SUCCESS };
};

const waitForReady = async (
  deps: ReadNeoStatusDeps,
  args: Extract<ParsedNeoStatusCliArguments, { kind: 'read' }>,
): Promise<ReadNeoStatusResult> => {
  const deadline = deps.nowMs() + args.timeoutMs;
  while (deps.nowMs() < deadline) {
    const result = await deps.reader.read(args.executionRoot);
    if (result.ok) {
      emitStatus(deps, toNeoReadinessStatusOutput(result.document));
      return { exitCode: NEO_STATUS_EXIT_SUCCESS };
    }
    if (result.reason === 'invalid' || result.reason === 'unreadable') {
      emitStatus(deps, { ready: false, reason: 'readiness-invalid' });
      return { exitCode: NEO_STATUS_EXIT_INVALID };
    }
    const remaining = deadline - deps.nowMs();
    if (remaining <= 0) break;
    await deps.sleep(Math.min(args.pollIntervalMs, remaining));
  }
  emitStatus(deps, { ready: false, reason: 'readiness-timeout' });
  return { exitCode: NEO_STATUS_EXIT_TIMEOUT };
};

export const readNeoStatus = async (deps: ReadNeoStatusDeps): Promise<ReadNeoStatusResult> => {
  const parsed = parseNeoStatusCliArguments(deps.argv);
  if (!parsed.ok) {
    emitStatus(deps, { ready: false, reason: 'invalid-cli' });
    return { exitCode: NEO_STATUS_EXIT_INVALID };
  }
  if (parsed.value.kind === 'help') {
    deps.writeStdout(
      JSON.stringify({
        tool: 'neo-status',
        usage: [
          '--execution-root <absolute-directory>',
          '[--wait-ready] [--timeout-ms <ms>]',
          '--help',
        ],
      }),
    );
    return { exitCode: NEO_STATUS_EXIT_SUCCESS };
  }

  if (parsed.value.waitReady) {
    return waitForReady(deps, parsed.value);
  }
  return readOnce(deps, parsed.value.executionRoot);
};

export const readNeoStatusFromNode = async (): Promise<ReadNeoStatusResult> =>
  readNeoStatus({
    argv: process.argv.slice(2),
    reader: createNodeNeoReadinessFileReader(),
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeStdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
