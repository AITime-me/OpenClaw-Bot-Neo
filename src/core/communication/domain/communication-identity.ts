import { createHash } from 'node:crypto';
import {
  type Brand,
  type IdentityFailure,
  type PayloadDigest,
  parsePayloadDigest,
} from '../../domain/identity.js';
import { err, ok, type Result } from '../../domain/result.js';

export type {
  ActorId,
  CorrelationId,
  ISO8601,
  OwnerId,
  PayloadDigest,
  PolicyVersion,
} from '../../domain/identity.js';
export {
  parseActorId,
  parseCorrelationId,
  parseISO8601,
  parseOwnerId,
  parsePolicyVersion,
} from '../../domain/identity.js';

/** Trusted local transport-instance identity assigned after sealed transport validation. */
export type TransportInstanceId = Brand<string, 'TransportInstanceId'>;
/** Trusted turn identifier created locally after atomic observed admission. */
export type TurnId = Brand<string, 'TurnId'>;
/** Canonical trusted conversation identity; transport cannot mint this directly. */
export type ConversationId = Brand<string, 'ConversationId'>;
/** Schema/binding version participating in idempotency derivation. */
export type CommunicationBindingVersion = Brand<string, 'CommunicationBindingVersion'>;
/** SHA-256 digest keyed by transport-scoped admission inputs. */
export type CommunicationIdempotencyKey = Brand<string, 'CommunicationIdempotencyKey'>;
/** Monotonic trusted per-conversation ordering sequence (1-based). */
export type ConversationSequence = Brand<number, 'ConversationSequence'>;
/** Durable conversation checkpoint revision. */
export type ConversationRevision = Brand<number, 'ConversationRevision'>;
/** Durable per-turn optimistic concurrency revision. */
export type TurnRevision = Brand<number, 'TurnRevision'>;

/** Validated-but-untrusted transport instance reference from adapter observation. */
export type ExternalTransportInstanceReference = Brand<
  string,
  'ExternalTransportInstanceReference'
>;
/** Validated-but-untrusted external message reference. */
export type ExternalTransportMessageReference = Brand<string, 'ExternalTransportMessageReference'>;
/** Validated-but-untrusted external conversation reference. */
export type ExternalTransportConversationReference = Brand<
  string,
  'ExternalTransportConversationReference'
>;
/** Validated-but-untrusted external sender reference. */
export type ExternalTransportSenderReference = Brand<string, 'ExternalTransportSenderReference'>;
/** Untrusted source metadata timestamp; never trusted for ordering or authority. */
export type UntrustedSourceTimestamp = Brand<string, 'UntrustedSourceTimestamp'>;

export const MAX_OWNER_TEXT_UTF8_BYTES = 16_384 as const;
export const MAX_MEMORY_EXCERPT_COUNT = 16 as const;
export const MAX_MEMORY_EXCERPT_UTF8_BYTES = 2_048 as const;
export const MAX_MEMORY_EXCERPTS_TOTAL_UTF8_BYTES = 16_384 as const;
export const MAX_ACTIVE_CONTEXT_ENTRIES = 32 as const;
export const MAX_ACTIVE_CONTEXT_TOTAL_UTF8_BYTES = 24_576 as const;
export const MAX_PROMPT_TOTAL_UTF8_BYTES = 49_152 as const;
export const MIN_MODEL_OUTPUT_UTF8_BYTES = 1 as const;
export const MAX_MODEL_OUTPUT_UTF8_BYTES = 8_192 as const;
export const MAX_TRANSPORT_OBSERVATION_TEXT_UTF8_BYTES = 16_384 as const;

const IDEMPOTENCY_DOMAIN_TAG = 'neo.communication.idempotency.v1' as const;
const TRUSTED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;
const BINDING_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const HEX_DIGEST_64 = /^[a-f0-9]{64}$/;
const VISIBLE_ASCII_REFERENCE_PATTERN = /^[\x21-\x7E]+$/;
const UNTRUSTED_TIMESTAMP_MAX_LENGTH = 256;

const textEncoder = new TextEncoder();

export type CommunicationTextFailureCode =
  'EMPTY' | 'MALFORMED' | 'CONTROL_CHAR' | 'INVALID_UNICODE' | 'UTF8_TOO_LARGE';

export interface CommunicationTextFailure {
  readonly code: CommunicationTextFailureCode;
  readonly reason: string;
}

const hasWhitespace = (value: string): boolean => /\s/.test(value);

const hasControlExceptTabLf = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a) continue;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const hasInvalidSurrogates = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

const canonicalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const utf8ByteLength = (value: string): number => textEncoder.encode(value).byteLength;

