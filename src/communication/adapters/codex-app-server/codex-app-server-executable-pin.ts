import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import { buildCodexAppServerChildEnv } from './codex-app-server-child-env.js';

export type CodexExecutablePin = {
  readonly absolutePath: string;
  readonly version: string;
  readonly sha256: string;
  readonly argv: readonly string[];
};

export type PinVerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type SpawnSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly shell: false;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: ['pipe', 'pipe', 'pipe'];
  };
};

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

const argvAllowed = (argv: readonly string[]): boolean => {
  if (argv.length === 0) return false;
  if (argv[0] !== 'app-server') return false;
  const joined = argv.join(' ');
  if (/\bws:\/\//i.test(joined) || /\bunix:\/\//i.test(joined)) return false;
  if (/[;&|`$]/.test(joined)) return false;
  return true;
};

export const verifyPinImmediatelyBeforeSpawn = (
  pin: CodexExecutablePin,
  options?: {
    readonly readVersion?: (absolutePath: string) => string;
  },
): PinVerificationResult => {
  const pathCheck = assertPinnedAbsolutePath(pin.absolutePath);
  if (!pathCheck.ok) return pathCheck;
  if (!argvAllowed(pin.argv))
    return { ok: false, reason: 'argv must start with app-server and use allowlisted flags only' };
  try {
    const st = statSync(pin.absolutePath);
    if (!st.isFile()) return { ok: false, reason: 'pinned path is not a file' };
  } catch {
    return { ok: false, reason: 'pinned executable file identity check failed' };
  }
  const actualHash = hashFileSha256(pin.absolutePath);
  if (actualHash.toLowerCase() !== pin.sha256.toLowerCase())
    return { ok: false, reason: 'executable sha256 mismatch immediately before spawn' };
  if (options?.readVersion) {
    const actualVersion = options.readVersion(pin.absolutePath);
    if (actualVersion !== pin.version)
      return { ok: false, reason: 'executable version mismatch immediately before spawn' };
  }
  return { ok: true };
};

export const createSpawnSpec = (
  pin: CodexExecutablePin,
  envInput: CodexAppServerChildEnvInput,
):
  | { readonly ok: true; readonly spec: SpawnSpec }
  | { readonly ok: false; readonly reason: string } => {
  const pinCheck = verifyPinImmediatelyBeforeSpawn(pin);
  if (!pinCheck.ok) return pinCheck;
  const envBuild = buildCodexAppServerChildEnv(envInput);
  if (!envBuild.ok) return envBuild;
  return {
    ok: true,
    spec: {
      command: pin.absolutePath,
      args: [...pin.argv],
      options: {
        shell: false,
        env: envBuild.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    },
  };
};
