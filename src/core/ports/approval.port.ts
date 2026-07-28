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
 * model-produced text.
 *
 * Consumption is an atomic port contract: at most one concurrent `consume` for the same
 * approvalId+nonce may return success. Implementations must reject a second concurrent or
 * subsequent consume as already consumed or as a consumption failure. This repository does not
 * ship a transactional store; adapters are responsible for enforcing the atomicity requirement.
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
