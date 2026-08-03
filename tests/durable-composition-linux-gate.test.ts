import { describe, expect, it, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GATE_EXPECTED_HEAD_ENV,
  GATE_EXPECTED_LOCK_SHA256_ENV,
  GATE_OPT_IN_ENV,
  MAX_PROTOCOL_LINE_BYTES,
  PASS_MARKER,
  REQUIRED_SCENARIO_KEYS,
  CHILD_ENV_ALLOWLIST,
} from '../scripts/integration/lib/constants.ts';
import {
  createCleanupController,
  GateAbortedError,
} from '../scripts/integration/lib/cleanup-controller.ts';
import {
  ABORT_CHECKED_SPAWN_MARKER,
  spawnCheckedChildSession,
  spawnCheckedRawProcess,
} from '../scripts/integration/lib/abort-spawn.ts';
import { SerialCommandQueue } from '../scripts/integration/lib/command-queue.ts';
import {
  createInteractiveStdinState,
  interactiveHandleEof,
  interactiveIngestChunk,
  interactiveMarkTerminalCommand,
  interactiveMarkTerminalEvent,
} from '../scripts/integration/lib/interactive-stdin.ts';
import {
  assertScenarioBStepOrder,
  runScenarioBOrchestration,
} from '../scripts/integration/lib/scenario-b-orchestration.ts';
import { createProtocolEventStream } from '../scripts/integration/lib/protocol-event-stream.ts';
import type { ProtocolMessage } from '../scripts/integration/lib/protocol.ts';
import {
  buildChildEnvironment,
  childEnvironmentContainsSecret,
  isSecretEnvKey,
} from '../scripts/integration/lib/child-env.ts';
import {
  defaultChildGateRuntimeFacts,
  runChildGate,
  type ChildGateRuntimeFacts,
} from '../scripts/integration/lib/child-gate.ts';
import {
  buildReadConfirmationFromRecord,
  buildWriteConfirmationDetail,
  parseAuthorizationFailureCode,
  sha256Utf8,
} from '../scripts/integration/lib/content-confirmation.ts';
import {
  createDisposableRoot,
  generateParentCapability,
  generateRunId,
  refuseUnsafeRootRemoval,
  removeDisposableRoot,
  validateExecutionRootAllowlist,
  validateHomeTmpEmpty,
  validateRemovalProof,
  validateStorageRootAllowlist,
  validateChildDisposableRoot,
  resolveDisposableParentRealpath,
  isExecutionRootUnderDisposableParent,
  type ChildRootValidationInput,
  type DisposableRootOwnership,
} from '../scripts/integration/lib/disposable-root.ts';
import {
  createInitialEvidence,
  fillUnrunScenariosAfterFailure,
  finalizeEvidence,
  hasExactScenarioKeySet,
  shouldPrintPassMarker,
  UNRUN_AFTER_PRIOR_FAILURE_DETAIL,
} from '../scripts/integration/lib/evidence.ts';
import { runEnvironmentGate } from '../scripts/integration/lib/environment-gate.ts';
import {
  detectFilesystemFromMounts,
  isPathWithinMount,
  isRejectedFilesystemType,
  normalizeMountPoint,
  parseProcMounts,
  unescapeProcMountsPath,
} from '../scripts/integration/lib/filesystem-detection.ts';
import { finalizeHarnessOutput } from '../scripts/integration/lib/stdout-exit.ts';
import {
  EXIT_ASSERTION_FAILURE,
  EXIT_LOCK_CONTENTION,
  EXIT_SUCCESS,
  mapEventToExpectedExit,
} from '../scripts/integration/lib/exit-codes.ts';
import {
  fingerprintFile,
  fingerprintsEqual,
  hashCapability,
  hashPackageLock,
} from '../scripts/integration/lib/fingerprint.ts';
import {
  createFlockHolderMachine,
  flockHolderHandleCompleteLine,
  flockHolderHandleEof,
  flockHolderIngestChunk,
} from '../scripts/integration/lib/flock-holder-protocol.ts';
import {
  injectProductionFactoryLoaderForTests,
  resetProductionFactoryLoadedForTests,
  wasProductionFactoryLoaded,
} from '../scripts/integration/lib/lazy-production.ts';
import {
  parseParentCommandLine,
  parseProtocolLine,
  ProtocolStateTracker,
  serializeProtocolMessage,
} from '../scripts/integration/lib/protocol.ts';
import {
  globalProcessRegistry,
  ProcessRegistry,
  resetProcessRegistryForTests,
} from '../scripts/integration/lib/process-registry.ts';
import {
  detectRedactionViolations,
  safeSerializeForEvidence,
  serializePublicFailure,
} from '../scripts/integration/lib/redaction.ts';
import {
  assertExactSigkillProof,
  assertFlockReadyBeforeContender,
  assertHeldLockCode,
  assertMatchingContentConfirmations,
  assertReadConfirmationMatches,
  assertReadyBeforeContender,
  assertScenarioBDenialsComplete,
  assertWriteConfirmationMatches,
  assertWriteReadBeforeKill,
} from '../scripts/integration/lib/scenario-orchestration.ts';
import {
  buildHarnessCompositionInput,
  buildHarnessMemoryAccess,
  buildHarnessReadRequest,
  buildHarnessWriteCommand,
  fixedHarnessClock,
} from '../scripts/integration/lib/harness-config.ts';
import {
  harnessContentSha256,
  HARNESS_CONTENT,
} from '../scripts/integration/lib/harness-content.ts';
import {
  buildGateScenarioSteps,
  runScenarios,
  type RunScenariosHooks,
} from '../scripts/integration/durable-composition-linux-gate.ts';
import {
  assertExactGateScenarioStepKeys,
  computePendingEventWaitersCleared,
  runFailFastScenarioSteps,
} from '../scripts/integration/lib/scenario-fail-fast.ts';
import {
  runScenarioGColdRoot,
  type ScenarioGColdRootDeps,
} from '../scripts/integration/lib/scenario-g-cold-root.ts';
import type { ChildSessionHandle } from '../scripts/integration/lib/child-runner.ts';
import type { ChildStartupDiagnostics } from '../scripts/integration/lib/child-stderr.ts';
import { toPosix } from '../scripts/lib/boundary-checker.mjs';

const fakeStartupDiagnostics = (
  exitCode: number | null = 0,
  protocolEventCount = 0,
): ChildStartupDiagnostics => ({
  diagnosticClass: 'CHILD_LIFECYCLE',
  exitCode,
  protocolEventCount,
  stderrTruncated: false,
  stderrSummary: '',
});

const gateFixture = () => ({
  gitHead: 'abc',
  packageLockSha256: 'def',
  osId: 'ubuntu',
  osVersionId: '24.04',
  architecture: 'x64',
  libc: 'glibc 2.39',
  libcFamily: 'glibc',
  libcVersion: '2.39',
  nodeVersion: '22.13.0',
  npmVersion: '10.9.2',
  filesystemType: 'ext4',
  localVerified: true,
  networkIsolationVerified: true,
  nonRootUserVerified: true,
  overlayFilesystem: false,
});

const contentHash = harnessContentSha256();

const linuxFacts = (overrides: Partial<ChildGateRuntimeFacts> = {}): ChildGateRuntimeFacts => ({
  platform: 'linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  readGitHead: () => execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  readPackageLockSha: (path) => hashPackageLock(path),
  validateRoot: () => ({ ok: true }),
  ...overrides,
});

const baseChildEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  [GATE_OPT_IN_ENV]: '1',
  [GATE_EXPECTED_HEAD_ENV]: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  [GATE_EXPECTED_LOCK_SHA256_ENV]: hashPackageLock(join(process.cwd(), 'package-lock.json')),
  OPENCLAW_B3C4_RUN_ID: generateRunId(),
  OPENCLAW_B3C4_ROLE: 'normal',
  OPENCLAW_B3C4_PROTOCOL_VERSION: '1',
  OPENCLAW_B3C4_STORAGE_ROOT: '/tmp/openclaw-b3c4-test/storage',
  OPENCLAW_B3C4_STORAGE_REALPATH: '/tmp/openclaw-b3c4-test/storage',
  OPENCLAW_B3C4_STORAGE_DEV: '1',
  OPENCLAW_B3C4_STORAGE_INODE: '2',
  OPENCLAW_B3C4_EXECUTION_ROOT: '/tmp/openclaw-b3c4-test',
  OPENCLAW_B3C4_EXECUTION_REALPATH: '/tmp/openclaw-b3c4-test',
  OPENCLAW_B3C4_EXECUTION_DEV: '1',
  OPENCLAW_B3C4_EXECUTION_INODE: '1',
  OPENCLAW_B3C4_MARKER_DEV: '1',
  OPENCLAW_B3C4_MARKER_INODE: '3',
  OPENCLAW_B3C4_PARENT_CAPABILITY: generateParentCapability(),
  OPENCLAW_B3C4_REPOSITORY_ROOT: process.cwd(),
  OPENCLAW_B3C4_EXPECTED_UID: '1000',
  OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH: '/tmp/openclaw-b3c4-test-parent',
  ...overrides,
});

const flockWaitEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv =>
  baseChildEnv({
    OPENCLAW_B3C4_ROLE: 'flock-wait',
    ...overrides,
  });

const expectedContent = {
  recordId: 'record-1',
  ownerId: 'owner-1',
  namespace: 'personal',
  contentSha256: contentHash,
};

const msg = (
  event: string,
  detail?: Record<string, string>,
  errorCode?: string,
): {
  v: 1;
  runId: string;
  role: 'holder';
  event: 'READY';
  pid: number;
  detail?: Record<string, string>;
  errorCode?: string;
} => ({
  v: 1 as const,
  runId: 'run',
  role: 'holder' as const,
  event: event as 'READY',
  pid: 1,
  ...(detail !== undefined ? { detail } : {}),
  ...(errorCode !== undefined ? { errorCode } : {}),
});

const perfectCleanup = {
  childrenTerminated: true,
  executionRootOwnershipVerified: true,
  storageRootOwnershipVerified: true,
  disposableRootRemoved: true,
  noOrphans: true,
  interruptedBySignal: false,
  pendingEventWaitersCleared: true,
};

let mockGateRunId = 'run';

const mockGateOwnership = (): DisposableRootOwnership => {
  const base = join(tmpdir(), `openclaw-b3c4-test-${generateRunId()}`);
  return {
    runId: generateRunId(),
    capability: generateParentCapability(),
    capabilityHash: 'mock-capability-hash',
    executionRootPath: base,
    realExecutionRootPath: base,
    executionInode: 1,
    executionDevice: 1,
    storageRootPath: join(base, 'storage'),
    realStorageRootPath: join(base, 'storage'),
    storageInode: 2,
    storageDevice: 1,
    markerInode: 3,
    markerDevice: 1,
    parentRealPath: tmpdir(),
    uid: 1000,
    homePath: join(base, 'home'),
    tmpPath: join(base, 'tmp'),
  };
};

const passingScenarioBOrchestrationImpl: typeof runScenarioBOrchestration = (
  _session,
  _ids,
  expected,
) => {
  const writeDetail = buildWriteConfirmationDetail({
    recordId: expected.recordId,
    ownerId: expected.ownerId,
    namespace: expected.namespace,
    writtenContent: HARNESS_CONTENT,
    expectedContentSha256: expected.contentSha256,
  });
  if (!writeDetail.ok) {
    return Promise.resolve({ pass: false, detail: writeDetail.reason, steps: [], messages: [] });
  }
  const readDetail = buildReadConfirmationFromRecord(
    {
      id: expected.recordId,
      namespace: expected.namespace,
      content: HARNESS_CONTENT,
      provenance: { initiatedBy: expected.ownerId },
    },
    expected,
  );
  if (!readDetail.ok) {
    return Promise.resolve({ pass: false, detail: readDetail.reason, steps: [], messages: [] });
  }
  const baseMessage = {
    v: 1 as const,
    runId: mockGateRunId,
    role: 'holder' as const,
    pid: 1,
  };
  return Promise.resolve({
    pass: true,
    steps: [
      'READY',
      'SEND_WRITE',
      'WRITE_CONFIRMED',
      'SEND_READ_LEGIT_1',
      'READ_CONFIRMED_1',
      'SEND_OWNER_MISMATCH',
      'OWNER_MISMATCH',
      'SEND_NAMESPACE_ISOLATED',
      'NAMESPACE_ISOLATED',
      'SEND_READ_LEGIT_2',
      'READ_CONFIRMED_2',
      'SEND_CLOSE',
      'CLOSED',
      'EXIT_0',
    ],
    messages: [
      { ...baseMessage, event: 'WRITE_CONFIRMED', detail: writeDetail.detail },
      { ...baseMessage, event: 'READ_CONFIRMED', detail: readDetail.detail },
      { ...baseMessage, event: 'READ_CONFIRMED', detail: readDetail.detail },
      {
        ...baseMessage,
        event: 'READ_REJECTED',
        errorCode: 'POLICY_DENIED',
        detail: {
          authorizationCode: 'OWNER_MISMATCH',
          proofType: 'OWNER_MISMATCH',
          domainCode: 'POLICY_DENIED',
        },
      },
      {
        ...baseMessage,
        event: 'READ_REJECTED',
        errorCode: 'POLICY_DENIED',
        detail: {
          authorizationCode: 'NAMESPACE_ISOLATED',
          proofType: 'NAMESPACE_ISOLATED',
          domainCode: 'POLICY_DENIED',
        },
      },
    ],
  });
};

const PERSISTED_RECORD_ID = 'harness-persisted-record';
const PERSISTED_OWNER_ID = 'harness-owner';

const recordScenarioForTests = (
  evidence: ReturnType<typeof createInitialEvidence>,
  key: string,
  result: { verdict: 'PASS' | 'FAIL' | 'SKIP'; detail?: string },
) => ({
  ...evidence,
  scenarios: { ...evidence.scenarios, [key]: result },
});

const allPassScenarios = (): Record<string, { verdict: 'PASS' }> =>
  Object.fromEntries(REQUIRED_SCENARIO_KEYS.map((key) => [key, { verdict: 'PASS' as const }]));

