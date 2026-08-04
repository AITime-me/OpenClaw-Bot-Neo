import type {
  ToolApprovalRequestBinding,
  ToolApprovalBinding,
  ToolApprovalFailure,
  ToolApprovalGrant,
} from '../domain/connector/approval.js';
import type { ApprovalId, ApprovalNonce } from '../domain/connector/identity.js';
import type { Result } from '../domain/result.js';
import type { ToolInvocationContext } from '../domain/connector/invocation.js';

export interface ToolApprovalPort {
  createRequest(
    binding: ToolApprovalRequestBinding,
    context: ToolInvocationContext,
  ): Promise<Result<ToolApprovalGrant, ToolApprovalFailure>>;
  consumeGrant(
    approvalId: ApprovalId,
    nonce: ApprovalNonce,
    binding: ToolApprovalBinding,
    context: ToolInvocationContext,
  ): Promise<Result<void, ToolApprovalFailure>>;
}
