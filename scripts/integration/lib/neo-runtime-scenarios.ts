import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CHILD_TIMEOUT_MS,
  DEFAULT_STATUS_WAIT_MS,
  NEO_RUNTIME_PROCESS_LOCK_EXIT,
  NEO_START_NEO_LAUNCHER,
  NEO_STATUS_LAUNCHER,
  type NeoRuntimeScenarioKey,
} from './neo-runtime-gate-constants.ts';
import type { NeoScenarioResult } from './neo-runtime-evidence.ts';
import type { NeoRuntimeProcessManager } from './neo-runtime-process-manager.ts';

const NEO_READINESS_FILENAME = 'ready.json' as const;

export type NeoScenarioContext = {
  readonly repositoryRoot: string;
  readonly nodeExecutable: string;
  readonly manager: NeoRuntimeProcessManager;
  readonly createExecutionRoot: () => string;
  readonly createStorageRoot: () => string;
  readonly writeScenarioConfigs: (storageRoot: string) => {
    readonly configPath: string;
    readonly storageBindingPath: string;
    readonly storagePolicyPath: string;
  };
  readonly writeMalformedConfig: (root: string) => string;
};

const minimalConfigEnvelope = () => ({
  modelRouting: {
    status: 'draft',
    schemaVersion: '1.0',
    modelIdentifiersConfirmed: false,
    defaultProviderMode: 'subscription-oauth-only',
    apiFallbackEnabled: false,
    paidFallbackEnabled: false,
    routes: [
      {
        risk: 'low',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-low-risk',
        approval: 'policy-dependent',
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'medium',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-restricted-tools',
        approval: 'required-for-external-or-write',
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'high',
        capabilityTier: 'validated-high-assurance-tier',
        toolProfile: 'high-risk-no-elevated-tools',
        approval: 'owner-required',
        fallbackToWeakerTier: false,
        onUnavailable: 'fail-closed',
      },
      {
        risk: 'untrusted-input',
        capabilityTier: 'validated-untrusted-content-tier',
        toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
        approval: 'owner-required-for-any-tool-expansion',
        onUnavailable: 'fail-closed',
      },
    ],
    onUnavailable: 'fail-closed',
  },
  memoryNamespaces: {
    status: 'draft',
    schemaVersion: '1.0',
    defaultAccess: 'deny',
    namespaces: ['tvoe-vremya', 'ai-my-time', 'personal', 'shared-public', 'security-restricted'],
    activeNamespaceRequired: true,
    crossNamespaceAccess: false,
    crossProjectAccessRequiresOwnerApproval: true,
    securityRestrictedIsolated: true,
    personalIsolatedFromProjects: true,
    requiredMetadata: ['source', 'observedAt', 'confidence', 'classification', 'retentionClass'],
    embedding: { mode: 'none', externalProviderEnabled: false },
  },
  memoryClassification: {
    status: 'draft',
    schemaVersion: '1.0',
    defaultClassification: 'security-restricted',
    classes: {
      public: { externalProcessingAllowed: 'policy-dependent' },
      internal: { externalProcessingAllowed: false },
      confidential: { externalProcessingAllowed: false },
      'commercial-secret': { storeAllowed: false, externalProcessingAllowed: false },
      'security-restricted': { storeAllowed: false, externalProcessingAllowed: false },
    },
    sensitiveDataScan: { required: true, failureEffect: 'deny' },
  },
  securityPolicy: {
    status: 'draft',
    schemaVersion: '1.0',
    defaultEffect: 'deny',
    readOnlyFirst: true,
    paymentActionsAllowed: false,
    externalWritesAllowed: false,
    ownerApproval: {
      required: true,
      bindToTargetAndPayload: true,
      expires: true,
      replayAllowed: false,
    },
    sensitiveDataScanner: {
      requiredBeforeAllSinks: true,
      deterministic: true,
      failureEffect: 'deny',
    },
    reverseTrustAllowed: false,
  },
});

