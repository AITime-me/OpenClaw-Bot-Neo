import type { IdentityFailure } from '../identity.js';

export const MAX_DISPLAY_NAME_LENGTH = 128;
export const MAX_PURPOSE_LENGTH = 256;
export const MAX_DIRECTORY_PATH_LENGTH = 512;
export const MAX_LOG_LINES = 500;
export const MAX_LOG_BYTES = 65_536;
export const MAX_LOG_LINE_LENGTH = 4_096;
export const MAX_OBSERVATION_METADATA_LENGTH = 256;
export const MAX_ERROR_REASON_LENGTH = 256;
export const MAX_ADDRESS_ENTRIES = 8;
export const MAX_SERVICE_DEPENDENCIES = 32;
export const MAX_SERVICE_PORTS = 16;
export const MAX_MANAGEMENT_CAPABILITIES = 16;

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\bpassword\s*[:=]\s*\S+/i,
  /\btoken\s*[:=]\s*\S+/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S+/i,
];

const COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\bsh\s+-c\b/i,
  /\bbash\s+-c\b/i,
  /\brm\s+-rf\b/i,
  /\bcurl\s+/i,
  /\bwget\s+/i,
];

export const containsSecretShapedData = (value: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(value));

export const containsCommandShapedData = (value: string): boolean =>
  COMMAND_PATTERNS.some((pattern) => pattern.test(value));

export const rejectSecretOrCommand = (
  value: string,
  label: string,
): { readonly ok: true } | { readonly ok: false; readonly error: IdentityFailure } => {
  if (containsSecretShapedData(value))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} must not contain secret-shaped data.` },
    };
  if (containsCommandShapedData(value))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} must not contain command-shaped data.` },
    };
  return { ok: true };
};

export const parseBoundedText = (
  value: unknown,
  options: { readonly max: number; readonly label: string; readonly allowEmpty?: boolean },
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${options.label} must be a string.` },
    };
  if (!options.allowEmpty && value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: `${options.label} must not be empty.` } };
  if (value.includes('\0'))
    return { ok: false, error: { code: 'CONTROL_CHAR', reason: `${options.label} contains NUL.` } };
  if (value.length > options.max)
    return {
      ok: false,
      error: { code: 'TOO_LONG', reason: `${options.label} exceeds the maximum length.` },
    };
  const secretCheck = rejectSecretOrCommand(value, options.label);
  if (!secretCheck.ok) return secretCheck;
  return { ok: true, value };
};

export const parsePercentage = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${label} must be a finite number 0..100.` },
    };
  return { ok: true, value };
};

export const parseNonNegativeInteger = (
  value: unknown,
  label: string,
  max: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max)
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${label} must be a safe non-negative integer.` },
    };
  return { ok: true, value };
};

export const parseLatencyMs = (
  value: unknown,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 300_000)
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: 'Latency must be a finite number 0..300000 ms.' },
    };
  return { ok: true, value };
};

export const replaceUnsafeControlCharacters = (
  value: string,
): { readonly text: string; readonly count: number } => {
  let count = 0;
  let text = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      text += '?';
      count += 1;
    } else {
      text += value.charAt(index);
    }
  }
  return { text, count };
};

const REDACTION_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  {
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    replacement: '[REDACTED-PRIVATE-KEY]',
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, replacement: '[REDACTED-BEARER]' },
  { pattern: /\bpassword\s*[:=]\s*\S+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /\btoken\s*[:=]\s*\S+/gi, replacement: 'token=[REDACTED]' },
  { pattern: /\bapi[_-]?key\s*[:=]\s*\S+/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /\bsecret\s*[:=]\s*\S+/gi, replacement: 'secret=[REDACTED]' },
];

export const redactLogText = (
  value: string,
): { readonly text: string; readonly redactionCount: number } => {
  let text = value;
  let redactionCount = 0;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) redactionCount += 1;
  }
  return { text, redactionCount };
};
