import { computeCommunicationTextDigest } from '../../../../core/communication/domain/communication-identity.js';
import {
  freezeConversationStateSnapshot,
  type ConversationActiveContextEntry,
  type ConversationModelDerivedSummary,
  type ConversationStateSnapshot,
} from '../../../../core/communication/domain/conversation-state.js';
import type { ConversationRevision } from '../../../../core/communication/domain/communication-identity.js';
import type { OwnerId } from '../../../../core/domain/identity.js';
import type { ConversationId } from '../../../../core/communication/domain/communication-identity.js';
import {
  SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_ENTRIES,
  SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_VALUE_BYTES,
  SQLITE_COMMUNICATION_MAX_JSON_BYTES,
  SQLITE_COMMUNICATION_MAX_OUTBOX_PLAINTEXT_BYTES,
} from './sqlite-communication-constants.js';

const utf8ByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export const assertSafeInteger = (
  value: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; reason: string } => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return { ok: false, reason: `${label} must be a safe integer.` };
  return { ok: true, value };
};

const serializeJson = (
  value: unknown,
): { ok: true; json: string } | { ok: false; reason: string } => {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return { ok: false, reason: 'json_serialize' };
    if (utf8ByteLength(json) > SQLITE_COMMUNICATION_MAX_JSON_BYTES)
      return { ok: false, reason: 'json_too_large' };
    return { ok: true, json };
  } catch {
    return { ok: false, reason: 'json_serialize' };
  }
};

const parseJson = (raw: string): { ok: true; value: unknown } | { ok: false; reason: string } => {
  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'json_parse' };
  }
};

/** Stable fingerprint of conversation snapshot body (SHA-256 hex via domain digest helper). */
export const fingerprintConversationSnapshot = (snapshot: ConversationStateSnapshot): string => {
  const body = {
    conversationId: snapshot.conversationId,
    ownerId: snapshot.ownerId,
    revision: snapshot.revision,
    pauseState: snapshot.pauseState,
    checkpoint: snapshot.checkpoint,
    activeContext: snapshot.activeContext,
    modelDerivedSummary: snapshot.modelDerivedSummary,
  };
  const encoded = serializeJson(body);
  if (!encoded.ok) throw new TypeError('Conversation snapshot fingerprint serialization failed.');
  return computeCommunicationTextDigest(encoded.json);
};

export const encodeConversationSnapshotParts = (
  snapshot: ConversationStateSnapshot,
):
  | {
      readonly ok: true;
      readonly activeContextJson: string;
      readonly summaryJson: string;
      readonly fingerprint: string;
    }
  | { readonly ok: false; readonly reason: string } => {
  const context = serializeJson(snapshot.activeContext);
  if (!context.ok) return context;
  const summary = serializeJson(snapshot.modelDerivedSummary);
  if (!summary.ok) return summary;
  let fingerprint: string;
  try {
    fingerprint = fingerprintConversationSnapshot(snapshot);
  } catch {
    return { ok: false, reason: 'fingerprint' };
  }
  return {
    ok: true,
    activeContextJson: context.json,
    summaryJson: summary.json,
    fingerprint,
  };
};

const parseActiveContext = (
  value: unknown,
):
  | { ok: true; value: readonly ConversationActiveContextEntry[] }
  | { ok: false; reason: string } => {
  if (!Array.isArray(value)) return { ok: false, reason: 'active_context' };
  const entries: ConversationActiveContextEntry[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return { ok: false, reason: 'active_context_entry' };
    const role = item['role'];
    const text = item['text'];
    const trust = item['trust'];
    if (
      (role !== 'owner' && role !== 'assistant' && role !== 'system-notice') ||
      typeof text !== 'string' ||
      (trust !== 'untrusted' && trust !== 'model-derived-untrusted')
    )
      return { ok: false, reason: 'active_context_entry' };
    entries.push(Object.freeze({ role, text, trust }));
  }
  return { ok: true, value: Object.freeze(entries) };
};

