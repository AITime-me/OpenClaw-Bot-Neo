/**
 * External flock holder for scenario G.
 * Parent wraps this script with `flock --exclusive`; READY means the lock is held.
 * Stdin EOF / partial line without terminal command → FAILED + exit 50.
 */
import { GATE_PROTOCOL_VERSION } from './lib/constants.ts';
import type { ChildRole } from './lib/constants.ts';
import { runChildGate } from './lib/child-gate.ts';
import {
  EXIT_ENVIRONMENT_GATE_FAILED,
  EXIT_PROTOCOL_FAILURE,
  EXIT_SUCCESS,
} from './lib/exit-codes.ts';
import {
  createFlockHolderMachine,
  flockHolderHandleEof,
  flockHolderIngestChunk,
  type FlockHolderAction,
} from './lib/flock-holder-protocol.ts';
import { serializeProtocolMessage } from './lib/protocol.ts';

const emit = (runId: string, event: 'READY' | 'CLOSED' | 'FAILED', errorCode?: string): void => {
  const message = {
    v: GATE_PROTOCOL_VERSION,
    runId,
    role: 'flock-wait' as ChildRole,
    event,
    pid: process.pid,
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
  process.stdout.write(serializeProtocolMessage(message));
};

const gate = runChildGate(process.env);
if (!gate.ok) {
  process.stderr.write(`${gate.reason}\n`);
  const exitCode =
    gate.reason === 'UNKNOWN_ROLE' ? EXIT_PROTOCOL_FAILURE : EXIT_ENVIRONMENT_GATE_FAILED;
  process.exit(exitCode);
}

const runId = gate.runId;
let machine = createFlockHolderMachine();
let finishing = false;

const failOnce = (reason: string): void => {
  if (finishing) return;
  finishing = true;
  emit(runId, 'FAILED', reason);
  process.exit(EXIT_PROTOCOL_FAILURE);
};

const closeOnce = (): void => {
  if (finishing) return;
  finishing = true;
  emit(runId, 'CLOSED');
  process.exit(EXIT_SUCCESS);
};

const applyActions = (actions: readonly FlockHolderAction[]): void => {
  for (const action of actions) {
    if (action.kind === 'fail') {
      failOnce(action.reason);
      return;
    }
    if (action.kind === 'close') {
      closeOnce();
      return;
    }
  }
};

emit(runId, 'READY');

process.on('SIGTERM', () => {
  if (!finishing) {
    closeOnce();
  }
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string | Buffer) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const result = flockHolderIngestChunk(machine, text);
  machine = result.state;
  applyActions(result.actions);
});

process.stdin.on('end', () => {
  const result = flockHolderHandleEof(machine);
  machine = result.state;
  applyActions(result.actions);
});

process.stdin.on('error', () => {
  failOnce('EOF_WITHOUT_TERMINAL');
});
