import type { ApprovalId, ISO8601, MemoryRecordId, OwnerId } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { MemoryProvenance } from './memory-provenance.js';
import type { MemoryRetentionPolicy } from './memory-retention-policy.js';
import type { MemorySource } from './memory-source.js';
import type { MemoryTrustLevel } from './memory-trust-level.js';
import type { PrivacyClassification } from './privacy.js';
import type { SafeScanDecision } from './sensitive-data.js';
import { deepFreeze, freezeStringRecord } from './immutable.js';

/**
 * Mandatory evidence that a memory write passed the non-overrideable secret boundary.
 * Trust is module-private WeakMap membership; callers cannot forge clearance.
 */
export interface SecretBoundaryClearance {
  readonly kind: 'secret-boundary-clearance';
}

/** Write components bound to a single-use clearance token. */
export interface SecretBoundaryClearanceBinding {
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

interface ClearanceState {
  readonly binding: SecretBoundaryClearanceBinding;
  consumed: boolean;
}

const clearanceRegistry = new WeakMap<object, true>();
const clearanceStateRegistry = new WeakMap<object, ClearanceState>();

const retentionPoliciesEqual = (
  left: MemoryRetentionPolicy,
  right: MemoryRetentionPolicy,
): boolean => left.expiresAt === right.expiresAt && left.reviewAt === right.reviewAt;

const provenancesEqual = (left: MemoryProvenance, right: MemoryProvenance): boolean =>
  left.capturedAt === right.capturedAt &&
  left.initiatedBy === right.initiatedBy &&
  left.transformation === right.transformation &&
  left.ownerApproved === right.ownerApproved &&
  left.crossProjectAccess === right.crossProjectAccess;

const sourcesEqual = (left: MemorySource, right: MemorySource): boolean =>
  left.kind === right.kind &&
  left.reference === right.reference &&
  left.observedAt === right.observedAt;

const bindingsMatch = (
  binding: SecretBoundaryClearanceBinding,
  write: SecretBoundaryClearanceBinding,
): boolean =>
  binding.content === write.content &&
  binding.metadata === write.metadata &&
  binding.recordId === write.recordId &&
  binding.ownerId === write.ownerId &&
  binding.namespace === write.namespace &&
  binding.privacyClassification === write.privacyClassification &&
  binding.trustLevel === write.trustLevel &&
  binding.approvalId === write.approvalId &&
  binding.createdAt === write.createdAt &&
  binding.updatedAt === write.updatedAt &&
  sourcesEqual(binding.source, write.source) &&
  provenancesEqual(binding.provenance, write.provenance) &&
  retentionPoliciesEqual(binding.retentionPolicy, write.retentionPolicy);

/** Issued only after the mandatory memory-write secret guard succeeds for one exact write. */
export const issueSecretBoundaryClearance = (
  binding: SecretBoundaryClearanceBinding,
): SecretBoundaryClearance | null => {
  if (!isSanitizedText(binding.content) || !isSanitizedMetadata(binding.metadata)) return null;
  const view = deepFreeze({ kind: 'secret-boundary-clearance' as const });
  clearanceRegistry.set(view, true);
  clearanceStateRegistry.set(view, { binding, consumed: false });
  return view;
};

export const isSecretBoundaryClearance = (value: unknown): value is SecretBoundaryClearance =>
  typeof value === 'object' && value !== null && clearanceRegistry.has(value);

/**
 * Seals for values that already passed the sensitive-data scanner.
 * Trust is module-private WeakMap membership (object identity), not a Symbol property.
 * Factories are not part of the public API.
 */

export interface SanitizedText {
  readonly value: string;
  readonly scanDecision: SafeScanDecision;
}

export interface SanitizedMetadata {
  readonly entries: Readonly<Record<string, string>>;
  readonly scanDecision: SafeScanDecision;
}

export interface VerifiedMemoryWrite {
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

interface SanitizedTextCanonical {
  readonly value: string;
  readonly scanDecision: SafeScanDecision;
}

interface SanitizedMetadataCanonical {
  readonly entries: Readonly<Record<string, string>>;
  readonly scanDecision: SafeScanDecision;
}

interface VerifiedMemoryWriteCanonical {
  readonly recordId: MemoryRecordId;
  readonly ownerId: OwnerId;
  readonly namespace: MemoryNamespace;
  readonly content: SanitizedTextCanonical;
  readonly metadata: SanitizedMetadataCanonical;
  readonly source: MemorySource;
  readonly provenance: MemoryProvenance;
  readonly privacyClassification: PrivacyClassification;
  readonly trustLevel: MemoryTrustLevel;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly approvalId: ApprovalId | null;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}

const sanitizedTextRegistry = new WeakMap<object, SanitizedTextCanonical>();
const sanitizedMetadataRegistry = new WeakMap<object, SanitizedMetadataCanonical>();
const verifiedMemoryWriteRegistry = new WeakMap<object, VerifiedMemoryWriteCanonical>();
const verifiedMemoryWriteClearanceRegistry = new WeakMap<object, true>();

export const sealSanitizedText = (value: string, scanDecision: SafeScanDecision): SanitizedText => {
  if (typeof value !== 'string') throw new TypeError('Sanitized text must be a string.');
  const view = deepFreeze({ value, scanDecision });
  const canonical: SanitizedTextCanonical = { value, scanDecision };
  sanitizedTextRegistry.set(view, canonical);
  return view;
};

export const sealSanitizedMetadata = (
  entries: Readonly<Record<string, string>>,
  scanDecision: SafeScanDecision,
): SanitizedMetadata => {
  const frozenEntries = freezeStringRecord(entries);
  if (frozenEntries === null)
    throw new TypeError('Sanitized metadata entries must be a plain string record.');
  const view = deepFreeze({ entries: frozenEntries, scanDecision });
  const canonical: SanitizedMetadataCanonical = {
    entries: freezeStringRecord(frozenEntries) ?? frozenEntries,
    scanDecision,
  };
  sanitizedMetadataRegistry.set(view, canonical);
  return view;
};

export const sealVerifiedMemoryWrite = (
  write: SecretBoundaryClearanceBinding,
  clearance: SecretBoundaryClearance,
): VerifiedMemoryWrite | null => {
  if (!isSecretBoundaryClearance(clearance)) return null;
  const state = clearanceStateRegistry.get(clearance);
  if (state === undefined || state.consumed) return null;
  if (!isSanitizedText(write.content) || !isSanitizedMetadata(write.metadata)) return null;
  if (!bindingsMatch(state.binding, write)) return null;

  const contentCanonical = sanitizedTextRegistry.get(write.content);
  const metadataCanonical = sanitizedMetadataRegistry.get(write.metadata);
  if (contentCanonical === undefined || metadataCanonical === undefined) return null;

  state.consumed = true;

  const provenance = deepFreeze({ ...write.provenance });
  const source = deepFreeze({ ...write.source });
  const retentionPolicy = deepFreeze({ ...write.retentionPolicy });
  const view = deepFreeze({
    recordId: write.recordId,
    ownerId: write.ownerId,
    namespace: write.namespace,
    content: write.content,
    metadata: write.metadata,
    source,
    provenance,
    privacyClassification: write.privacyClassification,
    trustLevel: write.trustLevel,
    retentionPolicy,
    approvalId: write.approvalId,
    createdAt: write.createdAt,
    updatedAt: write.updatedAt,
  });
  const canonical: VerifiedMemoryWriteCanonical = {
    recordId: write.recordId,
    ownerId: write.ownerId,
    namespace: write.namespace,
    content: contentCanonical,
    metadata: metadataCanonical,
    source,
    provenance,
    privacyClassification: write.privacyClassification,
    trustLevel: write.trustLevel,
    retentionPolicy,
    approvalId: write.approvalId,
    createdAt: write.createdAt,
    updatedAt: write.updatedAt,
  };
  verifiedMemoryWriteRegistry.set(view, canonical);
  verifiedMemoryWriteClearanceRegistry.set(view, true);
  return view;
};

export const isSanitizedText = (value: unknown): value is SanitizedText =>
  typeof value === 'object' && value !== null && sanitizedTextRegistry.has(value);

export const isSanitizedMetadata = (value: unknown): value is SanitizedMetadata =>
  typeof value === 'object' && value !== null && sanitizedMetadataRegistry.has(value);

export const isVerifiedMemoryWrite = (value: unknown): value is VerifiedMemoryWrite =>
  typeof value === 'object' && value !== null && verifiedMemoryWriteRegistry.has(value);

export const getSanitizedTextCanonical = (value: SanitizedText): SanitizedTextCanonical | null =>
  sanitizedTextRegistry.get(value) ?? null;

export const getSanitizedMetadataCanonical = (
  value: SanitizedMetadata,
): SanitizedMetadataCanonical | null => sanitizedMetadataRegistry.get(value) ?? null;

export const getVerifiedMemoryWriteCanonical = (
  value: VerifiedMemoryWrite,
): VerifiedMemoryWriteCanonical | null => verifiedMemoryWriteRegistry.get(value) ?? null;

export const verifiedMemoryWriteHasClearance = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  verifiedMemoryWriteRegistry.has(value) &&
  verifiedMemoryWriteClearanceRegistry.has(value);
