import type {
  ActorId,
  ApprovalId,
  CorrelationId,
  ISO8601,
  JobId,
  MemoryRecordId,
  OwnerId,
} from './identity.js';
import type { MediaKind } from './media-kind.js';
import type { MemoryRole } from './memory-access.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { MemoryTrustLevel } from './memory-trust-level.js';
import type { PrivacyClassification } from './privacy.js';
import type { SafeScanDecision, SensitiveCategory } from './sensitive-data.js';

/**
 * Audit events carry classification and identifiers only. No content, metadata value or
 * scanner match text may enter an audit sink, so the shape deliberately has no free-form
 * payload field.
 */
export interface SafeMemoryAuditEvent {
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly role: MemoryRole;
  readonly action: 'memory-write' | 'memory-read' | 'memory-query' | 'memory-delete';
  readonly outcome: 'allowed' | 'denied';
  readonly namespace: MemoryNamespace;
  readonly recordId: MemoryRecordId | null;
  readonly privacyClassification: PrivacyClassification;
  readonly trustLevel: MemoryTrustLevel;
  readonly scanDecision: SafeScanDecision;
  readonly findingCategories: readonly SensitiveCategory[];
  readonly metadataKeys: readonly string[];
  readonly approvalId: ApprovalId | null;
  readonly occurredAt: ISO8601;
}

export interface SafeMediaAuditEvent {
  readonly correlationId: CorrelationId;
  readonly ownerId: OwnerId;
  readonly jobId: JobId;
  readonly mediaKind: MediaKind;
  readonly action: 'received' | 'validated' | 'processed' | 'delivered' | 'rejected' | 'cleaned-up';
  readonly outcome: 'allowed' | 'denied';
  readonly privacyClassification: PrivacyClassification;
  readonly providerId: string | null;
  readonly scanDecision: SafeScanDecision;
  readonly findingCategories: readonly SensitiveCategory[];
  readonly occurredAt: ISO8601;
}