const parseSummary = (
  value: unknown,
): { ok: true; value: ConversationModelDerivedSummary | null } | { ok: false; reason: string } => {
  if (value === null) return { ok: true, value: null };
  if (!isPlainObject(value)) return { ok: false, reason: 'summary' };
  const text = value['text'];
  const trust = value['trust'];
  if (typeof text !== 'string' || trust !== 'model-derived-untrusted')
    return { ok: false, reason: 'summary' };
  return { ok: true, value: Object.freeze({ text, trust }) };
};

export const decodeConversationSnapshot = (input: {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly pauseState: string;
  readonly checkpointStatus: string;
  readonly checkpointRevision: number;
  readonly activeContextJson: string;
  readonly summaryJson: string;
}): { ok: true; snapshot: ConversationStateSnapshot } | { ok: false; reason: string } => {
  const revision = assertSafeInteger(input.revision, 'revision');
  if (!revision.ok) return revision;
  const checkpointRevision = assertSafeInteger(input.checkpointRevision, 'checkpointRevision');
  if (!checkpointRevision.ok) return checkpointRevision;

  if (
    input.pauseState !== 'active' &&
    input.pauseState !== 'paused' &&
    input.pauseState !== 'degraded'
  )
    return { ok: false, reason: 'pause_state' };
  if (
    input.checkpointStatus !== 'not_required' &&
    input.checkpointStatus !== 'pending' &&
    input.checkpointStatus !== 'succeeded' &&
    input.checkpointStatus !== 'failed'
  )
    return { ok: false, reason: 'checkpoint_status' };

  const contextRaw = parseJson(input.activeContextJson);
  if (!contextRaw.ok) return contextRaw;
  const context = parseActiveContext(contextRaw.value);
  if (!context.ok) return context;
  const summaryRaw = parseJson(input.summaryJson);
  if (!summaryRaw.ok) return summaryRaw;
  const summary = parseSummary(summaryRaw.value);
  if (!summary.ok) return summary;

  return {
    ok: true,
    snapshot: freezeConversationStateSnapshot({
      conversationId: input.conversationId as ConversationId,
      ownerId: input.ownerId as OwnerId,
      revision: revision.value as ConversationRevision,
      activeContext: context.value,
      modelDerivedSummary: summary.value,
      pauseState: input.pauseState,
      checkpoint: Object.freeze({
        status: input.checkpointStatus,
        revision: checkpointRevision.value as ConversationRevision,
      }),
    }),
  };
};

export const encodeAuditMetadata = (
  metadata: Readonly<Record<string, string>>,
): { ok: true; json: string } | { ok: false; reason: string } => {
  const keys = Object.keys(metadata);
  if (keys.length > SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_ENTRIES)
    return { ok: false, reason: 'metadata_too_many_entries' };
  const normalized: Record<string, string> = {};
  for (const key of keys.sort()) {
    const value = metadata[key];
    if (typeof key !== 'string' || key.length === 0 || typeof value !== 'string')
      return { ok: false, reason: 'metadata_invalid' };
    if (utf8ByteLength(value) > SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_VALUE_BYTES)
      return { ok: false, reason: 'metadata_value_too_large' };
    normalized[key] = value;
  }
  return serializeJson(normalized);
};

export const encodeOutboxPlaintext = (
  plaintext: string,
): { ok: true; plaintext: string } | { ok: false; reason: string } => {
  if (typeof plaintext !== 'string') return { ok: false, reason: 'plaintext_invalid' };
  if (utf8ByteLength(plaintext) > SQLITE_COMMUNICATION_MAX_OUTBOX_PLAINTEXT_BYTES)
    return { ok: false, reason: 'plaintext_too_large' };
  return { ok: true, plaintext };
};

export const snapshotTextsForScan = (snapshot: ConversationStateSnapshot): readonly string[] => {
  const texts: string[] = [];
  for (const entry of snapshot.activeContext) texts.push(entry.text);
  if (snapshot.modelDerivedSummary !== null) texts.push(snapshot.modelDerivedSummary.text);
  return texts;
};
