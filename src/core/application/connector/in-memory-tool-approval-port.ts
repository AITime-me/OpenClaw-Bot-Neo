import type { ToolApprovalPort } from '../../ports/tool-approval.port.js';
import type {
  ToolApprovalBinding,
  ToolApprovalFailure,
  ToolApprovalGrant,
} from '../../domain/connector/approval.js';
import type { ApprovalId, ApprovalNonce } from '../../domain/connector/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';

type StoredGrant = ToolApprovalGrant & { readonly consumed: boolean; readonly revoked: boolean };

const bindingsMatch = (left: ToolApprovalBinding, right: ToolApprovalBinding): boolean =>
  left.invocationId === right.invocationId &&
  left.toolId === right.toolId &&
  left.connectorId === right.connectorId &&
  left.connectionId === right.connectionId &&
  left.inputDigest === right.inputDigest &&
  left.sideEffectClass === right.sideEffectClass &&
  left.nonce === right.nonce;

export const createInMemoryToolApprovalPort = (): ToolApprovalPort & {
  readonly grantForTest: (grant: ToolApprovalGrant) => void;
  readonly revoke: (approvalId: ApprovalId) => void;
} => {
  const grants = new Map<string, StoredGrant>();

  return {
    createRequest(
      binding: ToolApprovalBinding,
      _context: ToolInvocationContext,
    ): Promise<Result<ToolApprovalGrant, ToolApprovalFailure>> {
      void _context;
      const approvalId = `approval.${binding.invocationId as string}` as ApprovalId;
      const grant: StoredGrant = {
        approvalId,
        binding,
        status: 'pending',
        consumed: false,
        revoked: false,
      };
      grants.set(approvalId, grant);
      return Promise.resolve(ok({ approvalId, binding, status: 'pending' }));
    },
    consumeGrant(
      approvalId: ApprovalId,
      nonce: ApprovalNonce,
      binding: ToolApprovalBinding,
      _context: ToolInvocationContext,
    ): Promise<Result<void, ToolApprovalFailure>> {
      void _context;
      const stored = grants.get(approvalId);
      if (stored === undefined)
        return Promise.resolve(err({ code: 'NOT_FOUND', reason: 'Approval grant not found.' }));
      if (stored.revoked)
        return Promise.resolve(err({ code: 'REVOKED', reason: 'Approval grant revoked.' }));
      if (stored.consumed)
        return Promise.resolve(
          err({ code: 'CONSUMED', reason: 'Approval grant already consumed.' }),
        );
      if (stored.binding.nonce !== nonce)
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Approval nonce mismatch.' }));
      if (!bindingsMatch(stored.binding, binding))
        return Promise.resolve(err({ code: 'MISMATCH', reason: 'Approval binding mismatch.' }));
      const expiresAt = Date.parse(stored.binding.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
        return Promise.resolve(err({ code: 'EXPIRED', reason: 'Approval grant expired.' }));
      grants.set(approvalId, { ...stored, consumed: true, status: 'consumed' });
      return Promise.resolve(ok(undefined));
    },
    grantForTest(grant: ToolApprovalGrant): void {
      grants.set(grant.approvalId, {
        ...grant,
        consumed: grant.status === 'consumed',
        revoked: grant.status === 'revoked',
      });
    },
    revoke(approvalId: ApprovalId): void {
      const stored = grants.get(approvalId);
      if (stored !== undefined)
        grants.set(approvalId, { ...stored, revoked: true, status: 'revoked' });
    },
  };
};
