import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  NEO_COMPILED_PROCESS_ENTRY,
  NEO_COMPILED_STATUS_ENTRY,
  NEO_GATE_EXPECTED_HEAD_ENV,
  NEO_GATE_EXPECTED_LOCK_SHA256_ENV,
  NEO_GATE_OPT_IN_ENV,
  NEO_START_NEO_LAUNCHER,
  NEO_STATUS_LAUNCHER,
  REQUIRED_NPM_VERSION,
  REQUIRED_NODE_VERSION,
} from './neo-runtime-gate-constants.ts';
import { hashPackageLock } from './fingerprint.ts';

export type NeoRuntimeEnvironmentClassification =
  | 'GATE_OPT_IN_MISSING'
  | 'GATE_EXPECTATION_MISSING'
  | 'GIT_HEAD_MISMATCH'
  | 'PACKAGE_LOCK_MISMATCH'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_NODE'
  | 'UNSUPPORTED_NPM'
  | 'WORKING_TREE_DIRTY'
  | 'STAGING_NOT_EMPTY'
  | 'UNTRACKED_FILES'
  | 'MISSING_COMPILED_ENTRY'
  | 'MISSING_LAUNCHER'
  | 'INHERITED_CREDENTIAL_ENV'
  | 'PASS';

export type NeoRuntimeEnvironmentGateResult = {
  readonly classification: NeoRuntimeEnvironmentClassification;
  readonly gitHead: string;
  readonly packageLockSha256: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
};

const readGitHead = (repositoryRoot: string): string => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  return result.stdout.trim();
};

const readGitStatus = (
  repositoryRoot: string,
): { readonly dirty: boolean; readonly staged: boolean; readonly untracked: readonly string[] } => {
  const status = spawnSync('git', ['status', '--short'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (status.status !== 0) return { dirty: true, staged: true, untracked: ['git-status-failed'] };
  const lines = status.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const dirty = lines.some((line) => line.length > 2 && !line.startsWith('??'));
  const staged = lines.some((line) => {
    const index = line[0];
    return index !== undefined && index !== ' ' && index !== '?';
  });
  const untracked = lines.filter((line) => line.startsWith('??')).map((line) => line.slice(3));
  return { dirty, staged, untracked };
};

const readNpmVersion = (): string => {
  const result = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return '';
  return result.stdout.trim();
};

const CREDENTIAL_ENV_PREFIXES = [
  'AWS_',
  'AZURE_',
  'GCP_',
  'OPENAI_',
  'ANTHROPIC_',
  'TELEGRAM_',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'DATABASE_URL',
  'SECRET_',
  'PASSWORD',
  'API_KEY',
] as const;

export const detectInheritedCredentialEnv = (env: NodeJS.ProcessEnv): boolean => {
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    for (const prefix of CREDENTIAL_ENV_PREFIXES) {
      if (upper === prefix || upper.startsWith(prefix)) return true;
    }
  }
  return false;
};

export const runNeoRuntimeEnvironmentGate = (
  env: NodeJS.ProcessEnv = process.env,
  repositoryRoot: string = process.cwd(),
): NeoRuntimeEnvironmentGateResult => {
  const gitHead = readGitHead(repositoryRoot);
  const packageLockSha256 = hashPackageLock(join(repositoryRoot, 'package-lock.json'));
  const nodeVersion = process.version.replace(/^v/, '');
  const npmVersion = readNpmVersion();

  const base: NeoRuntimeEnvironmentGateResult = {
    classification: 'PASS',
    gitHead,
    packageLockSha256,
    nodeVersion,
    npmVersion,
  };

  if (env[NEO_GATE_OPT_IN_ENV] !== '1') return { ...base, classification: 'GATE_OPT_IN_MISSING' };
  const expectedHead = env[NEO_GATE_EXPECTED_HEAD_ENV];
  const expectedLock = env[NEO_GATE_EXPECTED_LOCK_SHA256_ENV];
  if (typeof expectedHead !== 'string' || expectedHead.length === 0) {
    return { ...base, classification: 'GATE_EXPECTATION_MISSING' };
  }
  if (typeof expectedLock !== 'string' || expectedLock.length === 0) {
    return { ...base, classification: 'GATE_EXPECTATION_MISSING' };
  }
  if (expectedHead !== gitHead) return { ...base, classification: 'GIT_HEAD_MISMATCH' };
  if (expectedLock !== packageLockSha256) {
    return { ...base, classification: 'PACKAGE_LOCK_MISMATCH' };
  }
  if (process.platform !== 'linux') return { ...base, classification: 'UNSUPPORTED_PLATFORM' };
  if (nodeVersion !== REQUIRED_NODE_VERSION) return { ...base, classification: 'UNSUPPORTED_NODE' };
  if (npmVersion !== REQUIRED_NPM_VERSION) return { ...base, classification: 'UNSUPPORTED_NPM' };
  if (detectInheritedCredentialEnv(env)) {
    return { ...base, classification: 'INHERITED_CREDENTIAL_ENV' };
  }

  const gitStatus = readGitStatus(repositoryRoot);
  if (gitStatus.dirty) return { ...base, classification: 'WORKING_TREE_DIRTY' };
  if (gitStatus.staged) return { ...base, classification: 'STAGING_NOT_EMPTY' };
  if (gitStatus.untracked.length > 0) return { ...base, classification: 'UNTRACKED_FILES' };

  if (
    !existsSync(join(repositoryRoot, NEO_COMPILED_PROCESS_ENTRY)) ||
    !existsSync(join(repositoryRoot, NEO_COMPILED_STATUS_ENTRY))
  ) {
    return { ...base, classification: 'MISSING_COMPILED_ENTRY' };
  }
  if (
    !existsSync(join(repositoryRoot, NEO_START_NEO_LAUNCHER)) ||
    !existsSync(join(repositoryRoot, NEO_STATUS_LAUNCHER))
  ) {
    return { ...base, classification: 'MISSING_LAUNCHER' };
  }

  return base;
};

export const classificationToStderr = (
  classification: NeoRuntimeEnvironmentClassification,
): string => classification;