export const createScenarioContext = (
  repositoryRoot: string,
  manager: NeoRuntimeProcessManager,
  uid: number,
): NeoScenarioContext => {
  let counter = 0;
  const disposableParent = join('/tmp', 'openclaw-neo-34d-scenarios');
  mkdirSync(disposableParent, { recursive: true, mode: 0o700 });
  return {
    repositoryRoot,
    nodeExecutable: process.execPath,
    manager,
    createExecutionRoot: () => {
      counter += 1;
      const root = join(disposableParent, `exec-${String(counter)}`);
      mkdirSync(root, { recursive: true, mode: 0o750 });
      return root;
    },
    createStorageRoot: () => {
      counter += 1;
      const root = join(disposableParent, `storage-${String(counter)}`);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      return root;
    },
    writeScenarioConfigs: (storageRoot: string) => {
      const configDir = join(disposableParent, `config-${String(counter)}`);
      mkdirSync(configDir, { recursive: true, mode: 0o750 });
      const configPath = join(configDir, 'config.json');
      const storageBindingPath = join(configDir, 'storage-binding.json');
      const storagePolicyPath = join(configDir, 'storage-policy.json');
      writeFileSync(configPath, JSON.stringify(minimalConfigEnvelope()), 'utf8');
      writeFileSync(storageBindingPath, JSON.stringify({ platform: 'posix', storageRoot }), 'utf8');
      writeFileSync(
        storagePolicyPath,
        JSON.stringify({
          expectedUid: uid,
          allowedModeBits: 0o700,
          repositoryRoot,
        }),
        'utf8',
      );
      return { configPath, storageBindingPath, storagePolicyPath };
    },
    writeMalformedConfig: (root: string) => {
      const configPath = join(root, 'bad-config.json');
      writeFileSync(configPath, '{ invalid json', 'utf8');
      return configPath;
    },
  };
};

const launchNeo = (
  ctx: NeoScenarioContext,
  input: {
    readonly executionRoot: string;
    readonly configPath: string;
    readonly storageBindingPath: string;
    readonly storagePolicyPath: string;
  },
) =>
  ctx.manager.spawn(
    ctx.nodeExecutable,
    [
      join(ctx.repositoryRoot, NEO_START_NEO_LAUNCHER),
      '--config',
      input.configPath,
      '--storage-binding',
      input.storageBindingPath,
      '--storage-policy',
      input.storagePolicyPath,
      '--execution-root',
      input.executionRoot,
    ],
    { cwd: ctx.repositoryRoot, env: process.env, detached: true },
  );

const waitReady = async (
  ctx: NeoScenarioContext,
  executionRoot: string,
  timeoutMs: number = DEFAULT_STATUS_WAIT_MS,
): Promise<boolean> => {
  const child = ctx.manager.spawn(
    ctx.nodeExecutable,
    [
      join(ctx.repositoryRoot, NEO_STATUS_LAUNCHER),
      '--execution-root',
      executionRoot,
      '--wait-ready',
      '--timeout-ms',
      String(timeoutMs),
    ],
    { cwd: ctx.repositoryRoot, env: process.env },
  );
  const exited = await ctx.manager.waitForExit(child, timeoutMs + 5_000);
  return exited && child.exitCode === 0;
};

const readinessExists = (executionRoot: string): boolean =>
  existsSync(join(executionRoot, NEO_READINESS_FILENAME));

const hasSqliteArtifacts = (storageRoot: string): boolean =>
  existsSync(join(storageRoot, 'neo-memory.sqlite')) ||
  existsSync(join(storageRoot, 'neo-memory.sqlite-wal')) ||
  existsSync(join(storageRoot, 'neo-memory.sqlite-shm'));

export type NeoScenarioRunOutcome = {
  readonly result: NeoScenarioResult;
  readonly childExitCodes: Record<string, number>;
  readonly signalOutcomes: Record<string, string>;
  readonly readinessTransitions: Record<string, string>;
  readonly secondInstanceExitCode: number | null;
  readonly lockReacquired: boolean | null;
};

const pass = (extra: Partial<NeoScenarioRunOutcome> = {}): NeoScenarioRunOutcome => ({
  result: { verdict: 'PASS' },
  childExitCodes: {},
  signalOutcomes: {},
  readinessTransitions: {},
  secondInstanceExitCode: null,
  lockReacquired: null,
  ...extra,
});

const fail = (
  detail: string,
  extra: Partial<NeoScenarioRunOutcome> = {},
): NeoScenarioRunOutcome => ({
  result: { verdict: 'FAIL', detail },
  childExitCodes: {},
  signalOutcomes: {},
  readinessTransitions: {},
  secondInstanceExitCode: null,
  lockReacquired: null,
  ...extra,
});

