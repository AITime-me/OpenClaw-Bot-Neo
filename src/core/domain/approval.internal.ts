import type { ApprovalEffect } from './approval.js';
import type { ApprovalId, ResourceRef } from './identity.js';
import { deepFreeze } from './immutable.js';

/**
 * Internal seal for approvals that passed deterministic validation.
 * Trust is WeakMap membership, not a Symbol property.
 */
export interface ValidatedApproval {
  readonly approvalId: ApprovalId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
}

const validatedApprovalRegistry = new WeakMap<object, ValidatedApproval>();

export const sealValidatedApproval = (
  approvalId: ApprovalId,
  effect: ApprovalEffect,
  target: ResourceRef,
): ValidatedApproval => {
  const sealed = deepFreeze({ approvalId, effect, target });
  validatedApprovalRegistry.set(sealed, sealed);
  return sealed;
};

export const isValidatedApproval = (value: unknown): value is ValidatedApproval =>
  typeof value === 'object' && value !== null && validatedApprovalRegistry.has(value);
