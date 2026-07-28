import type { ApprovalId, ISO8601, MemoryRecordId, OwnerId } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { MemoryProvenance } from './memory-provenance.js';
import type { MemoryRetentionPolicy } from './memory-retention-policy.js';
import type { MemorySource } from './memory-source.js';
import type { MemoryTrustLevel } from './memory-trust-level.js';
import type { PrivacyClassification } from './privacy.js';
import type { SafeScanDecision } from './sensitive-data.js';

/**
 * Seals for values that already passed the sensitive-data scanner. The symbols and the
 * factories below are not part of the public API: the architecture checker restricts this
 * module to the memory-write application service, so a future adapter cannot relabel a raw
 * string as sanitized.
 */
export const sanitizedTextBrand: unique symbol = Symbol('SanitizedText');
export const sanitizedMetadataBrand: unique symbol = Symbol('SanitizedMetadata');
export const verifiedMemoryWriteBrand: unique symbol = Symbol('VerifiedMemoryWrite');

export interface SanitizedText {
  readonly [sanitizedTextBrand]: true;
  readonly value: string;
  readonly scanDecision: SafeScanDecision;
}
export interface SanitizedMetadata {
  readonly [sanitizedMetadataBrand]: true;
  readonly entries: Readonly<Record<string, string>>;
  readonly scanDecision: SafeScanDecision;
}
export interface VerifiedMemoryWrite {
  readonly [verifiedMemoryWriteBrand]: true;
  readonly recordId: MemoryRecordId;
  readonly ownerId: OwnerId;
  readonly namespace: MemoryNamespace;
  readonly content: SanitizedText;
  readonly metadata: SanitizedMetadata;
  readonly source: MemorySource;
  readonly provenance: MemoryProvenance;
  readonly privacyClassification: PrivacyClassification;
  readonly trustLevel: MemoryTrustLevel;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly approvalId: ApprovalId | null;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}

export const sealSanitizedText = (
  value: string,
  scanDecision: SafeScanDecision,
): SanitizedText => ({
  [sanitizedTextBrand]: true,
  value,
  scanDecision,
});

export const sealSanitizedMetadata = (
  entries: Readonly<Record<string, string>>,
  scanDecision: SafeScanDecision,
): SanitizedMetadata => ({ [sanitizedMetadataBrand]: true, entries, scanDecision });

export const sealVerifiedMemoryWrite = (
  write: Omit<VerifiedMemoryWrite, typeof verifiedMemoryWriteBrand>,
): VerifiedMemoryWrite => ({ [verifiedMemoryWriteBrand]: true, ...write });
