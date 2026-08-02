import { REQUIRED_SCENARIO_KEYS } from './constants.ts';
import { GateAbortedError } from './cleanup-controller.ts';
import {
  fillUnrunScenariosAfterFailure,
  type GateEvidence,
  type ScenarioResult,
} from './evidence.ts';
import { safeSerializeForEvidence } from './redaction.ts';

export type ScenarioStep = {
  readonly key: (typeof REQUIRED_SCENARIO_KEYS)[number];
  readonly run: () => Promise<ScenarioResult> | ScenarioResult;
};

export type FailFastRunResult = {
  readonly evidence: GateEvidence;
  readonly stoppedAt: string | null;
  readonly callOrder: readonly string[];
};

export type RecordScenarioFn = (
  evidence: GateEvidence,
  key: string,
  result: ScenarioResult,
) => GateEvidence;

export type FailFastRunOptions = {
  readonly beforeStep?: (key: string) => void;
};

export const scenarioThrownFailureDetail = (error: unknown): string => {
  const payload =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { error: String(error) };
  const serialized = safeSerializeForEvidence(payload);
  return typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
};

export const assertExactGateScenarioStepKeys = (
  steps: readonly ScenarioStep[],
): readonly string[] => {
  const keys = steps.map((step) => step.key);
  const required = [...REQUIRED_SCENARIO_KEYS];
  if (keys.length !== required.length) {
    throw new Error(
      `expected ${String(required.length)} scenario steps, got ${String(keys.length)}`,
    );
  }
  for (let index = 0; index < required.length; index += 1) {
    if (keys[index] !== required[index]) {
      throw new Error(`scenario step order mismatch at index ${String(index)}`);
    }
  }
  return keys;
};

/**
 * Production-used fail-fast sequencer for gate scenarios A–K.
 * Stops after first FAIL; fills later keys with SKIP.
 */
export const runFailFastScenarioSteps = async (
  initialEvidence: GateEvidence,
  steps: readonly ScenarioStep[],
  recordScenario: RecordScenarioFn,
  options: FailFastRunOptions = {},
): Promise<FailFastRunResult> => {
  assertExactGateScenarioStepKeys(steps);

  let current = initialEvidence;
  const callOrder: string[] = [];
  let stoppedAt: string | null = null;

  for (const step of steps) {
    options.beforeStep?.(step.key);
    callOrder.push(step.key);
    let result: ScenarioResult;
    try {
      result = await step.run();
    } catch (error) {
      if (error instanceof GateAbortedError) {
        throw error;
      }
      result = { verdict: 'FAIL', detail: scenarioThrownFailureDetail(error) };
    }
    current = recordScenario(current, step.key, result);
    if (result.verdict === 'FAIL') {
      current = fillUnrunScenariosAfterFailure(current);
      stoppedAt = step.key;
      break;
    }
  }

  return { evidence: current, stoppedAt, callOrder };
};

export const computePendingEventWaitersCleared = (
  trackedSessions: readonly { pendingEventWaiterCount: () => number }[],
): boolean => trackedSessions.every((session) => session.pendingEventWaiterCount() === 0);
