/**
 * Child role runner for B3C4B durable composition Linux gate.
 * stdout: JSON Lines protocol only. stderr: diagnostics without secrets/paths.
 */
import { err } from '../../src/core/domain/result.ts';
import type {
  PosixDurableLocalHostCompositionResult,
  PosixDurableLocalHostOwner,
  PosixDurableLocalHostTestHooks,
} from '../../src/host/durable/create-posix-durable-local-host.ts';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../../src/host/durable/posix-durable-local-host-composition-diagnostics.ts';
import { GATE_PROTOCOL_VERSION } from './lib/constants.ts';
import { runChildGate } from './lib/child-gate.ts';
import { SerialCommandQueue, type CommandHandlerOutcome } from './lib/command-queue.ts';
import {
  buildReadConfirmationFromRecord,
  buildWriteConfirmationDetail,
  parseAuthorizationFailureCode,
  type ContentIdentity,
} from './lib/content-confirmation.ts';
import {
  buildHarnessCompositionInput,
  buildHarnessMemoryAccess,
  buildHarnessReadRequest,
  buildHarnessWriteCommand,
  HARNESS_CONTENT,
  harnessContentSha256,
} from './lib/harness-config.ts';
import {
  EXIT_ASSERTION_FAILURE,
  EXIT_COMPOSITION_FAILURE,
  EXIT_ENVIRONMENT_GATE_FAILED,
  EXIT_LOCK_CONTENTION,
  EXIT_PROTOCOL_FAILURE,
  EXIT_SUCCESS,
} from './lib/exit-codes.ts';
import {
  createInteractiveStdinState,
  interactiveHandleEof,
  interactiveIngestChunk,
  interactiveMarkFailed,
  interactiveMarkTerminalCommand,
  interactiveMarkTerminalEvent,
} from './lib/interactive-stdin.ts';
import { loadProductionFactory } from './lib/lazy-production.ts';
import {
  serializeProtocolMessage,
  type ParentCommand,
  type ProtocolMessage,
} from './lib/protocol.ts';

const DEFAULT_OWNER_ID = 'harness-owner';
const DEFAULT_RECORD_ID = 'harness-persisted-record';
const HARNESS_CONTENT_HASH = harnessContentSha256();

const gateResult = runChildGate(process.env);
if (!gateResult.ok) {
  process.stderr.write(`${gateResult.reason}\n`);
  const exitCode =
    gateResult.reason === 'UNKNOWN_ROLE' ? EXIT_PROTOCOL_FAILURE : EXIT_ENVIRONMENT_GATE_FAILED;
  process.exit(exitCode);
}

const {
  runId,
  role,
  storageRoot,
  repositoryRoot,
  expectedUid,
  useTestHooks,
  recordId: envRecordId,
  ownerId: envOwnerId,
} = gateResult;

const resolvedRecordId = envRecordId ?? DEFAULT_RECORD_ID;
const resolvedOwnerId = envOwnerId ?? DEFAULT_OWNER_ID;

const extractOwner = (
  result: PosixDurableLocalHostCompositionResult,
): PosixDurableLocalHostOwner => {
  if (result.ok) return result.value;
  throw new Error('Expected composition success');
};

const compositionErrorCode = (result: PosixDurableLocalHostCompositionResult): string => {
  if (result.ok) return 'COMPOSITION_FAILED';
  if ('error' in result && typeof result.error.code === 'string') return result.error.code;
  return 'COMPOSITION_FAILED';
};

const emit = (message: ProtocolMessage): void => {
  process.stdout.write(serializeProtocolMessage(message));
};

const emitFailed = (errorCode: string, exitCode: number): never => {
  emit({
    v: GATE_PROTOCOL_VERSION,
    runId,
    role,
    event: 'FAILED',
    pid: process.pid,
    errorCode,
  });
  process.exit(exitCode);
};

const expectedIdentity = (
  recordId: string,
  ownerId: string,
  namespace: string,
): ContentIdentity => ({
  recordId,
  ownerId,
  namespace,
  contentSha256: HARNESS_CONTENT_HASH,
});

