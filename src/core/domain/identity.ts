declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type ISO8601 = Brand<string, 'ISO8601'>;
export type OwnerId = Brand<string, 'OwnerId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type JobId = Brand<string, 'JobId'>;
export type MemoryRecordId = Brand<string, 'MemoryRecordId'>;
export type ReminderId = Brand<string, 'ReminderId'>;
export type ScheduledJobId = Brand<string, 'ScheduledJobId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type ApprovalNonce = Brand<string, 'ApprovalNonce'>;
export type PayloadDigest = Brand<string, 'PayloadDigest'>;
export type ResourceRef = Brand<string, 'ResourceRef'>;
export type ExtensionId = Brand<string, 'ExtensionId'>;
export type ExtensionVersion = Brand<string, 'ExtensionVersion'>;
export type PolicyVersion = Brand<string, 'PolicyVersion'>;
export type ManifestDigest = Brand<string, 'ManifestDigest'>;
export type EventId = Brand<string, 'EventId'>;
export type ProviderReference = Brand<string, 'ProviderReference'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ChannelId = Brand<string, 'ChannelId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type DeploymentIdentity = Brand<string, 'DeploymentIdentity'>;
export type Nonce = Brand<string, 'Nonce'>;

export type IdentityFailureCode =
  | 'EMPTY'
  | 'WHITESPACE'
  | 'CONTROL_CHAR'
  | 'INVALID_CHARSET'
  | 'TOO_LONG'
  | 'MALFORMED'
  | 'WRONG_LENGTH';

export interface IdentityFailure {
  readonly code: IdentityFailureCode;
  readonly reason: string;
}

const hasControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const hasWhitespace = (value: string): boolean => /\s/.test(value);

const parseBoundedToken = (
  value: unknown,
  options: {
    readonly max: number;
    readonly pattern: RegExp;
    readonly label: string;
  },
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${options.label} must be a string.` },
    };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: `${options.label} must not be empty.` } };
  if (hasWhitespace(value))
    return {
      ok: false,
      error: { code: 'WHITESPACE', reason: `${options.label} must not contain whitespace.` },
    };
  if (hasControl(value))
    return {
      ok: false,
      error: {
        code: 'CONTROL_CHAR',
        reason: `${options.label} must not contain control characters.`,
      },
    };
  if (value.length > options.max)
    return {
      ok: false,
      error: { code: 'TOO_LONG', reason: `${options.label} exceeds the maximum length.` },
    };
  if (!options.pattern.test(value))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${options.label} has an invalid format.` },
    };
  return { ok: true, value };
};

/** Visible ASCII token without whitespace/control; used for most opaque IDs. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const HEX_DIGEST_64 = /^[a-f0-9]{64}$/;
const HEX_DIGEST_FLEX = /^[a-f0-9]{32,128}$/;

const parseId = (
  value: unknown,
  label: string,
  max = 128,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseBoundedToken(value, { max, pattern: ID_PATTERN, label });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
};

export const parseMessageId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: MessageId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'MessageId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as MessageId };
};

export const parseCorrelationId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: CorrelationId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'CorrelationId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as CorrelationId };
};

export const parseOwnerId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: OwnerId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'OwnerId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as OwnerId };
};

export const parseActorId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ActorId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ActorId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ActorId };
};

export const parseExtensionId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ExtensionId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ExtensionId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ExtensionId };
};

export const parseExtensionVersion = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ExtensionVersion }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseBoundedToken(value, {
    max: 64,
    pattern: VERSION_PATTERN,
    label: 'ExtensionVersion',
  });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ExtensionVersion };
};

export const parsePolicyVersion = (
  value: unknown,
):
  | { readonly ok: true; readonly value: PolicyVersion }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseBoundedToken(value, {
    max: 64,
    pattern: VERSION_PATTERN,
    label: 'PolicyVersion',
  });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as PolicyVersion };
};

export const parseManifestDigest = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ManifestDigest }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'ManifestDigest must be a string.' } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: 'ManifestDigest must not be empty.' } };
  if (hasWhitespace(value) || hasControl(value))
    return {
      ok: false,
      error: {
        code: 'CONTROL_CHAR',
        reason: 'ManifestDigest must not contain whitespace or controls.',
      },
    };
  if (!HEX_DIGEST_64.test(value))
    return {
      ok: false,
      error: {
        code: value.length === 64 ? 'INVALID_CHARSET' : 'WRONG_LENGTH',
        reason: 'ManifestDigest must be a 64-character lowercase hex SHA-256 digest.',
      },
    };
  return { ok: true, value: value as ManifestDigest };
};

export const parsePayloadDigest = (
  value: unknown,
):
  | { readonly ok: true; readonly value: PayloadDigest }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'PayloadDigest must be a string.' } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: 'PayloadDigest must not be empty.' } };
  if (hasWhitespace(value) || hasControl(value))
    return {
      ok: false,
      error: {
        code: 'CONTROL_CHAR',
        reason: 'PayloadDigest must not contain whitespace or controls.',
      },
    };
  if (!HEX_DIGEST_FLEX.test(value))
    return {
      ok: false,
      error: {
        code: 'MALFORMED',
        reason: 'PayloadDigest must be lowercase hex with a controlled length.',
      },
    };
  return { ok: true, value: value as PayloadDigest };
};

export const parseEventId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: EventId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'EventId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as EventId };
};

export const parseIdempotencyKey = (
  value: unknown,
):
  | { readonly ok: true; readonly value: IdempotencyKey }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'IdempotencyKey');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as IdempotencyKey };
};

export const parseProviderReference = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ProviderReference }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ProviderReference');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ProviderReference };
};

export const parseSessionId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: SessionId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'SessionId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as SessionId };
};

export const parseChannelId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ChannelId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ChannelId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ChannelId };
};

export const parseSourceId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: SourceId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'SourceId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as SourceId };
};

export const parseDeploymentIdentity = (
  value: unknown,
):
  | { readonly ok: true; readonly value: DeploymentIdentity }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'DeploymentIdentity');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as DeploymentIdentity };
};

export const parseApprovalId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ApprovalId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ApprovalId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ApprovalId };
};

export const parseNonce = (
  value: unknown,
):
  | { readonly ok: true; readonly value: Nonce }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'Nonce', 256);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as Nonce };
};

export const parseApprovalNonce = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ApprovalNonce }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ApprovalNonce');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ApprovalNonce };
};
