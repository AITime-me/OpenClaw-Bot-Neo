import type { IdentityFailure } from '../identity.js';

export const MAX_DISPLAY_NAME_LENGTH = 128;
export const MAX_PURPOSE_LENGTH = 256;
export const MAX_DIRECTORY_PATH_LENGTH = 512;
export const MAX_LOG_LINES = 500;
export const MAX_LOG_BYTES = 65_536;
export const MAX_LOG_LINE_LENGTH = 4_096;
export const MAX_SANITIZE_INPUT_BYTES = 262_144;
export const MAX_OBSERVATION_METADATA_LENGTH = 256;
export const MAX_ERROR_REASON_LENGTH = 256;
export const MAX_ADDRESS_ENTRIES = 8;
export const MAX_SERVICE_DEPENDENCIES = 32;
export const MAX_SERVICE_PORTS = 16;
export const MAX_MANAGEMENT_CAPABILITIES = 16;
export const MAX_POSITIVE_CAPACITY = Number.MAX_SAFE_INTEGER;

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

const SECRET_LINE_PATTERNS = [
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

const PRIVATE_KEY_BEGIN = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gi;
const PRIVATE_KEY_END = /-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gi;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ANSI_OSC = new RegExp(`${ESC}\\][^${ESC}${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const ANSI_INCOMPLETE = new RegExp(`${ESC}(?:\\[[^\n]*)?$`);

export const containsSecretShapedData = (value: string): boolean =>
  PRIVATE_KEY_BEGIN.test(value) || SECRET_LINE_PATTERNS.some((pattern) => pattern.test(value));

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

const hasUnsafePathControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const rejectPathTraversalSegments = (
  segments: readonly string[],
  label: string,
): { readonly ok: true } | { readonly ok: false; readonly error: IdentityFailure } => {
  for (const segment of segments) {
    if (segment.length === 0)
      return {
        ok: false,
        error: { code: 'INVALID_CHARSET', reason: `${label} has an empty path segment.` },
      };
    if (segment === '.' || segment === '..')
      return {
        ok: false,
        error: { code: 'INVALID_CHARSET', reason: `${label} must not contain traversal segments.` },
      };
  }
  return { ok: true };
};

export const parseAbsolutePosixDeploymentRoot = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'DeploymentRoot must be a string.' } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: 'DeploymentRoot must not be empty.' } };
  if (!value.startsWith('/'))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: 'DeploymentRoot must be an absolute POSIX path.' },
    };
  if (value.includes('\\'))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: 'DeploymentRoot must not contain backslashes.' },
    };
  if (value.includes('\0') || hasUnsafePathControl(value))
    return {
      ok: false,
      error: { code: 'CONTROL_CHAR', reason: 'DeploymentRoot contains unsafe control characters.' },
    };
  if (Buffer.byteLength(value, 'utf8') > MAX_DIRECTORY_PATH_LENGTH)
    return {
      ok: false,
      error: { code: 'TOO_LONG', reason: 'DeploymentRoot exceeds the maximum length.' },
    };
  const traversal = rejectPathTraversalSegments(value.split('/').slice(1), 'DeploymentRoot');
  if (!traversal.ok) return traversal;
  const secretCheck = rejectSecretOrCommand(value, 'DeploymentRoot');
  if (!secretCheck.ok) return secretCheck;
  return { ok: true, value };
};

export const parseRelativePosixPath = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: `${label} must be a string.` } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: `${label} must not be empty.` } };
  if (value.startsWith('/'))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} must be a relative POSIX path.` },
    };
  if (value.includes('\\'))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} must not contain backslashes.` },
    };
  if (value.includes('\0') || hasUnsafePathControl(value))
    return {
      ok: false,
      error: { code: 'CONTROL_CHAR', reason: `${label} contains unsafe control characters.` },
    };
  if (Buffer.byteLength(value, 'utf8') > MAX_DIRECTORY_PATH_LENGTH)
    return {
      ok: false,
      error: { code: 'TOO_LONG', reason: `${label} exceeds the maximum length.` },
    };
  const traversal = rejectPathTraversalSegments(value.split('/'), label);
  if (!traversal.ok) return traversal;
  const secretCheck = rejectSecretOrCommand(value, label);
  if (!secretCheck.ok) return secretCheck;
  return { ok: true, value };
};

export const parseOptionalRelativePosixPath = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (value === null) return { ok: true, value: null };
  const parsed = parseRelativePosixPath(value, label);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
};

export const parseHealthEndpointPath = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: `${label} must be a string.` } };
  if (value.length === 0)
    return { ok: false, error: { code: 'EMPTY', reason: `${label} must not be empty.` } };
  if (value.includes('\\'))
    return {
      ok: false,
      error: { code: 'INVALID_CHARSET', reason: `${label} must not contain backslashes.` },
    };
  if (value.includes('\0') || hasUnsafePathControl(value))
    return {
      ok: false,
      error: { code: 'CONTROL_CHAR', reason: `${label} contains unsafe control characters.` },
    };
  if (Buffer.byteLength(value, 'utf8') > MAX_DIRECTORY_PATH_LENGTH)
    return {
      ok: false,
      error: { code: 'TOO_LONG', reason: `${label} exceeds the maximum length.` },
    };
  const segments = value.startsWith('/') ? value.split('/').slice(1) : value.split('/');
  const traversal = rejectPathTraversalSegments(segments, label);
  if (!traversal.ok) return traversal;
  const secretCheck = rejectSecretOrCommand(value, label);
  if (!secretCheck.ok) return secretCheck;
  return { ok: true, value };
};

export const parseOptionalHealthEndpointPath = (
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (value === null) return { ok: true, value: null };
  const parsed = parseHealthEndpointPath(value, label);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
};

export const parseIpv4Address = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'IPv4 address must be a string.' } };
  if (!IPV4_PATTERN.test(value))
    return { ok: false, error: { code: 'INVALID_CHARSET', reason: 'IPv4 address is malformed.' } };
  const secretCheck = rejectSecretOrCommand(value, 'IPv4 address');
  if (!secretCheck.ok) return secretCheck;
  return { ok: true, value };
};

export const parseIpv6Address = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'string')
    return { ok: false, error: { code: 'MALFORMED', reason: 'IPv6 address must be a string.' } };
  if (value.length > 45 || !IPV6_PATTERN.test(value))
    return { ok: false, error: { code: 'INVALID_CHARSET', reason: 'IPv6 address is malformed.' } };
  const secretCheck = rejectSecretOrCommand(value, 'IPv6 address');
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

export const parseNonNegativeFiniteNumber = (
  value: unknown,
  label: string,
  max: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${label} must be a finite non-negative number.` },
    };
  return { ok: true, value };
};