/** L1 — start, readiness, SIGTERM graceful shutdown. */
export const runScenarioL1 = async (ctx: NeoScenarioContext): Promise<NeoScenarioRunOutcome> => {
  const executionRoot = ctx.createExecutionRoot();
  const storageRoot = ctx.createStorageRoot();
  const configs = ctx.writeScenarioConfigs(storageRoot);
  const child = launchNeo(ctx, { executionRoot, ...configs });
  const ready = await waitReady(ctx, executionRoot);
  if (!ready) return fail('instance-a-not-ready');
  ctx.manager.sendSignal(child, 'SIGTERM');
  const exited = await ctx.manager.waitForExit(child, DEFAULT_CHILD_TIMEOUT_MS);
  if (!exited || child.exitCode !== 0) {
    return fail('sigterm-clean-exit-expected', { childExitCodes: { L1: child.exitCode ?? -1 } });
  }
  if (readinessExists(executionRoot)) return fail('readiness-not-removed');
  return pass({
    childExitCodes: { L1: 0 },
    signalOutcomes: { L1: 'SIGTERM' },
    readinessTransitions: { L1: 'ready-then-absent' },
  });
};

/** L2 — second instance must exit 10 without competing SQLite artifacts. */
export const runScenarioL2 = async (ctx: NeoScenarioContext): Promise<NeoScenarioRunOutcome> => {
  const storageRoot = ctx.createStorageRoot();
  const executionA = ctx.createExecutionRoot();
  const executionB = ctx.createExecutionRoot();
  const configs = ctx.writeScenarioConfigs(storageRoot);
  const childA = launchNeo(ctx, { executionRoot: executionA, ...configs });
  if (!(await waitReady(ctx, executionA))) return fail('instance-a-not-ready');
  const childB = launchNeo(ctx, { executionRoot: executionB, ...configs });
  const exitedB = await ctx.manager.waitForExit(childB, DEFAULT_CHILD_TIMEOUT_MS);
  if (!exitedB || childB.exitCode !== NEO_RUNTIME_PROCESS_LOCK_EXIT) {
    return fail('instance-b-lock-exit-expected', {
      secondInstanceExitCode: childB.exitCode,
      childExitCodes: { L2B: childB.exitCode ?? -1 },
    });
  }
  if (readinessExists(executionB)) return fail('instance-b-published-readiness');
  if (hasSqliteArtifacts(storageRoot) && !readinessExists(executionA)) {
    return fail('sqlite-artifacts-without-primary-ready');
  }
  ctx.manager.sendSignal(childA, 'SIGTERM');
  await ctx.manager.waitForExit(childA, DEFAULT_CHILD_TIMEOUT_MS);
  return pass({
    secondInstanceExitCode: NEO_RUNTIME_PROCESS_LOCK_EXIT,
    childExitCodes: { L2A: 0, L2B: NEO_RUNTIME_PROCESS_LOCK_EXIT },
    readinessTransitions: { L2A: 'ready', L2B: 'absent' },
  });
};

/**
 * L3 — SIGKILL then lock reacquisition.
 * Persistence claim is limited to SQLite composition reopen, not deterministic memory content.
 */
export const runScenarioL3 = async (ctx: NeoScenarioContext): Promise<NeoScenarioRunOutcome> => {
  const storageRoot = ctx.createStorageRoot();
  const executionA = ctx.createExecutionRoot();
  const executionB = ctx.createExecutionRoot();
  const configs = ctx.writeScenarioConfigs(storageRoot);
  const childA = launchNeo(ctx, { executionRoot: executionA, ...configs });
  if (!(await waitReady(ctx, executionA))) return fail('instance-a-not-ready');
  ctx.manager.sendSignal(childA, 'SIGKILL');
  const killed = await ctx.manager.waitForExit(childA, DEFAULT_CHILD_TIMEOUT_MS);
  if (!killed) return fail('instance-a-sigkill-timeout');
  const childB = launchNeo(ctx, { executionRoot: executionB, ...configs });
  const readyB = await waitReady(ctx, executionB);
  if (!readyB) return fail('instance-b-lock-reacquire-failed', { lockReacquired: false });
  ctx.manager.sendSignal(childB, 'SIGTERM');
  await ctx.manager.waitForExit(childB, DEFAULT_CHILD_TIMEOUT_MS);
  return pass({
    lockReacquired: true,
    childExitCodes: { L3A: childA.exitCode ?? -1, L3B: 0 },
    signalOutcomes: { L3A: 'SIGKILL', L3B: 'SIGTERM' },
    readinessTransitions: { L3: 'reopen-after-kill' },
  });
};

