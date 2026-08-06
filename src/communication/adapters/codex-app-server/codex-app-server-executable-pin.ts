import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import { buildCodexAppServerChildEnv } from './codex-app-server-child-env.js';

export type CodexExecutablePin = {
  readonly absolutePath: string;
  readonly version: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly argv: readonly string[];
};

export type PinVerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type SpawnSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly shell: false;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: ['pipe', 'pipe', 'pipe'];
  };
};

const FORBIDDEN_ARGV_PATTERNS = [
  /\bws:\/\//i,
  /\bwss:\/\//i,
  /\bunix:\/\//i,
  /\bremote\b/i,
  /\bcode-mode\b/i,
  /--config\b/i,
  /--provider\b/i,
  /--model-provider\b/i,
  /--base-url\b/i,
  /--api-key\b/i,
] as const;

/** Fixed version-command argv against the same pinned absolute executable (`shell: false`). */
export const PINNED_VERSION_ARGV = Object.freeze(['--version'] as const);

export const assertPinnedAbsolutePath = (absolutePath: string): PinVerificationResult => {
  if (!isAbsolute(absolutePath))
    return { ok: false, reason: 'executable absolutePath must be absolute' };
  if (!absolutePath.includes('/') && !absolutePath.includes('\\'))
    return { ok: false, reason: 'basename / PATH resolution are forbidden' };
  if (absolutePath.includes('\0')) return { ok: false, reason: 'absolutePath contains NUL' };
  return { ok: true };
};

export const hashFileSha256 = (absolutePath: string): string => {
  const bytes = readFileSync(absolutePath);
  return createHash('sha256').update(bytes).digest('hex');
};

export const readExecutableSizeBytes = (absolutePath: string): number => {
  const st = statSync(absolutePath);
  return st.size;
};

/**
 * Read version from the pinned absolute executable with the fixed `--version` argv.
 * Does not trust caller-supplied expected version strings as evidence.
 */
export const readPinnedExecutableVersion = (absolutePath: string): string => {
  const pathCheck = assertPinnedAbsolutePath(absolutePath);
  if (!pathCheck.ok) throw new Error(pathCheck.reason);
  const result = spawnSync(absolutePath, [...PINNED_VERSION_ARGV], {
    encoding: 'utf8',
    shell: false,
    timeout: 5_000,
    env: {
      ...(process.platform === 'win32'
        ? {
            SystemRoot: process.env.SystemRoot,
            SYSTEMROOT: process.env.SYSTEMROOT,
            PATH: process.env.PATH,
          }
        : {}),
    },
  });
  if (result.error) throw new Error(`version-command-failed:${result.error.message}`);
  if (result.status !== 0) throw new Error(`version-command-exit:${String(result.status)}`);
  const out = typeof result.stdout === 'string' ? result.stdout : '';
  const errText = typeof result.stderr === 'string' ? result.stderr : '';
  const text = `${out}${errText}`.trim();
  if (text.length === 0) throw new Error('version-command-empty');
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length === 0) throw new Error('version-command-empty');
  return firstLine;
};

/** Exact stdio launch argv only: `app-server` or `app-server --listen stdio://`. */
export const argvIsExactStdioLaunch = (argv: readonly string[]): boolean => {
  if (argv.length === 1 && argv[0] === 'app-server') return true;
  if (
    argv.length === 3 &&
    argv[0] === 'app-server' &&
    argv[1] === '--listen' &&
    argv[2] === 'stdio://'
  )
    return true;
  return false;
};

export const argvAllowed = (argv: readonly string[]): PinVerificationResult => {
  if (!argvIsExactStdioLaunch(argv))
    return { ok: false, reason: 'argv must be exact app-server stdio launch' };
  const joined = argv.join(' ');
  for (const pattern of FORBIDDEN_ARGV_PATTERNS) {
    if (pattern.test(joined))
      return { ok: false, reason: `forbidden argv flag/pattern: ${pattern.source}` };
  }
  if (/[;&|`$]/.test(joined)) return { ok: false, reason: 'argv contains shell metacharacters' };
  return { ok: true };
};

export type VersionReader = (absolutePath: string) => string;

export const verifyPinImmediatelyBeforeSpawn = (
  pin: CodexExecutablePin,
  options: {
    readonly readVersion: VersionReader;
  },
): PinVerificationResult => {
  const pathCheck = assertPinnedAbsolutePath(pin.absolutePath);
  if (!pathCheck.ok) return pathCheck;
  const argvCheck = argvAllowed(pin.argv);
  if (!argvCheck.ok) return argvCheck;
  if (typeof pin.version !== 'string' || pin.version.length === 0)
    return { ok: false, reason: 'pin version is required' };
  if (!Number.isInteger(pin.sizeBytes) || pin.sizeBytes < 0)
    return { ok: false, reason: 'pin sizeBytes is required' };
  try {
    const st = statSync(pin.absolutePath);
    if (!st.isFile()) return { ok: false, reason: 'pinned path is not a file' };
    if (st.size !== pin.sizeBytes)
      return { ok: false, reason: 'executable size mismatch immediately before spawn' };
  } catch {
    return { ok: false, reason: 'pinned executable file identity check failed' };
  }
  const actualHash = hashFileSha256(pin.absolutePath);
  if (actualHash.toLowerCase() !== pin.sha256.toLowerCase())
    return { ok: false, reason: 'executable sha256 mismatch immediately before spawn' };
  let actualVersion: string;
  try {
    actualVersion = options.readVersion(pin.absolutePath);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'version-command-failed',
    };
  }
  if (actualVersion !== pin.version)
    return { ok: false, reason: 'executable version mismatch immediately before spawn' };
  return { ok: true };
};

export const createSpawnSpec = (
  pin: CodexExecutablePin,
  envInput: CodexAppServerChildEnvInput,
  options: {
    readonly readVersion: VersionReader;
    readonly cwd: string;
  },
):
  | { readonly ok: true; readonly spec: SpawnSpec }
  | { readonly ok: false; readonly reason: string } => {
  const pinCheck = verifyPinImmediatelyBeforeSpawn(pin, { readVersion: options.readVersion });
  if (!pinCheck.ok) return pinCheck;
  if (!isAbsolute(options.cwd)) return { ok: false, reason: 'spawn cwd must be absolute' };
  const envBuild = buildCodexAppServerChildEnv(envInput);
  if (!envBuild.ok) return envBuild;
  return {
    ok: true,
    spec: {
      command: pin.absolutePath,
      args: [...pin.argv],
      options: {
        shell: false,
        cwd: options.cwd,
        env: envBuild.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    },
  };
};
