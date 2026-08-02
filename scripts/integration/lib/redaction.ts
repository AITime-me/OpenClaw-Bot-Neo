const ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'`])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\/;
const HOME_PATH_PATTERN = /\/home\/[^/\s"'`]+/;
const USERNAME_PATTERN = /\/Users\/[^/\s"'`]+/;
const FD_PATTERN = /\bfd\b\s*[:=]\s*\d+/i;
const ERRNO_PATTERN = /\berrno\b\s*[:=]\s*-?\d+/i;
const STACK_PATTERN = /\bat\s+[\w./<>]+\s*\(/;
const RAW_CAUSE_PATTERN = /\bcause\b\s*[:=]/i;
const SQLITE_FILENAME_PATTERN = /neo-memory\.sqlite/i;

export type RedactionViolation =
  | 'ABSOLUTE_PATH'
  | 'HOME_PATH'
  | 'USERNAME_PATH'
  | 'FD_LEAK'
  | 'ERRNO_LEAK'
  | 'STACK_LEAK'
  | 'RAW_CAUSE_LEAK'
  | 'SQLITE_FILENAME'
  | 'SECRET_VALUE';

export const detectRedactionViolations = (
  serialized: string,
  secretValues: readonly string[] = [],
): readonly RedactionViolation[] => {
  const violations = new Set<RedactionViolation>();
  if (ABSOLUTE_PATH_PATTERN.test(serialized)) violations.add('ABSOLUTE_PATH');
  if (WINDOWS_PATH_PATTERN.test(serialized)) violations.add('ABSOLUTE_PATH');
  if (HOME_PATH_PATTERN.test(serialized)) violations.add('HOME_PATH');
  if (USERNAME_PATTERN.test(serialized)) violations.add('USERNAME_PATH');
  if (FD_PATTERN.test(serialized)) violations.add('FD_LEAK');
  if (ERRNO_PATTERN.test(serialized)) violations.add('ERRNO_LEAK');
  if (STACK_PATTERN.test(serialized)) violations.add('STACK_LEAK');
  if (RAW_CAUSE_PATTERN.test(serialized)) violations.add('RAW_CAUSE_LEAK');
  if (SQLITE_FILENAME_PATTERN.test(serialized)) violations.add('SQLITE_FILENAME');
  for (const secret of secretValues) {
    if (secret.length > 0 && serialized.includes(secret)) violations.add('SECRET_VALUE');
  }
  return [...violations];
};

/** Bounded redaction for Neo gate text and child observability summaries. */
export const redactNeoGateText = (text: string): string =>
  text
    .replace(/\/(?:var|run|etc|home|opt)[^\s'"]+/g, '<path>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>')
    .replace(/\b(token|secret|password|apikey|api_key)\b/gi, '<redacted>');

export const safeSerializeForEvidence = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '"<unserializable>"';
  }
};

/** Allowlisted public failure fields only. */
export const serializePublicFailure = (input: {
  readonly code: string;
  readonly event?: string;
}): string =>
  safeSerializeForEvidence({
    code: input.code,
    ...(input.event !== undefined ? { event: input.event } : {}),
  });
