import { ok, type Result } from '../../../domain/result.js';
import { communicationError, type CommunicationError } from '../../domain/communication-errors.js';
import type {
  CommunicationTurnTransitionOutcome,
  RecordFactualOutcomeResult,
} from '../../ports/communication-turn-ledger.port.js';
import type { CommunicationAuditRecordOutcome } from '../../ports/communication-audit.port.js';
import type {
  CommunicationDeliveryOutboxPutOutcome,
  CommunicationDeliveryOutboxRecordOutcomeResult,
} from '../../ports/communication-delivery-outbox.port.js';

const failUnproven = (
  code: CommunicationError['code'],
  kind: string,
  detail?: string,
): Result<never, CommunicationError> => ({
  ok: false,
  error: communicationError(
    code,
    detail !== undefined ? `${kind}: ${detail}` : `Unproven durable outcome: ${kind}`,
  ),
});

/** Continue only after exact durable success for ledger transitions. */
export const requireTransitionSuccess = (
  outcome: Result<CommunicationTurnTransitionOutcome, CommunicationError>,
  expectedRevision: number,
): Result<number, CommunicationError> => {
  if (!outcome.ok) return outcome;
  switch (outcome.value.kind) {
    case 'transitioned':
      return ok(Number(outcome.value.turnRevision));
    case 'already-transitioned':
      return ok(expectedRevision);
    case 'stale-revision':
    case 'illegal-transition':
    case 'unavailable':
    case 'concurrency-conflict':
      return failUnproven(
        'LEDGER_UNAVAILABLE',
        outcome.value.kind,
        'reason' in outcome.value ? outcome.value.reason : undefined,
      );
    default: {
      const _exhaustive: never = outcome.value;
      return failUnproven('LEDGER_UNAVAILABLE', String(_exhaustive));
    }
  }
};

/** Continue only after exact durable factual success. */
export const requireFactualSuccess = (
  outcome: Result<RecordFactualOutcomeResult, CommunicationError>,
  expectedRevision: number,
): Result<number, CommunicationError> => {
  if (!outcome.ok) return outcome;
  switch (outcome.value.kind) {
    case 'recorded':
      return ok(Number(outcome.value.turnRevision));
    case 'already-recorded':
      return ok(expectedRevision);
    case 'stale-revision':
    case 'fact-rewrite-denied':
    case 'unavailable':
    case 'concurrency-conflict':
      return failUnproven(
        'LEDGER_UNAVAILABLE',
        outcome.value.kind,
        'reason' in outcome.value ? outcome.value.reason : undefined,
      );
    default: {
      const _exhaustive: never = outcome.value;
      return failUnproven('LEDGER_UNAVAILABLE', String(_exhaustive));
    }
  }
};

/** Continue only after exact durable audit success. */
export const requireAuditSuccess = (
  outcome: Result<CommunicationAuditRecordOutcome, CommunicationError>,
): Result<void, CommunicationError> => {
  if (!outcome.ok) return outcome;
  switch (outcome.value.kind) {
    case 'recorded':
    case 'already-recorded':
      return ok(undefined);
    case 'unavailable':
    case 'rejected':
      return failUnproven('AUDIT_COMPLETION_FAILED', outcome.value.kind, outcome.value.reason);
    default: {
      const _exhaustive: never = outcome.value;
      return failUnproven('AUDIT_COMPLETION_FAILED', String(_exhaustive));
    }
  }
};

/** Continue only after exact durable outbox outcome success. */
export const requireOutboxRecordSuccess = (
  outcome: Result<CommunicationDeliveryOutboxRecordOutcomeResult, CommunicationError>,
): Result<void, CommunicationError> => {
  if (!outcome.ok) return outcome;
  switch (outcome.value.kind) {
    case 'recorded':
    case 'already-recorded':
      return ok(undefined);
    case 'unavailable':
      return failUnproven('OUTBOX_UNAVAILABLE', outcome.value.kind, outcome.value.reason);
    default: {
      const _exhaustive: never = outcome.value;
      return failUnproven('OUTBOX_UNAVAILABLE', String(_exhaustive));
    }
  }
};

/** Continue only after exact durable outbox put success. */
export const requireOutboxPutSuccess = (
  outcome: Result<CommunicationDeliveryOutboxPutOutcome, CommunicationError>,
): Result<void, CommunicationError> => {
  if (!outcome.ok) return outcome;
  switch (outcome.value.kind) {
    case 'stored':
    case 'already-stored':
      return ok(undefined);
    case 'unavailable':
    case 'rejected':
    case 'encryption-required':
      return failUnproven('OUTBOX_UNAVAILABLE', outcome.value.kind, outcome.value.reason);
    default: {
      const _exhaustive: never = outcome.value;
      return failUnproven('OUTBOX_UNAVAILABLE', String(_exhaustive));
    }
  }
};
