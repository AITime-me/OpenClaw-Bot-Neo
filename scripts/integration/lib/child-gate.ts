import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  GATE_EXPECTED_HEAD_ENV,
  GATE_EXPECTED_LOCK_SHA256_ENV,
  GATE_OPT_IN_ENV,
  GATE_PROTOCOL_VERSION,
  REQUIRED_NODE_VERSION,
  isChildRole,
  type ChildRole,
} from './constants.ts';
import {
  parseFsId,
  validateChildDisposableRoot,
  type ChildRootValidationResult,
} from './disposable-root.ts';
import { hashPackageLock } from './fingerprint.ts';

export type ChildGateSuccess = {
  readonly ok: true;
  readonly runId: string;
  readonly role: ChildRole;
  readonly storageRoot: string;
  readonly executionRoot: string;
  readonly repositoryRoot: string;
  readonly expectedUid: number;
  readonly useTestHooks: boolean;
  readonly recordId: string | null;
  readonly ownerId: string | null;
};

export type ChildGateFailure = {
  readonly ok: false;
  readonly reason: string;
};

export type ChildGateResult = ChildGateSuccess | ChildGateFailure;

export type ChildGateRuntimeFacts = {
  readonly platform: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly readGitHead: (repositoryRoot: string) => string | null;
  readonly readPackageLockSha: (packageLockPath: string) => string;
  readonly validateRoot: (
    input: Parameters<typeof validateChildDisposableRoot>[0],
  ) => ChildRootValidationResult;
};

const required = (env: NodeJS.ProcessEnv, name: string): string | null => {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
};

const defaultReadGitHead = (repositoryRoot: string): string | null => {
  const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (headResult.status !== 0) return null;
  return headResult.stdout.trim();
};

export const defaultChildGateRuntimeFacts = (): ChildGateRuntimeFacts => ({
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version.replace(/^v/, ''),
  readGitHead: defaultReadGitHead,
  readPackageLockSha: (packageLockPath) => hashPackageLock(packageLockPath),
  validateRoot: validateChildDisposableRoot,
});

/**
 * Fail-closed child validation before any production factory import.
 * All roles including flock-wait must pass HEAD/lock/platform checks before role-specific logic.
 * Platform/fs/git facts are injectable so Windows hosts can exercise pure validators.
 */
