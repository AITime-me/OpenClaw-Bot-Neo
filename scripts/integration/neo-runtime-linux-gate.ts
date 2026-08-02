/**
 * Build 3.4D Neo runtime Linux integration gate harness.
 * Does not execute scenarios unless OPENCLAW_LINUX_NEO_RUNTIME_GATE=1 on Linux.
 */
import { randomBytes } from 'node:crypto';
import {
  NEO_GATE_EXIT_ASSERTION,
  NEO_GATE_EXIT_ENVIRONMENT,
  NEO_GATE_EXIT_SUCCESS,
  REQUIRED_SCENARIO_KEYS,
} from './lib/neo-runtime-gate-constants.ts';
import {
  classificationToStderr,
  runNeoRuntimeEnvironmentGate,
} from './lib/neo-runtime-environment-gate.ts';
import {
  createInitialNeoRuntimeEvidence,
  fillUnrunNeoScenariosAfterFailure,
  finalizeNeoRuntimeEvidence,
  passMarkerLine,
  redactNeoGateText,
  shouldPrintNeoPassMarker,
} from './lib/neo-runtime-evidence.ts';
import { NeoRuntimeProcessManager } from './lib/neo-runtime-process-manager.ts';
import {
  cleanupScenarioRoots,
  createScenarioContext,
  NEO_SCENARIO_RUNNERS,
} from './lib/neo-runtime-scenarios.ts';

const REPOSITORY_ROOT = process.cwd();

const generateRunId = (): string => randomBytes(8).toString('hex');

const writeStdout = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export const runNeoRuntimeLinuxGate = async (): Promise<number> => {
  const gate = runNeoRuntimeEnvironmentGate(process.env, REPOSITORY_ROOT);
  if (gate.classification !== 'PASS') {
    process.stderr.write(`${classificationToStderr(gate.classification)}\n`);
    return NEO_GATE_EXIT_ENVIRONMENT;
  }

  const runId = generateRunId();
  let evidence = createInitialNeoRuntimeEvidence(runId, gate);
  const manager = new NeoRuntimeProcessManager();
  let failed = false;

  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const ctx = createScenarioContext(REPOSITORY_ROOT, manager, uid);

    for (const key of REQUIRED_SCENARIO_KEYS) {
      if (failed) {
        evidence = {
          ...evidence,
          scenarios: { ...evidence.scenarios, [key]: { verdict: 'SKIP', detail: 'prior-failure' } },
        };
        continue;
      }
      const outcome = await NEO_SCENARIO_RUNNERS[key](ctx);
      evidence = {
        ...evidence,
        scenarios: { ...evidence.scenarios, [key]: outcome.result },
        childExitCodes: { ...evidence.childExitCodes, ...outcome.childExitCodes },
        signalOutcomes: { ...evidence.signalOutcomes, ...outcome.signalOutcomes },
        readinessTransitions: {
          ...evidence.readinessTransitions,
          ...outcome.readinessTransitions,
        },
        secondInstanceExitCode: outcome.secondInstanceExitCode ?? evidence.secondInstanceExitCode,
        lockReacquired: outcome.lockReacquired ?? evidence.lockReacquired,
      };
      if (outcome.result.verdict !== 'PASS') failed = true;
    }
  } finally {
    const cleanup = await manager.terminateAll({ graceMs: 2_000, killMs: 2_000 });
    cleanupScenarioRoots();
    evidence = {
      ...evidence,
      cleanup: {
        ...evidence.cleanup,
        childrenTerminated: cleanup.childrenTerminated,
        childrenReaped: cleanup.childrenReaped,
        noOrphans: cleanup.noOrphans,
        noZombies: cleanup.noZombies,
        processGroupsEmpty: cleanup.processGroupsEmpty,
        executionRootsRemoved: true,
      },
    };
  }

  if (failed) {
    evidence = fillUnrunNeoScenariosAfterFailure(evidence);
    evidence = finalizeNeoRuntimeEvidence(evidence, 'FAIL');
    writeStdout(redactNeoGateText(JSON.stringify(evidence)));
    return NEO_GATE_EXIT_ASSERTION;
  }

  evidence = finalizeNeoRuntimeEvidence(evidence, 'PASS');
  writeStdout(redactNeoGateText(JSON.stringify(evidence)));
  if (shouldPrintNeoPassMarker(evidence)) writeStdout(passMarkerLine());
  return NEO_GATE_EXIT_SUCCESS;
};
