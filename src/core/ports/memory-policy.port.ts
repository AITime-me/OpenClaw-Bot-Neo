import type {
  DomainError,
  MemoryAccessContext,
  MemoryNamespace,
  MemoryProvenance,
  MemoryRetentionPolicy,
  MemorySource,
  MemoryTrustLevel,
  MemoryWriteDecision,
  PrivacyClassification,
  Result,
  SanitizedMetadata,
  SanitizedText,
} from '../domain/index.js';
/** Policy evaluates a candidate that already passed the sensitive-data scanner. */
export interface MemoryPolicyRequest {
  readonly namespace: MemoryNamespace;
  readonly content: SanitizedText;
  readonly metadata: SanitizedMetadata;
  readonly privacyClassification: PrivacyClassification;
  readonly trustLevel: MemoryTrustLevel;
  readonly source: MemorySource;
  readonly provenance: MemoryProvenance;
  readonly retentionPolicy: MemoryRetentionPolicy;
}
export interface MemoryPolicyPort {
  evaluate(
    request: MemoryPolicyRequest,
    access: MemoryAccessContext,
  ): Promise<Result<MemoryWriteDecision, DomainError>>;
}
