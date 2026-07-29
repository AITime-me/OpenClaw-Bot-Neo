import {
  err,
  isApprovalEffect,
  isApprovalStatus,
  isMemoryNamespace,
  ok,
  parseActorId,
  parseApprovalId,
  parseApprovalNonce,
  parseISO8601,
  parseOwnerId,
  parsePayloadDigest,
  parseResourceRef,
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
import { exactPlainObservation, exactStringArray } from '../domain/observation-validation.js';

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
const GRANT_FIELDS = Object.freeze([
  'approvalId',
  'ownerId',
  'actorId',
  'effect',
  'target',
  'namespace',
  'projectScope',
  'payloadDigest',
  'issuedAt',
  'expiresAt',
  'nonce',
  'status',
] as const);

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
  const plain = exactPlainObservation(grant, GRANT_FIELDS);
  if (plain === null) return fail('MALFORMED_GRANT', 'Grant is not exact plain data.');
  const approvalId = parseApprovalId(plain.approvalId);
  const ownerId = parseOwnerId(plain.ownerId);
  const actorId = parseActorId(plain.actorId);
  const target = parseResourceRef(plain.target);
  const payloadDigest = parsePayloadDigest(plain.payloadDigest);
  const nonce = parseApprovalNonce(plain.nonce);
  const issuedAtIdentity = parseISO8601(plain.issuedAt);
  const expiresAtIdentity = parseISO8601(plain.expiresAt);
  const scope = exactPlainObservation(plain.projectScope, [
    'primary',
    'permitted',
    'crossProjectPermitted',
  ]);
  const permitted = scope === null ? null : exactStringArray(scope.permitted);
  if (
    !approvalId.ok ||
    !ownerId.ok ||
    !actorId.ok ||
    !target.ok ||
    !payloadDigest.ok ||
    !nonce.ok ||
    scope === null ||
    !isMemoryNamespace(scope.primary) ||
    permitted === null ||
    permitted.length === 0 ||
    !permitted.every((value) => isMemoryNamespace(value)) ||
    typeof scope.crossProjectPermitted !== 'boolean' ||
    !isMemoryNamespace(plain.namespace)
  )
    return fail('MALFORMED_GRANT', 'Grant is structurally incomplete.');
  if (!issuedAtIdentity.ok || !expiresAtIdentity.ok)
    return fail('INVALID_TIMESTAMP', 'Grant timestamps are not canonical.');
  if (!isApprovalEffect(plain.effect) || !isApprovalEffect(demand.effect))
    return fail('UNKNOWN_EFFECT', 'Effect is not an approvable effect.');

  const issuedAt = new Date(issuedAtIdentity.value).getTime();
  const expiresAt = new Date(expiresAtIdentity.value).getTime();
  const current = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(current))
    return fail('INVALID_TIMESTAMP', 'Grant timestamps are not usable.');
  if (expiresAt <= issuedAt) return fail('INVALID_TIMESTAMP', 'Grant expiry precedes issuance.');

  if (!isApprovalStatus(plain.status)) return fail('REVOKED', 'Grant status is not usable.');
  if (plain.status === 'revoked') return fail('REVOKED', 'Grant was revoked.');
  if (plain.status === 'consumed') return fail('ALREADY_CONSUMED', 'Grant was already used.');
  if (current >= expiresAt) return fail('EXPIRED', 'Grant expired.');
  if (current < issuedAt) return fail('INVALID_TIMESTAMP', 'Grant is not valid yet.');

  if (ownerId.value !== demand.ownerId)
    return fail('OWNER_MISMATCH', 'Grant belongs to another owner.');
  if (actorId.value !== demand.actorId)
    return fail('ACTOR_MISMATCH', 'Grant belongs to another actor.');
  if (plain.effect !== demand.effect)
    return fail('EFFECT_MISMATCH', 'Grant covers another effect.');
  if (target.value !== demand.target)
    return fail('TARGET_MISMATCH', 'Grant covers another target.');
  if (plain.namespace !== demand.namespace)
    return fail('NAMESPACE_MISMATCH', 'Grant covers another namespace.');
  if (
    !projectScopesEqual(
      {
        primary: scope.primary,
        permitted,
        crossProjectPermitted: scope.crossProjectPermitted,
      },
      demand.projectScope,
    )
  )
    return fail('PROJECT_SCOPE_MISMATCH', 'Grant covers another project scope.');
  if (payloadDigest.value !== demand.payloadDigest)
    return fail('PAYLOAD_DIGEST_MISMATCH', 'Payload changed after approval.');

  return ok(sealValidatedApproval(approvalId.value, plain.effect, target.value, nonce.value));
}
