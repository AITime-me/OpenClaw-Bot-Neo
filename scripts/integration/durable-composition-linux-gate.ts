/**
 * Parent orchestrator for B3C4B durable composition Linux gate.
 * Production factory loads only after environment gate passes.
 */
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCheckedChildSession, spawnCheckedRawProcess } from './lib/abort-spawn.ts';
import { MARKER_FILENAME } from './lib/constants.ts';
import {
  GATE_EXPECTED_HEAD_ENV,
  GATE_EXPECTED_LOCK_SHA256_ENV,
  GATE_OPT_IN_ENV,
} from './lib/constants.ts';
import {
  killChildProcessGroup,
  validateChildExit,
  type ChildSessionHandle,
  type ChildSessionOptions,
} from './lib/child-runner.ts';
import { createCleanupController, GateAbortedError } from './lib/cleanup-controller.ts';
import type { CleanupController } from './lib/cleanup-controller.ts';
import type { DisposableRootOwnership } from './lib/disposable-root.ts';
import {
  createDisposableRoot,
  generateRunId,
  removeDisposableRoot,
  validateExecutionRootAllowlist,
  validateHomeTmpEmpty,
  validateStorageRootAllowlist,
} from './lib/disposable-root.ts';
import {
  createInitialEvidence,
  finalizeEvidence,
  passMarkerLine,
  shouldPrintPassMarker,
  type GateEvidence,
  type ScenarioResult,
} from './lib/evidence.ts';
import {
  computePendingEventWaitersCleared,
  runFailFastScenarioSteps,
  type ScenarioStep,
} from './lib/scenario-fail-fast.ts';
import { runScenarioGColdRoot } from './lib/scenario-g-cold-root.ts';
import { classificationToStderr, runEnvironmentGate } from './lib/environment-gate.ts';
import {
  EXIT_ASSERTION_FAILURE,
  EXIT_ENVIRONMENT_GATE_FAILED,
  EXIT_LOCK_CONTENTION,
} from './lib/exit-codes.ts';
import { fingerprintFile, fingerprintsStableEqual, statFileMode } from './lib/fingerprint.ts';
import { harnessContentSha256 } from './lib/harness-content.ts';
import { wasProductionFactoryLoaded } from './lib/lazy-production.ts';
import {
  assertScenarioBStepOrder,
  runScenarioBOrchestration,
} from './lib/scenario-b-orchestration.ts';
import { globalProcessRegistry } from './lib/process-registry.ts';
import { serializeChildStartupFailureDetail } from './lib/child-startup-evidence.ts';
import {
  detectRedactionViolations,
  safeSerializeForEvidence,
  serializePublicFailure,
} from './lib/redaction.ts';
import {
  assertCorrelatedEventPresent,
  assertExactSigkillProof,
  assertHeldLockCode,
  assertReadConfirmationMatches,
  assertReadyBeforeContender,
  assertScenarioBDenialsComplete,
  assertWriteConfirmationMatches,
  assertWriteReadBeforeKill,
} from './lib/scenario-orchestration.ts';
import { finalizeHarnessOutput, writeStdoutLine } from './lib/stdout-exit.ts';
import type { ChildRole } from './lib/constants.ts';

const REPOSITORY_ROOT = process.cwd();
const CHILD_TIMEOUT_MS = 30_000;
const PERSISTED_RECORD_ID = 'harness-persisted-record';
const PERSISTED_OWNER_ID = 'harness-owner';
const HARNESS_CONTENT_HASH = harnessContentSha256();

type SessionOverrides = Partial<
  Pick<
    ChildSessionOptions,
    'useTestHooks' | 'recordId' | 'ownerId' | 'scenario' | 'timeoutMs' | 'runId'
  >
> & {
  readonly role: ChildRole;
};

const recordScenario = (
  evidence: GateEvidence,
  key: string,
  result: ScenarioResult,
): GateEvidence => ({
  ...evidence,
  scenarios: { ...evidence.scenarios, [key]: result },
});

