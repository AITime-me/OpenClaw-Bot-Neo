import type {
  ActorId,
  ApprovalId,
  ApprovalNonce,
  ISO8601,
  OwnerId,
  PayloadDigest,
  ResourceRef,
} from './identity.js';
import type { ProjectScope } from './memory-access.js';
import type { MemoryNamespace } from './memory-namespace.js';

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
  'memory-write',
  'integration-write',
  'exec',
  'schedule-write',
  'notifications-send',
  'secrets-read',
] as const);
export type ApprovalEffect = (typeof APPROVAL_EFFECTS)[number];
export const isApprovalEffect = (value: unknown): value is ApprovalEffect =>
  typeof value === 'string' && (APPROVAL_EFFECTS as readonly string[]).includes(value);

export const APPROVAL_STATUSES = Object.freeze(['pending', 'consumed', 'revoked'] as const);
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const isApprovalStatus = (value: unknown): value is ApprovalStatus =>
  typeof value === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(value);

/** A grant issued by the owner for exactly one effect on exactly one target payload and scope. */
export interface ApprovalGrant {
  readonly approvalId: ApprovalId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
  readonly namespace: MemoryNamespace;
  readonly projectScope: ProjectScope;
  readonly payloadDigest: PayloadDigest;
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly nonce: ApprovalNonce;
  readonly status: ApprovalStatus;
}

/**
 * The action currently being attempted. Built inside the trusted application boundary from the
 * authenticated context and the actual operation — never supplied ready-made by a caller.
 * Nonce is intentionally absent: it lives only on the stored grant and is used for consumption.
 */
export interface ApprovalDemand {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly effect: ApprovalEffect;
  readonly target: ResourceRef;
  readonly namespace: MemoryNamespace;
  readonly projectScope: ProjectScope;
  readonly payloadDigest: PayloadDigest;
}

export type ApprovalFailureCode =
  | 'MISSING_GRANT'
  | 'UNKNOWN_EFFECT'
  | 'OWNER_MISMATCH'
  | 'ACTOR_MISMATCH'
  | 'EFFECT_MISMATCH'
  | 'TARGET_MISMATCH'
  | 'NAMESPACE_MISMATCH'
  | 'PROJECT_SCOPE_MISMATCH'
  | 'PAYLOAD_DIGEST_MISMATCH'
  | 'INVALID_TIMESTAMP'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'REVOKED'
  | 'APPROVAL_UNAVAILABLE'
  | 'CONSUMPTION_FAILED'
  | 'MALFORMED_GRANT';
export interface ApprovalFailure {
  readonly code: ApprovalFailureCode;
  readonly reason: string;
}

export const projectScopesEqual = (left: ProjectScope, right: ProjectScope): boolean => {
  if (left.primary !== right.primary) return false;
  if (left.crossProjectPermitted !== right.crossProjectPermitted) return false;
  if (left.permitted.length !== right.permitted.length) return false;
  const a = [...left.permitted].sort();
  const b = [...right.permitted].sort();
  return a.every((value, index) => value === b[index]);
};
