export const NEO_STATUS_CLI_MAX_ARG_LENGTH = 4096 as const;
export const NEO_STATUS_CLI_MAX_PATH_LENGTH = 1024 as const;
export const NEO_STATUS_DEFAULT_TIMEOUT_MS = 30_000 as const;
export const NEO_STATUS_MAX_TIMEOUT_MS = 120_000 as const;
export const NEO_STATUS_DEFAULT_POLL_INTERVAL_MS = 100 as const;
export const NEO_STATUS_MAX_POLL_INTERVAL_MS = 1_000 as const;

export type ParsedNeoStatusCliArguments =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'read';
      readonly executionRoot: string;
      readonly waitReady: boolean;
      readonly timeoutMs: number;
      readonly pollIntervalMs: number;
    };

const ALLOWED_KEYS = new Set<string>([
  '--execution-root',
  '--wait-ready',
  '--timeout-ms',
  '--help',
]);

const isAbsolutePath = (value: string): boolean => {
  if (value.length === 0 || value.length > NEO_STATUS_CLI_MAX_PATH_LENGTH) return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/')) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
};

const parsePositiveInt = (
  value: string,
  max: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: string } => {
  if (!/^\d+$/.test(value)) return { ok: false, reason: 'Timeout must be a positive integer.' };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    return { ok: false, reason: 'Timeout is out of allowed bounds.' };
  }
  return { ok: true, value: parsed };
};

export const parseNeoStatusCliArguments = (
  argv: readonly string[],
):
  | { readonly ok: true; readonly value: ParsedNeoStatusCliArguments }
  | { readonly ok: false; readonly reason: string } => {
  if (argv.length === 0) {
    return { ok: false, reason: 'Neo status CLI requires explicit arguments.' };
  }

  const positional: string[] = [];
  const seen = new Map<string, string>();
  let waitReady = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token.length === 0) {
      return { ok: false, reason: 'Empty CLI token is not allowed.' };
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (!ALLOWED_KEYS.has(token)) {
      return { ok: false, reason: `Unknown CLI argument: ${token}.` };
    }
    if (seen.has(token)) {
      return { ok: false, reason: `Duplicate CLI argument: ${token}.` };
    }
    if (token === '--help') {
      if (argv.length !== 1) return { ok: false, reason: '--help must be used alone.' };
      return { ok: true, value: { kind: 'help' } };
    }
    if (token === '--wait-ready') {
      seen.set(token, 'true');
      waitReady = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, reason: `Missing value for ${token}.` };
    }
    if (value.length > NEO_STATUS_CLI_MAX_ARG_LENGTH) {
      return { ok: false, reason: `Argument value for ${token} is too long.` };
    }
    seen.set(token, value);
    index += 1;
  }

  if (positional.length > 0) {
    return { ok: false, reason: 'Positional CLI arguments are not allowed.' };
  }

  const executionRoot = seen.get('--execution-root');
  if (executionRoot === undefined) {
    return { ok: false, reason: 'Missing required CLI argument: --execution-root.' };
  }
  if (!isAbsolutePath(executionRoot)) {
    return { ok: false, reason: '--execution-root requires an absolute path.' };
  }

  let timeoutMs: number = NEO_STATUS_DEFAULT_TIMEOUT_MS;
  const timeoutRaw = seen.get('--timeout-ms');
  if (timeoutRaw !== undefined) {
    const parsed = parsePositiveInt(timeoutRaw, NEO_STATUS_MAX_TIMEOUT_MS);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    timeoutMs = parsed.value;
  }

  return {
    ok: true,
    value: {
      kind: 'read',
      executionRoot,
      waitReady,
      timeoutMs,
      pollIntervalMs: NEO_STATUS_DEFAULT_POLL_INTERVAL_MS,
    },
  };
};
