import {
  err,
  ok,
  readMemoryQueryLimit,
  type AuthenticatedMemoryAccessContext,
  type DomainError,
  type MemoryDeleteRequest,
  type MemoryOperationKind,
  type MemoryQueryRequest,
  type MemoryReadRequest,
  type MemoryRecord,
  type MemoryRecordId,
  type OwnerId,
  type MemoryNamespace,
  type Result,
  type VerifiedMemoryWrite,
} from '../../core/domain/index.js';
import { authorizeMemoryAccess } from '../../core/policy/namespace-isolation.js';
import type { MemoryPort } from '../../core/ports/index.js';
import { memoryRecordNotFound } from '../memory-port-errors.js';

const authorizationDenied = (code: string, reason: string): DomainError => ({
  code: 'POLICY_DENIED',
  reason: `${code}: ${reason}`,
});

const requireAuthorized = (
  access: AuthenticatedMemoryAccessContext | null | undefined,
  operation: MemoryOperationKind,
  ownerId: OwnerId,
  namespace: MemoryNamespace,
): DomainError | null => {
  const decision = authorizeMemoryAccess(access, operation, { ownerId, namespace });
  if (!decision.allowed) return authorizationDenied(decision.code, decision.reason);
  return null;
};

const snapshotSource = (source: VerifiedMemoryWrite['source']): MemoryRecord['source'] =>
  Object.freeze({
    kind: source.kind,
    reference: source.reference,
    observedAt: source.observedAt,
  });

const snapshotProvenance = (
  provenance: VerifiedMemoryWrite['provenance'],
): MemoryRecord['provenance'] =>
  Object.freeze({
    capturedAt: provenance.capturedAt,
    initiatedBy: provenance.initiatedBy,
    transformation: provenance.transformation,
    ownerApproved: provenance.ownerApproved,
    crossProjectAccess: provenance.crossProjectAccess,
  });

const snapshotRetention = (
  retention: VerifiedMemoryWrite['retentionPolicy'],
): MemoryRecord['retentionPolicy'] =>
  Object.freeze({
    expiresAt: retention.expiresAt,
    reviewAt: retention.reviewAt,
    deleteOnExpiry: retention.deleteOnExpiry,
  });

const toRecord = (write: VerifiedMemoryWrite): MemoryRecord =>
  Object.freeze({
    id: write.recordId,
    namespace: write.namespace,
    content: write.content.value,
    source: snapshotSource(write.source),
    provenance: snapshotProvenance(write.provenance),
    privacyClassification: write.privacyClassification,
    trustLevel: write.trustLevel,
    retentionPolicy: snapshotRetention(write.retentionPolicy),
    createdAt: write.createdAt,
    updatedAt: write.updatedAt,
  });

/** Canonical MemoryRecord identity: (ownerId, namespace, recordId). */
const storageKey = (ownerId: string, namespace: string, recordId: string): string =>
  `${ownerId}/${namespace}/${recordId}`;

/**
 * Ephemeral in-memory MemoryPort. Every operation fail-closes through public
 * `authorizeMemoryAccess` (opaque authenticated evidence + owner/namespace alignment).
 * Storage identity is (ownerId, namespace, recordId); duplicate keys overwrite while
 * preserving Map insertion order for that exact identity. Query requires explicit
 * `limit` (1..100) and returns at most that many matching records in insertion order.
 * The `query` string is ignored (not content search). Not durable; not production-ready.
 */
export function createInMemoryMemoryStore(): MemoryPort {
  const records = new Map<string, VerifiedMemoryWrite>();

  return {
    query(
      request: MemoryQueryRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<readonly MemoryRecord[], DomainError>> {
      const denied = requireAuthorized(
        access,
        'query',
        request.expectedOwnerId,
        request.targetNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const limitResult = readMemoryQueryLimit(request);
      if (!limitResult.ok) return Promise.resolve(limitResult);
      const limit = limitResult.value;

      const matches: MemoryRecord[] = [];
      for (const write of records.values()) {
        if (write.namespace !== request.targetNamespace) continue;
        if (write.ownerId !== access.ownerId) continue;
        if (write.ownerId !== request.expectedOwnerId) continue;
        matches.push(toRecord(write));
        if (matches.length >= limit) break;
      }
      return Promise.resolve(ok(Object.freeze(matches)));
    },

    read(
      request: MemoryReadRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<MemoryRecord, DomainError>> {
      const denied = requireAuthorized(
        access,
        'read',
        request.expectedOwnerId,
        request.expectedNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const write = records.get(
        storageKey(request.expectedOwnerId, request.expectedNamespace, String(request.recordId)),
      );
      if (write === undefined) return Promise.resolve(err(memoryRecordNotFound()));
      // Align stored record to opaque access owner — request fields alone are not authority.
      if (write.ownerId !== access.ownerId || write.ownerId !== request.expectedOwnerId)
        return Promise.resolve(err(memoryRecordNotFound()));
      if (write.namespace !== request.expectedNamespace)
        return Promise.resolve(err(memoryRecordNotFound()));
      return Promise.resolve(ok(toRecord(write)));
    },

    write(
      write: VerifiedMemoryWrite,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<MemoryRecordId, DomainError>> {
      const denied = requireAuthorized(access, 'write', write.ownerId, write.namespace);
      if (denied !== null) return Promise.resolve(err(denied));
      if (write.ownerId !== access.ownerId)
        return Promise.resolve(err(authorizationDenied('OWNER_MISMATCH', 'Write owner mismatch.')));
      records.set(storageKey(write.ownerId, write.namespace, String(write.recordId)), write);
      return Promise.resolve(ok(write.recordId));
    },

    delete(
      request: MemoryDeleteRequest,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<void, DomainError>> {
      const denied = requireAuthorized(
        access,
        'delete',
        request.expectedOwnerId,
        request.expectedNamespace,
      );
      if (denied !== null) return Promise.resolve(err(denied));

      const key = storageKey(
        request.expectedOwnerId,
        request.expectedNamespace,
        String(request.recordId),
      );
      const write = records.get(key);
      if (write === undefined) return Promise.resolve(err(memoryRecordNotFound()));
      if (write.ownerId !== access.ownerId || write.ownerId !== request.expectedOwnerId)
        return Promise.resolve(err(memoryRecordNotFound()));
      if (write.namespace !== request.expectedNamespace)
        return Promise.resolve(err(memoryRecordNotFound()));
      records.delete(key);
      return Promise.resolve(ok(undefined));
    },
  };
}
