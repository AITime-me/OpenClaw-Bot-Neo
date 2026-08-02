import { chmodSync, closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import type { CleanupController } from './cleanup-controller.ts';
import { GateAbortedError } from './cleanup-controller.ts';
import {
  createDisposableRoot,
  removeDisposableRoot,
  type DisposableRootOwnership,
} from './disposable-root.ts';
import type { ChildSessionHandle, ChildSessionOptions } from './child-runner.ts';
import { FLOCK_HOLDER_SCRIPT_PATH, validateChildExit } from './child-runner.ts';
import { EXIT_LOCK_CONTENTION } from './exit-codes.ts';
import { spawnCheckedRawProcess } from './abort-spawn.ts';
import { buildChildEnvironment } from './child-env.ts';
import { globalProcessRegistry } from './process-registry.ts';
import { fingerprintFile, fingerprintsStableEqual } from './fingerprint.ts';
import { assertFlockReadyBeforeContender, assertHeldLockCode } from './scenario-orchestration.ts';
import { scenarioThrownFailureDetail } from './scenario-fail-fast.ts';
import type { ScenarioResult } from './evidence.ts';

const CHILD_TIMEOUT_MS = 30_000;

export type ScenarioGColdRootDeps = {
  readonly createDisposableRoot: typeof createDisposableRoot;
  readonly removeDisposableRoot: typeof removeDisposableRoot;
  readonly resolveFlockBinary: () => string | null;
  readonly hasSqliteArtifacts: (storageRootPath: string) => boolean;
  readonly spawnCheckedRawProcess: typeof spawnCheckedRawProcess;
  readonly buildSessionOptions: (
    coldRoot: DisposableRootOwnership,
    overrides: { readonly role: 'contender' | 'normal' },
  ) => ChildSessionOptions;
  readonly spawnSession: (options: ChildSessionOptions) => ChildSessionHandle;
  readonly checkpoint: (label: string) => void;
};

export type ScenarioGColdRootParams = {
  readonly ownership: DisposableRootOwnership;
  readonly gateEnv: Record<string, string>;
  readonly cleanupController: CleanupController;
  readonly repositoryRoot: string;
};

export type ScenarioGColdRootOutcome = {
  readonly result: ScenarioResult;
  readonly coldRootRemoved: boolean;
};

const fail = (detail: string): ScenarioResult => ({ verdict: 'FAIL', detail });

/**
 * Scenario G cold-root lifecycle with guaranteed single removal attempt in finally.
 */
export const runScenarioGColdRoot = async (
  deps: ScenarioGColdRootDeps,
  params: ScenarioGColdRootParams,
): Promise<ScenarioGColdRootOutcome> => {
  const flockBinary = deps.resolveFlockBinary();
  if (flockBinary === null) {
    return { result: fail('flock-binary-missing'), coldRootRemoved: true };
  }

  const coldRoot = deps.createDisposableRoot(params.ownership.uid, params.repositoryRoot);
  let coldRootRemoved = false;
  let result: ScenarioResult = fail('scenario-g-incomplete');
  let abortError: GateAbortedError | undefined;

  const ensureColdRootRemoved = (): boolean => {
    if (coldRootRemoved) {
      return true;
    }
    try {
      const removal = deps.removeDisposableRoot(coldRoot, params.repositoryRoot);
      coldRootRemoved = true;
      return removal.removed;
    } catch {
      coldRootRemoved = true;
      return false;
    }
  };

  try {
    const gTimeline: string[] = [];
    const lockPath = join(coldRoot.storageRootPath, 'neo.primary.lock');
    const lockFd = openSync(lockPath, 'w');
    closeSync(lockFd);
    chmodSync(lockPath, 0o600);
    const lockBefore = fingerprintFile(lockPath);
    const beforeSqlite = deps.hasSqliteArtifacts(coldRoot.storageRootPath);

    const flockEnv = buildChildEnvironment(process.env, {
      ...params.gateEnv,
      OPENCLAW_B3C4_RUN_ID: coldRoot.runId,
      OPENCLAW_B3C4_ROLE: 'flock-wait',
      OPENCLAW_B3C4_PARENT_CAPABILITY: coldRoot.capability,
      OPENCLAW_B3C4_REPOSITORY_ROOT: params.repositoryRoot,
      OPENCLAW_B3C4_PROTOCOL_VERSION: '1',
    });

    deps.checkpoint('G-flock');
    const flockChecked = deps.spawnCheckedRawProcess(
      flockBinary,
      [
        '--exclusive',
        lockPath,
        process.execPath,
        '--experimental-strip-types',
        FLOCK_HOLDER_SCRIPT_PATH,
      ],
      {
        env: flockEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform === 'linux',
      },
      params.cleanupController,
    );
    const flockProcess = flockChecked.process;
    const flockRegistryId = flockChecked.registryId;

    if (flockProcess.stdout === null) {
      result = fail('flock-stdout-missing');
    } else {
      let flockBuffer = '';
      const flockStdout = flockProcess.stdout;
      const flockReadyPromise = new Promise<boolean>((resolveReady) => {
        const timer = setTimeout(() => {
          resolveReady(false);
        }, CHILD_TIMEOUT_MS);
        flockStdout.on('data', (chunk: Buffer | string) => {
          flockBuffer += chunk.toString();
          let newline = flockBuffer.indexOf('\n');
          while (newline >= 0) {
            const line = flockBuffer.slice(0, newline).trim();
            flockBuffer = flockBuffer.slice(newline + 1);
            if (line.length > 0) {
              try {
                const parsed = JSON.parse(line) as { event?: string };
                if (parsed.event === 'READY') {
                  clearTimeout(timer);
                  gTimeline.push('FLOCK_READY');
                  resolveReady(true);
                }
              } catch {
                // ignore non-protocol noise
              }
            }
            newline = flockBuffer.indexOf('\n');
          }
        });
      });

      const flockExit = new Promise<number | null>((resolvePromise) => {
        flockProcess.on('close', (code) => {
          globalProcessRegistry.markExited(flockRegistryId);
          resolvePromise(code);
        });
      });

      const flockReady = await flockReadyPromise;
      deps.checkpoint('G-contender');

      gTimeline.push('CONTENDER_SPAWN');
      const contender = deps.spawnSession(
        deps.buildSessionOptions(coldRoot, { role: 'contender' }),
      );
      const contenderResult = await contender.waitForCompletion();
      const afterSqlite = deps.hasSqliteArtifacts(coldRoot.storageRootPath);

      try {
        flockProcess.stdin?.write(`${JSON.stringify({ v: 1, command: 'EXIT' })}\n`);
      } catch {
        // best effort
      }
      if (flockProcess.pid !== undefined && process.platform === 'linux') {
        try {
          process.kill(-flockProcess.pid, 'SIGTERM');
        } catch {
          // best effort
        }
      }
      await flockExit;
      deps.checkpoint('G-reopen');

      const reopen = deps.spawnSession(deps.buildSessionOptions(coldRoot, { role: 'normal' }));
      reopen.sendCommand({ command: 'CLOSE' });
      const reopenResult = await reopen.waitForCompletion();
      const lockAfter = fingerprintFile(lockPath);

      const pass =
        flockReady &&
        assertFlockReadyBeforeContender(gTimeline) &&
        !beforeSqlite &&
        !afterSqlite &&
        contenderResult.exitCode === EXIT_LOCK_CONTENTION &&
        assertHeldLockCode(contenderResult.messages) &&
        validateChildExit(reopenResult, 'CLOSED') &&
        fingerprintsStableEqual(lockBefore, lockAfter);

      result = { verdict: pass ? 'PASS' : 'FAIL' };
    }
  } catch (error) {
    if (error instanceof GateAbortedError) {
      abortError = error;
    } else {
      result = { verdict: 'FAIL', detail: scenarioThrownFailureDetail(error) };
    }
  } finally {
    const removed = ensureColdRootRemoved();
    if (abortError === undefined && result.verdict === 'PASS' && !removed) {
      result = fail('cold-root-removal-failed');
    }
  }

  if (abortError !== undefined) {
    throw abortError;
  }

  return { result, coldRootRemoved };
};
