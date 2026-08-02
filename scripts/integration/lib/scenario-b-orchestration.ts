import type { ProtocolEvent } from './constants.ts';
import { GateAbortedError } from './cleanup-controller.ts';
import type { ChildSessionResult } from './child-runner.ts';
import { ProtocolEventWaitError, type EventWaitFailureCode } from './protocol-event-stream.ts';
import {
  assertReadConfirmationMatches,
  assertWriteConfirmationMatches,
} from './scenario-orchestration.ts';
import type { ParentCommand, ProtocolMessage } from './protocol.ts';

export type ScenarioBIds = {
  readonly ownerId: string;
  readonly foreignOwnerId: string;
  readonly recordId: string;
};

export type ScenarioBExpectation = {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly contentSha256: string;
};

export type ScenarioBSession = {
  readonly sendCommand: (command: ParentCommand) => void;
  /**
   * Consume the very next protocol event and require exact type.
   * Must reject (not hang) on FAILED, unexpected, exit, close, timeout, abort.
   */
  readonly waitForNextEvent: (event: ProtocolEvent) => Promise<ProtocolMessage>;
  readonly waitForCompletion: () => Promise<ChildSessionResult>;
  readonly isAlive: () => boolean;
};

export type ScenarioBOrchestrationResult = {
  readonly pass: boolean;
  readonly detail?: string;
  readonly steps: readonly string[];
  readonly messages: readonly ProtocolMessage[];
};

const isRejectedProof = (
  message: ProtocolMessage,
  proofType: 'OWNER_MISMATCH' | 'NAMESPACE_ISOLATED',
): boolean => {
  if (message.event !== 'READ_REJECTED' || message.errorCode !== 'POLICY_DENIED') return false;
  const detail = message.detail;
  if (detail === undefined) return false;
  return (
    detail['authorizationCode'] === proofType &&
    detail['proofType'] === proofType &&
    detail['domainCode'] === 'POLICY_DENIED'
  );
};

const mapWaitFailure = (error: ProtocolEventWaitError): string => {
  const code: EventWaitFailureCode = error.code;
  if (code === 'FAILED_EVENT') {
    return error.observedErrorCode !== undefined
      ? `failed-event:${error.observedErrorCode}`
      : 'failed-event';
  }
  if (code === 'UNEXPECTED_EVENT') return `unexpected-event:${String(error.observedEvent)}`;
  if (code === 'UNEXPECTED_TERMINAL') {
    return `unexpected-terminal:${String(error.observedEvent)}`;
  }
  if (code === 'CHILD_EXITED' || code === 'CHILD_CLOSED') return 'child-exited-early';
  if (code === 'TIMED_OUT') return 'timed-out';
  if (code === 'PROTOCOL_ERROR' || code === 'PARTIAL_LINE') {
    return `protocol:${error.protocolError ?? code}`;
  }
  if (code === 'WAITER_CONFLICT') return 'waiter-conflict';
  if (code === 'STREAM_CLOSED') return 'stream-closed';
  return `event-wait:${code}`;
};

/**
 * Strict event-driven Scenario B parent orchestration.
 * Exactly one command is in flight; each step consumes the next event in arrival order.
 */
