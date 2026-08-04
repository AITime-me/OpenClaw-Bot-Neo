import type { Brand } from '../identity.js';
import {
  parseApprovalId,
  parseApprovalNonce,
  parseActorId,
  parseCorrelationId,
  parseIdempotencyKey,
  parseOwnerId,
  parsePolicyVersion,
  type ApprovalId,
  type ApprovalNonce,
  type ActorId,
  type CorrelationId,
  type IdempotencyKey,
  type OwnerId,
  type PolicyVersion,
  type IdentityFailure,
} from '../identity.js';

export type ConnectorId = Brand<string, 'ConnectorId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type InvocationId = Brand<string, 'InvocationId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;
export type ToolVersion = Brand<string, 'ToolVersion'>;
export type InputDigest = Brand<string, 'InputDigest'>;
export type SecretReferenceId = Brand<string, 'SecretReferenceId'>;
export type SecretHandleId = Brand<string, 'SecretHandleId'>;

export type {
  ApprovalId,
  ApprovalNonce,
  ActorId,
  CorrelationId,
  IdempotencyKey,
  OwnerId,
  PolicyVersion,
  IdentityFailure,
};

export {
  parseApprovalId,
  parseApprovalNonce,
  parseActorId,
  parseCorrelationId,
  parseIdempotencyKey,
  parseOwnerId,
  parsePolicyVersion,
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const HEX_DIGEST_64 = /^[a-f0-9]{64}$/;

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
  options: { readonly max: number; readonly pattern: RegExp; readonly label: string },
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

const parseId = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } =>
  parseBoundedToken(value, { max: 128, pattern: ID_PATTERN, label });

export const parseConnectorId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ConnectorId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ConnectorId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ConnectorId };
};

export const parseToolId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ToolId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ToolId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ToolId };
};

export const parseInvocationId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: InvocationId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'InvocationId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as InvocationId };
};

export const parseConnectionId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ConnectionId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'ConnectionId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ConnectionId };
};

export const parseToolVersion = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ToolVersion }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseBoundedToken(value, {
    max: 64,
    pattern: VERSION_PATTERN,
    label: 'ToolVersion',
  });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ToolVersion };
};

export const parseInputDigest = (
  value: unknown,
):
  | { readonly ok: true; readonly value: InputDigest }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'InputDigest must be a string.' } };
  if (!HEX_DIGEST_64.test(value))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: 'InputDigest must be a 64-character hex digest.' },
    };
  return { ok: true, value: value as InputDigest };
};

export const parseSecretReferenceId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: SecretReferenceId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'SecretReferenceId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as SecretReferenceId };
};

export const parseSecretHandleId = (
  value: unknown,
):
  | { readonly ok: true; readonly value: SecretHandleId }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseId(value, 'SecretHandleId');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as SecretHandleId };
};
