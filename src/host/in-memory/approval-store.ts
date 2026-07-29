import {
  err,
  ok,
  type ApprovalGrant,
  type ApprovalId,
  type ApprovalNonce,
  type DomainError,
  type OperationContext,
  type Result,
} from '../../core/domain/index.js';
import type { ApprovalPort } from '../../core/ports/index.js';

const missingGrant = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'Approval grant not found in ephemeral local store.',
});

const consumeFailed = (): DomainError => ({
  code: 'EXTERNAL_FAILURE',
  operation: 'consume',
  retryable: false,
});

const snapshotGrant = (grant: ApprovalGrant): ApprovalGrant =>
  Object.freeze({
    approvalId: grant.approvalId,
    ownerId: grant.ownerId,
    actorId: grant.actorId,
    effect: grant.effect,
    target: grant.target,
    namespace: grant.namespace,
    projectScope: Object.freeze({
      primary: grant.projectScope.primary,
      permitted: Object.freeze([...grant.projectScope.permitted]),
      crossProjectPermitted: grant.projectScope.crossProjectPermitted,
    }),
    payloadDigest: grant.payloadDigest,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    nonce: grant.nonce,
    status: grant.status,
  });

/**
 * Process-local approval store. Enforces single-use consume within one process only.
 * Crash persistence and distributed atomicity are absent by design (Build 3.0 ephemeral).
 */
export interface InMemoryApprovalStore extends ApprovalPort {
  seed(grant: ApprovalGrant): void;
}

export function createInMemoryApprovalStore(): InMemoryApprovalStore {
  const grants = new Map<string, ApprovalGrant>();
  const consumed = new Set<string>();
  const inFlight = new Set<string>();

  const consumeKey = (approvalId: ApprovalId, nonce: ApprovalNonce): string =>
    `${String(approvalId)}\0${String(nonce)}`;

  return {
    seed(grant: ApprovalGrant): void {
      if (typeof grant.approvalId !== 'string' || typeof grant.nonce !== 'string')
        throw new TypeError('Approval grant is missing approvalId or nonce.');
      grants.set(String(grant.approvalId), snapshotGrant(grant));
    },

    lookup(
      approvalId: ApprovalId,
      context: OperationContext,
    ): Promise<Result<ApprovalGrant, DomainError>> {
      void context;
      const stored = grants.get(String(approvalId));
      if (stored === undefined) return Promise.resolve(err(missingGrant()));
      return Promise.resolve(ok(snapshotGrant(stored)));
    },

    consume(
      approvalId: ApprovalId,
      nonce: ApprovalNonce,
      context: OperationContext,
    ): Promise<Result<void, DomainError>> {
      void context;
      const key = consumeKey(approvalId, nonce);
      // Synchronous check-and-set: no await between claim and commit (process-local atomicity).
      if (consumed.has(key) || inFlight.has(key)) return Promise.resolve(err(consumeFailed()));
      inFlight.add(key);
      try {
        const stored = grants.get(String(approvalId));
        if (stored === undefined || stored.nonce !== nonce)
          return Promise.resolve(err(missingGrant()));
        if (stored.status === 'consumed' || stored.status === 'revoked')
          return Promise.resolve(err(consumeFailed()));
        if (consumed.has(key)) return Promise.resolve(err(consumeFailed()));
        consumed.add(key);
        grants.set(
          String(approvalId),
          snapshotGrant({
            ...stored,
            status: 'consumed',
          }),
        );
        return Promise.resolve(ok(undefined));
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