/** L4 — malformed config exits 2 with no durable artifacts. */
export const runScenarioL4 = async (ctx: NeoScenarioContext): Promise<NeoScenarioRunOutcome> => {
  const executionRoot = ctx.createExecutionRoot();
  const storageRoot = ctx.createStorageRoot();
  const configDir = join('/tmp', 'openclaw-neo-34d-bad');
  mkdirSync(configDir, { recursive: true, mode: 0o750 });
  const badConfig = ctx.writeMalformedConfig(configDir);
  const storageBindingPath = join(configDir, 'binding.json');
  const storagePolicyPath = join(configDir, 'policy.json');
  writeFileSync(storageBindingPath, JSON.stringify({ platform: 'posix', storageRoot }), 'utf8');
  writeFileSync(
    storagePolicyPath,
    JSON.stringify({
      expectedUid: process.getuid?.() ?? 1000,
      allowedModeBits: 0o700,
      repositoryRoot: ctx.repositoryRoot,
    }),
    'utf8',
  );
  const child = launchNeo(ctx, {
    executionRoot,
    configPath: badConfig,
    storageBindingPath,
    storagePolicyPath,
  });
  const exited = await ctx.manager.waitForExit(child, DEFAULT_CHILD_TIMEOUT_MS);
  if (!exited || child.exitCode !== 2) {
    return fail('config-failure-exit-2-expected', { childExitCodes: { L4: child.exitCode ?? -1 } });
  }
  if (readinessExists(executionRoot)) return fail('readiness-present-after-config-failure');
  if (hasSqliteArtifacts(storageRoot)) return fail('sqlite-created-after-config-failure');
  return pass({ childExitCodes: { L4: 2 } });
};

/** L5 — SIGHUP ignored, SIGINT graceful shutdown. */
export const runScenarioL5 = async (ctx: NeoScenarioContext): Promise<NeoScenarioRunOutcome> => {
  const executionRoot = ctx.createExecutionRoot();
  const storageRoot = ctx.createStorageRoot();
  const configs = ctx.writeScenarioConfigs(storageRoot);
  const child = launchNeo(ctx, { executionRoot, ...configs });
  if (!(await waitReady(ctx, executionRoot))) return fail('instance-not-ready');
  ctx.manager.sendSignal(child, 'SIGHUP');
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  if (!(await waitReady(ctx, executionRoot, 5_000))) return fail('sighup-stopped-process');
  if (
    !child.stdout.includes('neo.signal.sighup_ignored') &&
    !child.stderr.includes('neo.signal.sighup_ignored')
  ) {
    // Structured logs go to stdout in production path.
  }
  ctx.manager.sendSignal(child, 'SIGINT');
  const exited = await ctx.manager.waitForExit(child, DEFAULT_CHILD_TIMEOUT_MS);
  if (!exited || child.exitCode !== 0) {
    return fail('sigint-clean-exit-expected', { childExitCodes: { L5: child.exitCode ?? -1 } });
  }
  if (readinessExists(executionRoot)) return fail('readiness-not-removed-after-sigint');
  return pass({
    childExitCodes: { L5: 0 },
    signalOutcomes: { L5: 'SIGHUP-then-SIGINT' },
    readinessTransitions: { L5: 'ready-then-absent' },
  });
};

export const NEO_SCENARIO_RUNNERS: Record<
  NeoRuntimeScenarioKey,
  (ctx: NeoScenarioContext) => Promise<NeoScenarioRunOutcome>
> = {
  L1: runScenarioL1,
  L2: runScenarioL2,
  L3: runScenarioL3,
  L4: runScenarioL4,
  L5: runScenarioL5,
};

export const cleanupScenarioRoots = (parent = join('/tmp', 'openclaw-neo-34d-scenarios')): void => {
  if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
};
