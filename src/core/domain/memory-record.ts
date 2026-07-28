import type { MemoryRecordId, ISO8601 } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { MemorySource } from './memory-source.js';
import type { MemoryProvenance } from './memory-provenance.js';
import type { MemoryTrustLevel } from './memory-trust-level.js';
import type { MemoryRetentionPolicy } from './memory-retention-policy.js';
import type { PrivacyClassification } from './privacy.js';
export interface MemoryRecord {
  readonly id: MemoryRecordId;
  readonly namespace: MemoryNamespace;
  readonly content: string;
  readonly source: MemorySource;
  readonly provenance: MemoryProvenance;
  readonly privacyClassification: PrivacyClassification;
  readonly trustLevel: MemoryTrustLevel;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}
