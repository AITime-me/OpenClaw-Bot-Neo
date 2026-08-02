import type { ProtocolMessage } from './protocol.ts';

type ContentExpectation = {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly contentSha256: string;
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

/** True when killed by SIGKILL and no CLOSED event was emitted. */
export const assertExactSigkillProof = (result: {
  readonly signal: string | null;
  readonly exitCode?: number | null;
  readonly messages: ReadonlyArray<{ readonly event: string }>;
}): boolean => {
  if (result.signal === 'SIGTERM') return false;
  if (result.signal !== 'SIGKILL') return false;
  if (result.messages.some((message) => message.event === 'CLOSED')) return false;
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

/** True when WRITE_CONFIRMED and READ_CONFIRMED carry matching content identity detail. */
export const assertMatchingContentConfirmations = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
): boolean => {
  const writeConfirmed = messages.some(
    (message) => message.event === 'WRITE_CONFIRMED' && detailMatches(message, expected),
  );
  const readConfirmed = messages.some(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );
  return writeConfirmed && readConfirmed;
};

/** True when a single READ_CONFIRMED matches exact identity/content. */
export const assertReadConfirmationMatches = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
): boolean =>
  messages.some(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );

/** True when a single WRITE_CONFIRMED matches exact identity/content. */
export const assertWriteConfirmationMatches = (
  messages: ReadonlyArray<ProtocolMessage>,
  expected: ContentExpectation,
): boolean =>
  messages.some(
    (message) => message.event === 'WRITE_CONFIRMED' && detailMatches(message, expected),
  );

const hasReadRejected = (
  messages: ReadonlyArray<ProtocolMessage>,
  proofType: 'OWNER_MISMATCH' | 'NAMESPACE_ISOLATED',
): boolean =>
  messages.some((message) => {
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
): boolean => {
  if (!assertMatchingContentConfirmations(messages, expected)) return false;
  const legitReads = messages.filter(
    (message) => message.event === 'READ_CONFIRMED' && detailMatches(message, expected),
  );
  if (legitReads.length < 2) return false;
  if (!hasReadRejected(messages, 'OWNER_MISMATCH')) return false;
  if (!hasReadRejected(messages, 'NAMESPACE_ISOLATED')) return false;
  // Not-found must never be labeled as READ_REJECTED / ACCESS_DENIED access proof.
  const forgedAccess = messages.some(
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
export const assertHeldLockCode = (messages: ReadonlyArray<ProtocolMessage>): boolean =>
  messages.some(
    (message) => message.event === 'HELD' && message.errorCode === 'DURABLE_COMPOSITION_LOCK_HELD',
  );
