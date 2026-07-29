import {
  err,
  ok,
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

const notFound = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'Memory record not found in ephemeral local store.',
});

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

const storageKey = (namespace: string, recordId: string): string => `${namespace}/${recordId}`;

/**
 * Ephemeral in-memory MemoryPort. Every operation fail-closes through public
 * `authorizeMemoryAccess` (opaque authenticated evidence + owner/namespace alignment).
 * Duplicate keys overwrite. Not durable; not production-ready.
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

      const matches: MemoryRecord[] = [];
      for (const write of records.values()) {
        if (write.namespace !== request.targetNamespace) continue;
        if (write.ownerId !== access.ownerId) continue;
        if (write.ownerId !== request.expectedOwnerId) continue;
        matches.push(toRecord(write));
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

      const write = records.get(storageKey(request.expectedNamespace, String(request.recordId)));
      if (write === undefined) return Promise.resolve(err(notFound()));
      // Align stored record to opaque access owner — request fields alone are not authority.
      if (write.ownerId !== access.ownerId || write.ownerId !== request.expectedOwnerId)
        return Promise.resolve(err(notFound()));
      if (write.namespace !== request.expectedNamespace) return Promise.resolve(err(notFound()));
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
      records.set(storageKey(write.namespace, String(write.recordId)), write);
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

      const key = storageKey(request.expectedNamespace, String(request.recordId));
      const write = records.get(key);
      if (write === undefined) return Promise.resolve(err(notFound()));
      if (write.ownerId !== access.ownerId || write.ownerId !== request.expectedOwnerId)
        return Promise.resolve(err(notFound()));
      if (write.namespace !== request.expectedNamespace) return Promise.resolve(err(notFound()));
      records.delete(key);
      return Promise.resolve(ok(undefined));
    },
  };
}