export const runScenarioBOrchestration = async (
  session: ScenarioBSession,
  ids: ScenarioBIds,
  expected: ScenarioBExpectation,
  options: {
    readonly throwIfAborted: () => void;
  },
): Promise<ScenarioBOrchestrationResult> => {
  const steps: string[] = [];
  const fail = (detail: string): ScenarioBOrchestrationResult => ({
    pass: false,
    detail,
    steps,
    messages: [],
  });

  const awaitEvent = async (
    event: ProtocolEvent,
  ): Promise<ProtocolMessage | ScenarioBOrchestrationResult> => {
    options.throwIfAborted();
    try {
      const message = await session.waitForNextEvent(event);
      options.throwIfAborted();
      return message;
    } catch (error) {
      if (error instanceof GateAbortedError) throw error;
      if (error instanceof ProtocolEventWaitError) return fail(mapWaitFailure(error));
      throw error;
    }
  };

  const isFail = (
    value: ProtocolMessage | ScenarioBOrchestrationResult,
  ): value is ScenarioBOrchestrationResult => 'pass' in value && !value.pass;

  // 1–2: wait READY
  options.throwIfAborted();
  const ready = await awaitEvent('READY');
  if (isFail(ready)) return ready;
  steps.push('READY');

  // 3–5: WRITE → WRITE_CONFIRMED
  options.throwIfAborted();
  session.sendCommand({
    command: 'WRITE',
    ownerId: ids.ownerId,
    namespace: 'personal',
    recordId: ids.recordId,
  });
  steps.push('SEND_WRITE');
  const writeConfirmed = await awaitEvent('WRITE_CONFIRMED');
  if (isFail(writeConfirmed)) return writeConfirmed;
  if (!assertWriteConfirmationMatches([writeConfirmed], expected)) {
    return fail('write-identity-mismatch');
  }
  steps.push('WRITE_CONFIRMED');

  // 6–8: legitimate READ
  options.throwIfAborted();
  session.sendCommand({
    command: 'READ',
    ownerId: ids.ownerId,
    namespace: 'personal',
    recordId: ids.recordId,
  });
  steps.push('SEND_READ_LEGIT_1');
  const read1 = await awaitEvent('READ_CONFIRMED');
  if (isFail(read1)) return read1;
  if (!assertReadConfirmationMatches([read1], expected)) {
    return fail('read1-identity-mismatch');
  }
  steps.push('READ_CONFIRMED_1');

  // 9–10: OWNER_MISMATCH
  options.throwIfAborted();
  session.sendCommand({
    command: 'READ',
    ownerId: ids.ownerId,
    namespace: 'personal',
    recordId: ids.recordId,
    expectedOwnerId: ids.foreignOwnerId,
    expectedNamespace: 'personal',
  });
  steps.push('SEND_OWNER_MISMATCH');
  const ownerDeny = await awaitEvent('READ_REJECTED');
  if (isFail(ownerDeny)) return ownerDeny;
  if (!isRejectedProof(ownerDeny, 'OWNER_MISMATCH')) return fail('owner-mismatch-invalid');
  steps.push('OWNER_MISMATCH');

  // 11–12: NAMESPACE_ISOLATED
  options.throwIfAborted();
  session.sendCommand({
    command: 'READ',
    ownerId: ids.ownerId,
    namespace: 'personal',
    recordId: ids.recordId,
    expectedOwnerId: ids.ownerId,
    expectedNamespace: 'ai-my-time',
  });
  steps.push('SEND_NAMESPACE_ISOLATED');
  const nsDeny = await awaitEvent('READ_REJECTED');
  if (isFail(nsDeny)) return nsDeny;
  if (!isRejectedProof(nsDeny, 'NAMESPACE_ISOLATED')) return fail('namespace-isolated-invalid');
  steps.push('NAMESPACE_ISOLATED');

  // 13–15: second legitimate READ
  options.throwIfAborted();
  session.sendCommand({
    command: 'READ',
    ownerId: ids.ownerId,
    namespace: 'personal',
    recordId: ids.recordId,
  });
  steps.push('SEND_READ_LEGIT_2');
  const read2 = await awaitEvent('READ_CONFIRMED');
  if (isFail(read2)) return read2;
  if (!assertReadConfirmationMatches([read2], expected)) {
    return fail('read2-identity-mismatch');
  }
  steps.push('READ_CONFIRMED_2');

  // 16–18: CLOSE → CLOSED → exit 0
  options.throwIfAborted();
  session.sendCommand({ command: 'CLOSE' });
  steps.push('SEND_CLOSE');
  const closed = await awaitEvent('CLOSED');
  if (isFail(closed)) return closed;
  steps.push('CLOSED');

  const completion = await session.waitForCompletion();
  options.throwIfAborted();
  if (completion.timedOut) return fail('timed-out');
  if (completion.protocolError !== null) return fail(`protocol:${completion.protocolError}`);
  if (completion.exitCode !== 0) return fail(`exit:${String(completion.exitCode)}`);
  if (completion.messages.some((message) => message.event === 'FAILED')) {
    return fail('unexpected-failed');
  }
  steps.push('EXIT_0');
  return { pass: true, steps, messages: completion.messages };
};

/**
 * Mutation detector: fire-and-forget parent sequences are forbidden for Scenario B.
 * Returns false if more than one command is sent before the prior expected event step.
 */
export const assertScenarioBStepOrder = (steps: readonly string[]): boolean => {
  const expected = [
    'READY',
    'SEND_WRITE',
    'WRITE_CONFIRMED',
    'SEND_READ_LEGIT_1',
    'READ_CONFIRMED_1',
    'SEND_OWNER_MISMATCH',
    'OWNER_MISMATCH',
    'SEND_NAMESPACE_ISOLATED',
    'NAMESPACE_ISOLATED',
    'SEND_READ_LEGIT_2',
    'READ_CONFIRMED_2',
    'SEND_CLOSE',
    'CLOSED',
    'EXIT_0',
  ];
  if (steps.length !== expected.length) return false;
  return expected.every((step, index) => steps[index] === step);
};
