import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  GATE_EXPECTED_HEAD_ENV,
  GATE_EXPECTED_LOCK_SHA256_ENV,
  GATE_OPT_IN_ENV,
  REQUIRED_GLIBC_MAJOR,
  REQUIRED_GLIBC_MINOR,
  REQUIRED_NPM_VERSION,
  REQUIRED_NODE_VERSION,
} from './constants.ts';
import { hashPackageLock } from './fingerprint.ts';

export type EnvironmentGateClassification =
  | 'GATE_OPT_IN_MISSING'
  | 'GATE_EXPECTATION_MISSING'
  | 'GIT_HEAD_MISMATCH'
  | 'PACKAGE_LOCK_MISMATCH'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_ARCHITECTURE'
  | 'UNSUPPORTED_OS'
  | 'UNSUPPORTED_NODE'
  | 'UNSUPPORTED_NPM'
  | 'ROOT_USER_FORBIDDEN'
  | 'NON_LOCAL_FILESYSTEM'
  | 'NETWORK_NOT_ISOLATED'
  | 'WORKING_TREE_DIRTY'
  | 'STAGING_NOT_EMPTY'
  | 'UNTRACKED_FILES'
  | 'GLIBC_UNAVAILABLE'
  | 'PASS';

export type EnvironmentGateResult = {
  readonly classification: EnvironmentGateClassification;
  readonly gitHead: string;
  readonly packageLockSha256: string;
  readonly osId: string;
  readonly osVersionId: string;
  readonly architecture: string;
  readonly libc: string;
  readonly libcFamily: string;
  readonly libcVersion: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly filesystemType: string;
  readonly localVerified: boolean;
  readonly networkIsolationVerified: boolean;
  readonly nonRootUserVerified: boolean;
  readonly overlayFilesystem: boolean;
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

const parseOsRelease = (): { id: string; versionId: string } => {
  if (!existsSync('/etc/os-release')) return { id: '', versionId: '' };
  const content = readFileSync('/etc/os-release', 'utf8');
  let id = '';
  let versionId = '';
  for (const line of content.split('\n')) {
    if (line.startsWith('ID=')) id = line.slice(3).replaceAll('"', '');
    if (line.startsWith('VERSION_ID=')) versionId = line.slice(11).replaceAll('"', '');
  }
  return { id, versionId };
};

export type GlibcParseResult = {
  readonly family: string;
  readonly version: string;
  readonly raw: string;
  readonly ok: boolean;
};

export const parseGlibcVersionOutput = (output: string): GlibcParseResult => {
  const first = (output.split('\n')[0] ?? '').trim();
  const lower = first.toLowerCase();
  if (lower.includes('musl')) {
    return { family: 'musl', version: '', raw: first, ok: false };
  }
  if (!(lower.includes('glibc') || lower.includes('gnu libc') || lower.includes('gnu c library'))) {
    return { family: 'unknown', version: '', raw: first, ok: false };
  }
  const match = first.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { family: 'glibc', version: '', raw: first, ok: false };
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const version = `${match[1]}.${match[2]}${match[3] !== undefined ? `.${match[3]}` : ''}`;
  const ok =
    major > REQUIRED_GLIBC_MAJOR ||
    (major === REQUIRED_GLIBC_MAJOR && minor >= REQUIRED_GLIBC_MINOR);
  return { family: 'glibc', version, raw: first, ok };
};

const detectGlibc = (): GlibcParseResult => {
  try {
    const output = execFileSync('ldd', ['--version'], { encoding: 'utf8' });
    return parseGlibcVersionOutput(output);
  } catch {
    return { family: '', version: '', raw: '', ok: false };
  }
};

const REJECTED_FS_TYPES = new Set(['nfs', 'nfs4', 'cifs', 'smb', 'fuse']);

const detectFilesystem = (
  targetPath: string,
): { type: string; localVerified: boolean; overlayFilesystem: boolean } => {
  if (!existsSync('/proc/mounts'))
    return { type: 'unknown', localVerified: false, overlayFilesystem: false };
  const mounts = readFileSync('/proc/mounts', 'utf8');
  const resolved = resolve(targetPath);
  let bestLen = 0;
  let fsType = 'unknown';
  for (const line of mounts.split('\n')) {
    const parts = line.split(' ');
    const mountPoint = parts[1];
    const type = parts[2];
    if (mountPoint === undefined || type === undefined) continue;
    if (resolved === mountPoint || resolved.startsWith(`${mountPoint}/`)) {
      if (mountPoint.length >= bestLen) {
        bestLen = mountPoint.length;
        fsType = type;
      }
    }
  }
  const localVerified = fsType !== 'unknown' && !REJECTED_FS_TYPES.has(fsType);
  const overlayFilesystem = fsType === 'overlay' || fsType === 'overlayfs';
  return { type: fsType, localVerified, overlayFilesystem };
};

export const verifyNetworkIsolationFromProc = (sources: {
  readonly netClassExists: boolean;
  readonly interfaces: readonly { readonly name: string; readonly operstate: string | null }[];
  readonly ipv4Routes: string | null;
  readonly ipv6Routes: string | null;
}): boolean => {
  if (!sources.netClassExists) return false;
  if (sources.ipv4Routes === null || sources.ipv6Routes === null) return false;
  for (const iface of sources.interfaces) {
    if (iface.name === 'lo') continue;
    if (iface.operstate === null) return false;
    if (iface.operstate === 'up' || iface.operstate === 'unknown') return false;
  }
  // IPv4: any non-loopback interface in the route table means usable off-box routing.
  for (const line of sources.ipv4Routes.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const iface = parts[0];
    if (iface === undefined || iface === 'lo') continue;
    return false;
  }
  // IPv6: reject non-loopback routes (lo entries often use 'lo' or unset)
  for (const line of sources.ipv6Routes.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(/\s+/);
    // Format: dest dest_prefix src src_prefix metric ... device
    const device = parts[parts.length - 1];
    if (device === undefined || device === 'lo') continue;
    // Default / non-lo device present
    return false;
  }
  return true;
};

const verifyNetworkIsolation = (): boolean => {
  const devPath = '/sys/class/net';
  if (!existsSync(devPath)) return false;
  if (!existsSync('/proc/net/route') || !existsSync('/proc/net/ipv6_route')) return false;
  const interfaces = readdirSync(devPath).map((name) => {
    const operstatePath = join(devPath, name, 'operstate');
    let operstate: string | null = null;
    if (existsSync(operstatePath)) {
      try {
        operstate = readFileSync(operstatePath, 'utf8').trim();
      } catch {
        operstate = null;
      }
    }
    return { name, operstate };
  });
  let ipv4Routes: string;
  let ipv6Routes: string;
  try {
    ipv4Routes = readFileSync('/proc/net/route', 'utf8');
    ipv6Routes = readFileSync('/proc/net/ipv6_route', 'utf8');
  } catch {
    return false;
  }
  return verifyNetworkIsolationFromProc({
    netClassExists: true,
    interfaces,
    ipv4Routes,
    ipv6Routes,
  });
};

const readNpmVersion = (): string => {
  const result = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return '';
  return result.stdout.trim();
};

export const runEnvironmentGate = (
  env: NodeJS.ProcessEnv = process.env,
  repositoryRoot: string = process.cwd(),
): EnvironmentGateResult => {
  const gitHead = readGitHead(repositoryRoot);
  const packageLockSha256 = hashPackageLock(join(repositoryRoot, 'package-lock.json'));
  const osRelease = parseOsRelease();
  const architecture = process.arch;
  const nodeVersion = process.version.replace(/^v/, '');
  const npmVersion = readNpmVersion();
  const glibc = detectGlibc();
  const tempFs = detectFilesystem(tmpdir());
  const networkIsolationVerified = process.platform === 'linux' ? verifyNetworkIsolation() : false;
  const nonRootUserVerified = typeof process.getuid === 'function' ? process.getuid() !== 0 : false;

  const base: EnvironmentGateResult = {
    classification: 'PASS',
    gitHead,
    packageLockSha256,
    osId: osRelease.id,
    osVersionId: osRelease.versionId,
    architecture,
    libc: glibc.raw,
    libcFamily: glibc.family,
    libcVersion: glibc.version,
    nodeVersion,
    npmVersion,
    filesystemType: tempFs.type,
    localVerified: tempFs.localVerified,
    networkIsolationVerified,
    nonRootUserVerified,
    overlayFilesystem: tempFs.overlayFilesystem,
  };

  if (env[GATE_OPT_IN_ENV] !== '1') return { ...base, classification: 'GATE_OPT_IN_MISSING' };
  const expectedHead = env[GATE_EXPECTED_HEAD_ENV];
  const expectedLock = env[GATE_EXPECTED_LOCK_SHA256_ENV];
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
  if (process.arch !== 'x64') return { ...base, classification: 'UNSUPPORTED_ARCHITECTURE' };
  if (osRelease.id !== 'ubuntu' || !osRelease.versionId.startsWith('24.04')) {
    return { ...base, classification: 'UNSUPPORTED_OS' };
  }
  if (!glibc.ok) return { ...base, classification: 'GLIBC_UNAVAILABLE' };
  if (nodeVersion !== REQUIRED_NODE_VERSION) return { ...base, classification: 'UNSUPPORTED_NODE' };
  if (npmVersion !== REQUIRED_NPM_VERSION) return { ...base, classification: 'UNSUPPORTED_NPM' };
  if (!nonRootUserVerified) return { ...base, classification: 'ROOT_USER_FORBIDDEN' };
  if (!tempFs.localVerified) return { ...base, classification: 'NON_LOCAL_FILESYSTEM' };
  if (!networkIsolationVerified) return { ...base, classification: 'NETWORK_NOT_ISOLATED' };

  const gitStatus = readGitStatus(repositoryRoot);
  if (gitStatus.dirty) return { ...base, classification: 'WORKING_TREE_DIRTY' };
  if (gitStatus.staged) return { ...base, classification: 'STAGING_NOT_EMPTY' };
  if (gitStatus.untracked.length > 0) return { ...base, classification: 'UNTRACKED_FILES' };

  return base;
};

export const classificationToStderr = (classification: EnvironmentGateClassification): string =>
  classification;

export const listRootArtifacts = (rootPath: string): readonly string[] => {
  if (!existsSync(rootPath)) return [];
  return readdirSync(rootPath).filter(
    (name) =>
      statSync(join(rootPath, name)).isFile() || statSync(join(rootPath, name)).isDirectory(),
  );
};