export const parsePositiveSafeInteger = (
  value: unknown,
  label: string,
  max: number = MAX_POSITIVE_CAPACITY,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: IdentityFailure } => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  )
    return {
      ok: false,
      error: { code: 'MALFORMED', reason: `${label} must be a positive safe integer.` },
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

export const stripAnsiAndUnsafeControlCharacters = (
  value: string,
): { readonly text: string; readonly controlCount: number } => {
  const text = value.replace(ANSI_CSI, '').replace(ANSI_OSC, '').replace(ANSI_INCOMPLETE, '');
  let controlCount = 0;
  let sanitized = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x09 || code === 0x0a) {
      sanitized += text.charAt(index);
      continue;
    }
    if (code <= 0x1f || code === 0x7f) {
      sanitized += '?';
      controlCount += 1;
    } else {
      sanitized += text.charAt(index);
    }
  }
  return { text: sanitized, controlCount };
};

export const redactSecretsInBuffer = (
  value: string,
): { readonly text: string; readonly redactionCount: number; readonly controlCount: number } => {
  let text = value;
  let redactionCount = 0;

  const replacePattern = (pattern: RegExp, replacement: string): void => {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) redactionCount += 1;
  };

  replacePattern(PRIVATE_KEY_BLOCK, '[REDACTED-PRIVATE-KEY]');

  let beginMatch: RegExpExecArray | null;
  const beginPattern = new RegExp(PRIVATE_KEY_BEGIN.source, PRIVATE_KEY_BEGIN.flags);
  while ((beginMatch = beginPattern.exec(text)) !== null) {
    const start = beginMatch.index;
    const afterBegin = text.slice(start);
    const endPattern = new RegExp(PRIVATE_KEY_END.source, PRIVATE_KEY_END.flags);
    const endMatch = endPattern.exec(afterBegin);
    if (endMatch === null) {
      text = `${text.slice(0, start)}[REDACTED-PRIVATE-KEY]`;
      redactionCount += 1;
      break;
    }
    const endIndex = start + endMatch.index + endMatch[0].length;
    text = `${text.slice(0, start)}[REDACTED-PRIVATE-KEY]${text.slice(endIndex)}`;
    redactionCount += 1;
    beginPattern.lastIndex = start + '[REDACTED-PRIVATE-KEY]'.length;
  }

  for (const pattern of SECRET_LINE_PATTERNS) {
    const before = text;
    text = text.replace(pattern, (match) => {
      const label = match.split(/[:=]/)[0] ?? 'secret';
      return `${label}=[REDACTED]`;
    });
    if (text !== before) redactionCount += 1;
  }

  return { text, redactionCount, controlCount: 0 };
};

/** @deprecated Use sanitizeBoundedLogPayload for multi-line log handling. */
export const replaceUnsafeControlCharacters = (
  value: string,
): { readonly text: string; readonly count: number } => {
  const stripped = stripAnsiAndUnsafeControlCharacters(value);
  return { text: stripped.text, count: stripped.controlCount };
};

/** @deprecated Use redactSecretsInBuffer for multi-line log handling. */
export const redactLogText = (
  value: string,
): { readonly text: string; readonly redactionCount: number } => {
  const redacted = redactSecretsInBuffer(value);
  return { text: redacted.text, redactionCount: redacted.redactionCount };
};