describe('tsconfig boundary flags', () => {
  it('root tsconfig does not enable allowImportingTsExtensions', () => {
    const root = JSON.parse(readFileSync(join(process.cwd(), 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { allowImportingTsExtensions?: boolean };
    };
    expect(root.compilerOptions?.allowImportingTsExtensions).not.toBe(true);
  });

  it('integration tsconfig enables allowImportingTsExtensions', () => {
    const integration = JSON.parse(
      readFileSync(join(process.cwd(), 'tsconfig.integration.json'), 'utf8'),
    ) as { compilerOptions?: { allowImportingTsExtensions?: boolean } };
    expect(integration.compilerOptions?.allowImportingTsExtensions).toBe(true);
  });
});

describe('protocol parsing and ordering', () => {
  const baseMessage = {
    v: 1 as const,
    runId: 'abc123',
    role: 'holder' as const,
    event: 'READY' as const,
    pid: 1000,
  };

  it('parses valid protocol JSON', () => {
    const line = serializeProtocolMessage(baseMessage).trim();
    expect(parseProtocolLine(line, 'abc123', 'holder').ok).toBe(true);
  });

  it('parses READ_REJECTED with authorization detail', () => {
    const line = serializeProtocolMessage({
      ...baseMessage,
      event: 'READ_REJECTED',
      errorCode: 'POLICY_DENIED',
      detail: {
        recordId: 'r1',
        ownerId: 'o1',
        namespace: 'personal',
        expectedOwnerId: 'foreign',
        expectedNamespace: 'personal',
        authorizationCode: 'OWNER_MISMATCH',
        proofType: 'OWNER_MISMATCH',
        domainCode: 'POLICY_DENIED',
      },
    }).trim();
    expect(parseProtocolLine(line, 'abc123', 'holder').ok).toBe(true);
  });

  it('parses READ command with expectedOwnerId mismatch fields', () => {
    const parsed = parseParentCommandLine(
      JSON.stringify({
        v: 1,
        command: 'READ',
        ownerId: 'owner-a',
        namespace: 'personal',
        recordId: 'rec-1',
        expectedOwnerId: 'owner-b',
        expectedNamespace: 'ai-my-time',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.command === 'READ') {
      expect(parsed.value.expectedOwnerId).toBe('owner-b');
      expect(parsed.value.expectedNamespace).toBe('ai-my-time');
    }
  });

  it('rejects invalid JSON', () => {
    expect(parseProtocolLine('{bad', 'abc123', 'holder').ok).toBe(false);
  });

  it('rejects wrong schema version', () => {
    const line = JSON.stringify({ ...baseMessage, v: 2 });
    expect(parseProtocolLine(line, 'abc123', 'holder')).toMatchObject({
      ok: false,
      error: 'WRONG_VERSION',
    });
  });

  it('rejects wrong runId', () => {
    const line = serializeProtocolMessage(baseMessage).trim();
    expect(parseProtocolLine(line, 'other', 'holder')).toMatchObject({
      ok: false,
      error: 'WRONG_RUN_ID',
    });
  });

  it('rejects oversized protocol lines', () => {
    const huge = 'a'.repeat(MAX_PROTOCOL_LINE_BYTES + 1);
    expect(parseProtocolLine(huge, 'abc123', 'holder')).toMatchObject({
      ok: false,
      error: 'LINE_TOO_LONG',
    });
  });

  it('rejects duplicate terminal events', () => {
    const tracker = new ProtocolStateTracker();
    expect(tracker.validateOrder('CLOSED')).toBeNull();
    expect(tracker.validateOrder('FAILED')).toBe('DUPLICATE_TERMINAL');
  });

  it('rejects invalid event order', () => {
    const tracker = new ProtocolStateTracker();
    tracker.validateOrder('READY');
    expect(tracker.validateOrder('READY')).toBe('OUT_OF_ORDER');
  });

  it('allows READ_REJECTED after READY without terminal', () => {
    const tracker = new ProtocolStateTracker();
    tracker.validateOrder('READY');
    expect(tracker.validateOrder('READ_REJECTED')).toBeNull();
    expect(tracker.hasTerminal()).toBe(false);
  });

  it('maps HELD to lock contention exit code', () => {
    expect(mapEventToExpectedExit('HELD')).toBe(EXIT_LOCK_CONTENTION);
    expect(mapEventToExpectedExit('CLOSED')).toBe(EXIT_SUCCESS);
    expect(mapEventToExpectedExit('READ_REJECTED')).toBe(EXIT_SUCCESS);
  });
});

describe('child environment sanitization', () => {
  it('excludes injected secret variables', () => {
    const parentEnv = {
      PATH: '/usr/bin',
      TELEGRAM_BOT_TOKEN: 'secret-token',
      OPENAI_API_KEY: 'secret-key',
      OPENCLAW_B3C4_RUN_ID: 'run',
    };
    const childEnv = buildChildEnvironment(parentEnv, {
      OPENCLAW_B3C4_RUN_ID: 'run',
      OPENCLAW_B3C4_ROLE: 'holder',
    });
    const leaks = childEnvironmentContainsSecret(childEnv, {
      TELEGRAM_BOT_TOKEN: 'secret-token',
      OPENAI_API_KEY: 'secret-key',
    });
    expect(leaks).toEqual([]);
    expect(childEnv['TELEGRAM_BOT_TOKEN']).toBeUndefined();
    expect(childEnv['OPENAI_API_KEY']).toBeUndefined();
  });

  it('passes expanded storage execution and marker env vars when allowlisted', () => {
    const childEnv = buildChildEnvironment(
      {},
      {
        OPENCLAW_B3C4_STORAGE_ROOT: '/tmp/x/storage',
        OPENCLAW_B3C4_STORAGE_REALPATH: '/tmp/x/storage',
        OPENCLAW_B3C4_STORAGE_DEV: '1',
        OPENCLAW_B3C4_STORAGE_INODE: '2',
        OPENCLAW_B3C4_EXECUTION_ROOT: '/tmp/x',
        OPENCLAW_B3C4_EXECUTION_REALPATH: '/tmp/x',
        OPENCLAW_B3C4_EXECUTION_DEV: '1',
        OPENCLAW_B3C4_EXECUTION_INODE: '1',
        OPENCLAW_B3C4_MARKER_DEV: '1',
        OPENCLAW_B3C4_MARKER_INODE: '9',
      },
    );
    expect(childEnv['OPENCLAW_B3C4_STORAGE_ROOT']).toBe('/tmp/x/storage');
    expect(childEnv['OPENCLAW_B3C4_EXECUTION_ROOT']).toBe('/tmp/x');
    expect(childEnv['OPENCLAW_B3C4_MARKER_INODE']).toBe('9');
  });

  it('rejects NODE_OPTIONS even if allowlisted', () => {
    expect(isSecretEnvKey('NODE_OPTIONS')).toBe(true);
    const childEnv = buildChildEnvironment(
      { NODE_OPTIONS: '--require evil' },
      {
        OPENCLAW_B3C4_RUN_ID: 'run',
      },
    );
    expect(childEnv['NODE_OPTIONS']).toBeUndefined();
  });

  it('rejects LD_PRELOAD', () => {
    const childEnv = buildChildEnvironment(
      { LD_PRELOAD: '/evil.so' },
      {
        OPENCLAW_B3C4_RUN_ID: 'run',
      },
    );
    expect(childEnv['LD_PRELOAD']).toBeUndefined();
  });

  it('rejects proxy environment variables', () => {
    const childEnv = buildChildEnvironment(
      { HTTP_PROXY: 'http://proxy', HTTPS_PROXY: 'http://proxy', ALL_PROXY: 'http://proxy' },
      { OPENCLAW_B3C4_RUN_ID: 'run' },
    );
    expect(childEnv['HTTP_PROXY']).toBeUndefined();
    expect(childEnv['HTTPS_PROXY']).toBeUndefined();
    expect(childEnv['ALL_PROXY']).toBeUndefined();
  });

  it('rejects NODE_PATH, LD_LIBRARY_PATH, NPM_CONFIG and generic secrets', () => {
    const childEnv = buildChildEnvironment(
      {
        NODE_PATH: '/evil',
        LD_LIBRARY_PATH: '/evil',
        NPM_CONFIG_CACHE: '/evil',
        API_KEY: 'x',
        GENERIC_TOKEN: 'y',
        MY_SECRET: 'z',
      },
      { OPENCLAW_B3C4_RUN_ID: 'run' },
    );
    expect(childEnv['NODE_PATH']).toBeUndefined();
    expect(childEnv['LD_LIBRARY_PATH']).toBeUndefined();
    expect(childEnv['NPM_CONFIG_CACHE']).toBeUndefined();
    expect(childEnv['API_KEY']).toBeUndefined();
    expect(childEnv['GENERIC_TOKEN']).toBeUndefined();
    expect(childEnv['MY_SECRET']).toBeUndefined();
  });
});

describe('environment gate classifications', () => {
  beforeEach(() => {
    resetProductionFactoryLoadedForTests();
  });

  it('classifies missing opt-in as GATE_OPT_IN_MISSING', () => {
    const result = runEnvironmentGate({}, process.cwd());
    expect(result.classification).toBe('GATE_OPT_IN_MISSING');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('classifies missing expectations as GATE_EXPECTATION_MISSING', () => {
    const result = runEnvironmentGate({ [GATE_OPT_IN_ENV]: '1' }, process.cwd());
    expect(result.classification).toBe('GATE_EXPECTATION_MISSING');
  });

  it('rejects wrong git head without loading production', () => {
    const lock = hashPackageLock(join(process.cwd(), 'package-lock.json'));
    const result = runEnvironmentGate(
      {
        [GATE_OPT_IN_ENV]: '1',
        [GATE_EXPECTED_HEAD_ENV]: 'deadbeef',
        [GATE_EXPECTED_LOCK_SHA256_ENV]: lock,
      },
      process.cwd(),
    );
    expect(result.classification).toBe('GIT_HEAD_MISMATCH');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('rejects wrong lock hash', () => {
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const result = runEnvironmentGate(
      {
        [GATE_OPT_IN_ENV]: '1',
        [GATE_EXPECTED_HEAD_ENV]: head,
        [GATE_EXPECTED_LOCK_SHA256_ENV]: '0'.repeat(64),
      },
      process.cwd(),
    );
    expect(result.classification).toBe('PACKAGE_LOCK_MISMATCH');
  });

  it('classifies unsupported platform on Windows host facts', () => {
    if (process.platform === 'linux') return;
    const lock = hashPackageLock(join(process.cwd(), 'package-lock.json'));
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const result = runEnvironmentGate(
      {
        [GATE_OPT_IN_ENV]: '1',
        [GATE_EXPECTED_HEAD_ENV]: head,
        [GATE_EXPECTED_LOCK_SHA256_ENV]: lock,
      },
      process.cwd(),
    );
    expect(result.classification).toBe('UNSUPPORTED_PLATFORM');
  });
});

describe('filesystem detection from /proc/mounts', () => {
  const overlayRootOnly = 'overlay / overlay rw,relatime 0 0\n';
  const layeredMounts = [
    'overlay / overlay rw,relatime 0 0',
    'tmpfs /tmp tmpfs rw,nosuid,nodev 0 0',
    'ext4 /tmp/specific ext4 rw,relatime 0 0',
  ].join('\n');

  it('matches root overlay for authoritative Docker tmpdir regression', () => {
    const result = detectFilesystemFromMounts('/tmp/openclaw-b3c4c', overlayRootOnly);
    expect(result.matchedMountPoint).toBe('/');
    expect(result.type).toBe('overlay');
    expect(result.localVerified).toBe(true);
    expect(result.overlayFilesystem).toBe(true);
    expect(result.type).not.toBe('unknown');
  });

  it('would fail root regression with legacy startsWith("//") matching', () => {
    const candidate = '/tmp/openclaw-b3c4c';
    const legacyRootMatch = (path: string, mountPoint: string): boolean =>
      path === mountPoint || path.startsWith(`${mountPoint}/`);
    expect(legacyRootMatch(candidate, '/')).toBe(false);
    expect(isPathWithinMount(candidate, '/')).toBe(true);
  });

  it('matches exact root path to overlay', () => {
    const result = detectFilesystemFromMounts('/', overlayRootOnly);
    expect(result.matchedMountPoint).toBe('/');
    expect(result.type).toBe('overlay');
    expect(result.localVerified).toBe(true);
  });

  it('selects longest matching mount prefix', () => {
    expect(detectFilesystemFromMounts('/var/data', layeredMounts)).toEqual({
      type: 'overlay',
      localVerified: true,
      overlayFilesystem: true,
      matchedMountPoint: '/',
    });
    expect(detectFilesystemFromMounts('/tmp/file', layeredMounts)).toEqual({
      type: 'tmpfs',
      localVerified: true,
      overlayFilesystem: false,
      matchedMountPoint: '/tmp',
    });
    expect(detectFilesystemFromMounts('/tmp/specific/file', layeredMounts)).toEqual({
      type: 'ext4',
      localVerified: true,
      overlayFilesystem: false,
      matchedMountPoint: '/tmp/specific',
    });
  });

  it('enforces path-component boundaries', () => {
    expect(isPathWithinMount('/tmp-other', '/tmp')).toBe(false);
    expect(isPathWithinMount('/var/tmp/a', '/tmp')).toBe(false);
    expect(detectFilesystemFromMounts('/tmp-other', layeredMounts).matchedMountPoint).toBe('/');
    expect(isPathWithinMount('/tmp/a', '/tmp')).toBe(true);
    expect(isPathWithinMount('/tmp', '/tmp')).toBe(true);
  });

  it('normalizes trailing slashes on mount points', () => {
    expect(normalizeMountPoint('/tmp/')).toBe('/tmp');
    expect(normalizeMountPoint('/')).toBe('/');
    const mounts = 'tmpfs /tmp/ tmpfs rw,nosuid,nodev 0 0\n';
    expect(detectFilesystemFromMounts('/tmp/a', mounts).matchedMountPoint).toBe('/tmp');
  });

  it('decodes escaped mount paths from /proc/mounts', () => {
    const encoded = '/path\\040with\\040space';
    expect(unescapeProcMountsPath(encoded)).toBe('/path with space');
    const mounts = 'ext4 /path\\040with\\040space ext4 rw,relatime 0 0\n';
    expect(detectFilesystemFromMounts('/path with space/file', mounts)).toEqual({
      type: 'ext4',
      localVerified: true,
      overlayFilesystem: false,
      matchedMountPoint: '/path with space',
    });
  });

  it('fails closed for relative, empty, and malformed inputs', () => {
    expect(isPathWithinMount('tmp/a', '/')).toBe(false);
    expect(detectFilesystemFromMounts('tmp/a', overlayRootOnly).type).toBe('unknown');
    expect(detectFilesystemFromMounts('', overlayRootOnly).type).toBe('unknown');
    expect(parseProcMounts('not-a-mount-line')).toEqual([]);
    expect(detectFilesystemFromMounts('/tmp', 'bad line\n')).toEqual({
      type: 'unknown',
      localVerified: false,
      overlayFilesystem: false,
      matchedMountPoint: null,
    });
  });

  it('applies production local-filesystem policy for overlay and rejected types', () => {
    const overlay = detectFilesystemFromMounts('/tmp/x', overlayRootOnly);
    expect(overlay.localVerified).toBe(true);
    expect(isRejectedFilesystemType(overlay.type)).toBe(false);

    const nfsMounts = 'nfs4 / nfs4 rw,relatime 0 0\n';
    const nfs = detectFilesystemFromMounts('/var', nfsMounts);
    expect(nfs.type).toBe('nfs4');
    expect(nfs.localVerified).toBe(false);
    expect(isRejectedFilesystemType(nfs.type)).toBe(true);
  });

  it('rejects mutation-prone matching strategies', () => {
    const candidate = '/tmp/openclaw-b3c4c';
    const rootOnly = '/';
    expect(candidate.startsWith(`${rootOnly}/`)).toBe(false);
    expect(isPathWithinMount(candidate, rootOnly)).toBe(true);
    expect(isPathWithinMount('/tmp-other', '/tmp')).toBe(false);
    expect(normalizeMountPoint('/')).toBe('/');
    expect(normalizeMountPoint('')).toBeNull();
    const firstMatch = parseProcMounts(layeredMounts)[0];
    expect(firstMatch?.mountPoint).toBe('/');
    expect(
      detectFilesystemFromMounts('/tmp/specific/file', layeredMounts).matchedMountPoint,
    ).not.toBe(firstMatch?.mountPoint);
  });
});

describe('child gate fail-closed with injectable facts', () => {
  beforeEach(() => {
    resetProductionFactoryLoadedForTests();
    injectProductionFactoryLoaderForTests(() => Promise.reject(new Error('factory must not load')));
  });

  it('rejects missing capability without loading factory', () => {
    const env = baseChildEnv();
    delete env['OPENCLAW_B3C4_PARENT_CAPABILITY'];
    const result = runChildGate(env, linuxFacts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_CHILD_ENV');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('rejects flock-wait with wrong git HEAD before returning success', () => {
    const result = runChildGate(
      flockWaitEnv({
        [GATE_EXPECTED_HEAD_ENV]: '0'.repeat(40),
      }),
      linuxFacts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('GIT_HEAD_MISMATCH');
  });

  it('rejects flock-wait with wrong package-lock hash', () => {
    const result = runChildGate(
      flockWaitEnv({
        [GATE_EXPECTED_LOCK_SHA256_ENV]: '0'.repeat(64),
      }),
      linuxFacts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('PACKAGE_LOCK_MISMATCH');
  });

  it('rejects flock-wait without capability', () => {
    const env = flockWaitEnv();
    delete env['OPENCLAW_B3C4_PARENT_CAPABILITY'];
    const result = runChildGate(env, linuxFacts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_CHILD_ENV');
  });

  it('rejects flock-wait without repository root', () => {
    const env = flockWaitEnv();
    delete env['OPENCLAW_B3C4_REPOSITORY_ROOT'];
    const result = runChildGate(env, linuxFacts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_CHILD_ENV');
  });

  it('allows flock-wait after HEAD and lock checks with injected linux facts', () => {
    const result = runChildGate(flockWaitEnv(), linuxFacts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storageRoot).toBe('');
      expect(result.executionRoot).toBe('');
      expect(result.repositoryRoot).toBe(process.cwd());
    }
  });

  it('rejects unknown role without loading factory', () => {
    const result = runChildGate(baseChildEnv({ OPENCLAW_B3C4_ROLE: 'evil-role' }), linuxFacts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNKNOWN_ROLE');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('rejects invalid capability hash without loading factory', () => {
    const result = runChildGate(
      baseChildEnv({ OPENCLAW_B3C4_PARENT_CAPABILITY: 'short' }),
      linuxFacts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('INVALID_CAPABILITY');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('never loads factory when gate fails on any platform', () => {
    const result = runChildGate(baseChildEnv({ OPENCLAW_B3C4_ROLE: 'evil-role' }));
    expect(result.ok).toBe(false);
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('passes marker inode/device into root validator', () => {
    let seenInode: number | null = null;
    let seenDev: number | null = null;
    const result = runChildGate(
      baseChildEnv({
        OPENCLAW_B3C4_MARKER_INODE: '42',
        OPENCLAW_B3C4_MARKER_DEV: '7',
      }),
      linuxFacts({
        validateRoot: (input) => {
          seenInode = input.expectedMarkerInode;
          seenDev = input.expectedMarkerDev;
          return { ok: false, reason: 'MARKER_INODE_DEV' };
        },
      }),
    );
    expect(seenInode).toBe(42);
    expect(seenDev).toBe(7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MARKER_INODE_DEV');
    expect(wasProductionFactoryLoaded()).toBe(false);
  });

  it('rejects forged marker content via validator reason', () => {
    const result = runChildGate(
      baseChildEnv(),
      linuxFacts({
        validateRoot: () => ({ ok: false, reason: 'MARKER_PARSE' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MARKER_PARSE');
  });

  it('rejects wrong execution-root inode via validator', () => {
    const result = runChildGate(
      baseChildEnv(),
      linuxFacts({
        validateRoot: () => ({ ok: false, reason: 'EXECUTION_INODE_DEV' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXECUTION_INODE_DEV');
  });

  it('rejects wrong storage-root device via validator', () => {
    const result = runChildGate(
      baseChildEnv(),
      linuxFacts({
        validateRoot: () => ({ ok: false, reason: 'STORAGE_INODE_DEV' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('STORAGE_INODE_DEV');
  });

  it('uses default facts platform from process without vacuous skip', () => {
    const facts = defaultChildGateRuntimeFacts();
    expect(facts.platform).toBe(process.platform);
  });
});

describe('content confirmation from actual payload', () => {
  it('hashes actual content and rejects claimed hash for corrupted payload', () => {
    const ok = buildReadConfirmationFromRecord(
      {
        id: 'record-1',
        namespace: 'personal',
        content: HARNESS_CONTENT,
        provenance: { initiatedBy: 'owner-1' },
      },
      expectedContent,
    );
    expect(ok.ok).toBe(true);
    const bad = buildReadConfirmationFromRecord(
      {
        id: 'record-1',
        namespace: 'personal',
        content: 'corrupted-payload',
        provenance: { initiatedBy: 'owner-1' },
      },
      expectedContent,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('READ_CONTENT_HASH_MISMATCH');
  });

  it('rejects wrong recordId owner namespace even when hash matches', () => {
    expect(
      buildReadConfirmationFromRecord(
        {
          id: 'wrong-id',
          namespace: 'personal',
          content: HARNESS_CONTENT,
          provenance: { initiatedBy: 'owner-1' },
        },
        expectedContent,
      ).ok,
    ).toBe(false);
    expect(
      buildReadConfirmationFromRecord(
        {
          id: 'record-1',
          namespace: 'personal',
          content: HARNESS_CONTENT,
          provenance: { initiatedBy: 'other-owner' },
        },
        expectedContent,
      ).ok,
    ).toBe(false);
    expect(
      buildReadConfirmationFromRecord(
        {
          id: 'record-1',
          namespace: 'ai-my-time',
          content: HARNESS_CONTENT,
          provenance: { initiatedBy: 'owner-1' },
        },
        expectedContent,
      ).ok,
    ).toBe(false);
  });

  it('builds write confirmation from written content identity', () => {
    const confirmation = buildWriteConfirmationDetail({
      recordId: 'record-1',
      ownerId: 'owner-1',
      namespace: 'personal',
      writtenContent: HARNESS_CONTENT,
    });
    expect(confirmation.ok).toBe(true);
    if (confirmation.ok) {
      expect(confirmation.detail.contentSha256).toBe(contentHash);
      expect(confirmation.detail.contentSha256).toBe(sha256Utf8(HARNESS_CONTENT));
    }
  });

  it('parses LocalHost POLICY_DENIED authorization codes from reason', () => {
    expect(
      parseAuthorizationFailureCode(
        'POLICY_DENIED',
        'OWNER_MISMATCH: Target belongs to another owner.',
      ),
    ).toBe('OWNER_MISMATCH');
    expect(
      parseAuthorizationFailureCode(
        'POLICY_DENIED',
        'NAMESPACE_ISOLATED: Personal memory is isolated from projects.',
      ),
    ).toBe('NAMESPACE_ISOLATED');
    expect(
      parseAuthorizationFailureCode(
        'VALIDATION_FAILED',
        'Memory record not found in ephemeral local store.',
      ),
    ).toBeNull();
  });
});

describe('disposable root dual-layout safety', () => {
  it('refuses unsafe root removal', () => {
    expect(refuseUnsafeRootRemoval('/')).toBe(true);
    expect(refuseUnsafeRootRemoval(tmpdir())).toBe(true);
    expect(refuseUnsafeRootRemoval('/tmp/openclaw-b3c4-safe')).toBe(false);
  });

  it('creates execution root with nested storage/home/tmp when uid matches', () => {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    if (process.platform === 'win32') {
      // Windows fs uid semantics differ; layout helpers still unit-tested below.
      expect(validateStorageRootAllowlist('/nonexistent')).toBe(false);
      return;
    }
    const ownership = createDisposableRoot(uid, process.cwd());
    expect(ownership.executionRootPath).toContain('openclaw-b3c4-');
    expect(
      ownership.storageRootPath.endsWith('/storage') ||
        ownership.storageRootPath.endsWith('\\storage'),
    ).toBe(true);
    expect(ownership.homePath.endsWith('/home') || ownership.homePath.endsWith('\\home')).toBe(
      true,
    );
    expect(ownership.tmpPath.endsWith('/tmp') || ownership.tmpPath.endsWith('\\tmp')).toBe(true);
    expect(ownership.homePath).not.toContain(ownership.storageRootPath);
    expect(validateExecutionRootAllowlist(ownership.executionRootPath)).toBe(true);
    expect(validateHomeTmpEmpty(ownership.homePath, ownership.tmpPath)).toBe(true);
    const proof = validateRemovalProof(ownership, process.cwd());
    expect(proof.prefixOk).toBe(true);
    expect(proof.markerOk).toBe(true);
    expect(proof.markerInodeOk).toBe(true);
    expect(proof.storageValidated).toBe(true);
    const removal = removeDisposableRoot(ownership, process.cwd());
    expect(removal.removed).toBe(true);
  });
});

const validationInputFromOwnership = (
  ownership: DisposableRootOwnership,
  overrides: Partial<ChildRootValidationInput> = {},
): ChildRootValidationInput => ({
  storageRoot: ownership.storageRootPath,
  expectedStorageRealpath: ownership.realStorageRootPath,
  expectedStorageDev: ownership.storageDevice,
  expectedStorageInode: ownership.storageInode,
  executionRoot: ownership.executionRootPath,
  expectedExecutionRealpath: ownership.realExecutionRootPath,
  expectedExecutionDev: ownership.executionDevice,
  expectedExecutionInode: ownership.executionInode,
  expectedMarkerDev: ownership.markerDevice,
  expectedMarkerInode: ownership.markerInode,
  expectedRunId: ownership.runId,
  capability: ownership.capability,
  repositoryRoot: process.cwd(),
  expectedUid: ownership.uid,
  expectedDisposableParentRealpath: ownership.parentRealPath,
  ...overrides,
});

describe('child disposable parent validation', () => {
  const supportsPosixFs = process.platform !== 'win32';

  it('allowlists only the explicit disposable parent env key', () => {
    expect(CHILD_ENV_ALLOWLIST).toContain('OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH');
    const disposableKeys = (CHILD_ENV_ALLOWLIST as readonly string[]).filter((key) =>
      key.includes('DISPOSABLE'),
    );
    expect(disposableKeys).toEqual(['OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH']);
  });

  it('rejects component-boundary prefix collisions', () => {
    expect(isExecutionRootUnderDisposableParent('/tmp/base/run', '/tmp/base')).toBe(true);
    expect(isExecutionRootUnderDisposableParent('/tmp/base-other/run', '/tmp/base')).toBe(false);
    expect(isExecutionRootUnderDisposableParent('/tmp/base', '/tmp/base')).toBe(false);
  });

  it('resolves only absolute canonical existing parent directories', () => {
    expect(resolveDisposableParentRealpath('relative/parent').ok).toBe(false);
    expect(resolveDisposableParentRealpath('/definitely-missing-openclaw-parent').ok).toBe(false);
    if (!supportsPosixFs) return;
    const ownership = createDisposableRoot(
      typeof process.getuid === 'function' ? process.getuid() : 0,
      process.cwd(),
    );
    const resolved = resolveDisposableParentRealpath(ownership.parentRealPath);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.parentReal).toBe(ownership.parentRealPath);
    removeDisposableRoot(ownership, process.cwd());
  });

  it('passes production validation when parent is creation-time path and child TMPDIR is nested', () => {
    if (!supportsPosixFs) return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const ownership = createDisposableRoot(uid, process.cwd());
    const input = validationInputFromOwnership(ownership);
    expect(validateChildDisposableRoot(input).ok).toBe(true);
    expect(input.expectedDisposableParentRealpath).toBe(ownership.parentRealPath);
    expect(ownership.tmpPath).toBe(join(ownership.executionRootPath, 'tmp'));
    expect(validateChildDisposableRoot(input).ok).toBe(true);
    removeDisposableRoot(ownership, process.cwd());
  });

  it('reproduces EXECUTION_PARENT when disposable parent is child TMPDIR instead of creation parent', () => {
    if (!supportsPosixFs) return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const ownership = createDisposableRoot(uid, process.cwd());
    const input = validationInputFromOwnership(ownership, {
      expectedDisposableParentRealpath: ownership.tmpPath,
    });
    const result = validateChildDisposableRoot(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXECUTION_PARENT');
    removeDisposableRoot(ownership, process.cwd());
  });

  it('fails closed when explicit parent is missing from child gate env', () => {
    const env = baseChildEnv();
    delete env['OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH'];
    const result = runChildGate(env, linuxFacts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_CHILD_ENV');
  });

  it('rejects execution roots outside the explicit parent', () => {
    if (!supportsPosixFs) return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const ownership = createDisposableRoot(uid, process.cwd());
    const outsider = join(tmpdir(), `openclaw-b3c4-outsider-${generateRunId()}`);
    mkdirSync(outsider, { recursive: true, mode: 0o700 });
    chmodSync(outsider, 0o700);
    const outsiderStats = lstatSync(outsider);
    const result = validateChildDisposableRoot(
      validationInputFromOwnership(ownership, {
        executionRoot: outsider,
        expectedExecutionRealpath: outsider,
        expectedExecutionDev: outsiderStats.dev,
        expectedExecutionInode: outsiderStats.ino,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXECUTION_PARENT');
    rmSync(outsider, { recursive: true, force: true });
    removeDisposableRoot(ownership, process.cwd());
  });

  it('rejects execution root equal to parent and preserves uid/mode checks', () => {
    if (!supportsPosixFs) return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const ownership = createDisposableRoot(uid, process.cwd());
    const parentStats = lstatSync(ownership.parentRealPath);
    const equalParent = validateChildDisposableRoot(
      validationInputFromOwnership(ownership, {
        executionRoot: ownership.parentRealPath,
        expectedExecutionRealpath: ownership.parentRealPath,
        expectedExecutionDev: parentStats.dev,
        expectedExecutionInode: parentStats.ino,
      }),
    );
    expect(equalParent.ok).toBe(false);
    if (!equalParent.ok) expect(equalParent.reason).toBe('EXECUTION_PREFIX');

    const wrongUid = validateChildDisposableRoot(
      validationInputFromOwnership(ownership, { expectedUid: ownership.uid + 1 }),
    );
    expect(wrongUid.ok).toBe(false);
    if (!wrongUid.ok) expect(wrongUid.reason).toBe('EXECUTION_UID');

    removeDisposableRoot(ownership, process.cwd());
  });

  it('rejects parent symlink alias and execution symlink escape', () => {
    if (!supportsPosixFs) return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const ownership = createDisposableRoot(uid, process.cwd());
    const aliasParent = join(tmpdir(), `openclaw-b3c4-alias-${generateRunId()}`);
    symlinkSync(ownership.parentRealPath, aliasParent);
    const aliasResult = validateChildDisposableRoot(
      validationInputFromOwnership(ownership, {
        expectedDisposableParentRealpath: aliasParent,
      }),
    );
    expect(aliasResult.ok).toBe(false);
    if (!aliasResult.ok) expect(aliasResult.reason).toBe('DISPOSABLE_PARENT_REALPATH');

    const escapeLink = join(ownership.executionRootPath, 'escape-link');
    symlinkSync('/tmp', escapeLink);
    const escapeResult = validateChildDisposableRoot(
      validationInputFromOwnership(ownership, {
        executionRoot: escapeLink,
        expectedExecutionRealpath: realpathSync(escapeLink),
      }),
    );
    expect(escapeResult.ok).toBe(false);
    if (!escapeResult.ok) expect(escapeResult.reason).toBe('EXECUTION_SYMLINK');

    rmSync(aliasParent);
    rmSync(escapeLink);
    removeDisposableRoot(ownership, process.cwd());
  });

  it('passes explicit parent through child environment builder', () => {
    const parent = '/tmp/openclaw-b3c4-test-parent';
    const childEnv = buildChildEnvironment(
      {},
      {
        OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH: parent,
        OPENCLAW_B3C4_RUN_ID: generateRunId(),
        OPENCLAW_B3C4_ROLE: 'normal',
      },
      { home: '/tmp/home', tmpdir: '/tmp/base/run/tmp' },
    );
    expect(childEnv['OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH']).toBe(parent);
    expect(childEnv['TMPDIR']).toBe('/tmp/base/run/tmp');
  });
});

describe('fingerprint and redaction', () => {
  it('compares fingerprints with timestamp tolerance', () => {
    const left = fingerprintFile(__filename);
    const right = { ...left };
    expect(fingerprintsEqual(left, right)).toBe(true);
  });

  it('detects absolute path leaks in evidence', () => {
    const violations = detectRedactionViolations('failed at /home/user/secret/path');
    expect(violations).toContain('HOME_PATH');
  });

  it('detects secret value leaks', () => {
    const violations = detectRedactionViolations('error: fake-secret-123', ['fake-secret-123']);
    expect(violations).toContain('SECRET_VALUE');
  });

  it('uses safe serialization for hostile values', () => {
    const hostile = {
      get leak(): string {
        throw new Error('boom');
      },
    };
    expect(safeSerializeForEvidence(hostile)).toBe('"<unserializable>"');
  });

  it('serializes public failure without secret values', () => {
    const sample = serializePublicFailure({ code: 'DURABLE_COMPOSITION_LOCK_HELD', event: 'HELD' });
    expect(sample).toContain('DURABLE_COMPOSITION_LOCK_HELD');
    expect(detectRedactionViolations(sample, ['fake-secret']).length).toBe(0);
  });
});

describe('evidence verdict and scenario keys', () => {
  it('never prints PASS marker with failed scenario', () => {
    const evidence = finalizeEvidence(createInitialEvidence(generateRunId(), gateFixture()));
    expect(shouldPrintPassMarker(evidence)).toBe(false);
    expect(evidence.verdict).toBe('FAIL');
  });

  it('requires truthful ownership fields and no signal interrupt for PASS marker', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        executionRootOwnershipVerified: false,
      },
    });
    expect(shouldPrintPassMarker(evidence)).toBe(false);
  });

  it('rejects PASS marker when interrupted by signal', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        interruptedBySignal: true,
      },
    });
    expect(shouldPrintPassMarker(evidence)).toBe(false);
    expect(evidence.verdict).toBe('FAIL');
  });

  it('requires exact A-K scenario key set', () => {
    expect(hasExactScenarioKeySet({ A: { verdict: 'PASS' } })).toBe(false);
    expect(hasExactScenarioKeySet(allPassScenarios())).toBe(true);
  });

  it('rejects eleven scenarios with one wrong key', () => {
    const wrong = Object.fromEntries(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'Z'].map((key) => [
        key,
        { verdict: 'PASS' as const },
      ]),
    );
    expect(hasExactScenarioKeySet(wrong)).toBe(false);
  });

  it('rejects missing H and extra L', () => {
    const missingH = Object.fromEntries(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L'].map((key) => [
        key,
        { verdict: 'PASS' as const },
      ]),
    );
    expect(hasExactScenarioKeySet(missingH)).toBe(false);
  });

  it('rejects SKIP verdict for PASS eligibility', () => {
    const scenarios = {
      ...allPassScenarios(),
      B: { verdict: 'SKIP' as const },
    };
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios,
      cleanup: perfectCleanup,
    });
    expect(evidence.verdict).toBe('FAIL');
    expect(shouldPrintPassMarker(evidence)).toBe(false);
  });

  it('fails verdict when orphans remain in cleanup', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        childrenTerminated: false,
        noOrphans: false,
      },
    });
    expect(evidence.verdict).toBe('FAIL');
  });

  it('fails when storage ownership is false', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        storageRootOwnershipVerified: false,
      },
    });
    expect(evidence.verdict).toBe('FAIL');
  });
});

describe('process registry', () => {
  beforeEach(() => {
    resetProcessRegistryForTests();
  });

  it('tracks alive pids after register', () => {
    const registry = new ProcessRegistry();
    const fakeChild = { pid: 4242, exitCode: null, signalCode: null, kill: () => true } as never;
    registry.register(fakeChild);
    expect(registry.listAlivePids()).toEqual([4242]);
    expect(registry.hasAlive()).toBe(true);
  });

  it('marks exited children as not alive', () => {
    const registry = new ProcessRegistry();
    const fakeChild = { pid: 4242, exitCode: null, signalCode: null, kill: () => true } as never;
    const id = registry.register(fakeChild);
    registry.markExited(id);
    expect(registry.hasAlive()).toBe(false);
  });

  it('resets global registry for tests', () => {
    const fakeChild = { pid: 1, exitCode: null, signalCode: null, kill: () => true } as never;
    globalProcessRegistry.register(fakeChild);
    resetProcessRegistryForTests();
    expect(globalProcessRegistry.hasAlive()).toBe(false);
  });
});

describe('scenario orchestration helpers', () => {
  it('assertReadyBeforeContender validates ordering', () => {
    expect(assertReadyBeforeContender(['READY', 'CONTENDER_SPAWN'])).toBe(true);
    expect(assertReadyBeforeContender(['CONTENDER_SPAWN', 'READY'])).toBe(false);
  });

  it('assertWriteReadBeforeKill validates ordering', () => {
    expect(assertWriteReadBeforeKill(['WRITE_CONFIRMED', 'READ_CONFIRMED', 'SIGKILL'])).toBe(true);
    expect(assertWriteReadBeforeKill(['SIGKILL', 'WRITE_CONFIRMED', 'READ_CONFIRMED'])).toBe(false);
  });

  it('assertExactSigkillProof requires SIGKILL without CLOSED and rejects SIGTERM/null', () => {
    expect(
      assertExactSigkillProof({
        signal: 'SIGKILL',
        messages: [{ event: 'WRITE_CONFIRMED' }],
      }),
    ).toBe(true);
    expect(
      assertExactSigkillProof({
        signal: null,
        exitCode: 137,
        messages: [{ event: 'WRITE_CONFIRMED' }],
      }),
    ).toBe(false);
    expect(
      assertExactSigkillProof({
        signal: 'SIGTERM',
        messages: [{ event: 'WRITE_CONFIRMED' }],
      }),
    ).toBe(false);
    expect(
      assertExactSigkillProof({
        signal: 'SIGKILL',
        messages: [{ event: 'CLOSED' }],
      }),
    ).toBe(false);
  });

  it('assertMatchingContentConfirmations checks full identity detail', () => {
    const messages = [
      msg('WRITE_CONFIRMED', expectedContent),
      msg('READ_CONFIRMED', expectedContent),
    ];
    expect(assertMatchingContentConfirmations(messages, expectedContent)).toBe(true);
    expect(
      assertMatchingContentConfirmations(
        [msg('WRITE_CONFIRMED', { ...expectedContent, contentSha256: 'dead' })],
        expectedContent,
      ),
    ).toBe(false);
    expect(
      assertWriteConfirmationMatches(
        [msg('WRITE_CONFIRMED', { ...expectedContent, recordId: 'wrong' })],
        expectedContent,
      ),
    ).toBe(false);
    expect(
      assertReadConfirmationMatches(
        [msg('READ_CONFIRMED', { ...expectedContent, ownerId: 'wrong' })],
        expectedContent,
      ),
    ).toBe(false);
  });

  it('assertScenarioBDenialsComplete requires exact OWNER_MISMATCH and NAMESPACE_ISOLATED', () => {
    const messages = [
      msg('WRITE_CONFIRMED', expectedContent),
      msg('READ_CONFIRMED', expectedContent),
      msg(
        'READ_REJECTED',
        {
          ...expectedContent,
          expectedOwnerId: 'foreign-owner',
          authorizationCode: 'OWNER_MISMATCH',
          proofType: 'OWNER_MISMATCH',
          domainCode: 'POLICY_DENIED',
        },
        'POLICY_DENIED',
      ),
      msg(
        'READ_REJECTED',
        {
          ...expectedContent,
          expectedNamespace: 'ai-my-time',
          authorizationCode: 'NAMESPACE_ISOLATED',
          proofType: 'NAMESPACE_ISOLATED',
          domainCode: 'POLICY_DENIED',
        },
        'POLICY_DENIED',
      ),
      msg('READ_CONFIRMED', expectedContent),
    ];
    expect(assertScenarioBDenialsComplete(messages, expectedContent)).toBe(true);

    // missing owner deny
    expect(
      assertScenarioBDenialsComplete(
        [
          msg('WRITE_CONFIRMED', expectedContent),
          msg('READ_CONFIRMED', expectedContent),
          msg(
            'READ_REJECTED',
            {
              ...expectedContent,
              authorizationCode: 'NAMESPACE_ISOLATED',
              proofType: 'NAMESPACE_ISOLATED',
              domainCode: 'POLICY_DENIED',
            },
            'POLICY_DENIED',
          ),
          msg('READ_CONFIRMED', expectedContent),
        ],
        expectedContent,
      ),
    ).toBe(false);

    // missing namespace deny
    expect(
      assertScenarioBDenialsComplete(
        [
          msg('WRITE_CONFIRMED', expectedContent),
          msg('READ_CONFIRMED', expectedContent),
          msg(
            'READ_REJECTED',
            {
              ...expectedContent,
              authorizationCode: 'OWNER_MISMATCH',
              proofType: 'OWNER_MISMATCH',
              domainCode: 'POLICY_DENIED',
            },
            'POLICY_DENIED',
          ),
          msg('READ_CONFIRMED', expectedContent),
        ],
        expectedContent,
      ),
    ).toBe(false);

    // not-found masquerading as denial
    expect(
      assertScenarioBDenialsComplete(
        [
          msg('WRITE_CONFIRMED', expectedContent),
          msg('READ_CONFIRMED', expectedContent),
          msg(
            'READ_REJECTED',
            {
              ...expectedContent,
              authorizationCode: 'VALIDATION_FAILED',
              proofType: 'OWNER_MISMATCH',
              domainCode: 'VALIDATION_FAILED',
            },
            'VALIDATION_FAILED',
          ),
          msg(
            'READ_REJECTED',
            {
              ...expectedContent,
              authorizationCode: 'NAMESPACE_ISOLATED',
              proofType: 'NAMESPACE_ISOLATED',
              domainCode: 'POLICY_DENIED',
            },
            'POLICY_DENIED',
          ),
          msg('READ_CONFIRMED', expectedContent),
        ],
        expectedContent,
      ),
    ).toBe(false);

    // missing second legitimate read
    expect(assertScenarioBDenialsComplete(messages.slice(0, 4), expectedContent)).toBe(false);
  });

  it('assertHeldLockCode requires exact error code', () => {
    expect(
      assertHeldLockCode([
        { ...msg('HELD'), event: 'HELD', errorCode: 'DURABLE_COMPOSITION_LOCK_HELD' },
      ]),
    ).toBe(true);
    expect(assertHeldLockCode([{ ...msg('HELD'), event: 'HELD' }])).toBe(false);
  });

  it('assertFlockReadyBeforeContender validates ordering', () => {
    expect(assertFlockReadyBeforeContender(['FLOCK_READY', 'CONTENDER_SPAWN'])).toBe(true);
    expect(assertFlockReadyBeforeContender(['CONTENDER_SPAWN', 'FLOCK_READY'])).toBe(false);
  });
});

describe('flock-holder EOF state machine', () => {
  it('fails invalid JSON with exactly one fail action', () => {
    const result = flockHolderHandleCompleteLine(createFlockHolderMachine(), '{bad');
    expect(result.state.failed).toBe(true);
    expect(result.actions).toEqual([{ kind: 'fail', reason: 'INVALID_JSON' }]);
  });

  it('fails primitive array unknown command and unknown fields', () => {
    expect(flockHolderHandleCompleteLine(createFlockHolderMachine(), '1').actions[0]).toEqual({
      kind: 'fail',
      reason: 'INVALID_SCHEMA',
    });
    expect(flockHolderHandleCompleteLine(createFlockHolderMachine(), '[]').actions[0]).toEqual({
      kind: 'fail',
      reason: 'INVALID_SCHEMA',
    });
    expect(
      flockHolderHandleCompleteLine(
        createFlockHolderMachine(),
        JSON.stringify({
          v: 1,
          command: 'WRITE',
          ownerId: 'a',
          namespace: 'personal',
          recordId: 'r',
        }),
      ).actions[0],
    ).toEqual({ kind: 'fail', reason: 'UNKNOWN_COMMAND' });
    expect(
      flockHolderHandleCompleteLine(
        createFlockHolderMachine(),
        JSON.stringify({ v: 1, command: 'EXIT', extra: true }),
      ).actions[0],
    ).toEqual({ kind: 'fail', reason: 'UNKNOWN_FIELDS' });
  });

  it('fails oversized line', () => {
    const huge = `${'a'.repeat(MAX_PROTOCOL_LINE_BYTES + 1)}\n`;
    const result = flockHolderIngestChunk(createFlockHolderMachine(), huge);
    expect(result.state.failed).toBe(true);
    expect(result.actions.some((action) => action.kind === 'fail')).toBe(true);
  });

  it('fails partial EOF and empty EOF before terminal', () => {
    const partial = flockHolderIngestChunk(createFlockHolderMachine(), '{"v":1,"command":"EX');
    expect(partial.state.partialBuffer.length).toBeGreaterThan(0);
    const eofPartial = flockHolderHandleEof(partial.state);
    expect(eofPartial.actions).toEqual([{ kind: 'fail', reason: 'PARTIAL_EOF' }]);

    const emptyEof = flockHolderHandleEof(createFlockHolderMachine());
    expect(emptyEof.actions).toEqual([{ kind: 'fail', reason: 'EOF_WITHOUT_TERMINAL' }]);
  });

  it('closes on EXIT and rejects command after terminal', () => {
    const closed = flockHolderHandleCompleteLine(
      createFlockHolderMachine(),
      JSON.stringify({ v: 1, command: 'EXIT' }),
    );
    expect(closed.actions).toEqual([{ kind: 'close', command: 'EXIT' }]);
    const after = flockHolderHandleCompleteLine(
      { ...closed.state, terminalCommandSeen: true, closed: false },
      JSON.stringify({ v: 1, command: 'EXIT' }),
    );
    expect(after.actions).toEqual([{ kind: 'fail', reason: 'COMMAND_AFTER_TERMINAL' }]);
  });

  it('does not emit duplicate fail after already failed', () => {
    const failed = {
      ...createFlockHolderMachine(),
      failed: true,
    };
    const result = flockHolderHandleEof(failed);
    expect(result.actions).toEqual([]);
  });
});

describe('harness config builders', () => {
  it('builds composition input with deterministic clock and storage root', () => {
    const input = buildHarnessCompositionInput('/tmp/root/storage', process.cwd(), 1000);
    expect(input.host.clock.now().toISOString()).toBe(fixedHarnessClock().now().toISOString());
    expect((input as { storageBinding: { storageRoot: string } }).storageBinding.storageRoot).toBe(
      '/tmp/root/storage',
    );
  });

  it('builds write command with exported harness content constant', () => {
    const command = buildHarnessWriteCommand('record-abc');
    expect(command.rawContent).toBe(HARNESS_CONTENT);
    expect(command.recordId).toBe('record-abc');
    expect(harnessContentSha256()).toHaveLength(64);
  });

  it('builds sealed memory access and read request', () => {
    const access = buildHarnessMemoryAccess('harness-owner', 'personal');
    expect(access.ownerId).toBeDefined();
    const request = buildHarnessReadRequest('harness-persisted-record');
    expect(request.recordId).toBeDefined();
    expect(request.expectedOwnerId).toBeDefined();
  });
});

describe('cleanup controller and safe exit', () => {
  it('runs cleanup only once', async () => {
    const controller = createCleanupController();
    let count = 0;
    controller.registerSignalHandlers(() => {
      count += 1;
    });
    await controller.runCleanupOnce();
    await controller.runCleanupOnce();
    expect(count).toBe(1);
    controller.restoreHandlers();
  });

  it('markInterruptedForTests aborts and throwIfAborted raises', () => {
    const controller = createCleanupController();
    expect(controller.wasInterruptedBySignal()).toBe(false);
    controller.markInterruptedForTests('SIGINT');
    expect(controller.wasInterruptedBySignal()).toBe(true);
    expect(controller.isAborted()).toBe(true);
    expect(() => {
      controller.throwIfAborted();
    }).toThrow(GateAbortedError);
  });

  it('repeated interrupt does not clear aborted state', () => {
    const controller = createCleanupController();
    controller.markInterruptedForTests('SIGINT');
    controller.markInterruptedForTests('SIGTERM');
    expect(controller.abortReason()).toBe('SIGINT');
    expect(controller.isAborted()).toBe(true);
  });

  it('finalizeHarnessOutput sets exit code without calling exitNow by default', async () => {
    const written: string[] = [];
    let exitCode = 0;
    const code = await finalizeHarnessOutput({
      writeLine: (line) => {
        written.push(line);
        return Promise.resolve();
      },
      lines: ['line-a', 'line-b'],
      code: 20,
      setExitCode: (value) => {
        exitCode = value;
      },
    });
    expect(code).toBe(20);
    expect(exitCode).toBe(20);
    expect(written).toEqual(['line-a', 'line-b']);
  });

  it('finalizeHarnessOutput awaits delayed stdout and preserves fatal exit code', async () => {
    const written: string[] = [];
    let exitCode: number | undefined = 1;
    const code = await finalizeHarnessOutput({
      writeLine: (line) =>
        new Promise((resolve) => {
          setTimeout(() => {
            written.push(line);
            resolve();
          }, 5);
        }),
      lines: ['evidence', PASS_MARKER],
      code: 0,
      preserveFatalExitCode: true,
      getExistingExitCode: () => exitCode,
      setExitCode: (value) => {
        if (exitCode !== undefined && exitCode !== 0 && value === 0) return;
        exitCode = value;
      },
    });
    expect(written).toEqual(['evidence', PASS_MARKER]);
    expect(code).toBe(1);
    expect(exitCode).toBe(1);
  });

  it('finalizeHarnessOutput propagates write errors without process.exit', async () => {
    await expect(
      finalizeHarnessOutput({
        writeLine: () => Promise.reject(new Error('stdout backpressure')),
        lines: ['x'],
        code: 0,
        setExitCode: () => {
          throw new Error('should not set exit before write');
        },
      }),
    ).rejects.toThrow('stdout backpressure');
  });
});

describe('path safety and constants', () => {
  it('normalizes Windows separators via toPosix', () => {
    expect(toPosix('scripts\\integration\\lib')).toBe('scripts/integration/lib');
  });

  it('uses the required PASS marker string', () => {
    expect(PASS_MARKER).toBe('BUILD_3_3B3C4_LINUX_COMPOSITION_GATE_PASSED');
  });

  it('hashes capability deterministically', () => {
    const capability = 'abc';
    expect(hashCapability(capability)).toHaveLength(64);
    expect(hashCapability(capability)).toBe(hashCapability(capability));
  });

  it('validates storage allowlist helper rejects unexpected files', () => {
    expect(validateStorageRootAllowlist('/nonexistent')).toBe(false);
  });
});

describe('R1 serial command queue', () => {
  it('executes WRITE → READ → CLOSE strictly sequentially with deferred handlers', async () => {
    const order: string[] = [];
    let resolveWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    let resolveRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });

    const queue = new SerialCommandQueue({
      handler: async (_line, command) => {
        if (command?.command === 'WRITE') {
          order.push('WRITE_ENTER');
          await writeGate;
          order.push('WRITE_LEAVE');
          return { kind: 'continue' };
        }
        if (command?.command === 'READ') {
          order.push('READ_ENTER');
          await readGate;
          order.push('READ_LEAVE');
          return { kind: 'continue' };
        }
        if (command?.command === 'CLOSE') {
          order.push('CLOSE_ENTER');
          order.push('CLOSE_LEAVE');
          return { kind: 'terminal-close' };
        }
        return { kind: 'terminal-fail', errorCode: 'UNKNOWN' };
      },
      onTerminalFail: () => {
        order.push('FAIL');
      },
    });

    // Concurrent enqueue in one tick
    queue.enqueue(
      JSON.stringify({
        v: 1,
        command: 'WRITE',
        ownerId: 'o',
        namespace: 'personal',
        recordId: 'r',
      }),
    );
    queue.enqueue(
      JSON.stringify({ v: 1, command: 'READ', ownerId: 'o', namespace: 'personal', recordId: 'r' }),
    );
    queue.enqueue(JSON.stringify({ v: 1, command: 'CLOSE' }));

    await Promise.resolve();
    expect(order).toEqual(['WRITE_ENTER']);
    expect(order).not.toContain('READ_ENTER');
    expect(order).not.toContain('CLOSE_ENTER');

    resolveWrite();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain('WRITE_LEAVE');
    expect(order).toContain('READ_ENTER');
    expect(order).not.toContain('CLOSE_ENTER');

    resolveRead();
    await queue.waitIdle();
    expect(queue.getTrace()).toEqual([
      'WRITE_START',
      'WRITE_END',
      'READ_START',
      'READ_END',
      'CLOSE_START',
      'CLOSE_END',
    ]);
    expect(order).toEqual([
      'WRITE_ENTER',
      'WRITE_LEAVE',
      'READ_ENTER',
      'READ_LEAVE',
      'CLOSE_ENTER',
      'CLOSE_LEAVE',
    ]);
  });

  it('stops queue on failure so READ/CLOSE never run', async () => {
    const entered: string[] = [];
    let failures = 0;
    const queue = new SerialCommandQueue({
      handler: (_line, command) => {
        entered.push(command?.command ?? 'unknown');
        if (command?.command === 'WRITE') {
          return Promise.resolve({ kind: 'terminal-fail' as const, errorCode: 'WRITE_FAILED' });
        }
        return Promise.resolve({ kind: 'continue' as const });
      },
      onTerminalFail: () => {
        failures += 1;
      },
    });
    queue.enqueue(
      JSON.stringify({
        v: 1,
        command: 'WRITE',
        ownerId: 'o',
        namespace: 'personal',
        recordId: 'r',
      }),
    );
    queue.enqueue(
      JSON.stringify({ v: 1, command: 'READ', ownerId: 'o', namespace: 'personal', recordId: 'r' }),
    );
    queue.enqueue(JSON.stringify({ v: 1, command: 'CLOSE' }));
    await queue.waitIdle();
    expect(entered).toEqual(['WRITE']);
    expect(failures).toBe(1);
    expect(queue.getTrace()).toContain('FAILED');
    expect(queue.getTrace()).toContain('REJECTED_AFTER_TERMINAL');
  });

  it('rejects commands after successful CLOSE', async () => {
    const entered: string[] = [];
    const queue = new SerialCommandQueue({
      handler: (_line, command) => {
        entered.push(command?.command ?? 'unknown');
        if (command?.command === 'CLOSE') {
          return Promise.resolve({ kind: 'terminal-close' as const });
        }
        return Promise.resolve({ kind: 'continue' as const });
      },
      onTerminalFail: () => undefined,
    });
    queue.enqueue(JSON.stringify({ v: 1, command: 'CLOSE' }));
    await queue.waitIdle();
    queue.enqueue(
      JSON.stringify({ v: 1, command: 'READ', ownerId: 'o', namespace: 'personal', recordId: 'r' }),
    );
    await queue.waitIdle();
    expect(entered).toEqual(['CLOSE']);
    expect(queue.getTrace()).toContain('REJECTED_AFTER_TERMINAL');
  });

  it('handler throw yields one terminal failure and no unhandledRejection', async () => {
    const seen: unknown[] = [];
    const observer = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on('unhandledRejection', observer);
    try {
      let failures = 0;
      const entered: string[] = [];
      const queue = new SerialCommandQueue({
        handler: (_line, command) => {
          entered.push(command?.command ?? 'unknown');
          if (command?.command === 'WRITE') {
            return Promise.reject(new Error('handler-boom'));
          }
          return Promise.resolve({ kind: 'continue' as const });
        },
        onTerminalFail: () => {
          failures += 1;
        },
      });
      queue.enqueue(
        JSON.stringify({
          v: 1,
          command: 'WRITE',
          ownerId: 'o',
          namespace: 'personal',
          recordId: 'r',
        }),
      );
      queue.enqueue(
        JSON.stringify({
          v: 1,
          command: 'READ',
          ownerId: 'o',
          namespace: 'personal',
          recordId: 'r',
        }),
      );
      await queue.waitIdle();
      await new Promise((r) => setTimeout(r, 25));
      expect(failures).toBe(1);
      expect(entered).toEqual(['WRITE']);
      expect(queue.getTrace()).toContain('FAILED');
      expect(seen).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', observer);
    }
  });
});

describe('R4 interactive EOF state machine', () => {
  it('fails EOF after READY with no terminal command', () => {
    const state = createInteractiveStdinState();
    const eof = interactiveHandleEof(state);
    expect(eof.actions).toEqual([{ kind: 'fail', reason: 'EOF_WITHOUT_TERMINAL' }]);
  });

  it('fails partial command then EOF', () => {
    let state = createInteractiveStdinState();
    const ingested = interactiveIngestChunk(state, '{"command":"CLO');
    state = ingested.state;
    const eof = interactiveHandleEof(state);
    expect(eof.actions).toEqual([{ kind: 'fail', reason: 'PARTIAL_EOF' }]);
  });

  it('noop EOF after terminal command', () => {
    let state = createInteractiveStdinState();
    state = interactiveMarkTerminalCommand(state);
    state = interactiveMarkTerminalEvent(state);
    const eof = interactiveHandleEof(state);
    expect(eof.actions).toEqual([{ kind: 'noop' }]);
  });

  it('queue handleEof fails when non-terminal after idle', async () => {
    let failed = '';
    const queue = new SerialCommandQueue({
      handler: () => Promise.resolve({ kind: 'continue' as const }),
      onTerminalFail: (code) => {
        failed = code;
      },
    });
    const result = await queue.handleEof();
    expect(result).toBe('failed');
    expect(failed).toBe('EOF_WITHOUT_TERMINAL');
  });
});

describe('H1/M1 Scenario B faithful event consumption', () => {
  const expected = {
    recordId: 'record-1',
    ownerId: 'owner-1',
    namespace: 'personal',
    contentSha256: 'abc',
  };

  const detail = {
    recordId: 'record-1',
    ownerId: 'owner-1',
    namespace: 'personal',
    contentSha256: 'abc',
  };

  const msg = (
    event: ProtocolMessage['event'],
    extra?: Partial<ProtocolMessage>,
  ): ProtocolMessage => ({
    v: 1,
    runId: 'r',
    role: 'holder',
    event,
    pid: 1,
    ...extra,
  });

  const bound = async <T>(promise: Promise<T>, ms = 500): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('TEST_HANG'));
          }, ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /**
   * Faithful session: uses real ProtocolEventStream consumption.
   * Does NOT magically convert mismatches into FAILED.
   */
  const makeFaithfulSession = (
    script: ProtocolMessage[],
    options: {
      readonly completionExitCode?: number;
      readonly timedOut?: boolean;
      readonly protocolError?: string | null;
      readonly abortSignal?: AbortSignal;
      readonly onSend?: (
        command: string,
        stream: ReturnType<typeof createProtocolEventStream>,
      ) => void;
    } = {},
  ) => {
    const stream = createProtocolEventStream();
    for (const event of script) stream.push(event);
    const sent: string[] = [];
    const messages = [...script];
    let alive = true;
    return {
      sent,
      stream,
      session: {
        sendCommand: (command: { command: string }) => {
          sent.push(command.command);
          options.onSend?.(command.command, stream);
        },
        waitForNextEvent: (event: ProtocolMessage['event']) =>
          stream.expectNextEvent(event, options.abortSignal),
        waitForCompletion: () => {
          alive = false;
          if (!stream.isClosed()) {
            stream.close({
              code: options.timedOut === true ? 'TIMED_OUT' : 'CHILD_CLOSED',
              exitCode: options.completionExitCode ?? 0,
              signal: null,
              timedOut: options.timedOut === true,
              ...(options.protocolError != null ? { protocolError: options.protocolError } : {}),
            });
          }
          return Promise.resolve({
            exitCode: options.completionExitCode ?? 0,
            signal: null,
            messages,
            protocolError: options.protocolError ?? null,
            timedOut: options.timedOut === true,
            startupDiagnostics: fakeStartupDiagnostics(),
            registryId: 'x',
          });
        },
        isAlive: () => alive,
      },
    };
  };

  const ownerDeny = msg('READ_REJECTED', {
    errorCode: 'POLICY_DENIED',
    detail: {
      authorizationCode: 'OWNER_MISMATCH',
      proofType: 'OWNER_MISMATCH',
      domainCode: 'POLICY_DENIED',
    },
  });
  const nsDeny = msg('READ_REJECTED', {
    errorCode: 'POLICY_DENIED',
    detail: {
      authorizationCode: 'NAMESPACE_ISOLATED',
      proofType: 'NAMESPACE_ISOLATED',
      domainCode: 'POLICY_DENIED',
    },
  });

  it('happy path passes with strict ordered consumption', async () => {
    const { session, sent } = makeFaithfulSession([
      msg('READY'),
      msg('WRITE_CONFIRMED', { detail }),
      msg('READ_CONFIRMED', { detail }),
      ownerDeny,
      nsDeny,
      msg('READ_CONFIRMED', { detail }),
      msg('CLOSED'),
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(true);
    expect(assertScenarioBStepOrder(result.steps)).toBe(true);
    expect(sent).toEqual(['WRITE', 'READ', 'READ', 'READ', 'READ', 'CLOSE']);
  });

  it('FAILED while waiting WRITE_CONFIRMED fails promptly', async () => {
    const { session, sent } = makeFaithfulSession([
      msg('READY'),
      msg('FAILED', { errorCode: 'WRITE_FAILED' }),
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('failed-event:WRITE_FAILED');
    expect(sent).toEqual(['WRITE']);
  });

  it('FAILED while waiting READ_CONFIRMED fails promptly', async () => {
    const { session, sent } = makeFaithfulSession([
      msg('READY'),
      msg('WRITE_CONFIRMED', { detail }),
      msg('FAILED', { errorCode: 'READ_FAILED' }),
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('failed-event:READ_FAILED');
    expect(sent).toEqual(['WRITE', 'READ']);
  });

  it('early exit fails promptly', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    const sent: string[] = [];
    const session = {
      sendCommand: (command: { command: string }) => {
        sent.push(command.command);
        stream.close({ code: 'CHILD_EXITED', exitCode: 1, signal: 'SIGTERM' });
      },
      waitForNextEvent: (event: ProtocolMessage['event']) => stream.expectNextEvent(event),
      waitForCompletion: () =>
        Promise.resolve({
          exitCode: 1,
          signal: 'SIGTERM' as const,
          messages: [msg('READY')],
          protocolError: null,
          timedOut: false,
          startupDiagnostics: fakeStartupDiagnostics(),
          registryId: 'x',
        }),
      isAlive: () => !stream.isClosed(),
    };
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('child-exited-early');
    expect(sent).toEqual(['WRITE']);
  });

  it('unexpected event fails promptly', async () => {
    const { session, sent } = makeFaithfulSession([
      msg('READY'),
      msg('READ_CONFIRMED', { detail }),
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('unexpected-event:READ_CONFIRMED');
    expect(sent).toEqual(['WRITE']);
  });

  it('owner/namespace rejection reversed fails', async () => {
    const { session } = makeFaithfulSession([
      msg('READY'),
      msg('WRITE_CONFIRMED', { detail }),
      msg('READ_CONFIRMED', { detail }),
      nsDeny,
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('owner-mismatch-invalid');
  });

  it('missing namespace denial fails', async () => {
    const { session } = makeFaithfulSession([
      msg('READY'),
      msg('WRITE_CONFIRMED', { detail }),
      msg('READ_CONFIRMED', { detail }),
      ownerDeny,
      msg('READ_CONFIRMED', { detail }),
    ]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('unexpected-event:READ_CONFIRMED');
  });

  it('child CLOSED early fails', async () => {
    const { session, sent } = makeFaithfulSession([msg('READY'), msg('CLOSED')]);
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('unexpected-terminal:CLOSED');
    expect(sent).toEqual(['WRITE']);
  });

  it('timeout fails without hang', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    const sent: string[] = [];
    const session = {
      sendCommand: (command: { command: string }) => {
        sent.push(command.command);
        stream.close({ code: 'TIMED_OUT', timedOut: true });
      },
      waitForNextEvent: (event: ProtocolMessage['event']) => stream.expectNextEvent(event),
      waitForCompletion: () =>
        Promise.resolve({
          exitCode: null,
          signal: null,
          messages: [msg('READY')],
          protocolError: null,
          timedOut: true,
          startupDiagnostics: fakeStartupDiagnostics(),
          registryId: 'x',
        }),
      isAlive: () => true,
    };
    const result = await bound(
      runScenarioBOrchestration(
        session,
        { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
        expected,
        { throwIfAborted: () => undefined },
      ),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('timed-out');
    expect(sent).toEqual(['WRITE']);
  });

  it('abort during wait fails without sending next command', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    const ac = new AbortController();
    const sent: string[] = [];
    const session = {
      sendCommand: (command: { command: string }) => {
        sent.push(command.command);
        queueMicrotask(() => {
          ac.abort();
        });
      },
      waitForNextEvent: (event: ProtocolMessage['event']) =>
        stream.expectNextEvent(event, ac.signal),
      waitForCompletion: () =>
        Promise.resolve({
          exitCode: 1,
          signal: null,
          messages: [msg('READY')],
          protocolError: null,
          timedOut: false,
          startupDiagnostics: fakeStartupDiagnostics(),
          registryId: 'x',
        }),
      isAlive: () => true,
    };
    await expect(
      bound(
        runScenarioBOrchestration(
          session,
          { ownerId: 'owner-1', foreignOwnerId: 'foreign-1', recordId: 'record-1' },
          expected,
          {
            throwIfAborted: () => {
              if (ac.signal.aborted) throw new GateAbortedError('aborted');
            },
          },
        ),
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);
    expect(sent).toEqual(['WRITE']);
  });

  it('fails when CLOSE would be sent before final read confirmation', () => {
    expect(
      assertScenarioBStepOrder([
        'READY',
        'SEND_WRITE',
        'WRITE_CONFIRMED',
        'SEND_READ_LEGIT_1',
        'READ_CONFIRMED_1',
        'SEND_OWNER_MISMATCH',
        'OWNER_MISMATCH',
        'SEND_NAMESPACE_ISOLATED',
        'NAMESPACE_ISOLATED',
        'SEND_CLOSE',
      ]),
    ).toBe(false);
  });
});

describe('R2/R3 abort-checked spawn', () => {
  it('does not call underlying spawn when already aborted', () => {
    const controller = createCleanupController();
    controller.markInterruptedForTests('SIGINT');
    let spawned = false;
    expect(() =>
      spawnCheckedChildSession({} as never, controller, {
        spawnChildImpl: () => {
          spawned = true;
          return {} as never;
        },
      }),
    ).toThrow(GateAbortedError);
    expect(spawned).toBe(false);
  });

  it('aborts in beforeUnderlyingSpawn window without spawning', () => {
    const controller = createCleanupController();
    let spawned = false;
    expect(() =>
      spawnCheckedChildSession({} as never, controller, {
        beforeUnderlyingSpawn: () => {
          controller.markInterruptedForTests('SIGINT');
        },
        spawnChildImpl: () => {
          spawned = true;
          return {} as never;
        },
      }),
    ).toThrow(GateAbortedError);
    expect(spawned).toBe(false);
  });

  it('registers raw process then throws on post-spawn abort', () => {
    const controller = createCleanupController();
    resetProcessRegistryForTests();
    const fakeChild = {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      on: () => fakeChild,
    } as unknown as import('node:child_process').ChildProcess;
    expect(() =>
      spawnCheckedRawProcess('flock', ['--exclusive', '/tmp/x'], {}, controller, {
        beforeUnderlyingSpawn: () => undefined,
        rawSpawnImpl: () => {
          controller.markInterruptedForTests('SIGINT');
          return fakeChild;
        },
      }),
    ).toThrow(GateAbortedError);
    expect(globalProcessRegistry.listAlivePids()).toContain(4242);
    resetProcessRegistryForTests();
  });

  it('registers child session then throws on post-spawn abort', () => {
    const controller = createCleanupController();
    resetProcessRegistryForTests();
    const fakeChild = {
      pid: 5252,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      on: () => fakeChild,
    } as unknown as import('node:child_process').ChildProcess;
    let returnedSession = false;
    expect(() =>
      spawnCheckedChildSession({} as never, controller, {
        spawnChildImpl: () => {
          globalProcessRegistry.register(fakeChild);
          controller.markInterruptedForTests('SIGINT');
          returnedSession = true;
          return {
            process: fakeChild,
            registryId: 'session-abort',
          } as never;
        },
      }),
    ).toThrow(GateAbortedError);
    expect(returnedSession).toBe(true);
    expect(globalProcessRegistry.listAlivePids()).toContain(5252);
    resetProcessRegistryForTests();
  });

  it('exports abort-checked spawn marker for mutation resistance', () => {
    expect(ABORT_CHECKED_SPAWN_MARKER).toBe('spawnCheckedChildSession');
  });
});

describe('gate-level stop-on-first-failure', () => {
  const scenarioKeys = [...REQUIRED_SCENARIO_KEYS];

  const makeSession = (options: {
    readonly pendingWaiters?: number;
    readonly pass?: boolean;
    readonly pid?: number;
    readonly role?: string;
    readonly runId?: string;
  }): ChildSessionHandle => {
    const pass = options.pass ?? true;
    const pid = options.pid ?? 9000;
    const role = options.role ?? 'normal';
    const runId = options.runId ?? mockGateRunId;
    const closedMessages = [
      { v: 1 as const, runId, role: 'normal' as const, event: 'READY' as const, pid: 1 },
      { v: 1 as const, runId, role: 'normal' as const, event: 'CLOSED' as const, pid: 1 },
    ];
    const writeDetail = buildWriteConfirmationDetail({
      recordId: PERSISTED_RECORD_ID,
      ownerId: PERSISTED_OWNER_ID,
      namespace: 'personal',
      writtenContent: HARNESS_CONTENT,
    });
    const readDetail = buildReadConfirmationFromRecord(
      {
        id: PERSISTED_RECORD_ID,
        namespace: 'personal',
        content: HARNESS_CONTENT,
        provenance: { initiatedBy: PERSISTED_OWNER_ID },
      },
      {
        recordId: PERSISTED_RECORD_ID,
        ownerId: PERSISTED_OWNER_ID,
        namespace: 'personal',
        contentSha256: contentHash,
      },
    );
    const writerMessages = writeDetail.ok
      ? [
          {
            v: 1 as const,
            runId,
            role: 'writer' as const,
            event: 'WRITE_CONFIRMED' as const,
            pid: 1,
            detail: writeDetail.detail,
          },
          {
            v: 1 as const,
            runId,
            role: 'writer' as const,
            event: 'CLOSED' as const,
            pid: 1,
          },
        ]
      : [];
    const readerMessages = readDetail.ok
      ? [
          {
            v: 1 as const,
            runId,
            role: 'reader' as const,
            event: 'READ_CONFIRMED' as const,
            pid: 1,
            detail: readDetail.detail,
          },
          {
            v: 1 as const,
            runId,
            role: 'reader' as const,
            event: 'CLOSED' as const,
            pid: 1,
          },
        ]
      : [];
    const contenderMessages = [
      {
        v: 1 as const,
        runId,
        role: 'contender' as const,
        event: 'HELD' as const,
        pid: 1,
        errorCode: 'DURABLE_COMPOSITION_LOCK_HELD',
      },
    ];
    const readyMessage = {
      v: 1 as const,
      runId,
      role: 'normal' as const,
      event: 'READY' as const,
      pid: 1,
    };
    const child = {
      pid,
      exitCode: null as number | null,
      signalCode: null,
      killed: false,
      kill: vi.fn((signal?: string) => {
        if (signal === 'SIGKILL') {
          child.killed = true;
        }
        return true;
      }),
    };
    return {
      process: child as never,
      registryId: `fake-${String(pid)}`,
      sendCommand: () => {},
      waitForCompletion: () => {
        if (child.killed) {
          return Promise.resolve({
            exitCode: null,
            signal: 'SIGKILL',
            messages: [],
            protocolError: null,
            timedOut: false,
            startupDiagnostics: fakeStartupDiagnostics(),
            registryId: `fake-${String(pid)}`,
          });
        }
        const rollbackMessages = [
          {
            v: 1 as const,
            runId,
            role: 'rollback' as const,
            event: 'FAILED' as const,
            pid: 1,
          },
        ];
        const repeatedCloseMessages = [
          {
            v: 1 as const,
            runId,
            role: 'repeated-close' as const,
            event: 'CLOSED' as const,
            pid: 1,
            detail: { closeCount: 2 },
          },
        ];
        const messages =
          role === 'writer'
            ? writerMessages
            : role === 'reader'
              ? readerMessages
              : role === 'contender'
                ? contenderMessages
                : role === 'rollback'
                  ? rollbackMessages
                  : role === 'repeated-close'
                    ? repeatedCloseMessages
                    : pass
                      ? closedMessages
                      : [];
        const exitCode =
          role === 'contender' ? EXIT_LOCK_CONTENTION : role === 'rollback' ? 1 : pass ? 0 : 1;
        return Promise.resolve({
          exitCode,
          signal: null,
          messages,
          protocolError: null,
          timedOut: false,
          startupDiagnostics: fakeStartupDiagnostics(),
          registryId: `fake-${String(pid)}`,
        });
      },
      waitForEvent: (event) => {
        if (role === 'holder' && event === 'WRITE_CONFIRMED' && writeDetail.ok) {
          return Promise.resolve({
            v: 1 as const,
            runId,
            role: 'holder' as const,
            event,
            pid: 1,
            detail: writeDetail.detail,
          });
        }
        if (role === 'holder' && event === 'READ_CONFIRMED' && readDetail.ok) {
          return Promise.resolve({
            v: 1 as const,
            runId,
            role: 'holder' as const,
            event,
            pid: 1,
            detail: readDetail.detail,
          });
        }
        return Promise.resolve({
          v: 1 as const,
          runId: mockGateRunId,
          role: 'holder' as const,
          event,
          pid: 1,
        });
      },
      waitForNextEvent: (event) =>
        Promise.resolve({
          v: 1 as const,
          runId: mockGateRunId,
          role: 'holder' as const,
          event,
          pid: 1,
        }),
      waitForNextProtocolEvent: () => Promise.resolve(readyMessage),
      expectNextEvent: (event) =>
        Promise.resolve({
          v: 1 as const,
          runId: mockGateRunId,
          role: 'holder' as const,
          event,
          pid: 1,
        }),
      isAlive: () => false,
      pendingEventWaiterCount: () => options.pendingWaiters ?? 0,
      eventStream: {} as never,
    };
  };

  const passingOrchestration = passingScenarioBOrchestrationImpl;

  const runProductionScenarios = async (
    hooks: RunScenariosHooks = {},
    options: {
      readonly spawnSession?: (role: string, index: number) => ChildSessionHandle;
    } = {},
  ) => {
    resetProcessRegistryForTests();
    const trackedSessions: Array<{ pendingEventWaiterCount: () => number }> = [];
    const cleanup = createCleanupController();
    const ownership = mockGateOwnership();
    mockGateRunId = ownership.runId;
    const spawnCalls: string[] = [];
    let spawnIndex = 0;

    const result = await runScenarios(
      createInitialEvidence(generateRunId(), gateFixture()),
      ownership,
      {},
      cleanup,
      trackedSessions,
      {
        runScenarioBOrchestrationImpl: passingOrchestration,
        runScenarioGColdRootImpl: () =>
          Promise.resolve({
            result: { verdict: 'PASS' as const },
            coldRootRemoved: true,
          }),
        spawnCheckedChildSessionImpl: (sessionOptions) => {
          spawnIndex += 1;
          spawnCalls.push(sessionOptions.role);
          const session =
            options.spawnSession?.(sessionOptions.role, spawnIndex) ??
            makeSession({ pid: 9100 + spawnIndex, role: sessionOptions.role });
          globalProcessRegistry.register(session.process);
          return session;
        },
        ...hooks,
      },
    );

    return { result, trackedSessions, spawnCalls, cleanup, ownership };
  };

  const runProductionSteps = async (
    patch: Partial<
      Record<
        (typeof REQUIRED_SCENARIO_KEYS)[number],
        () =>
          | Promise<{ verdict: 'PASS' | 'FAIL'; detail?: string }>
          | { verdict: 'PASS' | 'FAIL'; detail?: string }
      >
    > = {},
  ) => {
    const patchInput = patch;
    const trackedSessions: Array<{ pendingEventWaiterCount: () => number }> = [];
    const cleanup = createCleanupController();
    const ownership = mockGateOwnership();
    mockGateRunId = ownership.runId;
    const auxiliary = {
      quickCheckVerified: false,
      childExitCodes: {},
      contentionClassification: null,
      artifactModes: {},
      redactionChecks: {},
    };
    const spawnCalls: string[] = [];
    let spawnIndex = 0;
    const steps = buildGateScenarioSteps({
      ownership,
      gateEnv: {},
      cleanupController: cleanup,
      trackedSessions,
      spawnSession: (sessionOptions) => {
        spawnIndex += 1;
        spawnCalls.push(sessionOptions.role);
        const session = makeSession({ pid: 9200 + spawnIndex, role: sessionOptions.role });
        globalProcessRegistry.register(session.process);
        trackedSessions.push(session);
        return session;
      },
      sessionOpts: (overrides) =>
        ({
          role: overrides.role,
        }) as never,
      checkpoint: () => {},
      auxiliary,
      hooks: {
        runScenarioBOrchestrationImpl: passingOrchestration,
        runScenarioGColdRootImpl: () =>
          Promise.resolve({
            result: { verdict: 'PASS' as const },
            coldRootRemoved: true,
          }),
      },
    }).map((step) => {
      const patch = patchInput[step.key];
      return patch === undefined ? step : { ...step, run: patch };
    });

    const failFast = await runFailFastScenarioSteps(
      createInitialEvidence(generateRunId(), gateFixture()),
      steps,
      recordScenarioForTests,
    );
    return { failFast, spawnCalls, trackedSessions, cleanup };
  };

  it('buildGateScenarioSteps exposes exact production A–K keys', () => {
    const cleanup = createCleanupController();
    const ownership = mockGateOwnership();
    const steps = buildGateScenarioSteps({
      ownership,
      gateEnv: {},
      cleanupController: cleanup,
      trackedSessions: [],
      spawnSession: () => makeSession({}),
      sessionOpts: (overrides) => ({ role: overrides.role }) as never,
      checkpoint: () => {},
      auxiliary: {
        quickCheckVerified: false,
        childExitCodes: {},
        contentionClassification: null,
        artifactModes: {},
        redactionChecks: {},
      },
      hooks: {},
    });
    expect(assertExactGateScenarioStepKeys(steps)).toEqual(scenarioKeys);
  });

  it('rejects production steps that omit a required scenario key', () => {
    const cleanup = createCleanupController();
    const ownership = mockGateOwnership();
    const steps = buildGateScenarioSteps({
      ownership,
      gateEnv: {},
      cleanupController: cleanup,
      trackedSessions: [],
      spawnSession: () => makeSession({}),
      sessionOpts: (overrides) => ({ role: overrides.role }) as never,
      checkpoint: () => {},
      auxiliary: {
        quickCheckVerified: false,
        childExitCodes: {},
        contentionClassification: null,
        artifactModes: {},
        redactionChecks: {},
      },
      hooks: {},
    }).filter((step) => step.key !== 'F');
    expect(() => assertExactGateScenarioStepKeys(steps)).toThrow();
  });

  it('stops after Scenario A failure without calling B–K via runScenarios', async () => {
    const { result, spawnCalls } = await runProductionScenarios(
      {},
      {
        spawnSession: () => makeSession({ pass: false, pid: 9301 }),
      },
    );
    expect(result.evidence.scenarios.A?.verdict).toBe('FAIL');
    expect(spawnCalls).toEqual(['normal']);
    for (const key of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      expect(result.evidence.scenarios[key]?.verdict).toBe('SKIP');
    }
  });

  it('stops after Scenario B failure without calling C–K via runScenarios', async () => {
    const { result, spawnCalls } = await runProductionScenarios({
      runScenarioBOrchestrationImpl: () =>
        Promise.resolve({
          pass: false,
          detail: 'scenario-b-failed',
          steps: [],
          messages: [],
        }),
    });
    expect(result.evidence.scenarios.A?.verdict).toBe('PASS');
    expect(result.evidence.scenarios.B?.verdict).toBe('FAIL');
    expect(spawnCalls).toEqual(['normal', 'holder']);
    for (const key of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      expect(result.evidence.scenarios[key]?.verdict).toBe('SKIP');
    }
  });

  it('continues after Scenario B pass and reaches C via runScenarios', async () => {
    const { spawnCalls } = await runProductionScenarios();
    expect(spawnCalls.slice(0, 4)).toEqual(['normal', 'holder', 'writer', 'reader']);
  });

  it('stops after Scenario F failure without calling G–K via production steps', async () => {
    const { failFast } = await runProductionSteps({
      F: () => ({ verdict: 'FAIL', detail: 'f-failed' }),
    });
    expect(failFast.stoppedAt).toBe('F');
    expect(failFast.callOrder).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(failFast.evidence.scenarios.G?.verdict).toBe('SKIP');
  });

  it('stops after Scenario K failure with no extra step via production steps', async () => {
    const { failFast } = await runProductionSteps({
      J: () => ({ verdict: 'PASS' }),
      K: () => ({ verdict: 'FAIL', detail: 'k-failed' }),
    });
    expect(failFast.stoppedAt).toBe('K');
    expect(failFast.callOrder).toEqual(scenarioKeys);
    expect(failFast.evidence.scenarios.K?.verdict).toBe('FAIL');
  });

  it('runs full A–K PASS via production steps without SKIP', async () => {
    const { failFast } = await runProductionSteps({
      F: () => ({ verdict: 'PASS' }),
      J: () => ({ verdict: 'PASS' }),
    });
    expect(failFast.stoppedAt).toBeNull();
    expect(failFast.callOrder).toEqual(scenarioKeys);
    for (const key of scenarioKeys) {
      expect(failFast.evidence.scenarios[key]?.verdict).toBe('PASS');
    }
    const finalized = finalizeEvidence({ ...failFast.evidence, cleanup: perfectCleanup });
    expect(finalized.verdict).toBe('PASS');
  });

  it('records partial evidence with SKIP for unexecuted later scenarios', () => {
    let evidence = createInitialEvidence(generateRunId(), gateFixture());
    evidence = recordScenarioForTests(evidence, 'A', { verdict: 'PASS' });
    evidence = recordScenarioForTests(evidence, 'B', {
      verdict: 'FAIL',
      detail: 'scenario-b-failed',
    });
    evidence = fillUnrunScenariosAfterFailure(evidence);

    expect(evidence.scenarios.A).toEqual({ verdict: 'PASS' });
    expect(evidence.scenarios.B).toEqual({ verdict: 'FAIL', detail: 'scenario-b-failed' });
    for (const key of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      expect(evidence.scenarios[key]).toEqual({
        verdict: 'SKIP',
        detail: UNRUN_AFTER_PRIOR_FAILURE_DETAIL,
      });
    }
    expect(hasExactScenarioKeySet(evidence.scenarios)).toBe(true);
    const finalized = finalizeEvidence({
      ...evidence,
      cleanup: perfectCleanup,
    });
    expect(finalized.verdict).toBe('FAIL');
    expect(shouldPrintPassMarker(finalized)).toBe(false);
  });

  it('does not overwrite prior PASS/FAIL entries when filling unrun scenarios', () => {
    let evidence = createInitialEvidence(generateRunId(), gateFixture());
    evidence = recordScenarioForTests(evidence, 'A', { verdict: 'PASS' });
    evidence = recordScenarioForTests(evidence, 'B', { verdict: 'FAIL', detail: 'b-fail' });
    evidence = recordScenarioForTests(evidence, 'C', { verdict: 'PASS' });
    evidence = fillUnrunScenariosAfterFailure(evidence);

    expect(evidence.scenarios.A).toEqual({ verdict: 'PASS' });
    expect(evidence.scenarios.B).toEqual({ verdict: 'FAIL', detail: 'b-fail' });
    expect(evidence.scenarios.C).toEqual({ verdict: 'PASS' });
    expect(Object.keys(evidence.scenarios).sort()).toEqual([...REQUIRED_SCENARIO_KEYS].sort());
  });

  it('records thrown scenario as FAIL and skips later production steps', async () => {
    const { failFast } = await runProductionSteps({
      B: () => {
        throw new Error('synthetic-scenario-failure');
      },
    });
    expect(failFast.stoppedAt).toBe('B');
    expect(failFast.evidence.scenarios.B?.verdict).toBe('FAIL');
    expect(failFast.evidence.scenarios.B?.detail).toContain('synthetic-scenario-failure');
    expect(failFast.evidence.scenarios.C?.verdict).toBe('SKIP');
  });

  it('rethrows GateAbortedError from production steps without converting to scenario FAIL', async () => {
    await expect(
      runProductionSteps({
        B: () => {
          throw new GateAbortedError('SIGINT');
        },
      }),
    ).rejects.toBeInstanceOf(GateAbortedError);
  });

  it('keeps failed B session registered through production path until global terminateAll', async () => {
    resetProcessRegistryForTests();
    const { trackedSessions, spawnCalls } = await runProductionScenarios({
      runScenarioBOrchestrationImpl: () =>
        Promise.resolve({
          pass: false,
          detail: 'scenario-b-failed',
          steps: [],
          messages: [],
        }),
    });
    expect(spawnCalls).toEqual(['normal', 'holder']);
    expect(trackedSessions).toHaveLength(2);
    expect(globalProcessRegistry.listAlivePids().length).toBeGreaterThan(0);
    await globalProcessRegistry.terminateAll({ graceMs: 0, killMs: 0 });
    expect(trackedSessions.every((session) => session.pendingEventWaiterCount() === 0)).toBe(true);
  });

  it('fails PASS eligibility when pending event waiters remain after cleanup', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        pendingEventWaitersCleared: false,
      },
    });
    expect(evidence.verdict).toBe('FAIL');
    expect(shouldPrintPassMarker(evidence)).toBe(false);
  });

  it('does not falsify childrenTerminated when only waiters fail verification', () => {
    const evidence = finalizeEvidence({
      ...createInitialEvidence(generateRunId(), gateFixture()),
      scenarios: allPassScenarios(),
      cleanup: {
        ...perfectCleanup,
        childrenTerminated: true,
        pendingEventWaitersCleared: false,
      },
    });
    expect(evidence.cleanup.childrenTerminated).toBe(true);
    expect(evidence.cleanup.pendingEventWaitersCleared).toBe(false);
    expect(evidence.verdict).toBe('FAIL');
  });

  it('remains FAIL when scenario and cleanup both fail', () => {
    let evidence = createInitialEvidence(generateRunId(), gateFixture());
    evidence = recordScenarioForTests(evidence, 'A', { verdict: 'PASS' });
    evidence = recordScenarioForTests(evidence, 'B', { verdict: 'FAIL', detail: 'b-fail' });
    evidence = fillUnrunScenariosAfterFailure(evidence);
    const finalized = finalizeEvidence({
      ...evidence,
      cleanup: {
        ...perfectCleanup,
        childrenTerminated: false,
        noOrphans: false,
        pendingEventWaitersCleared: false,
      },
    });
    expect(finalized.verdict).toBe('FAIL');
    expect(shouldPrintPassMarker(finalized)).toBe(false);
    expect(EXIT_ASSERTION_FAILURE).toBe(40);
  });

  it('verifies zero pending waiter count passes cleanup eligibility', () => {
    const sessions = [{ pendingEventWaiterCount: () => 0 }, { pendingEventWaiterCount: () => 0 }];
    expect(computePendingEventWaitersCleared(sessions)).toBe(true);
  });

  it('verifies non-zero pending waiter count fails cleanup eligibility', () => {
    const sessions = [{ pendingEventWaiterCount: () => 0 }, { pendingEventWaiterCount: () => 1 }];
    expect(computePendingEventWaitersCleared(sessions)).toBe(false);
  });
});

describe('Scenario G cold-root lifecycle', () => {
  const FAKE_FLOCK_BINARY = '/usr/bin/flock';
  const scenarioGTestUid = typeof process.getuid === 'function' ? process.getuid() : 0;

  const mockColdOwnership = (): DisposableRootOwnership => {
    const base = join(tmpdir(), `openclaw-b3c4-cold-${generateRunId()}`);
    return {
      runId: generateRunId(),
      capability: generateParentCapability(),
      capabilityHash: 'mock-cold-capability-hash',
      executionRootPath: base,
      realExecutionRootPath: base,
      executionInode: 11,
      executionDevice: 1,
      storageRootPath: join(base, 'storage'),
      realStorageRootPath: join(base, 'storage'),
      storageInode: 12,
      storageDevice: 1,
      markerInode: 13,
      markerDevice: 1,
      parentRealPath: tmpdir(),
      uid: 1000,
      homePath: join(base, 'home'),
      tmpPath: join(base, 'tmp'),
    };
  };

  const createFlockReadyRawProcess = () => ({
    process: {
      stdout: {
        on: (event: string, listener: (chunk: Buffer) => void) => {
          if (event === 'data') {
            listener(Buffer.from('{"event":"READY"}\n'));
          }
        },
      },
      stdin: { write: vi.fn(() => true) },
      on: (event: string, listener: (code: number | null) => void) => {
        if (event === 'close') {
          listener(0);
        }
      },
      pid: 1,
    },
    registryId: 'flock-ready',
  });

  const makeGColdSession = (role: 'contender' | 'normal'): ChildSessionHandle => {
    const contenderMessages = [
      {
        v: 1 as const,
        runId: mockGateRunId,
        role: 'contender' as const,
        event: 'HELD' as const,
        pid: 1,
        errorCode: 'DURABLE_COMPOSITION_LOCK_HELD',
      },
    ];
    const normalMessages = [
      {
        v: 1 as const,
        runId: mockGateRunId,
        role: 'normal' as const,
        event: 'CLOSED' as const,
        pid: 1,
      },
    ];
    return {
      process: {
        pid: role === 'contender' ? 9400 : 9401,
        exitCode: null,
        signalCode: null,
        kill: vi.fn(),
      } as unknown as import('node:child_process').ChildProcess,
      registryId: `g-fake-${role}`,
      sendCommand: () => {},
      waitForCompletion: () =>
        Promise.resolve({
          exitCode: role === 'contender' ? EXIT_LOCK_CONTENTION : 0,
          signal: null,
          messages: role === 'contender' ? contenderMessages : normalMessages,
          protocolError: null,
          timedOut: false,
          startupDiagnostics: fakeStartupDiagnostics(),
          registryId: `g-fake-${role}`,
        }),
      waitForEvent: (event) =>
        Promise.resolve({
          v: 1,
          runId: mockGateRunId,
          role: 'holder',
          event,
          pid: 1,
        }),
      waitForNextEvent: (event) =>
        Promise.resolve({
          v: 1,
          runId: mockGateRunId,
          role: 'holder',
          event,
          pid: 1,
        }),
      waitForNextProtocolEvent: () =>
        Promise.resolve({ v: 1, runId: mockGateRunId, role: 'holder', event: 'READY', pid: 1 }),
      expectNextEvent: (event) =>
        Promise.resolve({
          v: 1,
          runId: mockGateRunId,
          role: 'holder',
          event,
          pid: 1,
        }),
      isAlive: () => false,
      pendingEventWaiterCount: () => 0,
      eventStream: {} as never,
    };
  };

  const baseDeps = (overrides: Partial<ScenarioGColdRootDeps> = {}): ScenarioGColdRootDeps => ({
    createDisposableRoot: () => {
      const ownership = mockColdOwnership();
      mkdirSync(ownership.storageRootPath, { recursive: true });
      return ownership;
    },
    removeDisposableRoot,
    resolveFlockBinary: () => FAKE_FLOCK_BINARY,
    hasSqliteArtifacts: () => false,
    spawnCheckedRawProcess: () =>
      ({
        process: { stdout: null, stdin: null, on: () => {}, pid: 1 },
        registryId: 'flock',
      }) as never,
    buildSessionOptions: (_coldRoot, roleOverrides) => ({ role: roleOverrides.role }) as never,
    spawnSession: (options) => makeGColdSession(options.role as 'contender' | 'normal'),
    checkpoint: () => {},
    ...overrides,
  });

  const successfulRemoval = (): ReturnType<typeof removeDisposableRoot> => ({
    removed: true,
    proof: {
      prefixOk: true,
      parentOk: true,
      markerOk: true,
      executionInodeOk: true,
      markerInodeOk: true,
      notSymlink: true,
      noChildSymlinks: true,
      notUnsafe: true,
      storageValidated: true,
    },
  });

  const failedRemoval = (): ReturnType<typeof removeDisposableRoot> => ({
    removed: false,
    proof: {
      prefixOk: false,
      parentOk: false,
      markerOk: false,
      executionInodeOk: false,
      markerInodeOk: false,
      notSymlink: false,
      noChildSymlinks: false,
      notUnsafe: false,
      storageValidated: false,
    },
  });

  const passingBodyDeps = (overrides: Partial<ScenarioGColdRootDeps> = {}): ScenarioGColdRootDeps =>
    baseDeps({
      spawnCheckedRawProcess: () => createFlockReadyRawProcess() as never,
      ...overrides,
    });

  const baseParams = () => ({
    ownership: { ...mockColdOwnership(), uid: scenarioGTestUid },
    gateEnv: {},
    cleanupController: createCleanupController(),
    repositoryRoot: process.cwd(),
  });

  const trackRemoveCalls = (
    deps: ScenarioGColdRootDeps,
    removalResult: ReturnType<typeof removeDisposableRoot> = successfulRemoval(),
  ): { readonly deps: ScenarioGColdRootDeps; readonly getRemoveCalls: () => number } => {
    let removeCalls = 0;
    return {
      deps: {
        ...deps,
        removeDisposableRoot: (...args) => {
          removeCalls += 1;
          void args;
          return removalResult;
        },
      },
      getRemoveCalls: () => removeCalls,
    };
  };

  const assertBodyReachedPassPath = (checkpoints: readonly string[]): void => {
    expect(checkpoints).toEqual(expect.arrayContaining(['G-flock', 'G-contender', 'G-reopen']));
    expect(assertFlockReadyBeforeContender(['FLOCK_READY', 'CONTENDER_SPAWN'])).toBe(true);
  };

  it('returns PASS when body succeeds and cold-root removal succeeds', async () => {
    const checkpoints: string[] = [];
    const tracked = trackRemoveCalls(
      passingBodyDeps({
        checkpoint: (label) => {
          checkpoints.push(label);
        },
      }),
    );
    const outcome = await runScenarioGColdRoot(tracked.deps, baseParams());

    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.result.detail).toBeUndefined();
    assertBodyReachedPassPath(checkpoints);
    expect(tracked.getRemoveCalls()).toBe(1);
    expect(outcome.coldRootRemoved).toBe(true);
  });

  it('returns FAIL on normal body assertion failure and removes cold root once', async () => {
    let removeCalls = 0;
    const outcome = await runScenarioGColdRoot(
      passingBodyDeps({
        hasSqliteArtifacts: () => true,
        removeDisposableRoot: (...args) => {
          removeCalls += 1;
          return removeDisposableRoot(...args);
        },
      }),
      baseParams(),
    );

    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.detail).toBeUndefined();
    expect(removeCalls).toBe(1);
    expect(outcome.coldRootRemoved).toBe(true);
  });

  it('removes cold root exactly once on stdout-missing FAIL', async () => {
    let removeCalls = 0;
    const outcome = await runScenarioGColdRoot(
      baseDeps({
        removeDisposableRoot: (...args) => {
          removeCalls += 1;
          return removeDisposableRoot(...args);
        },
      }),
      baseParams(),
    );
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.detail).toBe('flock-stdout-missing');
    expect(removeCalls).toBe(1);
    expect(outcome.coldRootRemoved).toBe(true);
  });

  it('removes cold root exactly once on ordinary throw', async () => {
    let removeCalls = 0;
    const outcome = await runScenarioGColdRoot(
      passingBodyDeps({
        spawnSession: () => {
          throw new Error('g-spawn-failed');
        },
        removeDisposableRoot: (...args) => {
          removeCalls += 1;
          return removeDisposableRoot(...args);
        },
      }),
      baseParams(),
    );
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.detail).toContain('g-spawn-failed');
    expect(removeCalls).toBe(1);
  });

  it('removes cold root and rethrows GateAbortedError without masking abort', async () => {
    let removeCalls = 0;
    await expect(
      runScenarioGColdRoot(
        passingBodyDeps({
          spawnSession: () => {
            throw new GateAbortedError('SIGINT');
          },
          removeDisposableRoot: (...args) => {
            removeCalls += 1;
            return removeDisposableRoot(...args);
          },
        }),
        baseParams(),
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);
    expect(removeCalls).toBe(1);
  });

  it('marks G FAIL with cold-root-removal-failed when body PASS and removal fails', async () => {
    const checkpoints: string[] = [];
    let removeCalls = 0;
    const outcome = await runScenarioGColdRoot(
      passingBodyDeps({
        checkpoint: (label) => {
          checkpoints.push(label);
        },
        removeDisposableRoot: () => {
          removeCalls += 1;
          return failedRemoval();
        },
      }),
      baseParams(),
    );

    assertBodyReachedPassPath(checkpoints);
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.detail).toBe('cold-root-removal-failed');
    expect(removeCalls).toBe(1);
    expect(outcome.coldRootRemoved).toBe(true);
  });

  it('rethrows GateAbortedError when removal fails during abort without masking abort type', async () => {
    let removeCalls = 0;
    await expect(
      runScenarioGColdRoot(
        passingBodyDeps({
          spawnSession: () => {
            throw new GateAbortedError('SIGINT');
          },
          removeDisposableRoot: () => {
            removeCalls += 1;
            return failedRemoval();
          },
        }),
        baseParams(),
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);
    expect(removeCalls).toBe(1);
  });

  it('never calls remove more than once per lifecycle path', async () => {
    let removeCalls = 0;
    const guardedRemove: ScenarioGColdRootDeps['removeDisposableRoot'] = (...args) => {
      removeCalls += 1;
      if (removeCalls > 1) {
        throw new Error('duplicate-remove');
      }
      void args;
      return successfulRemoval();
    };

    const passOutcome = await runScenarioGColdRoot(
      passingBodyDeps({ removeDisposableRoot: guardedRemove }),
      baseParams(),
    );
    expect(passOutcome.result.verdict).toBe('PASS');
    expect(removeCalls).toBe(1);

    removeCalls = 0;
    await expect(
      runScenarioGColdRoot(
        passingBodyDeps({
          spawnSession: () => {
            throw new GateAbortedError('SIGTERM');
          },
          removeDisposableRoot: guardedRemove,
        }),
        baseParams(),
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);
    expect(removeCalls).toBe(1);
  });
});

describe('abort tracked-session survival', () => {
  const makeAbortSession = (pendingWaiters: number, role = 'normal'): ChildSessionHandle => ({
    process: { pid: 9500, exitCode: null, signalCode: null, kill: vi.fn() } as never,
    registryId: 'abort-fake',
    sendCommand: () => {},
    waitForCompletion: () =>
      Promise.resolve({
        exitCode: 0,
        signal: null,
        messages:
          role === 'normal'
            ? [
                {
                  v: 1 as const,
                  runId: mockGateRunId,
                  role: 'normal' as const,
                  event: 'READY' as const,
                  pid: 1,
                },
              ]
            : [],
        protocolError: null,
        timedOut: false,
        startupDiagnostics: fakeStartupDiagnostics(),
        registryId: 'abort-fake',
      }),
    waitForEvent: (event) =>
      Promise.resolve({
        v: 1,
        runId: mockGateRunId,
        role: 'holder',
        event,
        pid: 1,
      }),
    waitForNextEvent: (event) =>
      Promise.resolve({
        v: 1,
        runId: mockGateRunId,
        role: 'holder',
        event,
        pid: 1,
      }),
    waitForNextProtocolEvent: () =>
      Promise.resolve({ v: 1, runId: mockGateRunId, role: 'holder', event: 'READY', pid: 1 }),
    expectNextEvent: (event) =>
      Promise.resolve({
        v: 1,
        runId: mockGateRunId,
        role: 'holder',
        event,
        pid: 1,
      }),
    isAlive: () => true,
    pendingEventWaiterCount: () => pendingWaiters,
    eventStream: {} as never,
  });

  it('preserves tracked sessions after session-created abort for cleanup evidence', async () => {
    const trackedSessions: Array<{ pendingEventWaiterCount: () => number }> = [];
    const cleanup = createCleanupController();
    const ownership = mockGateOwnership();
    mockGateRunId = ownership.runId;

    await expect(
      runScenarios(
        createInitialEvidence(generateRunId(), gateFixture()),
        ownership,
        {},
        cleanup,
        trackedSessions,
        {
          spawnCheckedChildSessionImpl: (sessionOptions) => {
            const session = makeAbortSession(0, sessionOptions.role);
            globalProcessRegistry.register(session.process);
            return session;
          },
          runScenarioBOrchestrationImpl: () => {
            throw new GateAbortedError('SIGINT');
          },
        },
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);

    expect(trackedSessions.length).toBeGreaterThanOrEqual(2);
    expect(computePendingEventWaitersCleared(trackedSessions)).toBe(true);
    cleanup.markInterruptedForTests('SIGINT');
    expect(cleanup.wasInterruptedBySignal()).toBe(true);
  });

  it('allows honest vacuous waiter clearance when abort happens before any session', async () => {
    const trackedSessions: Array<{ pendingEventWaiterCount: () => number }> = [];
    const cleanup = createCleanupController();
    cleanup.markInterruptedForTests('SIGINT');
    const ownership = mockGateOwnership();

    await expect(
      runScenarios(
        createInitialEvidence(generateRunId(), gateFixture()),
        ownership,
        {},
        cleanup,
        trackedSessions,
      ),
    ).rejects.toBeInstanceOf(GateAbortedError);

    expect(trackedSessions).toHaveLength(0);
    expect(computePendingEventWaitersCleared(trackedSessions)).toBe(true);
  });

  it('records pendingEventWaitersCleared false when abort leaves non-zero waiter', () => {
    const trackedSessions: Array<{ pendingEventWaiterCount: () => number }> = [];
    const session = makeAbortSession(1);
    trackedSessions.push(session);
    expect(computePendingEventWaitersCleared(trackedSessions)).toBe(false);
  });
});
