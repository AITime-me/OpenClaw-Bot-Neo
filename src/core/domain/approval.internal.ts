import type { ApprovalEffect } from './approval.js';
import type { ApprovalId, ApprovalNonce, ResourceRef } from './identity.js';
import { deepFreeze } from './immutable.js';

/**
 * Internal seal for approvals that passed deterministic validation.
 * Trust is WeakMap membership, not a Symbol property.
 */
export interface ValidatedApproval {
  readonly approvalId: ApprovalId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
  readonly nonce: ApprovalNonce;
}

const validatedApprovalRegistry = new WeakMap<object, ValidatedApproval>();

export const sealValidatedApproval = (
  approvalId: ApprovalId,
  effect: ApprovalEffect,
  target: ResourceRef,
  nonce: ApprovalNonce,
): ValidatedApproval => {
  const sealed = deepFreeze({ approvalId, effect, target, nonce });
  validatedApprovalRegistry.set(sealed, sealed);
  return sealed;
};

export const isValidatedApproval = (value: unknown): value is ValidatedApproval =>
  typeof value === 'object' && value !== null && validatedApprovalRegistry.has(value);