const gateEnvFromProcess = (): Record<string, string> => ({
  [GATE_OPT_IN_ENV]: process.env[GATE_OPT_IN_ENV] ?? '',
  [GATE_EXPECTED_HEAD_ENV]: process.env[GATE_EXPECTED_HEAD_ENV] ?? '',
  [GATE_EXPECTED_LOCK_SHA256_ENV]: process.env[GATE_EXPECTED_LOCK_SHA256_ENV] ?? '',
});

const buildSessionOptions = (
  ownership: DisposableRootOwnership,
  gateEnv: Record<string, string>,
  overrides: SessionOverrides,
  abortSignal?: AbortSignal,
): ChildSessionOptions => ({
  runId: overrides.runId ?? ownership.runId,
  role: overrides.role,
  storageRoot: ownership.storageRootPath,
  executionRoot: ownership.executionRootPath,
  repositoryRoot: REPOSITORY_ROOT,
  expectedUid: ownership.uid,
  capability: ownership.capability,
  realStorageRootPath: ownership.realStorageRootPath,
  storageInode: ownership.storageInode,
  storageDevice: ownership.storageDevice,
  realExecutionRootPath: ownership.realExecutionRootPath,
  executionInode: ownership.executionInode,
  executionDevice: ownership.executionDevice,
  markerInode: ownership.markerInode,
  markerDevice: ownership.markerDevice,
  homePath: ownership.homePath,
  tmpPath: ownership.tmpPath,
  disposableParentRealPath: ownership.parentRealPath,
  gateEnv,
  timeoutMs: overrides.timeoutMs ?? CHILD_TIMEOUT_MS,
  parentEnv: process.env,
  ...(abortSignal !== undefined ? { abortSignal } : {}),
  ...(overrides.scenario !== undefined ? { scenario: overrides.scenario } : {}),
  ...(overrides.useTestHooks === true ? { useTestHooks: true } : {}),
  ...(overrides.recordId !== undefined ? { recordId: overrides.recordId } : {}),
  ...(overrides.ownerId !== undefined ? { ownerId: overrides.ownerId } : {}),
});

const hasSqliteArtifacts = (storageRootPath: string): boolean =>
  existsSync(join(storageRootPath, 'neo-memory.sqlite')) ||
  existsSync(join(storageRootPath, 'neo-memory.sqlite-wal')) ||
  existsSync(join(storageRootPath, 'neo-memory.sqlite-shm'));

