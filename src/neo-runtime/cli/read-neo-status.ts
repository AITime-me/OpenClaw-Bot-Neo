import process from 'node:process';
import {
  parseNeoStatusCliArguments,
  type ParsedNeoStatusCliArguments,
} from './parse-neo-status-cli-arguments.js';
import {
  createNodeNeoReadinessFileReader,
  type NeoReadinessFileReaderPort,
} from './read-neo-readiness-file.js';
import {
  toNeoReadinessStatusOutput,
  type NeoReadinessStatusDocument,
} from './parse-neo-readiness-document.js';
import type { ProcessInstanceIdentityProvider } from '../process-identity/process-instance-identity-provider.port.js';
import { createNodeProcessInstanceProvider } from '../process-identity/create-node-process-instance-provider.js';
import { verifyNeoReadinessProcessIdentity } from './verify-neo-readiness-process-identity.js';

export const NEO_STATUS_EXIT_SUCCESS = 0 as const;
export const NEO_STATUS_EXIT_NOT_READY = 1 as const;
export const NEO_STATUS_EXIT_INVALID = 2 as const;
export const NEO_STATUS_EXIT_TIMEOUT = 3 as const;

export type NeoStatusExitCode =
  | typeof NEO_STATUS_EXIT_SUCCESS
  | typeof NEO_STATUS_EXIT_NOT_READY
  | typeof NEO_STATUS_EXIT_INVALID
  | typeof NEO_STATUS_EXIT_TIMEOUT;

export type NeoStatusNotReadyReason =
  | 'readiness-absent'
  | 'readiness-legacy-unbound'
  | 'readiness-invalid'
  | 'process-identity-missing'
  | 'process-identity-invalid'
  | 'process-identity-unavailable'
  | 'process-boot-mismatch'
  | 'process-absent'
  | 'process-zombie'
  | 'process-identity-mismatch'
  | 'readiness-timeout'
  | 'invalid-cli';

export type ReadNeoStatusResult = {
  readonly exitCode: NeoStatusExitCode;
  readonly output?: string;
};

export type ReadNeoStatusDeps = {
  readonly argv: readonly string[];
  readonly reader: NeoReadinessFileReaderPort;
  readonly processInstance: ProcessInstanceIdentityProvider;
  readonly nowMs: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly writeStdout: (line: string) => void;
};

const emitStatus = (deps: ReadNeoStatusDeps, payload: unknown): void => {
  deps.writeStdout(JSON.stringify(payload));
};

const exitForNotReadyReason = (reason: NeoStatusNotReadyReason): NeoStatusExitCode => {
  if (
    reason === 'readiness-invalid' ||
    reason === 'invalid-cli' ||
    reason === 'process-identity-invalid'
  ) {
    return NEO_STATUS_EXIT_INVALID;
  }
  return NEO_STATUS_EXIT_NOT_READY;
};

const evaluateReadiness = async (
  deps: ReadNeoStatusDeps,
  executionRoot: string,
): Promise<
  | { readonly kind: 'ready'; readonly document: NeoReadinessStatusDocument }
  | { readonly kind: 'not-ready'; readonly reason: NeoStatusNotReadyReason }
> => {
  const result = await deps.reader.read(executionRoot);
  if (!result.ok) {
    if (result.reason === 'absent') {
      return { kind: 'not-ready', reason: 'readiness-absent' };
    }
    if (result.reason === 'legacy-unbound') {
      return { kind: 'not-ready', reason: 'readiness-legacy-unbound' };
    }
    return { kind: 'not-ready', reason: 'readiness-invalid' };
  }

  const verified = await verifyNeoReadinessProcessIdentity(result.document, deps.processInstance);
  if (!verified.ok) {
    return { kind: 'not-ready', reason: verified.reason };
  }

  return { kind: 'ready', document: result.document };
};

const readOnce = async (
  deps: ReadNeoStatusDeps,
  executionRoot: string,
): Promise<ReadNeoStatusResult> => {
  const evaluated = await evaluateReadiness(deps, executionRoot);
  if (evaluated.kind === 'ready') {
    emitStatus(deps, toNeoReadinessStatusOutput(evaluated.document));
    return { exitCode: NEO_STATUS_EXIT_SUCCESS };
  }
  emitStatus(deps, { ready: false, reason: evaluated.reason });
  return { exitCode: exitForNotReadyReason(evaluated.reason) };
};

const waitForReady = async (
  deps: ReadNeoStatusDeps,
  args: Extract<ParsedNeoStatusCliArguments, { kind: 'read' }>,
): Promise<ReadNeoStatusResult> => {
  const deadline = deps.nowMs() + args.timeoutMs;
  while (deps.nowMs() < deadline) {
    const evaluated = await evaluateReadiness(deps, args.executionRoot);
    if (evaluated.kind === 'ready') {
      emitStatus(deps, toNeoReadinessStatusOutput(evaluated.document));
      return { exitCode: NEO_STATUS_EXIT_SUCCESS };
    }
    if (
      evaluated.reason === 'readiness-invalid' ||
      evaluated.reason === 'process-identity-invalid'
    ) {
      emitStatus(deps, { ready: false, reason: evaluated.reason });
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
    processInstance: createNodeProcessInstanceProvider(),
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeStdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
