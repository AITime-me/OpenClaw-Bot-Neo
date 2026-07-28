import type {
  ApprovalGrant,
  ApprovalId,
  ApprovalNonce,
  DomainError,
  OperationContext,
  Result,
} from '../domain/index.js';
/**
 * Approval storage is the only source of grants. A grant is never reconstructed from
 * model-produced text, and consumption must be atomic so a grant cannot be replayed.
 */
export interface ApprovalPort {
  lookup(
    approvalId: ApprovalId,
    context: OperationContext,
  ): Promise<Result<ApprovalGrant, DomainError>>;
  consume(
    approvalId: ApprovalId,
    nonce: ApprovalNonce,
    context: OperationContext,
  ): Promise<Result<void, DomainError>>;
}
