import { createHash } from 'node:crypto';
import { harnessContentSha256 } from './harness-content.ts';

export type ContentIdentity = {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly contentSha256: string;
};

export type ReturnedMemoryRecordLike = {
  readonly id: string;
  readonly namespace: string;
  readonly content: string;
  readonly provenance?: { readonly initiatedBy?: string } | null;
};

export type ConfirmationBuildResult =
  | { readonly ok: true; readonly detail: ContentIdentity }
  | { readonly ok: false; readonly reason: string };

/** SHA-256 of an arbitrary UTF-8 content string. */
export const sha256Utf8 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * Build WRITE_CONFIRMED detail from known written content and identity.
 * Does not invent identity from unverified sources.
 */
export const buildWriteConfirmationDetail = (input: {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly writtenContent: string;
  readonly expectedContentSha256?: string;
}): ConfirmationBuildResult => {
  if (input.recordId.length === 0 || input.ownerId.length === 0 || input.namespace.length === 0) {
    return { ok: false, reason: 'WRITE_IDENTITY_MISSING' };
  }
  const contentSha256 = sha256Utf8(input.writtenContent);
  const expected = input.expectedContentSha256 ?? harnessContentSha256();
  if (contentSha256 !== expected) {
    return { ok: false, reason: 'WRITE_CONTENT_HASH_MISMATCH' };
  }
  return {
    ok: true,
    detail: {
      recordId: input.recordId,
      ownerId: input.ownerId,
      namespace: input.namespace,
      contentSha256,
    },
  };
};

/**
 * Build READ_CONFIRMED detail exclusively from the returned memory record payload.
 * Rejects claimed command identity and hardcoded hashes that do not match actual content.
 */
export const buildReadConfirmationFromRecord = (
  record: ReturnedMemoryRecordLike | null | undefined,
  expected: ContentIdentity,
): ConfirmationBuildResult => {
  if (record === null || record === undefined) {
    return { ok: false, reason: 'READ_RECORD_MISSING' };
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return { ok: false, reason: 'READ_RECORD_ID_MISSING' };
  }
  if (typeof record.namespace !== 'string' || record.namespace.length === 0) {
    return { ok: false, reason: 'READ_NAMESPACE_MISSING' };
  }
  if (typeof record.content !== 'string') {
    return { ok: false, reason: 'READ_CONTENT_MISSING' };
  }
  if (record.provenance === undefined || record.provenance === null) {
    return { ok: false, reason: 'READ_OWNER_MISSING' };
  }
  const ownerId = record.provenance.initiatedBy;
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    return { ok: false, reason: 'READ_OWNER_MISSING' };
  }
  if (record.id !== expected.recordId) {
    return { ok: false, reason: 'READ_RECORD_ID_MISMATCH' };
  }
  if (ownerId !== expected.ownerId) {
    return { ok: false, reason: 'READ_OWNER_MISMATCH' };
  }
  if (record.namespace !== expected.namespace) {
    return { ok: false, reason: 'READ_NAMESPACE_MISMATCH' };
  }
  const contentSha256 = sha256Utf8(record.content);
  if (contentSha256 !== expected.contentSha256) {
    return { ok: false, reason: 'READ_CONTENT_HASH_MISMATCH' };
  }
  return {
    ok: true,
    detail: {
      recordId: record.id,
      ownerId,
      namespace: record.namespace,
      contentSha256,
    },
  };
};

/** Parse LocalHost POLICY_DENIED reason prefix for authorization failure codes. */
export const parseAuthorizationFailureCode = (
  domainCode: string,
  reason: string | undefined,
): 'OWNER_MISMATCH' | 'NAMESPACE_ISOLATED' | null => {
  if (domainCode !== 'POLICY_DENIED' || typeof reason !== 'string') return null;
  if (reason.startsWith('OWNER_MISMATCH:')) return 'OWNER_MISMATCH';
  if (reason.startsWith('NAMESPACE_ISOLATED:')) return 'NAMESPACE_ISOLATED';
  return null;
};