const resolveFlockBinary = (): string | null => {
  for (const candidate of ['/usr/bin/flock', '/bin/flock']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const validateStorageArtifactPermissions = (
  storageRoot: string,
): {
  readonly pass: boolean;
  readonly modes: Record<string, number | null>;
} => {
  const modes: Record<string, number | null> = {
    lock: statFileMode(join(storageRoot, 'neo.primary.lock')),
    db: statFileMode(join(storageRoot, 'neo-memory.sqlite')),
  };
  const lockFp = fingerprintFile(join(storageRoot, 'neo.primary.lock'));
  if (modes.lock !== 0o600) return { pass: false, modes };
  if (!lockFp.exists || lockFp.fileType !== 'file' || lockFp.nlink !== 1) {
    return { pass: false, modes };
  }
  if (modes.db !== null && modes.db !== undefined && (modes.db & 0o077) !== 0) {
    return { pass: false, modes };
  }
  if (!validateStorageRootAllowlist(storageRoot)) return { pass: false, modes };
  return { pass: true, modes };
};

const validateExecutionLayout = (
  ownership: DisposableRootOwnership,
): {
  readonly pass: boolean;
  readonly modes: Record<string, number | null>;
} => {
  const modes: Record<string, number | null> = {
    executionRoot: statFileMode(ownership.executionRootPath),
    marker: statFileMode(join(ownership.executionRootPath, MARKER_FILENAME)),
    storage: statFileMode(ownership.storageRootPath),
    home: statFileMode(ownership.homePath),
    tmp: statFileMode(ownership.tmpPath),
  };
  if (modes.executionRoot !== 0o700) return { pass: false, modes };
  if (modes.marker === null) return { pass: false, modes };
  if (!validateExecutionRootAllowlist(ownership.executionRootPath)) return { pass: false, modes };
  if (!validateHomeTmpEmpty(ownership.homePath, ownership.tmpPath)) return { pass: false, modes };
  return { pass: true, modes };
};

const contentExpectation = (
  recordId: string,
  ownerId: string,
  namespace = 'personal',
): {
  readonly recordId: string;
  readonly ownerId: string;
  readonly namespace: string;
  readonly contentSha256: string;
} => ({
  recordId,
  ownerId,
  namespace,
  contentSha256: HARNESS_CONTENT_HASH,
});

type TrackedSession = Pick<ChildSessionHandle, 'pendingEventWaiterCount'>;

type ScenarioAuxiliary = {
  quickCheckVerified: boolean;
  childExitCodes: Record<string, number>;
  contentionClassification: string | null;
  artifactModes: Record<string, number | null>;
  redactionChecks: Record<string, boolean>;
};

export type RunScenariosHooks = {
  readonly spawnCheckedChildSessionImpl?: typeof spawnCheckedChildSession;
  readonly runScenarioBOrchestrationImpl?: typeof runScenarioBOrchestration;
  readonly runScenarioGColdRootImpl?: typeof runScenarioGColdRoot;
  readonly resolveFlockBinaryImpl?: () => string | null;
};

export type GateScenarioBuildContext = {
  readonly ownership: DisposableRootOwnership;
  readonly gateEnv: Record<string, string>;
  readonly cleanupController: CleanupController;
  readonly trackedSessions: TrackedSession[];
  readonly spawnSession: (options: ChildSessionOptions) => ChildSessionHandle;
  readonly sessionOpts: (overrides: SessionOverrides) => ChildSessionOptions;
  readonly checkpoint: (label: string) => void;
  readonly auxiliary: ScenarioAuxiliary;
  readonly hooks: RunScenariosHooks;
};

export const buildGateScenarioSteps = (ctx: GateScenarioBuildContext): ScenarioStep[] => {
  const orchestrateB = ctx.hooks.runScenarioBOrchestrationImpl ?? runScenarioBOrchestration;
  const runGColdRoot = ctx.hooks.runScenarioGColdRootImpl ?? runScenarioGColdRoot;
  const resolveFlock = ctx.hooks.resolveFlockBinaryImpl ?? resolveFlockBinary;
  const timeline: string[] = [];

  return [
    {
      key: 'A',
      run: async () => {
        const session = ctx.spawnSession(ctx.sessionOpts({ role: 'normal' }));
        session.sendCommand({ command: 'CLOSE' });
        const result = await session.waitForCompletion();
        ctx.checkpoint('A-done');
        const correlation = { runId: ctx.ownership.runId, role: 'normal' as const };
        const readyCheck = assertCorrelatedEventPresent(result.messages, {
          ...correlation,
          event: 'READY',
        });
        const pass = validateChildExit(result, 'CLOSED') && readyCheck.pass;
        ctx.auxiliary.childExitCodes = {
          ...ctx.auxiliary.childExitCodes,
          A: result.exitCode ?? -1,
        };
        return {
          verdict: pass ? 'PASS' : 'FAIL',
          ...(pass
            ? {}
            : {
                detail:
                  readyCheck.detail ??
                  serializeChildStartupFailureDetail(result.startupDiagnostics),
              }),
        };
      },
    },
    {
      key: 'B',
      run: async () => {
        const ownerId = `owner-${generateRunId().slice(0, 8)}`;
        const foreignOwnerId = `foreign-${generateRunId().slice(0, 8)}`;
        const recordId = `record-${generateRunId().slice(0, 8)}`;
        const expected = contentExpectation(recordId, ownerId);
        const session = ctx.spawnSession(ctx.sessionOpts({ role: 'holder' }));
        const orchestration = await orchestrateB(
          session,
          { ownerId, foreignOwnerId, recordId },
          expected,
          {
            throwIfAborted: () => {
              ctx.cleanupController.throwIfAborted();
            },
          },
        );
        ctx.checkpoint('B-done');
        const holderCorrelation = { runId: ctx.ownership.runId, role: 'holder' as const };
        const pass =
          orchestration.pass &&
          assertScenarioBStepOrder(orchestration.steps) &&
          assertScenarioBDenialsComplete(orchestration.messages, expected, holderCorrelation);
        return {
          verdict: pass ? 'PASS' : 'FAIL',
          ...(pass ? {} : { detail: orchestration.detail ?? 'scenario-b-failed' }),
        };
      },
    },
    {
      key: 'C',
      run: async () => {
        const writer = ctx.spawnSession(
          ctx.sessionOpts({
            role: 'writer',
            recordId: PERSISTED_RECORD_ID,
            ownerId: PERSISTED_OWNER_ID,
          }),
        );
        const writerResult = await writer.waitForCompletion();
        ctx.checkpoint('C-reader');
        const reader = ctx.spawnSession(
          ctx.sessionOpts({
            role: 'reader',
            recordId: PERSISTED_RECORD_ID,
            ownerId: PERSISTED_OWNER_ID,
          }),
        );
        const readerResult = await reader.waitForCompletion();
        ctx.checkpoint('C-done');
        const expected = contentExpectation(PERSISTED_RECORD_ID, PERSISTED_OWNER_ID);
        const writerCorrelation = { runId: ctx.ownership.runId, role: 'writer' as const };
        const readerCorrelation = { runId: ctx.ownership.runId, role: 'reader' as const };
        const pass =
          validateChildExit(writerResult, 'CLOSED') &&
          validateChildExit(readerResult, 'CLOSED') &&
          assertWriteConfirmationMatches(writerResult.messages, expected, writerCorrelation) &&
          assertReadConfirmationMatches(readerResult.messages, expected, readerCorrelation);
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
    {
      key: 'D',
      run: async () => {
        const holder = ctx.spawnSession(ctx.sessionOpts({ role: 'holder' }));
        await holder.waitForEvent('READY');
        ctx.checkpoint('D-ready');
        timeline.push('READY');
        const lockBaseline = fingerprintFile(
          join(ctx.ownership.storageRootPath, 'neo.primary.lock'),
        );
        timeline.push('CONTENDER_SPAWN');
        const contender = ctx.spawnSession(ctx.sessionOpts({ role: 'contender' }));
        const contenderResult = await contender.waitForCompletion();
        ctx.checkpoint('D-contender');
        holder.sendCommand({ command: 'CLOSE' });
        const holderResult = await holder.waitForCompletion();
        ctx.checkpoint('D-done');
        const redacted = detectRedactionViolations(
          safeSerializeForEvidence(contenderResult.messages),
        );
        const contenderCorrelation = { runId: ctx.ownership.runId, role: 'contender' as const };
        const pass =
          assertReadyBeforeContender(timeline) &&
          contenderResult.exitCode === EXIT_LOCK_CONTENTION &&
          assertHeldLockCode(contenderResult.messages, contenderCorrelation) &&
          validateChildExit(holderResult, 'CLOSED') &&
          fingerprintsStableEqual(
            lockBaseline,
            fingerprintFile(join(ctx.ownership.storageRootPath, 'neo.primary.lock')),
          ) &&
          redacted.length === 0;
        if (pass) {
          ctx.auxiliary.contentionClassification = 'DURABLE_COMPOSITION_LOCK_HELD';
        }
        return {
          verdict: pass ? 'PASS' : 'FAIL',
          ...(pass ? {} : { detail: 'lock-contention-or-ordering-failed' }),
        };
      },
    },
    {
      key: 'E',
      run: async () => {
        const holder = ctx.spawnSession(ctx.sessionOpts({ role: 'holder' }));
        holder.sendCommand({ command: 'CLOSE' });
        await holder.waitForCompletion();
        ctx.checkpoint('E-reopen');
        const next = ctx.spawnSession(ctx.sessionOpts({ role: 'normal' }));
        next.sendCommand({ command: 'CLOSE' });
        const nextResult = await next.waitForCompletion();
        ctx.checkpoint('E-done');
        const pass = validateChildExit(nextResult, 'CLOSED');
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
    {
      key: 'F',
      run: async () => {
        const fTimeline: string[] = [];
        const expected = contentExpectation(PERSISTED_RECORD_ID, PERSISTED_OWNER_ID);
        const holderCorrelation = { runId: ctx.ownership.runId, role: 'holder' as const };
        const readerCorrelation = { runId: ctx.ownership.runId, role: 'reader' as const };
        const holder = ctx.spawnSession(ctx.sessionOpts({ role: 'holder' }));
        await holder.waitForEvent('READY');
        ctx.checkpoint('F-ready');
        holder.sendCommand({
          command: 'WRITE',
          ownerId: PERSISTED_OWNER_ID,
          namespace: 'personal',
          recordId: PERSISTED_RECORD_ID,
        });
        const writeConfirmed = await holder.waitForEvent('WRITE_CONFIRMED');
        ctx.checkpoint('F-write');
        fTimeline.push('WRITE_CONFIRMED');
        holder.sendCommand({
          command: 'READ',
          ownerId: PERSISTED_OWNER_ID,
          namespace: 'personal',
          recordId: PERSISTED_RECORD_ID,
        });
        const readConfirmed = await holder.waitForEvent('READ_CONFIRMED');
        ctx.checkpoint('F-read');
        fTimeline.push('READ_CONFIRMED');
        killChildProcessGroup(holder.process);
        fTimeline.push('SIGKILL');
        const killedResult = await holder.waitForCompletion();
        ctx.checkpoint('F-killed');
        const reader = ctx.spawnSession(
          ctx.sessionOpts({
            role: 'reader',
            recordId: PERSISTED_RECORD_ID,
            ownerId: PERSISTED_OWNER_ID,
          }),
        );
        const readerResult = await reader.waitForCompletion();
        ctx.checkpoint('F-done');
        const pass =
          assertWriteReadBeforeKill(fTimeline) &&
          assertExactSigkillProof(killedResult, holderCorrelation) &&
          assertWriteConfirmationMatches([writeConfirmed], expected, holderCorrelation) &&
          assertReadConfirmationMatches([readConfirmed], expected, holderCorrelation) &&
          validateChildExit(readerResult, 'CLOSED') &&
          assertReadConfirmationMatches(readerResult.messages, expected, readerCorrelation);
        ctx.auxiliary.quickCheckVerified = pass;
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
    {
      key: 'G',
      run: async () => {
        const outcome = await runGColdRoot(
          {
            createDisposableRoot,
            removeDisposableRoot,
            resolveFlockBinary: resolveFlock,
            hasSqliteArtifacts,
            spawnCheckedRawProcess,
            buildSessionOptions: (coldRoot, overrides) =>
              buildSessionOptions(
                coldRoot,
                ctx.gateEnv,
                { role: overrides.role },
                ctx.cleanupController.getAbortSignal(),
              ),
            spawnSession: ctx.spawnSession,
            checkpoint: ctx.checkpoint,
          },
          {
            ownership: ctx.ownership,
            gateEnv: ctx.gateEnv,
            cleanupController: ctx.cleanupController,
            repositoryRoot: REPOSITORY_ROOT,
          },
        );
        return outcome.result;
      },
    },
    {
      key: 'H',
      run: async () => {
        const rollback = ctx.spawnSession(
          ctx.sessionOpts({ role: 'rollback', useTestHooks: true }),
        );
        const rollbackResult = await rollback.waitForCompletion();
        ctx.checkpoint('H-retry');
        const retry = ctx.spawnSession(ctx.sessionOpts({ role: 'normal' }));
        retry.sendCommand({ command: 'CLOSE' });
        const retryResult = await retry.waitForCompletion();
        ctx.checkpoint('H-done');
        const rollbackCorrelation = { runId: ctx.ownership.runId, role: 'rollback' as const };
        const failedCheck = assertCorrelatedEventPresent(rollbackResult.messages, {
          ...rollbackCorrelation,
          event: 'FAILED',
        });
        const pass =
          rollbackResult.exitCode !== 0 &&
          rollbackResult.exitCode !== null &&
          failedCheck.pass &&
          validateChildExit(retryResult, 'CLOSED');
        return {
          verdict: pass ? 'PASS' : 'FAIL',
          detail: pass
            ? 'rollback-injected-sqlite-failure-then-reopen-on-same-root'
            : (failedCheck.detail ?? 'rollback-scenario-failed'),
        };
      },
    },
    {
      key: 'I',
      run: async () => {
        const repeated = ctx.spawnSession(ctx.sessionOpts({ role: 'repeated-close' }));
        const repeatedResult = await repeated.waitForCompletion();
        ctx.checkpoint('I-reopen');
        const reopen = ctx.spawnSession(ctx.sessionOpts({ role: 'normal' }));
        reopen.sendCommand({ command: 'CLOSE' });
        const reopenResult = await reopen.waitForCompletion();
        ctx.checkpoint('I-done');
        const pass =
          validateChildExit(repeatedResult, 'CLOSED') && validateChildExit(reopenResult, 'CLOSED');
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
    {
      key: 'J',
      run: () => {
        const storageCheck = validateStorageArtifactPermissions(ctx.ownership.storageRootPath);
        const executionCheck = validateExecutionLayout(ctx.ownership);
        const pass = storageCheck.pass && executionCheck.pass;
        ctx.auxiliary.artifactModes = { ...storageCheck.modes, ...executionCheck.modes };
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
    {
      key: 'K',
      run: () => {
        const sample = serializePublicFailure({
          code: 'DURABLE_COMPOSITION_LOCK_HELD',
          event: 'HELD',
        });
        const violations = detectRedactionViolations(sample, ['fake-secret-value']);
        const pass = violations.length === 0;
        ctx.auxiliary.redactionChecks = {
          publicFailureSerialization: pass,
          noSecretLeak: !sample.includes('fake-secret-value'),
        };
        return { verdict: pass ? 'PASS' : 'FAIL' };
      },
    },
  ];
};

export const runScenarios = async (
  evidence: GateEvidence,
  ownership: DisposableRootOwnership,
  gateEnv: Record<string, string>,
  cleanupController: CleanupController,
  trackedSessions: TrackedSession[],
  hooks: RunScenariosHooks = {},
): Promise<{ evidence: GateEvidence; quickCheckVerified: boolean }> => {
  const auxiliary: ScenarioAuxiliary = {
    quickCheckVerified: false,
    childExitCodes: {},
    contentionClassification: null,
    artifactModes: {},
    redactionChecks: {},
  };

  const checkpoint = (label: string): void => {
    cleanupController.throwIfAborted();
    void label;
  };

  const abortSignal = cleanupController.getAbortSignal();
  const spawnSession = (options: ChildSessionOptions): ChildSessionHandle => {
    const spawnFn = hooks.spawnCheckedChildSessionImpl ?? spawnCheckedChildSession;
    const session = spawnFn(options, cleanupController);
    trackedSessions.push(session);
    return session;
  };
  const sessionOpts = (overrides: SessionOverrides): ChildSessionOptions =>
    buildSessionOptions(ownership, gateEnv, overrides, abortSignal);

  const steps = buildGateScenarioSteps({
    ownership,
    gateEnv,
    cleanupController,
    trackedSessions,
    spawnSession,
    sessionOpts,
    checkpoint,
    auxiliary,
    hooks,
  });

  const failFast = await runFailFastScenarioSteps(evidence, steps, recordScenario, {
    beforeStep: (key) => {
      checkpoint(key);
    },
  });

  checkpoint('done');
  return {
    evidence: {
      ...failFast.evidence,
      childExitCodes: { ...failFast.evidence.childExitCodes, ...auxiliary.childExitCodes },
      contentionClassification:
        auxiliary.contentionClassification ?? failFast.evidence.contentionClassification,
      artifactModes: { ...failFast.evidence.artifactModes, ...auxiliary.artifactModes },
      redactionChecks: { ...failFast.evidence.redactionChecks, ...auxiliary.redactionChecks },
    },
    quickCheckVerified: auxiliary.quickCheckVerified,
  };
};

export const runLinuxCompositionGate = async (): Promise<number> => {
  const gate = runEnvironmentGate(process.env, REPOSITORY_ROOT);
  if (gate.classification !== 'PASS') {
    process.stderr.write(`${classificationToStderr(gate.classification)}\n`);
    if (wasProductionFactoryLoaded()) {
      process.stderr.write('PRODUCTION_FACTORY_LOADED_BEFORE_GATE\n');
    }
    return EXIT_ENVIRONMENT_GATE_FAILED;
  }

  const runId = generateRunId();
  const expectedUid =
    typeof process.getuid === 'function' ? process.getuid() : gate.nonRootUserVerified ? 1000 : 0;
  let evidence = createInitialEvidence(runId, gate);
  const cleanupController = createCleanupController();
  let ownership: DisposableRootOwnership | null = null;
  const trackedSessions: TrackedSession[] = [];

  const performCleanup = async (): Promise<void> => {
    const termination = await globalProcessRegistry.terminateAll({ graceMs: 500, killMs: 500 });
    const pendingEventWaitersCleared = computePendingEventWaitersCleared(trackedSessions);
    let rootRemoved = false;
    let executionRootOwnershipVerified = false;
    let storageRootOwnershipVerified = false;
    if (ownership !== null) {
      const removal = removeDisposableRoot(ownership, REPOSITORY_ROOT);
      rootRemoved = removal.removed;
      executionRootOwnershipVerified =
        removal.proof.executionInodeOk &&
        removal.proof.markerOk &&
        removal.proof.notSymlink &&
        removal.proof.notUnsafe;
      storageRootOwnershipVerified = removal.proof.storageValidated;
    }
    evidence = {
      ...evidence,
      cleanup: {
        childrenTerminated: termination.terminated,
        executionRootOwnershipVerified,
        storageRootOwnershipVerified,
        disposableRootRemoved: rootRemoved,
        noOrphans: termination.orphans.length === 0,
        interruptedBySignal: cleanupController.wasInterruptedBySignal(),
        pendingEventWaitersCleared,
      },
    };
  };

  cleanupController.registerSignalHandlers(() => performCleanup());

  try {
    if (process.platform === 'linux') process.umask(0o077);
    ownership = createDisposableRoot(expectedUid, REPOSITORY_ROOT);
    if (cleanupController.isAborted()) {
      await cleanupController.runCleanupOnce();
    } else {
      const gateEnv = gateEnvFromProcess();
      try {
        const scenarioResult = await runScenarios(
          evidence,
          ownership,
          gateEnv,
          cleanupController,
          trackedSessions,
        );
        evidence = scenarioResult.evidence;
        evidence = {
          ...evidence,
          quickCheckVerifiedBySuccessfulCompositionOpen: scenarioResult.quickCheckVerified,
        };
      } catch (error) {
        if (!(error instanceof GateAbortedError)) {
          throw error;
        }
        // Interrupted: leave scenarios as-is; cleanup + FAIL below.
      }
      await cleanupController.runCleanupOnce();
    }
  } catch {
    await cleanupController.runCleanupOnce();
  } finally {
    cleanupController.restoreHandlers();
  }

  // Interrupted state is sticky and cannot be cleared by cleanup success.
  if (cleanupController.wasInterruptedBySignal()) {
    evidence = {
      ...evidence,
      cleanup: {
        ...evidence.cleanup,
        interruptedBySignal: true,
      },
    };
  }

  const finalEvidence = finalizeEvidence(evidence);
  const interrupted = cleanupController.isAborted() || finalEvidence.cleanup.interruptedBySignal;
  const lines = [JSON.stringify(finalEvidence)];
  const mayPass = !interrupted && shouldPrintPassMarker(finalEvidence);
  if (mayPass) {
    lines.push(passMarkerLine());
  }
  const exitCode = mayPass ? 0 : EXIT_ASSERTION_FAILURE;
  await finalizeHarnessOutput({
    writeLine: writeStdoutLine,
    lines,
    code: exitCode,
    preserveFatalExitCode: true,
    getExistingExitCode: () =>
      typeof process.exitCode === 'number' ? process.exitCode : undefined,
    setExitCode: (code) => {
      if (
        (cleanupController.isAborted() || interrupted) &&
        code === 0 &&
        typeof process.exitCode === 'number' &&
        process.exitCode !== 0
      ) {
        return;
      }
      process.exitCode = code;
    },
  });
  if (interrupted && (process.exitCode === undefined || process.exitCode === 0)) {
    process.exitCode = EXIT_ASSERTION_FAILURE;
  }
  return typeof process.exitCode === 'number' ? process.exitCode : exitCode;
};

const isCli =
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (isCli) {
  void runLinuxCompositionGate().then((code) => {
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = code;
    }
  });
}

export { runEnvironmentGate, wasProductionFactoryLoaded };
