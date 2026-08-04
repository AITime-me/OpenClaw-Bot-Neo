import type { ToolApprovalFailure } from '../domain/connector/approval.js';
import type { ActorId, ApprovalId } from '../domain/connector/identity.js';
import type { Result } from '../domain/result.js';

/** Trusted owner decision surface — not reachable from invocation callers or connectors. */
export interface ToolApprovalDecisionPort {
  grant(
    approvalId: ApprovalId,
    approvingActorId: ActorId,
  ): Promise<Result<void, ToolApprovalFailure>>;
  deny(
    approvalId: ApprovalId,
    approvingActorId: ActorId,
  ): Promise<Result<void, ToolApprovalFailure>>;
  revoke(
    approvalId: ApprovalId,
    approvingActorId: ActorId,
  ): Promise<Result<void, ToolApprovalFailure>>;
}
