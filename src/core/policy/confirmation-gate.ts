import {
  err,
  isApprovalEffect,
  isApprovalStatus,
  ok,
  projectScopesEqual,
  type Result,
} from '../domain/index.js';
import type {
  ApprovalDemand,
  ApprovalEffect,
  ApprovalFailure,
  ApprovalGrant,
  ValidatedApproval,
} from '../domain/index.js';
import { sealValidatedApproval } from '../domain/approval.internal.js';

export type EffectDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'approval-required'; readonly effect: ApprovalEffect }
  | { readonly decision: 'deny'; readonly reason: string };

/**
 * Read stays free, payment stays impossible, every other known effect needs a scoped grant
 * and an unknown effect is denied instead of being treated as harmless.
 */
export function classifyEffect(effect: unknown): EffectDecision {
  if (effect === 'read') return { decision: 'allow' };
  if (effect === 'payment')
    return { decision: 'deny', reason: 'Payment actions are not supported.' };
  if (isApprovalEffect(effect)) return { decision: 'approval-required', effect };
  return { decision: 'deny', reason: 'Unknown effect is denied by default.' };
}

const fail = (code: ApprovalFailure['code'], reason: string): Result<never, ApprovalFailure> =>
  err({ code, reason });
const instant = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const filled = (value: string | undefined): boolean =>
  typeof value === 'string' && value.length > 0;

/**
 * Deterministic, fail-closed validation of a single grant against the action being attempted.
 * The demand must be derived inside the trusted application boundary from the actual operation.
 * Nothing here reads model-produced text: every compared field is an identifier, scope or digest.
 */
export function validateApproval(
  grant: ApprovalGrant | null | undefined,
  demand: ApprovalDemand,
  now: Date,
): Result<ValidatedApproval, ApprovalFailure> {
  if (!grant) return fail('MISSING_GRANT', 'No approval grant was supplied.');
  if (!isApprovalEffect(grant.effect) || !isApprovalEffect(demand.effect))
    return fail('UNKNOWN_EFFECT', 'Effect is not an approvable effect.');
  if (
    !filled(grant.approvalId) ||
    !filled(grant.ownerId) ||
    !filled(grant.actorId) ||
    !filled(grant.target) ||
    !filled(grant.payloadDigest) ||
    !filled(grant.nonce) ||
    !filled(grant.namespace) ||
    typeof grant.projectScope.primary !== 'string' ||
    !Array.isArray(grant.projectScope.permitted)
  )
    return fail('MALFORMED_GRANT', 'Grant is structurally incomplete.');

  const issuedAt = instant(grant.issuedAt);
  const expiresAt = instant(grant.expiresAt);
  const current = now instanceof Date ? now.getTime() : Number.NaN;
  if (issuedAt === null || expiresAt === null || !Number.isFinite(current))
    return fail('INVALID_TIMESTAMP', 'Grant timestamps are not usable.');
  if (expiresAt <= issuedAt) return fail('INVALID_TIMESTAMP', 'Grant expiry precedes issuance.');

  if (!isApprovalStatus(grant.status)) return fail('REVOKED', 'Grant status is not usable.');
  if (grant.status === 'revoked') return fail('REVOKED', 'Grant was revoked.');
  if (grant.status === 'consumed') return fail('ALREADY_CONSUMED', 'Grant was already used.');
  if (current >= expiresAt) return fail('EXPIRED', 'Grant expired.');
  if (current < issuedAt) return fail('INVALID_TIMESTAMP', 'Grant is not valid yet.');

  if (grant.ownerId !== demand.ownerId)
    return fail('OWNER_MISMATCH', 'Grant belongs to another owner.');
  if (grant.actorId !== demand.actorId)
    return fail('ACTOR_MISMATCH', 'Grant belongs to another actor.');
  if (grant.effect !== demand.effect)
    return fail('EFFECT_MISMATCH', 'Grant covers another effect.');
  if (grant.target !== demand.target)
    return fail('TARGET_MISMATCH', 'Grant covers another target.');
  if (grant.namespace !== demand.namespace)
    return fail('NAMESPACE_MISMATCH', 'Grant covers another namespace.');
  if (!projectScopesEqual(grant.projectScope, demand.projectScope))
    return fail('PROJECT_SCOPE_MISMATCH', 'Grant covers another project scope.');
  if (grant.payloadDigest !== demand.payloadDigest)
    return fail('PAYLOAD_DIGEST_MISMATCH', 'Payload changed after approval.');

  return ok(sealValidatedApproval(grant.approvalId, grant.effect, grant.target));
}
