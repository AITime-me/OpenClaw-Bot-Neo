/** Strict child env allowlist for Codex app-server probe (Build 3.7E1). */

export const CHILD_ENV_DENYLIST = Object.freeze([
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'CHATGPT_ACCESS_TOKEN',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_AUTH_JSON',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'SSLKEYLOGFILE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'PATH',
] as const);

export type CodexAppServerChildEnvInput = {
  readonly codexHome: string;
  readonly home: string;
  readonly tempDir: string;
  readonly lang?: string;
  readonly lcAll?: string;
  readonly tz?: string;
  readonly noColor?: string;
  readonly term?: string;
};

export type ChildEnvBuildResult =
  | { readonly ok: true; readonly env: NodeJS.ProcessEnv }
  | { readonly ok: false; readonly reason: string };

const isAbsolutePath = (value: string): boolean => {
  if (value.length === 0) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
};

export const buildCodexAppServerChildEnv = (
  input: CodexAppServerChildEnvInput,
): ChildEnvBuildResult => {
  if (!isAbsolutePath(input.codexHome))
    return { ok: false, reason: 'CODEX_HOME must be an absolute path' };
  if (!isAbsolutePath(input.home)) return { ok: false, reason: 'HOME must be an absolute path' };
  if (!isAbsolutePath(input.tempDir))
    return { ok: false, reason: 'tempDir must be an absolute path' };

  const env: NodeJS.ProcessEnv = {
    CODEX_HOME: input.codexHome,
    HOME: input.home,
    USERPROFILE: input.home,
    TMPDIR: input.tempDir,
    TEMP: input.tempDir,
    TMP: input.tempDir,
  };
  if (input.lang !== undefined) {
    if (input.lang.length === 0) return { ok: false, reason: 'LANG must be non-empty' };
    env.LANG = input.lang;
  }
  if (input.lcAll !== undefined) {
    if (input.lcAll.length === 0) return { ok: false, reason: 'LC_ALL must be non-empty' };
    env.LC_ALL = input.lcAll;
  }
  if (input.tz !== undefined) {
    if (input.tz.length === 0) return { ok: false, reason: 'TZ must be non-empty' };
    env.TZ = input.tz;
  }
  if (input.noColor !== undefined) {
    if (input.noColor !== '1') return { ok: false, reason: 'NO_COLOR must be "1" when set' };
    env.NO_COLOR = '1';
  }
  if (input.term !== undefined) {
    if (input.term !== 'dumb') return { ok: false, reason: 'TERM must be "dumb" when set' };
    env.TERM = 'dumb';
  }

  for (const key of CHILD_ENV_DENYLIST) {
    if (Object.prototype.hasOwnProperty.call(env, key))
      return { ok: false, reason: `denylist key present in child env: ${key}` };
  }
  if (env.PATH !== undefined) return { ok: false, reason: 'PATH must not be passed to child' };

  return { ok: true, env };
};
