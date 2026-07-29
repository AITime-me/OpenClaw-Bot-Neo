import {
  ok,
  type AuthenticatedMemoryAccessContext,
  type DomainError,
  type Result,
  type SafeMemoryAuditEvent,
} from '../../core/domain/index.js';
import type { MemoryAuditPort } from '../../core/ports/index.js';

const snapshotEvent = (event: SafeMemoryAuditEvent): SafeMemoryAuditEvent =>
  Object.freeze({
    correlationId: event.correlationId,
    ownerId: event.ownerId,
    actorId: event.actorId,
    role: event.role,
    action: event.action,
    outcome: event.outcome,
    namespace: event.namespace,
    recordId: event.recordId,
    privacyClassification: event.privacyClassification,
    trustLevel: event.trustLevel,
    scanDecision: event.scanDecision,
    findingCategories: Object.freeze([...event.findingCategories]),
    metadataFieldCount: event.metadataFieldCount,
    approvalId: event.approvalId,
    occurredAt: event.occurredAt,
  });

/**
 * Ephemeral audit sink. Keeps safe metadata only; no durability guarantees.
 */
export function createInMemoryAuditLog(): MemoryAuditPort {
  const events: SafeMemoryAuditEvent[] = [];

  return {
    record(
      event: SafeMemoryAuditEvent,
      access: AuthenticatedMemoryAccessContext,
    ): Promise<Result<void, DomainError>> {
      void access;
      events.push(snapshotEvent(event));
      return Promise.resolve(ok(undefined));
    },
  };
}