const parseBoundedToken = (
  value: unknown,
  options: {
    readonly max: number;
    readonly pattern: RegExp;
    readonly label: string;
  },
): Result<string, IdentityFailure> => {
  if (typeof value !== 'string')
    return err({ code: 'MALFORMED', reason: `${options.label} must be a string.` });
  if (value.length === 0)
    return err({ code: 'EMPTY', reason: `${options.label} must not be empty.` });
  if (hasWhitespace(value))
    return err({ code: 'WHITESPACE', reason: `${options.label} must not contain whitespace.` });
  if (hasControlExceptTabLf(value))
    return err({
      code: 'CONTROL_CHAR',
      reason: `${options.label} must not contain control characters.`,
    });
  if (value.length > options.max)
    return err({ code: 'TOO_LONG', reason: `${options.label} exceeds the maximum length.` });
  if (!options.pattern.test(value))
    return err({ code: 'INVALID_CHARSET', reason: `${options.label} has an invalid format.` });
  return ok(value);
};

const parseTrustedId = (value: unknown, label: string): Result<string, IdentityFailure> =>
  parseBoundedToken(value, { max: 128, pattern: TRUSTED_ID_PATTERN, label });

const parseExternalReference = (value: unknown, label: string): Result<string, IdentityFailure> =>
  parseBoundedToken(value, {
    max: 256,
    pattern: VISIBLE_ASCII_REFERENCE_PATTERN,
    label,
  });

const parseSafeIntegerInRange = (
  value: unknown,
  label: string,
  min: number,
  max: number,
): Result<number, IdentityFailure> => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return err({ code: 'MALFORMED', reason: `${label} must be a safe integer.` });
  if (value < min || value > max)
    return err({ code: 'MALFORMED', reason: `${label} is outside the allowed range.` });
  return ok(value);
};

export const parseTransportInstanceId = (
  value: unknown,
): Result<TransportInstanceId, IdentityFailure> => {
  const parsed = parseTrustedId(value, 'TransportInstanceId');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as TransportInstanceId);
};

export const parseTurnId = (value: unknown): Result<TurnId, IdentityFailure> => {
  const parsed = parseTrustedId(value, 'TurnId');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as TurnId);
};

export const parseConversationId = (value: unknown): Result<ConversationId, IdentityFailure> => {
  const parsed = parseTrustedId(value, 'ConversationId');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ConversationId);
};

export const parseCommunicationBindingVersion = (
  value: unknown,
): Result<CommunicationBindingVersion, IdentityFailure> => {
  const parsed = parseBoundedToken(value, {
    max: 64,
    pattern: BINDING_VERSION_PATTERN,
    label: 'CommunicationBindingVersion',
  });
  if (!parsed.ok) return parsed;
  return ok(parsed.value as CommunicationBindingVersion);
};

export const parseCommunicationIdempotencyKey = (
  value: unknown,
): Result<CommunicationIdempotencyKey, IdentityFailure> => {
  if (typeof value !== 'string')
    return err({
      code: 'MALFORMED',
      reason: 'CommunicationIdempotencyKey must be a string.',
    });
  if (value.length !== 64)
    return err({
      code: 'WRONG_LENGTH',
      reason: 'CommunicationIdempotencyKey must be exactly 64 lowercase hex characters.',
    });
  if (hasWhitespace(value) || hasControlExceptTabLf(value))
    return err({
      code: 'CONTROL_CHAR',
      reason: 'CommunicationIdempotencyKey must not contain whitespace or controls.',
    });
  if (!HEX_DIGEST_64.test(value))
    return err({
      code: 'INVALID_CHARSET',
      reason: 'CommunicationIdempotencyKey must be lowercase hex.',
    });
  return ok(value as CommunicationIdempotencyKey);
};

export const parseConversationSequence = (
  value: unknown,
): Result<ConversationSequence, IdentityFailure> => {
  const parsed = parseSafeIntegerInRange(value, 'ConversationSequence', 1, Number.MAX_SAFE_INTEGER);
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ConversationSequence);
};

export const parseConversationRevision = (
  value: unknown,
): Result<ConversationRevision, IdentityFailure> => {
  const parsed = parseSafeIntegerInRange(value, 'ConversationRevision', 0, Number.MAX_SAFE_INTEGER);
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ConversationRevision);
};

export const parseTurnRevision = (value: unknown): Result<TurnRevision, IdentityFailure> => {
  const parsed = parseSafeIntegerInRange(value, 'TurnRevision', 0, Number.MAX_SAFE_INTEGER);
  if (!parsed.ok) return parsed;
  return ok(parsed.value as TurnRevision);
};

