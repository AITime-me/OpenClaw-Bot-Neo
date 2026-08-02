export const NEO_CLI_MAX_ARG_LENGTH = 4096 as const;
export const NEO_CLI_MAX_PATH_LENGTH = 1024 as const;

export type NeoCliArgumentKey =
  '--config' | '--storage-binding' | '--storage-policy' | '--execution-root';

export type ParsedNeoCliArguments =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'run';
      readonly configPath: string;
      readonly storageBindingPath: string;
      readonly storagePolicyPath: string;
      readonly executionRoot: string;
    };

export type NeoCliParseFailure = {
  readonly reason: string;
};

const ALLOWED_KEYS = new Set<string>([
  '--config',
  '--storage-binding',
  '--storage-policy',
  '--execution-root',
  '--help',
]);

const isAbsolutePath = (value: string): boolean => {
  if (value.length === 0 || value.length > NEO_CLI_MAX_PATH_LENGTH) return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/')) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
};

const readValue = (
  argv: readonly string[],
  index: number,
  flag: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string } => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return { ok: false, reason: `Missing value for ${flag}.` };
  }
  if (value.length > NEO_CLI_MAX_ARG_LENGTH) {
    return { ok: false, reason: `Argument value for ${flag} is too long.` };
  }
  return { ok: true, value };
};

export const parseNeoCliArguments = (
  argv: readonly string[],
):
  | { readonly ok: true; readonly value: ParsedNeoCliArguments }
  | { readonly ok: false; readonly error: NeoCliParseFailure } => {
  if (argv.length === 0) {
    return { ok: false, error: { reason: 'Neo CLI requires explicit arguments.' } };
  }

  const positional: string[] = [];
  const seen = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token.length === 0) {
      return { ok: false, error: { reason: 'Empty CLI token is not allowed.' } };
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (!ALLOWED_KEYS.has(token)) {
      return { ok: false, error: { reason: `Unknown CLI argument: ${token}.` } };
    }
    if (seen.has(token)) {
      return { ok: false, error: { reason: `Duplicate CLI argument: ${token}.` } };
    }
    if (token === '--help') {
      if (argv.length !== 1) {
        return { ok: false, error: { reason: '--help must be used alone.' } };
      }
      return { ok: true, value: { kind: 'help' } };
    }
    const valueResult = readValue(argv, index, token);
    if (!valueResult.ok) return { ok: false, error: { reason: valueResult.reason } };
    if (!isAbsolutePath(valueResult.value)) {
      return { ok: false, error: { reason: `${token} requires an absolute path.` } };
    }
    seen.set(token, valueResult.value);
    index += 1;
  }

  if (positional.length > 0) {
    return { ok: false, error: { reason: 'Positional CLI arguments are not allowed.' } };
  }

  const required: NeoCliArgumentKey[] = [
    '--config',
    '--storage-binding',
    '--storage-policy',
    '--execution-root',
  ];
  for (const key of required) {
    if (!seen.has(key)) {
      return { ok: false, error: { reason: `Missing required CLI argument: ${key}.` } };
    }
  }

  return {
    ok: true,
    value: {
      kind: 'run',
      configPath: seen.get('--config') as string,
      storageBindingPath: seen.get('--storage-binding') as string,
      storagePolicyPath: seen.get('--storage-policy') as string,
      executionRoot: seen.get('--execution-root') as string,
    },
  };
};