export const runChildGate = (
  env: NodeJS.ProcessEnv = process.env,
  facts: ChildGateRuntimeFacts = defaultChildGateRuntimeFacts(),
): ChildGateResult => {
  if (env[GATE_OPT_IN_ENV] !== '1') return { ok: false, reason: 'GATE_OPT_IN_MISSING' };

  const expectedHead = required(env, GATE_EXPECTED_HEAD_ENV);
  const expectedLock = required(env, GATE_EXPECTED_LOCK_SHA256_ENV);
  if (expectedHead === null || expectedLock === null) {
    return { ok: false, reason: 'GATE_EXPECTATION_MISSING' };
  }

  if (facts.platform !== 'linux') return { ok: false, reason: 'UNSUPPORTED_PLATFORM' };
  if (facts.arch !== 'x64') return { ok: false, reason: 'UNSUPPORTED_ARCHITECTURE' };
  if (facts.nodeVersion !== REQUIRED_NODE_VERSION) return { ok: false, reason: 'UNSUPPORTED_NODE' };

  const roleRaw = required(env, 'OPENCLAW_B3C4_ROLE');
  if (roleRaw === null || !isChildRole(roleRaw)) return { ok: false, reason: 'UNKNOWN_ROLE' };

  const runId = required(env, 'OPENCLAW_B3C4_RUN_ID');
  if (runId === null || !/^[a-f0-9]{8,64}$/.test(runId)) {
    return { ok: false, reason: 'INVALID_RUN_ID' };
  }

  const capability = required(env, 'OPENCLAW_B3C4_PARENT_CAPABILITY');
  if (capability === null) return { ok: false, reason: 'MISSING_CHILD_ENV' };
  if (!/^[a-f0-9]{64}$/.test(capability)) return { ok: false, reason: 'INVALID_CAPABILITY' };

  const repositoryRoot = required(env, 'OPENCLAW_B3C4_REPOSITORY_ROOT');
  if (repositoryRoot === null) return { ok: false, reason: 'MISSING_CHILD_ENV' };

  const protocolVersion = required(env, 'OPENCLAW_B3C4_PROTOCOL_VERSION');
  if (protocolVersion !== String(GATE_PROTOCOL_VERSION)) {
    return { ok: false, reason: 'WRONG_PROTOCOL_VERSION' };
  }

  const actualHead = facts.readGitHead(repositoryRoot);
  if (actualHead === null || actualHead !== expectedHead) {
    return { ok: false, reason: 'GIT_HEAD_MISMATCH' };
  }
  const actualLock = facts.readPackageLockSha(join(repositoryRoot, 'package-lock.json'));
  if (actualLock !== expectedLock) return { ok: false, reason: 'PACKAGE_LOCK_MISMATCH' };

  if (roleRaw === 'flock-wait') {
    return {
      ok: true,
      runId,
      role: roleRaw,
      storageRoot: '',
      executionRoot: '',
      repositoryRoot,
      expectedUid: 0,
      useTestHooks: false,
      recordId: null,
      ownerId: null,
    };
  }

  const storageRoot = required(env, 'OPENCLAW_B3C4_STORAGE_ROOT');
  const storageRealpath = required(env, 'OPENCLAW_B3C4_STORAGE_REALPATH');
  const storageDev = required(env, 'OPENCLAW_B3C4_STORAGE_DEV');
  const storageInode = required(env, 'OPENCLAW_B3C4_STORAGE_INODE');
  const executionRoot = required(env, 'OPENCLAW_B3C4_EXECUTION_ROOT');
  const executionRealpath = required(env, 'OPENCLAW_B3C4_EXECUTION_REALPATH');
  const executionDev = required(env, 'OPENCLAW_B3C4_EXECUTION_DEV');
  const executionInode = required(env, 'OPENCLAW_B3C4_EXECUTION_INODE');
  const markerDev = required(env, 'OPENCLAW_B3C4_MARKER_DEV');
  const markerInode = required(env, 'OPENCLAW_B3C4_MARKER_INODE');
  const expectedUidRaw = required(env, 'OPENCLAW_B3C4_EXPECTED_UID');

  if (
    storageRoot === null ||
    storageRealpath === null ||
    storageDev === null ||
    storageInode === null ||
    executionRoot === null ||
    executionRealpath === null ||
    executionDev === null ||
    executionInode === null ||
    markerDev === null ||
    markerInode === null ||
    expectedUidRaw === null
  ) {
    return { ok: false, reason: 'MISSING_CHILD_ENV' };
  }

  const expectedUid = Number(expectedUidRaw);
  const expectedStorageDev = parseFsId(storageDev);
  const expectedStorageInode = parseFsId(storageInode);
  const expectedExecutionDev = parseFsId(executionDev);
  const expectedExecutionInode = parseFsId(executionInode);
  const expectedMarkerDev = parseFsId(markerDev);
  const expectedMarkerInode = parseFsId(markerInode);
  if (!Number.isInteger(expectedUid) || expectedUid < 0) {
    return { ok: false, reason: 'INVALID_UID' };
  }
  if (
    expectedStorageDev === null ||
    expectedStorageInode === null ||
    expectedExecutionDev === null ||
    expectedExecutionInode === null ||
    expectedMarkerDev === null ||
    expectedMarkerInode === null
  ) {
    return { ok: false, reason: 'INVALID_INODE_DEV' };
  }

  const rootValidation = facts.validateRoot({
    storageRoot,
    expectedStorageRealpath: storageRealpath,
    expectedStorageDev,
    expectedStorageInode,
    executionRoot,
    expectedExecutionRealpath: executionRealpath,
    expectedExecutionDev,
    expectedExecutionInode,
    expectedMarkerDev,
    expectedMarkerInode,
    expectedRunId: runId,
    capability,
    repositoryRoot,
    expectedUid,
  });
  if (!rootValidation.ok) return { ok: false, reason: rootValidation.reason };

  return {
    ok: true,
    runId,
    role: roleRaw,
    storageRoot,
    executionRoot,
    repositoryRoot,
    expectedUid,
    useTestHooks: env['OPENCLAW_B3C4_USE_TEST_HOOKS'] === '1',
    recordId: required(env, 'OPENCLAW_B3C4_RECORD_ID'),
    ownerId: required(env, 'OPENCLAW_B3C4_OWNER_ID'),
  };
};
