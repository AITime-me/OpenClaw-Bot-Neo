import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DISPOSABLE_ROOT_PREFIX, MARKER_FILENAME, MARKER_SCHEMA_VERSION } from './constants.ts';
import { hashCapability } from './fingerprint.ts';

export type DisposableRootOwnership = {
  readonly runId: string;
  readonly capability: string;
  readonly capabilityHash: string;
  readonly executionRootPath: string;
  readonly realExecutionRootPath: string;
  readonly executionInode: number;
  readonly executionDevice: number;
  readonly storageRootPath: string;
  readonly realStorageRootPath: string;
  readonly storageInode: number;
  readonly storageDevice: number;
  readonly markerInode: number;
  readonly markerDevice: number;
  readonly parentRealPath: string;
  readonly uid: number;
  readonly homePath: string;
  readonly tmpPath: string;
};

export const STORAGE_ROOT_ALLOWED_FILENAMES = Object.freeze([
  'neo.primary.lock',
  'neo-memory.sqlite',
  'neo-memory.sqlite-wal',
  'neo-memory.sqlite-shm',
] as const);

export const EXECUTION_ROOT_ALLOWED_DIRS = Object.freeze(['storage', 'home', 'tmp'] as const);

export const EXECUTION_ROOT_ALLOWED_FILENAMES = Object.freeze([MARKER_FILENAME] as const);

export const generateRunId = (): string => randomBytes(16).toString('hex');

export const generateParentCapability = (): string => randomBytes(32).toString('hex');

export const formatMarkerContent = (runId: string, capabilityHash: string): string =>
  `${MARKER_SCHEMA_VERSION}\n${runId}\n${capabilityHash}\n`;

export const parseMarkerContent = (
  content: string,
): { readonly schema: string; readonly runId: string; readonly capabilityHash: string } | null => {
  const lines = content.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length !== 3) return null;
  const schema = lines[0];
  const runId = lines[1];
  const capabilityHash = lines[2];
  if (
    schema !== MARKER_SCHEMA_VERSION ||
    typeof runId !== 'string' ||
    runId.length === 0 ||
    typeof capabilityHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(capabilityHash)
  ) {
    return null;
  }
  return { schema, runId, capabilityHash };
};

const requireLstat = (
  path: string,
): {
  ino: number;
  dev: number;
  uid: number;
  mode: number;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
} => {
  const stats = lstatSync(path);
  return {
    ino: stats.ino,
    dev: stats.dev,
    uid: stats.uid,
    mode: stats.mode,
    isDir: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymlink: stats.isSymbolicLink(),
  };
};

const writeMarkerExclusive = (markerPath: string, content: string): void => {
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_WRONLY |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);
  const fd = openSync(markerPath, flags, 0o600);
  try {
    writeSync(fd, content, undefined, 'utf8');
  } finally {
    closeSync(fd);
  }
};

