import type { ChildRole } from './constants.ts';
import type { ProtocolMessage } from './protocol.ts';

type ContentExpectation = {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly contentSha256: string;
};

export type EventCorrelation = {
  readonly runId: string;
  readonly role: ChildRole;
};

export type CorrelatedEventExpectation = EventCorrelation & {
  readonly event: string;
};

const correlates = (message: ProtocolMessage, correlation: EventCorrelation): boolean =>
  message.runId === correlation.runId && message.role === correlation.role;

export const findCorrelatedEvent = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: CorrelatedEventExpectation,
): ProtocolMessage | undefined =>
  messages.find(
    (message) =>
      message.event === expected.event &&
      message.runId === expected.runId &&
      message.role === expected.role,
  );

export const assertCorrelatedEventPresent = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: CorrelatedEventExpectation,
): { readonly pass: boolean; readonly detail?: string } => {
  const found = findCorrelatedEvent(messages, expected);
  if (found === undefined) {
    return {
      pass: false,
      detail: `missing correlated event ${expected.event} runId=${expected.runId} role=${expected.role}`,
    };
  }
  return { pass: true };
};

export const assertCorrelatedEventSequence = (
  messages: ReadonlyArray<ProtocolMessage>,
  correlation: EventCorrelation,
  events: readonly string[],
): { readonly pass: boolean; readonly detail?: string } => {
  let searchFrom = 0;
  for (const event of events) {
    const index = messages.findIndex(
      (message, messageIndex) =>
        messageIndex >= searchFrom && message.event === event && correlates(message, correlation),
    );
    if (index < 0) {
      return {
        pass: false,
        detail: `missing correlated event ${event} runId=${correlation.runId} role=${correlation.role} after index ${String(searchFrom)}`,
      };
    }
    searchFrom = index + 1;
  }
  return { pass: true };
};

export const assertNoCorrelatedEvent = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: CorrelatedEventExpectation,
): { readonly pass: boolean; readonly detail?: string } => {
  const found = findCorrelatedEvent(messages, expected);
  if (found !== undefined) {
    return {
      pass: false,
      detail: `unexpected correlated event ${expected.event} runId=${expected.runId} role=${expected.role}`,
    };
  }
  return { pass: true };
};

/** True when READY appears before CONTENDER_SPAWN in the orchestration timeline. */
export const assertReadyBeforeContender = (events: readonly string[]): boolean => {
  const readyIndex = events.indexOf('READY');
  const contenderIndex = events.indexOf('CONTENDER_SPAWN');
  if (readyIndex < 0 || contenderIndex < 0) return false;
  return readyIndex < contenderIndex;
};

/** True when WRITE_CONFIRMED and READ_CONFIRMED both precede SIGKILL in the timeline. */
export const assertWriteReadBeforeKill = (events: readonly string[]): boolean => {
  const writeIndex = events.indexOf('WRITE_CONFIRMED');
  const readIndex = events.indexOf('READ_CONFIRMED');
  const killIndex = events.indexOf('SIGKILL');
  if (writeIndex < 0 || readIndex < 0 || killIndex < 0) return false;
  return writeIndex < killIndex && readIndex < killIndex;
};

/** True when flock-holder READY precedes contender spawn in the timeline. */
export const assertFlockReadyBeforeContender = (events: readonly string[]): boolean => {
  const readyIndex = events.indexOf('FLOCK_READY');
  const contenderIndex = events.indexOf('CONTENDER_SPAWN');
  if (readyIndex < 0 || contenderIndex < 0) return false;
  return readyIndex < contenderIndex;
};

/** True when killed by SIGKILL and no CLOSED event was emitted for the correlated session. */
export const assertExactSigkillProof = (
  result: {
    readonly signal: string | null;
    readonly exitCode?: number | null;
    readonly messages: ReadonlyArray<{
      readonly event: string;
      readonly runId?: string;
      readonly role?: ChildRole;
    }>;
  },
  correlation?: EventCorrelation,
): boolean => {
  if (result.signal === 'SIGTERM') return false;
  if (result.signal !== 'SIGKILL') return false;
  const closed =
    correlation === undefined
      ? result.messages.some((message) => message.event === 'CLOSED')
      : result.messages.some(
          (message) =>
            message.event === 'CLOSED' &&
            message.runId === correlation.runId &&
            message.role === correlation.role,
        );
  if (closed) return false;
  return true;
};

