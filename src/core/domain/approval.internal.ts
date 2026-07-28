import type { ApprovalEffect } from './approval.js';
import type { ApprovalId, ResourceRef } from './identity.js';

/**
 * Internal seal for approvals that passed deterministic validation. The symbol and the
 * factory are intentionally excluded from the public surface: only the approval policy
 * may create this value, so no adapter can label an unchecked grant as validated.
 */
export const validatedApprovalBrand: unique symbol = Symbol('ValidatedApproval');

export interface ValidatedApproval {
  readonly [validatedApprovalBrand]: true;
  readonly approvalId: ApprovalId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
}

export const sealValidatedApproval = (
  approvalId: ApprovalId,
  effect: ApprovalEffect,
  target: ResourceRef,
): ValidatedApproval => ({ [validatedApprovalBrand]: true, approvalId, effect, target });