export const createDisposableRoot = (
  expectedUid: number,
  repositoryRoot: string,
): DisposableRootOwnership => {
  const runId = generateRunId();
  const capability = generateParentCapability();
  const capabilityHash = hashCapability(capability);
  const parentRealPath = realpathSync(tmpdir());
  const repoReal = realpathSync(repositoryRoot);

  const staged = mkdtempSync(join(parentRealPath, `${DISPOSABLE_ROOT_PREFIX}${runId}-`));
  const executionRootPath = join(parentRealPath, `${DISPOSABLE_ROOT_PREFIX}${runId}`);
  renameSync(staged, executionRootPath);

  if (executionRootPath === '/' || executionRootPath === parentRealPath) {
    throw new Error('DISPOSABLE_ROOT_UNSAFE');
  }
  if (executionRootPath === repoReal || executionRootPath.startsWith(`${repoReal}/`)) {
    throw new Error('DISPOSABLE_ROOT_IN_REPOSITORY');
  }

  chmodSync(executionRootPath, 0o700);
  const storageRootPath = join(executionRootPath, 'storage');
  const homePath = join(executionRootPath, 'home');
  const tmpPath = join(executionRootPath, 'tmp');
  mkdirSync(storageRootPath, { recursive: false, mode: 0o700 });
  mkdirSync(homePath, { recursive: false, mode: 0o700 });
  mkdirSync(tmpPath, { recursive: false, mode: 0o700 });
  chmodSync(storageRootPath, 0o700);
  chmodSync(homePath, 0o700);
  chmodSync(tmpPath, 0o700);

  const markerPath = join(executionRootPath, MARKER_FILENAME);
  writeMarkerExclusive(markerPath, formatMarkerContent(runId, capabilityHash));

  const realExecutionRootPath = realpathSync(executionRootPath);
  if (realExecutionRootPath !== executionRootPath) throw new Error('DISPOSABLE_ROOT_SYMLINK');

  const realStorageRootPath = realpathSync(storageRootPath);
  if (realStorageRootPath !== storageRootPath) throw new Error('STORAGE_ROOT_SYMLINK');

  const executionStats = requireLstat(executionRootPath);
  if (executionStats.isSymlink || !executionStats.isDir) throw new Error('DISPOSABLE_ROOT_SYMLINK');
  if ((executionStats.mode & 0o777) !== 0o700) throw new Error('DISPOSABLE_ROOT_MODE');
  if (executionStats.uid !== expectedUid) throw new Error('DISPOSABLE_ROOT_UID');

  const storageStats = requireLstat(storageRootPath);
  if (storageStats.isSymlink || !storageStats.isDir) throw new Error('STORAGE_ROOT_SYMLINK');
  if ((storageStats.mode & 0o777) !== 0o700) throw new Error('STORAGE_ROOT_MODE');

  const markerStats = requireLstat(markerPath);
  if (markerStats.isSymlink || !markerStats.isFile) throw new Error('MARKER_NOT_REGULAR');
  if ((markerStats.mode & 0o077) !== 0) throw new Error('MARKER_MODE');

  return {
    runId,
    capability,
    capabilityHash,
    executionRootPath,
    realExecutionRootPath,
    executionInode: executionStats.ino,
    executionDevice: executionStats.dev,
    storageRootPath,
    realStorageRootPath,
    storageInode: storageStats.ino,
    storageDevice: storageStats.dev,
    markerInode: markerStats.ino,
    markerDevice: markerStats.dev,
    parentRealPath,
    uid: executionStats.uid,
    homePath,
    tmpPath,
  };
};

export type RootRemovalProof = {
  readonly prefixOk: boolean;
  readonly parentOk: boolean;
  readonly markerOk: boolean;
  readonly executionInodeOk: boolean;
  readonly markerInodeOk: boolean;
  readonly notSymlink: boolean;
  readonly noChildSymlinks: boolean;
  readonly notUnsafe: boolean;
  readonly storageValidated: boolean;
};

const scanNoSymlinks = (rootPath: string): boolean => {
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const name of readdirSync(current)) {
      const child = join(current, name);
      const stats = requireLstat(child);
      if (stats.isSymlink) return false;
      if (stats.isDir) stack.push(child);
    }
  }
  return true;
};