const detailMatches = (message: ProtocolMessage, expected: ContentExpectation): boolean => {
  const detail = message.detail;
  if (detail === undefined) return false;
  return (
    detail['recordId'] === expected.recordId &&
    detail['ownerId'] === expected.ownerId &&
    detail['namespace'] === expected.namespace &&
    detail['contentSha256'] === expected.contentSha256
  );
};

const scopedMessages = (
  messages: ReadonlyArray<ProtocolMessage>,
  correlation?: EventCorrelation,
): ReadonlyArray<ProtocolMessage> =>
  correlation === undefined
    ? messages
    : messages.filter((message) => correlates(message, correlation));

/** True when WRITE_CONFIRMED and READ_CONFIRMED carry matching content identity detail. */
export const assertMatchingContentConfirmations = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
  correlation?: EventCorrelation,
): boolean => {
  const scoped = scopedMessages(messages, correlation);
  const writeConfirmed = scoped.some(
    (message) => message.event === 'WRITE_CONFIRMED' && detailMatches(message, expected),
  );
  const readConfirmed = scoped.some(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );
  return writeConfirmed && readConfirmed;
};

/** True when a single READ_CONFIRMED matches exact identity/content. */
export const assertReadConfirmationMatches = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
  correlation?: EventCorrelation,
): boolean =>
  scopedMessages(messages, correlation).some(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );

/** True when a single WRITE_CONFIRMED matches exact identity/content. */
export const assertWriteConfirmationMatches = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
  correlation?: EventCorrelation,
): boolean =>
  scopedMessages(messages, correlation).some(
    (message) => message.event === 'WRITE_CONFIRMED' && detailMatches(message, expected),
  );

const hasReadRejected = (
  messages: ReadonlyArray<ProtocolMessage>,
  proofType: 'OWNER_MISMATCH' | 'NAMESPACE_ISOLATED',
  correlation?: EventCorrelation,
): boolean =>
  scopedMessages(messages, correlation).some((message) => {
    if (message.event !== 'READ_REJECTED' || message.errorCode !== 'POLICY_DENIED') return false;
    const detail = message.detail;
    if (detail === undefined) return false;
    return (
      detail['authorizationCode'] === proofType &&
      detail['proofType'] === proofType &&
      detail['domainCode'] === 'POLICY_DENIED'
    );
  });

/**
 * Scenario B: WRITE + legitimate READ (actual content) + OWNER_MISMATCH +
 * NAMESPACE_ISOLATED + second legitimate READ. Rejects not-found masquerading as deny.
 */
export const assertScenarioBDenialsComplete = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
  correlation?: EventCorrelation,
): boolean => {
  if (!assertMatchingContentConfirmations(messages, expected, correlation)) return false;
  const scoped = scopedMessages(messages, correlation);
  const legitReads = scoped.filter(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );
  if (legitReads.length < 2) return false;
  if (!hasReadRejected(messages, 'OWNER_MISMATCH', correlation)) return false;
  if (!hasReadRejected(messages, 'NAMESPACE_ISOLATED', correlation)) return false;
  const forgedAccess = scoped.some(
    (message) =>
      (message.event === 'READ_REJECTED' || message.event === 'ACCESS_DENIED') &&
      (message.errorCode === 'VALIDATION_FAILED' ||
        message.detail?.['authorizationCode'] === 'VALIDATION_FAILED' ||
        message.detail?.['domainCode'] === 'VALIDATION_FAILED'),
  );
  if (forgedAccess) return false;
  return true;
};

/** True when contender emitted HELD with DURABLE_COMPOSITION_LOCK_HELD error code. */
export const assertHeldLockCode = (
  messages: ReadonlyArray<ProtocolMessage>,
  correlation?: EventCorrelation,
): boolean =>
  scopedMessages(messages, correlation).some(
    (message) => message.event === 'HELD' && message.errorCode === 'DURABLE_COMPOSITION_LOCK_HELD',
  );