export const parseExternalTransportInstanceReference = (
  value: unknown,
): Result<ExternalTransportInstanceReference, IdentityFailure> => {
  const parsed = parseExternalReference(value, 'ExternalTransportInstanceReference');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ExternalTransportInstanceReference);
};

export const parseExternalTransportMessageReference = (
  value: unknown,
): Result<ExternalTransportMessageReference, IdentityFailure> => {
  const parsed = parseExternalReference(value, 'ExternalTransportMessageReference');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ExternalTransportMessageReference);
};

export const parseExternalTransportConversationReference = (
  value: unknown,
): Result<ExternalTransportConversationReference, IdentityFailure> => {
  const parsed = parseExternalReference(value, 'ExternalTransportConversationReference');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ExternalTransportConversationReference);
};

export const parseExternalTransportSenderReference = (
  value: unknown,
): Result<ExternalTransportSenderReference, IdentityFailure> => {
  const parsed = parseExternalReference(value, 'ExternalTransportSenderReference');
  if (!parsed.ok) return parsed;
  return ok(parsed.value as ExternalTransportSenderReference);
};

export const parseUntrustedSourceTimestamp = (
  value: unknown,
): Result<UntrustedSourceTimestamp | null, IdentityFailure> => {
  if (value === null) return ok(null);
  if (typeof value !== 'string')
    return err({ code: 'MALFORMED', reason: 'UntrustedSourceTimestamp must be a string or null.' });
  if (value.length === 0)
    return err({ code: 'EMPTY', reason: 'UntrustedSourceTimestamp must not be empty.' });
  if (value.length > UNTRUSTED_TIMESTAMP_MAX_LENGTH)
    return err({
      code: 'TOO_LONG',
      reason: 'UntrustedSourceTimestamp exceeds the maximum length.',
    });
  if (hasControlExceptTabLf(value))
    return err({
      code: 'CONTROL_CHAR',
      reason: 'UntrustedSourceTimestamp must not contain control characters.',
    });
  return ok(value as UntrustedSourceTimestamp);
};

/**
 * Canonicalizes line endings to LF and validates Unicode, control, and UTF-8 bounds.
 * Does not trim or case-fold.
 */
export const normalizeAndValidateCommunicationText = (
  value: unknown,
  maxUtf8Bytes: number,
  label = 'Text',
): Result<string, CommunicationTextFailure> => {
  if (typeof value !== 'string')
    return err({ code: 'MALFORMED', reason: `${label} must be a string.` });
  const canonical = canonicalizeLineEndings(value);
  if (hasInvalidSurrogates(canonical))
    return err({
      code: 'INVALID_UNICODE',
      reason: `${label} contains invalid surrogate sequences.`,
    });
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    if (code === 0x09 || code === 0x0a) continue;
    if (code <= 0x1f || code === 0x7f)
      return err({
        code: 'CONTROL_CHAR',
        reason: `${label} contains forbidden control characters.`,
      });
  }
  if (utf8ByteLength(canonical) > maxUtf8Bytes)
    return err({ code: 'UTF8_TOO_LARGE', reason: `${label} exceeds the maximum UTF-8 size.` });
  return ok(canonical);
};

const lengthPrefix = (value: string): string => `${utf8ByteLength(value).toString(10)}:${value}`;

const idempotencyField = (name: string, value: string): string => `${name}=${lengthPrefix(value)}`;

/**
 * Deterministic transport-scoped idempotency key.
 * Excludes text, sender, sourceTimestamp, and observedAt by design.
 */
export const deriveCommunicationIdempotencyKey = (input: {
  readonly transportInstanceId: TransportInstanceId;
  readonly externalConversationReference: ExternalTransportConversationReference;
  readonly externalMessageReference: ExternalTransportMessageReference;
  readonly bindingVersion: CommunicationBindingVersion;
}): CommunicationIdempotencyKey => {
  const preimage = [
    IDEMPOTENCY_DOMAIN_TAG,
    idempotencyField('transportInstanceId', input.transportInstanceId),
    idempotencyField('externalConversationReference', input.externalConversationReference),
    idempotencyField('externalMessageReference', input.externalMessageReference),
    idempotencyField('bindingVersion', input.bindingVersion),
  ].join('\n');
  return createHash('sha256').update(preimage, 'utf8').digest('hex') as CommunicationIdempotencyKey;
};

export const computeCommunicationTextDigest = (text: string): PayloadDigest => {
  const parsed = parsePayloadDigest(createHash('sha256').update(text, 'utf8').digest('hex'));
  if (!parsed.ok) throw new RangeError('Communication text digest computation failed.');
  return parsed.value;
};