const run = async (): Promise<void> => {
  if (role === 'flock-wait') {
    // Dedicated flock-holder script is preferred; this role is a safety fallback.
    emit({ v: GATE_PROTOCOL_VERSION, runId, role, event: 'READY', pid: process.pid });
    emitFailed('USE_DEDICATED_FLOCK_HOLDER', EXIT_PROTOCOL_FAILURE);
  }

  const factory = await loadProductionFactory();
  const input = buildHarnessCompositionInput(storageRoot, repositoryRoot, expectedUid);

  let hooks: PosixDurableLocalHostTestHooks | undefined;
  if (useTestHooks && role === 'rollback') {
    hooks = {
      loadSqliteFactory: () =>
        Promise.resolve({
          createSqliteMemoryPort: () =>
            err({
              code: 'SQLITE_OPEN_FAILED',
              reason: 'Injected SQLite open failure for rollback.',
            }),
        }),
    };
  }

  const openComposition = (): Promise<PosixDurableLocalHostCompositionResult> =>
    hooks === undefined
      ? factory.createPosixDurableLocalHost(input)
      : factory.createPosixDurableLocalHostWithTestHooks(input, hooks);

  if (role === 'contender') {
    const result = await openComposition();
    if (!result.ok) {
      const code = compositionErrorCode(result);
      if (code === 'DURABLE_COMPOSITION_LOCK_HELD') {
        emit({
          v: GATE_PROTOCOL_VERSION,
          runId,
          role,
          event: 'HELD',
          pid: process.pid,
          errorCode: code,
        });
        process.exit(EXIT_LOCK_CONTENTION);
      }
      emitFailed(code, EXIT_COMPOSITION_FAILURE);
    }
    emitFailed('UNEXPECTED_SUCCESS', EXIT_ASSERTION_FAILURE);
  }

  if (role === 'rollback') {
    const result = await openComposition();
    if (result.ok) {
      emitFailed('ROLLBACK_UNEXPECTED_SUCCESS', EXIT_ASSERTION_FAILURE);
    }
    emit({
      v: GATE_PROTOCOL_VERSION,
      runId,
      role,
      event: 'FAILED',
      pid: process.pid,
      errorCode: compositionErrorCode(result),
    });
    process.exit(EXIT_COMPOSITION_FAILURE);
  }

  const composed = await openComposition();
  if (!composed.ok) {
    emitFailed(compositionErrorCode(composed), EXIT_COMPOSITION_FAILURE);
  }
  const owner = extractOwner(composed);
  if (owner.diagnostics !== POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS) {
    emitFailed('DIAGNOSTICS_MISMATCH', EXIT_ASSERTION_FAILURE);
  }

  emit({ v: GATE_PROTOCOL_VERSION, runId, role, event: 'READY', pid: process.pid });

  const isInteractiveRole = role === 'normal' || role === 'holder';

  if (isInteractiveRole) {
    let stdinState = createInteractiveStdinState();
    let finishing = false;

    const failOnce = (errorCode: string): never => {
      if (!finishing) {
        finishing = true;
        stdinState = interactiveMarkFailed(stdinState);
        emitFailed(errorCode, EXIT_PROTOCOL_FAILURE);
      }
      process.exit(EXIT_PROTOCOL_FAILURE);
    };

    const executeCommand = async (
      _line: string,
      command: ParentCommand | null,
    ): Promise<CommandHandlerOutcome> => {
      if (command === null) {
        return { kind: 'terminal-fail', errorCode: 'MALFORMED_PARENT_COMMAND' };
      }
      if (command.command === 'EXIT') {
        stdinState = interactiveMarkTerminalCommand(stdinState);
        stdinState = interactiveMarkTerminalEvent(stdinState);
        return { kind: 'stop' };
      }
      if (command.command === 'CLOSE') {
        stdinState = interactiveMarkTerminalCommand(stdinState);
        const closed = owner.close();
        if (!closed.ok) {
          return { kind: 'terminal-fail', errorCode: 'CLOSE_FAILED' };
        }
        emit({ v: GATE_PROTOCOL_VERSION, runId, role, event: 'CLOSED', pid: process.pid });
        stdinState = interactiveMarkTerminalEvent(stdinState);
        finishing = true;
        process.exit(EXIT_SUCCESS);
      }
      if (command.command === 'WRITE') {
        const namespace = command.namespace as 'personal' | 'ai-my-time';
        const access = buildHarnessMemoryAccess(command.ownerId, namespace);
        const writeResult = await owner.host.writeMemory(
          access,
          buildHarnessWriteCommand(command.recordId),
        );
        if (!writeResult.ok) {
          return { kind: 'terminal-fail', errorCode: 'WRITE_FAILED' };
        }
        const confirmation = buildWriteConfirmationDetail({
          recordId: String(writeResult.value.recordId),
          ownerId: command.ownerId,
          namespace,
          writtenContent: HARNESS_CONTENT,
          expectedContentSha256: HARNESS_CONTENT_HASH,
        });
        if (!confirmation.ok) {
          return { kind: 'terminal-fail', errorCode: confirmation.reason };
        }
        emit({
          v: GATE_PROTOCOL_VERSION,
          runId,
          role,
          event: 'WRITE_CONFIRMED',
          pid: process.pid,
          detail: confirmation.detail,
        });
        return { kind: 'continue' };
      }
      {
        const accessNamespace = command.namespace as 'personal' | 'ai-my-time';
        const expectedOwnerId = command.expectedOwnerId ?? command.ownerId;
        const expectedNamespace = (command.expectedNamespace ?? command.namespace) as
          'personal' | 'ai-my-time';
        const access = buildHarnessMemoryAccess(command.ownerId, accessNamespace);
        const readResult = await owner.host.readMemory(
          access,
          buildHarnessReadRequest(command.recordId, expectedOwnerId, expectedNamespace),
        );
        if (!readResult.ok) {
          const domainCode =
            typeof readResult.error.code === 'string' ? readResult.error.code : 'READ_FAILED';
          const reason =
            'reason' in readResult.error && typeof readResult.error.reason === 'string'
              ? readResult.error.reason
              : undefined;
          const authorizationCode = parseAuthorizationFailureCode(domainCode, reason);
          if (authorizationCode !== null) {
            emit({
              v: GATE_PROTOCOL_VERSION,
              runId,
              role,
              event: 'READ_REJECTED',
              pid: process.pid,
              errorCode: domainCode,
              detail: {
                recordId: command.recordId,
                ownerId: command.ownerId,
                namespace: accessNamespace,
                expectedOwnerId,
                expectedNamespace,
                authorizationCode,
                proofType: authorizationCode,
                domainCode,
              },
            });
            return { kind: 'continue' };
          }
          return { kind: 'terminal-fail', errorCode: domainCode };
        }
        const confirmation = buildReadConfirmationFromRecord(
          readResult.value,
          expectedIdentity(command.recordId, expectedOwnerId, expectedNamespace),
        );
        if (!confirmation.ok) {
          return { kind: 'terminal-fail', errorCode: confirmation.reason };
        }
        emit({
          v: GATE_PROTOCOL_VERSION,
          runId,
          role,
          event: 'READ_CONFIRMED',
          pid: process.pid,
          detail: confirmation.detail,
        });
        return { kind: 'continue' };
      }
    };

    const queue = new SerialCommandQueue({
      handler: async (line, command) => executeCommand(line, command),
      onTerminalFail: (errorCode) => {
        if (finishing) return;
        finishing = true;
        stdinState = interactiveMarkFailed(stdinState);
        if (
          errorCode === 'CLOSE_FAILED' ||
          errorCode === 'WRITE_FAILED' ||
          errorCode === 'READ_FAILED' ||
          errorCode === 'READ_NOT_FOUND'
        ) {
          emitFailed(errorCode, EXIT_COMPOSITION_FAILURE);
        }
        if (
          errorCode === 'CONTENT_HASH_MISMATCH' ||
          errorCode === 'IDENTITY_MISMATCH' ||
          errorCode.startsWith('CONTENT_')
        ) {
          emitFailed(errorCode, EXIT_ASSERTION_FAILURE);
        }
        emitFailed(errorCode, EXIT_PROTOCOL_FAILURE);
      },
    });

    await new Promise<void>((resolvePromise) => {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk: string | Buffer) => {
        if (finishing || queue.isTerminal()) return;
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const ingested = interactiveIngestChunk(stdinState, text);
        stdinState = ingested.state;
        for (const action of ingested.actions) {
          if (action.kind === 'fail') {
            failOnce(action.reason);
            return;
          }
          if (action.kind === 'lines') {
            for (const line of action.lines) {
              queue.enqueue(line);
            }
          }
        }
      });
      process.stdin.on('end', () => {
        void (async () => {
          if (finishing) {
            resolvePromise();
            return;
          }
          await queue.waitIdle();
          const eofResult = interactiveHandleEof(stdinState);
          stdinState = eofResult.state;
          for (const action of eofResult.actions) {
            if (action.kind === 'fail') {
              failOnce(action.reason);
              return;
            }
          }
          if (queue.isFailed()) {
            resolvePromise();
            return;
          }
          const queueEof = await queue.handleEof();
          if (queueEof === 'failed') {
            // onTerminalFail already emitted FAILED
            resolvePromise();
            return;
          }
          resolvePromise();
        })();
      });
      process.stdin.on('error', () => {
        failOnce('EOF_WITHOUT_TERMINAL');
      });
    });
    return;
  }

  if (role === 'writer') {
    const access = buildHarnessMemoryAccess(resolvedOwnerId);
    const writeResult = await owner.host.writeMemory(
      access,
      buildHarnessWriteCommand(resolvedRecordId),
    );
    if (!writeResult.ok) emitFailed('WRITE_FAILED', EXIT_COMPOSITION_FAILURE);
    else {
      const confirmation = buildWriteConfirmationDetail({
        recordId: String(writeResult.value.recordId),
        ownerId: resolvedOwnerId,
        namespace: 'personal',
        writtenContent: HARNESS_CONTENT,
        expectedContentSha256: HARNESS_CONTENT_HASH,
      });
      if (!confirmation.ok) emitFailed(confirmation.reason, EXIT_ASSERTION_FAILURE);
      else {
        emit({
          v: GATE_PROTOCOL_VERSION,
          runId,
          role,
          event: 'WRITE_CONFIRMED',
          pid: process.pid,
          detail: confirmation.detail,
        });
      }
    }
    owner.close();
    emit({ v: GATE_PROTOCOL_VERSION, runId, role, event: 'CLOSED', pid: process.pid });
    process.exit(EXIT_SUCCESS);
  }

  if (role === 'reader') {
    const access = buildHarnessMemoryAccess(resolvedOwnerId);
    const readResult = await owner.host.readMemory(
      access,
      buildHarnessReadRequest(resolvedRecordId, resolvedOwnerId),
    );
    if (!readResult.ok) emitFailed('READ_NOT_FOUND', EXIT_COMPOSITION_FAILURE);
    else {
      const confirmation = buildReadConfirmationFromRecord(
        readResult.value,
        expectedIdentity(resolvedRecordId, resolvedOwnerId, 'personal'),
      );
      if (!confirmation.ok) emitFailed(confirmation.reason, EXIT_ASSERTION_FAILURE);
      else {
        emit({
          v: GATE_PROTOCOL_VERSION,
          runId,
          role,
          event: 'READ_CONFIRMED',
          pid: process.pid,
          detail: confirmation.detail,
        });
      }
    }
    owner.close();
    emit({ v: GATE_PROTOCOL_VERSION, runId, role, event: 'CLOSED', pid: process.pid });
    process.exit(EXIT_SUCCESS);
  }

  if (role === 'repeated-close') {
    const first = owner.close();
    const second = owner.close();
    if (!first.ok || !second.ok) {
      emitFailed('REPEATED_CLOSE_FAILED', EXIT_COMPOSITION_FAILURE);
    }
    emit({
      v: GATE_PROTOCOL_VERSION,
      runId,
      role,
      event: 'CLOSED',
      pid: process.pid,
      detail: { closeCount: 2 },
    });
    process.exit(EXIT_SUCCESS);
  }

  emitFailed('UNKNOWN_ROLE', EXIT_PROTOCOL_FAILURE);
};

void run().catch(() => {
  process.exit(EXIT_COMPOSITION_FAILURE);
});
