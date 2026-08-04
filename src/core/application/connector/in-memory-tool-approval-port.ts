import { randomUUID } from 'node:crypto';
import type { ClockPort } from '../../ports/clock.port.js';
import type { ToolApprovalPort } from '../../ports/tool-approval.port.js';
import type { ToolApprovalDecisionPort } from '../../ports/tool-approval-decision.port.js';
import type {
  ToolApprovalRequestBinding,
  ToolApprovalBinding,
  ToolApprovalFailure,
  ToolApprovalGrant,
  ToolApprovalStatus,
} from '../../domain/connector/approval.js';
import type { ApprovalId, ApprovalNonce, ActorId } from '../../domain/connector/identity.js';
import { isFinancialAction } from '../../domain/connector/capabilities.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';

const MAX_ID_COLLISION_RETRIES = 8;

type StoredRecord = {
  readonly approvalId: ApprovalId;
  binding: ToolApprovalBinding;
  status: ToolApprovalStatus;
  consumed: boolean;
};

type ExpiryEvaluation =
  | { readonly kind: 'valid' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'clock-unavailable' };

const bindingsMatch = (left: ToolApprovalBinding, right: ToolApprovalBinding): boolean =>
  left.invocationId === right.invocationId &&
  left.toolId === right.toolId &&
  left.connectorId === right.connectorId &&
  left.connectionId === right.connectionId &&
  left.inputDigest === right.inputDigest &&
  left.sideEffectClass === right.sideEffectClass &&
  left.requestingActorId === right.requestingActorId &&
  left.nonce === right.nonce;

const generateApprovalId = (records: Map<string, StoredRecord>): ApprovalId | null => {
  for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt += 1) {
    const candidate = randomUUID() as ApprovalId;
    if (!records.has(candidate)) return candidate;
  }
  return null;
};

const generateNonce = (): ApprovalNonce => randomUUID() as ApprovalNonce;