const validateStorageRootIdentity = (
  ownership: DisposableRootOwnership,
): { readonly ok: boolean } => {
  try {
    const storageStats = requireLstat(ownership.storageRootPath);
    if (storageStats.isSymlink || !storageStats.isDir) return { ok: false };
    if (
      storageStats.ino !== ownership.storageInode ||
      storageStats.dev !== ownership.storageDevice
    ) {
      return { ok: false };
    }
    const realStorage = realpathSync(ownership.storageRootPath);
    if (realStorage !== ownership.realStorageRootPath) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
};

export const validateRemovalProof = (
  ownership: DisposableRootOwnership,
  repositoryRoot: string,
): RootRemovalProof => {
  const repoReal = resolve(realpathSync(repositoryRoot));
  const name = basename(ownership.realExecutionRootPath);
  const prefixOk = name.startsWith(DISPOSABLE_ROOT_PREFIX);
  const parentOk = ownership.parentRealPath === realpathSync(tmpdir());
  let markerOk = false;
  let executionInodeOk = false;
  let markerInodeOk = false;
  let notSymlink = false;
  let noChildSymlinks = false;
  const storageValidated = validateStorageRootIdentity(ownership).ok;
  try {
    const rootStats = requireLstat(ownership.executionRootPath);
    notSymlink = !rootStats.isSymlink && rootStats.isDir;
    executionInodeOk =
      rootStats.ino === ownership.executionInode && rootStats.dev === ownership.executionDevice;
    const markerPath = join(ownership.executionRootPath, MARKER_FILENAME);
    const markerStats = requireLstat(markerPath);
    markerInodeOk =
      !markerStats.isSymlink &&
      markerStats.isFile &&
      markerStats.ino === ownership.markerInode &&
      markerStats.dev === ownership.markerDevice;
    const parsed = parseMarkerContent(readFileSync(markerPath, 'utf8'));
    markerOk =
      parsed !== null &&
      parsed.runId === ownership.runId &&
      parsed.capabilityHash === ownership.capabilityHash;
    noChildSymlinks = scanNoSymlinks(ownership.executionRootPath);
  } catch {
    // remain false
  }
  const notUnsafe =
    ownership.realExecutionRootPath !== '/' &&
    ownership.realExecutionRootPath !== '/tmp' &&
    ownership.realExecutionRootPath !== ownership.parentRealPath &&
    ownership.realExecutionRootPath !== repoReal &&
    !ownership.realExecutionRootPath.startsWith(`${repoReal}/`) &&
    !repoReal.startsWith(`${ownership.realExecutionRootPath}/`);
  return {
    prefixOk,
    parentOk,
    markerOk,
    executionInodeOk,
    markerInodeOk,
    notSymlink,
    noChildSymlinks,
    notUnsafe,
    storageValidated,
  };
};

export const removeDisposableRoot = (
  ownership: DisposableRootOwnership,
  repositoryRoot: string,
): { readonly removed: boolean; readonly proof: RootRemovalProof } => {
  const proof = validateRemovalProof(ownership, repositoryRoot);
  if (
    !proof.prefixOk ||
    !proof.parentOk ||
    !proof.markerOk ||
    !proof.executionInodeOk ||
    !proof.markerInodeOk ||
    !proof.notSymlink ||
    !proof.noChildSymlinks ||
    !proof.notUnsafe ||
    !proof.storageValidated
  ) {
    return { removed: false, proof };
  }
  rmSync(ownership.executionRootPath, { recursive: true, force: false });
  try {
    requireLstat(ownership.executionRootPath);
    return { removed: false, proof };
  } catch {
    return { removed: true, proof };
  }
};

export const refuseUnsafeRootRemoval = (path: string): boolean => {
  const name = basename(path);
  if (!name.startsWith(DISPOSABLE_ROOT_PREFIX)) return true;
  if (path === '/' || path === '/tmp' || path === tmpdir()) return true;
  return false;
};

export type ChildRootValidationInput = {
  readonly storageRoot: string;
  readonly expectedStorageRealpath: string;
  readonly expectedStorageDev: number;
  readonly expectedStorageInode: number;
  readonly executionRoot: string;
  readonly expectedExecutionRealpath: string;
  readonly expectedExecutionDev: number;
  readonly expectedExecutionInode: number;
  readonly expectedMarkerDev: number;
  readonly expectedMarkerInode: number;
  readonly expectedRunId: string;
  readonly capability: string;
  readonly repositoryRoot: string;
  readonly expectedUid: number;
};

/** Serialize inode/device for env transport (number or bigint-safe). */
export const serializeFsId = (value: number | bigint): string => String(value);

export const parseFsId = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export type ChildRootValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

const validateExecutionRoot = (
  input: ChildRootValidationInput,
  parentReal: string,
  repoReal: string,
): ChildRootValidationResult => {
  const rootStats = requireLstat(input.executionRoot);
  if (rootStats.isSymlink || !rootStats.isDir) return { ok: false, reason: 'EXECUTION_SYMLINK' };
  if ((rootStats.mode & 0o777) !== 0o700) return { ok: false, reason: 'EXECUTION_MODE' };
  if (rootStats.uid !== input.expectedUid) return { ok: false, reason: 'EXECUTION_UID' };
  if (
    rootStats.ino !== input.expectedExecutionInode ||
    rootStats.dev !== input.expectedExecutionDev
  ) {
    return { ok: false, reason: 'EXECUTION_INODE_DEV' };
  }
  const realRoot = realpathSync(input.executionRoot);
  if (realRoot !== input.expectedExecutionRealpath)
    return { ok: false, reason: 'EXECUTION_REALPATH' };
  if (!basename(realRoot).startsWith(DISPOSABLE_ROOT_PREFIX)) {
    return { ok: false, reason: 'EXECUTION_PREFIX' };
  }
  if (!realRoot.startsWith(`${parentReal}/`)) return { ok: false, reason: 'EXECUTION_PARENT' };
  if (realRoot === '/' || realRoot === '/tmp' || realRoot === parentReal) {
    return { ok: false, reason: 'EXECUTION_UNSAFE' };
  }
  if (realRoot === repoReal || realRoot.startsWith(`${repoReal}/`)) {
    return { ok: false, reason: 'EXECUTION_IN_REPO' };
  }
  const markerPath = join(input.executionRoot, MARKER_FILENAME);
  const markerStats = requireLstat(markerPath);
  if (markerStats.isSymlink || !markerStats.isFile) return { ok: false, reason: 'MARKER_TYPE' };
  if ((markerStats.mode & 0o077) !== 0) return { ok: false, reason: 'MARKER_MODE' };
  if (
    markerStats.ino !== input.expectedMarkerInode ||
    markerStats.dev !== input.expectedMarkerDev
  ) {
    return { ok: false, reason: 'MARKER_INODE_DEV' };
  }
  const parsed = parseMarkerContent(readFileSync(markerPath, 'utf8'));
  if (parsed === null) return { ok: false, reason: 'MARKER_PARSE' };
  if (parsed.runId !== input.expectedRunId) return { ok: false, reason: 'MARKER_RUN_ID' };
  if (parsed.capabilityHash !== hashCapability(input.capability)) {
    return { ok: false, reason: 'MARKER_CAPABILITY' };
  }
  return { ok: true };
};

const validateStorageRoot = (input: ChildRootValidationInput): ChildRootValidationResult => {
  const storageStats = requireLstat(input.storageRoot);
  if (storageStats.isSymlink || !storageStats.isDir)
    return { ok: false, reason: 'STORAGE_SYMLINK' };
  if ((storageStats.mode & 0o777) !== 0o700) return { ok: false, reason: 'STORAGE_MODE' };
  if (storageStats.uid !== input.expectedUid) return { ok: false, reason: 'STORAGE_UID' };
  if (
    storageStats.ino !== input.expectedStorageInode ||
    storageStats.dev !== input.expectedStorageDev
  ) {
    return { ok: false, reason: 'STORAGE_INODE_DEV' };
  }
  const realStorage = realpathSync(input.storageRoot);
  if (realStorage !== input.expectedStorageRealpath)
    return { ok: false, reason: 'STORAGE_REALPATH' };
  const expectedStorage = join(input.executionRoot, 'storage');
  if (realStorage !== realpathSync(expectedStorage))
    return { ok: false, reason: 'STORAGE_NESTING' };
  return { ok: true };
};

export const validateChildDisposableRoot = (
  input: ChildRootValidationInput,
): ChildRootValidationResult => {
  try {
    const parentReal = realpathSync(tmpdir());
    const repoReal = realpathSync(input.repositoryRoot);
    const executionResult = validateExecutionRoot(input, parentReal, repoReal);
    if (!executionResult.ok) return executionResult;
    return validateStorageRoot(input);
  } catch {
    return { ok: false, reason: 'ROOT_VALIDATION_EXCEPTION' };
  }
};

const directoryIsEmpty = (dirPath: string): boolean => {
  try {
    return readdirSync(dirPath).length === 0;
  } catch {
    return false;
  }
};

export const validateHomeTmpEmpty = (homePath: string, tmpPath: string): boolean =>
  directoryIsEmpty(homePath) && directoryIsEmpty(tmpPath);

export const validateStorageRootAllowlist = (storageRoot: string): boolean => {
  try {
    const allowed = new Set<string>(STORAGE_ROOT_ALLOWED_FILENAMES);
    for (const name of readdirSync(storageRoot)) {
      const childPath = join(storageRoot, name);
      const stats = requireLstat(childPath);
      if (stats.isSymlink) return false;
      if (stats.isDir) return false;
      if (!allowed.has(name)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const validateExecutionRootAllowlist = (executionRoot: string): boolean => {
  try {
    const allowedFiles = new Set<string>(EXECUTION_ROOT_ALLOWED_FILENAMES);
    const allowedDirs = new Set<string>(EXECUTION_ROOT_ALLOWED_DIRS);
    for (const name of readdirSync(executionRoot)) {
      const childPath = join(executionRoot, name);
      const stats = requireLstat(childPath);
      if (stats.isSymlink) return false;
      if (stats.isDir) {
        if (!allowedDirs.has(name)) return false;
        continue;
      }
      if (!allowedFiles.has(name)) return false;
    }
    return true;
  } catch {
    return false;
  }
};
