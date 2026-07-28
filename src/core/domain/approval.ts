import type {
  ActorId,
  ApprovalId,
  ApprovalNonce,
  ISO8601,
  OwnerId,
  PayloadDigest,
  ResourceRef,
} from './identity.js';

/**
 * Payment-like effects are absent by design and can never be approved. The list is frozen so no
 * caller can widen the approvable set at runtime.
 */
export const APPROVAL_EFFECTS = Object.freeze([
  'write',
  'delete',
  'execute',
  'external-send',
  'privilege-change',
] as const);
export type ApprovalEffect = (typeof APPROVAL_EFFECTS)[number];
export const isApprovalEffect = (value: unknown): value is ApprovalEffect =>
  typeof value === 'string' && (APPROVAL_EFFECTS as readonly string[]).includes(value);

export const APPROVAL_STATUSES = Object.freeze(['pending', 'consumed', 'revoked'] as const);
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const isApprovalStatus = (value: unknown): value is ApprovalStatus =>
  typeof value === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(value);

/** A grant issued by the owner for exactly one effect on exactly one target payload. */
export interface ApprovalGrant {
  readonly approvalId: ApprovalId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
  readonly payloadDigest: PayloadDigest;
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly nonce: ApprovalNonce;
  readonly status: ApprovalStatus;
}

/** The action currently being attempted; validated against a grant field by field. */
export interface ApprovalDemand {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
  readonly payloadDigest: PayloadDigest;
  readonly nonce: ApprovalNonce;
}

export type ApprovalFailureCode =
  | 'MISSING_GRANT'
  | 'UNKNOWN_EFFECT'
  | 'OWNER_MISMATCH'
  | 'ACTOR_MISMATCH'
  | 'EFFECT_MISMATCH'
  | 'TARGET_MISMATCH'
  | 'PAYLOAD_DIGEST_MISMATCH'
  | 'NONCE_MISMATCH'
  | 'INVALID_TIMESTAMP'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'REVOKED'
  | 'APPROVAL_UNAVAILABLE'
  | 'CONSUMPTION_FAILED';
export interface ApprovalFailure {
  readonly code: ApprovalFailureCode;
  readonly reason: string;
}