const evaluateApprovalExpiry = (
  binding: ToolApprovalBinding,
  clock: ClockPort,
): ExpiryEvaluation => {
  const expiresAtMs = Date.parse(binding.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return { kind: 'expired' };
  const nowMs = clock.now().getTime();
  if (!Number.isFinite(nowMs)) return { kind: 'clock-unavailable' };
  if (nowMs >= expiresAtMs) return { kind: 'expired' };
  return { kind: 'valid' };
};

const expiryFailure = (evaluation: ExpiryEvaluation): Result<void, ToolApprovalFailure> => {
  if (evaluation.kind === 'clock-unavailable')
    return err({ code: 'MALFORMED', reason: 'Approval clock is unavailable.' });
  return err({ code: 'EXPIRED', reason: 'Approval grant expired.' });
};

export const createInMemoryToolApprovalPorts = (
  clock: ClockPort,
): {
  readonly approvalPort: ToolApprovalPort;
  readonly decisionPort: ToolApprovalDecisionPort;
} => {
  const records = new Map<string, StoredRecord>();

  const getRecord = (approvalId: ApprovalId): StoredRecord | undefined => records.get(approvalId);

  const approvalPort: ToolApprovalPort = {
    createRequest(
      binding: ToolApprovalRequestBinding,
      context: ToolInvocationContext,
    ): Promise<Result<ToolApprovalGrant, ToolApprovalFailure>> {
      if (isFinancialAction(binding.sideEffectClass))
        return Promise.resolve(
          err({ code: 'FINANCIAL_DENIED', reason: 'FINANCIAL actions cannot be approved.' }),
        );
      if (binding.requestingActorId !== context.actorId)
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Requesting actor mismatch.' }));
      const approvalId = generateApprovalId(records);
      if (approvalId === null)
        return Promise.resolve(
          err({ code: 'MALFORMED', reason: 'Unable to allocate approval identifier.' }),
        );
      const nonce = generateNonce();
      const stored: StoredRecord = {
        approvalId,
        binding: { ...binding, approvingActorId: null, nonce },
        status: 'pending',
        consumed: false,
      };
      records.set(approvalId, stored);
      return Promise.resolve(
        ok({
          approvalId,
          binding: stored.binding,
          status: 'pending',
        }),
      );
    },
    consumeGrant(
      approvalId: ApprovalId,
      nonce: ApprovalNonce,
      binding: ToolApprovalBinding,
      context: ToolInvocationContext,
    ): Promise<Result<void, ToolApprovalFailure>> {
      const stored = getRecord(approvalId);
      if (stored === undefined)
        return Promise.resolve(err({ code: 'NOT_FOUND', reason: 'Approval grant not found.' }));
      if (stored.status === 'denied')
        return Promise.resolve(err({ code: 'DENIED', reason: 'Approval request was denied.' }));
      if (stored.status === 'revoked')
        return Promise.resolve(err({ code: 'REVOKED', reason: 'Approval grant revoked.' }));
      if (stored.consumed || stored.status === 'consumed')
        return Promise.resolve(
          err({ code: 'CONSUMED', reason: 'Approval grant already consumed.' }),
        );
      if (stored.status !== 'granted')
        return Promise.resolve(
          err({ code: 'NOT_GRANTED', reason: 'Approval grant is not granted.' }),
        );
      if (stored.binding.nonce !== nonce)
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Approval nonce mismatch.' }));
      if (!bindingsMatch(stored.binding, binding))
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Approval binding mismatch.' }));
      if (binding.requestingActorId !== context.actorId)
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Requesting actor mismatch.' }));
      if (stored.binding.approvingActorId === null)
        return Promise.resolve(
          err({ code: 'NOT_GRANTED', reason: 'Approval has no approving actor.' }),
        );
      const expiry = evaluateApprovalExpiry(stored.binding, clock);
      if (expiry.kind !== 'valid') return Promise.resolve(expiryFailure(expiry));
      stored.consumed = true;
      stored.status = 'consumed';
      return Promise.resolve(ok(undefined));
    },
  };

  const decisionPort: ToolApprovalDecisionPort = {
    grant(
      approvalId: ApprovalId,
      approvingActorId: ActorId,
    ): Promise<Result<void, ToolApprovalFailure>> {
      const stored = getRecord(approvalId);
      if (stored === undefined)
        return Promise.resolve(err({ code: 'NOT_FOUND', reason: 'Approval grant not found.' }));
      if (stored.status === 'denied')
        return Promise.resolve(err({ code: 'DENIED', reason: 'Approval request was denied.' }));
      if (stored.status === 'revoked')
        return Promise.resolve(err({ code: 'REVOKED', reason: 'Approval grant revoked.' }));
      if (stored.consumed || stored.status === 'consumed')
        return Promise.resolve(
          err({ code: 'CONSUMED', reason: 'Approval grant already consumed.' }),
        );
      if (isFinancialAction(stored.binding.sideEffectClass))
        return Promise.resolve(
          err({ code: 'FINANCIAL_DENIED', reason: 'FINANCIAL actions cannot be approved.' }),
        );
      const expiry = evaluateApprovalExpiry(stored.binding, clock);
      if (expiry.kind !== 'valid') return Promise.resolve(expiryFailure(expiry));
      if (stored.status !== 'pending' && stored.status !== 'granted')
        return Promise.resolve(err({ code: 'MALFORMED', reason: 'Approval is not grantable.' }));
      stored.binding = { ...stored.binding, approvingActorId };
      stored.status = 'granted';
      return Promise.resolve(ok(undefined));
    },
    deny(
      approvalId: ApprovalId,
      _approvingActorId: ActorId,
    ): Promise<Result<void, ToolApprovalFailure>> {
      void _approvingActorId;
      const stored = getRecord(approvalId);
      if (stored === undefined)
        return Promise.resolve(err({ code: 'NOT_FOUND', reason: 'Approval grant not found.' }));
      if (stored.consumed || stored.status === 'consumed')
        return Promise.resolve(
          err({ code: 'CONSUMED', reason: 'Approval grant already consumed.' }),
        );
      stored.status = 'denied';
      return Promise.resolve(ok(undefined));
    },
    revoke(
      approvalId: ApprovalId,
      _approvingActorId: ActorId,
    ): Promise<Result<void, ToolApprovalFailure>> {
      void _approvingActorId;
      const stored = getRecord(approvalId);
      if (stored === undefined)
        return Promise.resolve(err({ code: 'NOT_FOUND', reason: 'Approval grant not found.' }));
      if (stored.consumed || stored.status === 'consumed')
        return Promise.resolve(
          err({ code: 'CONSUMED', reason: 'Approval grant already consumed.' }),
        );
      stored.status = 'revoked';
      return Promise.resolve(ok(undefined));
    },
  };

  return { approvalPort, decisionPort };
};

/** @internal Back-compat for tests that only need the invocation port surface. */
export const createInMemoryToolApprovalPort = (clock: ClockPort): ToolApprovalPort =>
  createInMemoryToolApprovalPorts(clock).approvalPort;

export { generateNonce as generateApprovalNonceForTest };
