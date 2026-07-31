import type {
  MemoryProvenance,
  MemoryRecord,
  MemoryRetentionPolicy,
  MemorySource,
  PrivacyClassification,
  MemoryTrustLevel,
  MemoryNamespace,
  VerifiedMemoryWrite,
} from '../../../core/domain/index.js';
import {
  SQLITE_MEMORY_MAX_CONTENT_BYTES,
  SQLITE_MEMORY_MAX_ID_CHARS,
  SQLITE_MEMORY_MAX_JSON_BYTES,
} from './sqlite-memory-constants.js';

const utf8ByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export type StoredMemoryRow = {
  readonly owner_id: string;
  readonly namespace: string;
  readonly record_id: string;
  readonly content: string;
  readonly source_json: string;
  readonly provenance_json: string;
  readonly privacy_classification: string;
  readonly trust_level: string;
  readonly retention_json: string;
  readonly created_at: string;
  readonly updated_at: string;
};

const snapshotSource = (source: VerifiedMemoryWrite['source']): MemorySource =>
  Object.freeze({
    kind: source.kind,
    reference: source.reference,
    observedAt: source.observedAt,
  });

const snapshotProvenance = (provenance: VerifiedMemoryWrite['provenance']): MemoryProvenance =>
  Object.freeze({
    capturedAt: provenance.capturedAt,
    initiatedBy: provenance.initiatedBy,
    transformation: provenance.transformation,
    ownerApproved: provenance.ownerApproved,
    crossProjectAccess: provenance.crossProjectAccess,
  });

const snapshotRetention = (
  retention: VerifiedMemoryWrite['retentionPolicy'],
): MemoryRetentionPolicy =>
  Object.freeze({
    expiresAt: retention.expiresAt,
    reviewAt: retention.reviewAt,
    deleteOnExpiry: retention.deleteOnExpiry,
  });

const serializeJson = (value: unknown): { ok: true; json: string } | { ok: false } => {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return { ok: false };
    if (utf8ByteLength(json) > SQLITE_MEMORY_MAX_JSON_BYTES) return { ok: false };
    return { ok: true, json };
  } catch {
    return { ok: false };
  }
};

export const encodeVerifiedWriteForStorage = (
  write: VerifiedMemoryWrite,
): { ok: true; row: Omit<StoredMemoryRow, never> } | { ok: false; reason: string } => {
  const ownerId = write.ownerId;
  const namespace = write.namespace;
  const recordId = write.recordId;
  const content = write.content.value;

  if (ownerId.length === 0 || ownerId.length > SQLITE_MEMORY_MAX_ID_CHARS)
    return { ok: false, reason: 'owner_id' };
  if (recordId.length === 0 || recordId.length > SQLITE_MEMORY_MAX_ID_CHARS)
    return { ok: false, reason: 'record_id' };
  if (namespace.length === 0 || namespace.length > SQLITE_MEMORY_MAX_ID_CHARS)
    return { ok: false, reason: 'namespace' };
  if (typeof content !== 'string' || utf8ByteLength(content) > SQLITE_MEMORY_MAX_CONTENT_BYTES)
    return { ok: false, reason: 'content' };

  const source = serializeJson(snapshotSource(write.source));
  if (!source.ok) return { ok: false, reason: 'source' };
  const provenance = serializeJson(snapshotProvenance(write.provenance));
  if (!provenance.ok) return { ok: false, reason: 'provenance' };
  const retention = serializeJson(snapshotRetention(write.retentionPolicy));
  if (!retention.ok) return { ok: false, reason: 'retention' };

  return {
    ok: true,
    row: {
      owner_id: ownerId,
      namespace,
      record_id: recordId,
      content,
      source_json: source.json,
      provenance_json: provenance.json,
      privacy_classification: write.privacyClassification,
      trust_level: write.trustLevel,
      retention_json: retention.json,
      created_at: write.createdAt,
      updated_at: write.updatedAt,
    },
  };
};

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const reviveSource = (raw: string): MemorySource | null => {
  const parsed = parseJsonObject(raw);
  if (parsed === null) return null;
  if (typeof parsed['kind'] !== 'string') return null;
  if (typeof parsed['reference'] !== 'string') return null;
  if (typeof parsed['observedAt'] !== 'string') return null;
  return Object.freeze({
    kind: parsed['kind'] as MemorySource['kind'],
    reference: parsed['reference'],
    observedAt: parsed['observedAt'] as MemorySource['observedAt'],
  });
};

const reviveProvenance = (raw: string): MemoryProvenance | null => {
  const parsed = parseJsonObject(raw);
  if (parsed === null) return null;
  if (typeof parsed['capturedAt'] !== 'string') return null;
  if (typeof parsed['initiatedBy'] !== 'string') return null;
  if (typeof parsed['transformation'] !== 'string') return null;
  if (typeof parsed['ownerApproved'] !== 'boolean') return null;
  if (typeof parsed['crossProjectAccess'] !== 'boolean') return null;
  return Object.freeze({
    capturedAt: parsed['capturedAt'] as MemoryProvenance['capturedAt'],
    initiatedBy: parsed['initiatedBy'] as MemoryProvenance['initiatedBy'],
    transformation: parsed['transformation'],
    ownerApproved: parsed['ownerApproved'],
    crossProjectAccess: parsed['crossProjectAccess'],
  });
};

const reviveRetention = (raw: string): MemoryRetentionPolicy | null => {
  const parsed = parseJsonObject(raw);
  if (parsed === null) return null;
  if (typeof parsed['expiresAt'] !== 'string') return null;
  if (typeof parsed['reviewAt'] !== 'string') return null;
  if (parsed['deleteOnExpiry'] !== true) return null;
  return Object.freeze({
    expiresAt: parsed['expiresAt'] as MemoryRetentionPolicy['expiresAt'],
    reviewAt: parsed['reviewAt'] as MemoryRetentionPolicy['reviewAt'],
    deleteOnExpiry: true as const,
  });
};

export const rowToMemoryRecord = (row: StoredMemoryRow): MemoryRecord | null => {
  const source = reviveSource(row.source_json);
  const provenance = reviveProvenance(row.provenance_json);
  const retention = reviveRetention(row.retention_json);
  if (source === null || provenance === null || retention === null) return null;
  if (typeof row.record_id !== 'string' || typeof row.content !== 'string') return null;
  if (typeof row.namespace !== 'string') return null;
  if (typeof row.privacy_classification !== 'string') return null;
  if (typeof row.trust_level !== 'string') return null;
  if (typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') return null;

  return Object.freeze({
    id: row.record_id as MemoryRecord['id'],
    namespace: row.namespace as MemoryNamespace,
    content: row.content,
    source,
    provenance,
    privacyClassification: row.privacy_classification as PrivacyClassification,
    trustLevel: row.trust_level as MemoryTrustLevel,
    retentionPolicy: retention,
    createdAt: row.created_at as MemoryRecord['createdAt'],
    updatedAt: row.updated_at as MemoryRecord['updatedAt'],
  });
};
