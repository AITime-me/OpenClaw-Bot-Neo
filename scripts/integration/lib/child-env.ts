import { CHILD_ENV_ALLOWLIST, TRUSTED_LINUX_PATH } from './constants.ts';

const SECRET_PATTERNS = [
  /^TELEGRAM_/i,
  /^OPENAI_/i,
  /^API_KEY/i,
  /^CRM_/i,
  /^EMAIL_/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /^DOTENV/i,
  /^AWS_/i,
  /^GOOGLE_/i,
];

const FORBIDDEN_EVEN_IF_ALLOWLISTED = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]);

export const isSecretEnvKey = (key: string): boolean => {
  if (FORBIDDEN_EVEN_IF_ALLOWLISTED.has(key)) return true;
  if (key.startsWith('NPM_CONFIG_') || key.startsWith('npm_config_')) return true;
  return SECRET_PATTERNS.some((pattern) => pattern.test(key));
};

export type ChildEnvPaths = {
  readonly home: string;
  readonly tmpdir: string;
};

export const buildChildEnvironment = (
  _parentEnv: NodeJS.ProcessEnv,
  required: Readonly<Record<string, string>>,
  paths?: ChildEnvPaths,
): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: TRUSTED_LINUX_PATH,
  };
  if (paths !== undefined) {
    childEnv['HOME'] = paths.home;
    childEnv['TMPDIR'] = paths.tmpdir;
  }
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (key === 'PATH' || key === 'HOME' || key === 'TMPDIR') continue;
    if (FORBIDDEN_EVEN_IF_ALLOWLISTED.has(key) || isSecretEnvKey(key)) continue;
    const value = required[key];
    if (typeof value === 'string' && value.length > 0) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(required)) {
    if (!(CHILD_ENV_ALLOWLIST as readonly string[]).includes(key)) continue;
    if (FORBIDDEN_EVEN_IF_ALLOWLISTED.has(key) || isSecretEnvKey(key)) continue;
    if (typeof value === 'string') childEnv[key] = value;
  }
  // Hard guarantee: never inherit NODE_OPTIONS / preload / proxy.
  delete childEnv['NODE_OPTIONS'];
  delete childEnv['NODE_PATH'];
  delete childEnv['LD_PRELOAD'];
  return childEnv;
};

export const childEnvironmentContainsSecret = (
  childEnv: NodeJS.ProcessEnv,
  injectedSecrets: Readonly<Record<string, string>>,
): readonly string[] => {
  const leaks: string[] = [];
  for (const key of Object.keys(injectedSecrets)) {
    if (key in childEnv) leaks.push(key);
  }
  for (const key of Object.keys(childEnv)) {
    if (isSecretEnvKey(key)) leaks.push(key);
  }
  for (const forbidden of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NPM_CONFIG_CACHE',
  ]) {
    if (forbidden in childEnv) leaks.push(forbidden);
  }
  return [...new Set(leaks)];
};
