import type { Brand } from '../identity.js';
import type { IdentityFailure } from '../identity.js';
import type { OwnerId } from '../identity.js';
import { parseOwnerId } from '../identity.js';

export type ServerId = Brand<string, 'ServerId'>;
export type ServiceId = Brand<string, 'ServiceId'>;
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
export type ProviderId = Brand<string, 'ProviderId'>;
export type ProviderServerId = Brand<string, 'ProviderServerId'>;
export type RegionId = Brand<string, 'RegionId'>;
export type ProductIdReference = Brand<string, 'ProductIdReference'>;
export type InfrastructureObservationId = Brand<string, 'InfrastructureObservationId'>;
export type InfrastructureOperationId = Brand<string, 'InfrastructureOperationId'>;
export type ReleaseId = Brand<string, 'ReleaseId'>;
export type HostConnectionReferenceId = Brand<string, 'HostConnectionReferenceId'>;
export type SystemdUnitName = Brand<string, 'SystemdUnitName'>;
export type ServicePort = Brand<number, 'ServicePort'>;
export type ServerDisplayName = Brand<string, 'ServerDisplayName'>;
export type ServiceDisplayName = Brand<string, 'ServiceDisplayName'>;
export type EnvironmentDisplayName = Brand<string, 'EnvironmentDisplayName'>;

export type { OwnerId, IdentityFailure };
export { parseOwnerId };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;
const DISPLAY_NAME_PATTERN = /^[\x20-\x7E]{1,128}$/;
const SYSTEMD_UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;
const HOSTNAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

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
  if (value.includes('\0'))
    return { ok: false, error: { code: 'CONTROL_CHAR', reason: `${options.label} contains NUL.` } };
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

const brandParser =
  <T extends string>(label: string) =>
  (
    value: unknown,
  ):
    | { readonly ok: true; readonly value: Brand<string, T> }
    | { readonly ok: false; readonly error: IdentityFailure } => {
    const parsed = parseId(value, label);
    if (!parsed.ok) return parsed;
    return { ok: true, value: parsed.value as Brand<string, T> };
  };

export const parseServerId = brandParser<'ServerId'>('ServerId');
export const parseServiceId = brandParser<'ServiceId'>('ServiceId');
export const parseEnvironmentId = brandParser<'EnvironmentId'>('EnvironmentId');
export const parseProviderId = brandParser<'ProviderId'>('ProviderId');
export const parseProviderServerId = brandParser<'ProviderServerId'>('ProviderServerId');
export const parseRegionId = brandParser<'RegionId'>('RegionId');
export const parseProductIdReference = brandParser<'ProductIdReference'>('ProductIdReference');
export const parseInfrastructureObservationId = brandParser<'InfrastructureObservationId'>(
  'InfrastructureObservationId',
);
export const parseInfrastructureOperationId = brandParser<'InfrastructureOperationId'>(
  'InfrastructureOperationId',
);
export const parseReleaseId = brandParser<'ReleaseId'>('ReleaseId');
export const parseHostConnectionReferenceId = brandParser<'HostConnectionReferenceId'>(
  'HostConnectionReferenceId',
);
export const parseSystemdUnitName = (
  value: unknown,
):
  | { readonly ok: true; readonly value: SystemdUnitName }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseBoundedToken(value, {
    max: 256,
    pattern: SYSTEMD_UNIT_PATTERN,
    label: 'SystemdUnitName',
  });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as SystemdUnitName };
};

const parseDisplayName = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: `${label} must be a string.` } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: `${label} must not be empty.` } };
  if (value.length > 128)
    return { ok: false, error: { code: 'TOO_LONG', reason: `${label} exceeds max.` } };
  if (hasControl(value))
    return {
      ok: false,
      error: { code: 'CONTROL_CHAR', reason: `${label} has control characters.` },
    };
  if (!DISPLAY_NAME_PATTERN.test(value))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} has invalid characters.` },
    };
  return { ok: true, value };
};

export const parseServerDisplayName = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ServerDisplayName }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseDisplayName(value, 'ServerDisplayName');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ServerDisplayName };
};

export const parseServiceDisplayName = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ServiceDisplayName }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseDisplayName(value, 'ServiceDisplayName');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as ServiceDisplayName };
};

export const parseEnvironmentDisplayName = (
  value: unknown,
):
  | { readonly ok: true; readonly value: EnvironmentDisplayName }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  const parsed = parseDisplayName(value, 'EnvironmentDisplayName');
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value as EnvironmentDisplayName };
};

export const parseServicePort = (
  value: unknown,
):
  | { readonly ok: true; readonly value: ServicePort }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535)
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: 'ServicePort must be an integer 1..65535.' },
    };
  return { ok: true, value: value as ServicePort };
};

export const parseHostname = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } =>
  parseBoundedToken(value, { max: 253, pattern: HOSTNAME_PATTERN, label: 'Hostname' });

export const parseReleaseIdentifier = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } =>
  parseBoundedToken(value, { max: 128, pattern: RELEASE_ID_PATTERN, label: 'ReleaseId' });
