import {
  NEO_GATE_PASS_MARKER,
  NEO_GATE_SCHEMA_VERSION,
  REQUIRED_SCENARIO_KEYS,
  type NeoRuntimeScenarioKey,
} from './neo-runtime-gate-constants.ts';

export type NeoScenarioVerdict = 'PASS' | 'FAIL' | 'SKIP';

export type NeoReadinessWaitOutcome = {
  readonly ready: boolean;
  readonly reason?: string;
  readonly statusExitCode: number | null;
  readonly elapsedMs: number;
  readonly neoChildState: 'alive' | 'exited' | 'unknown';
  readonly neoChildExitCode: number | null;
  readonly neoChildSignal: string | null;
  readonly statusStdoutSummary: string;
  readonly statusStderrSummary: string;
};

export type NeoScenarioResult = {
  readonly verdict: NeoScenarioVerdict;
  readonly detail?: string;
};

export type NeoRuntimeGateEvidence = {
  readonly schemaVersion: typeof NEO_GATE_SCHEMA_VERSION;
  readonly runId: string;
  readonly verdict: 'PASS' | 'FAIL';
  readonly gitHead: string;
  readonly packageLockSha256: string;
  readonly environment: {
    readonly platform: string;
    readonly node: string;
    readonly npm: string;
  };
  readonly scenarios: Record<NeoRuntimeScenarioKey, NeoScenarioResult>;
  readonly childExitCodes: Record<string, number>;
  readonly signalOutcomes: Record<string, string>;
  readonly readinessTransitions: Record<string, string>;
  readonly readinessWaitOutcomes: Record<string, NeoReadinessWaitOutcome>;
  readonly secondInstanceExitCode: number | null;
  readonly lockReacquired: boolean | null;
  readonly stderrRedacted: boolean;
  readonly cleanup: {
    readonly childrenTerminated: boolean;
    readonly childrenReaped: boolean;
    readonly noOrphans: boolean;
    readonly noZombies: boolean;
    readonly pendingWaitersCleared: boolean;
    readonly executionRootsRemoved: boolean;
    readonly processGroupsEmpty: boolean;
  };
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
};

export const UNRUN_AFTER_PRIOR_FAILURE_DETAIL = 'not-run-after-prior-failure' as const;

export const createInitialNeoRuntimeEvidence = (
  runId: string,
  gate: {
    gitHead: string;
    packageLockSha256: string;
    nodeVersion: string;
    npmVersion: string;
  },
): NeoRuntimeGateEvidence => ({
  schemaVersion: NEO_GATE_SCHEMA_VERSION,
  runId,
  verdict: 'FAIL',
  gitHead: gate.gitHead,
  packageLockSha256: gate.packageLockSha256,
  environment: {
    platform: process.platform,
    node: gate.nodeVersion,
    npm: gate.npmVersion,
  },
  scenarios: {} as Record<NeoRuntimeScenarioKey, NeoScenarioResult>,
  childExitCodes: {},
  signalOutcomes: {},
  readinessTransitions: {},
  readinessWaitOutcomes: {},
  secondInstanceExitCode: null,
  lockReacquired: null,
  stderrRedacted: true,
  cleanup: {
    childrenTerminated: false,
    childrenReaped: false,
    noOrphans: false,
    noZombies: false,
    pendingWaitersCleared: true,
    executionRootsRemoved: false,
    processGroupsEmpty: false,
  },
  startedAtUtc: new Date().toISOString(),
  completedAtUtc: new Date().toISOString(),
});

export const fillUnrunNeoScenariosAfterFailure = (
  evidence: NeoRuntimeGateEvidence,
  detail: string = UNRUN_AFTER_PRIOR_FAILURE_DETAIL,
): NeoRuntimeGateEvidence => {
  const scenarios = { ...evidence.scenarios };
  for (const key of REQUIRED_SCENARIO_KEYS) {
    if (!(key in scenarios)) scenarios[key] = { verdict: 'SKIP', detail };
  }
  return { ...evidence, scenarios };
};

export const hasExactNeoScenarioKeySet = (
  scenarios: Record<string, NeoScenarioResult>,
): boolean => {
  const keys = Object.keys(scenarios).sort();
  const required = [...REQUIRED_SCENARIO_KEYS].sort();
  if (keys.length !== required.length) return false;
  return keys.every((key, index) => key === required[index]);
};

export const finalizeNeoRuntimeEvidence = (
  evidence: NeoRuntimeGateEvidence,
  verdict: 'PASS' | 'FAIL',
): NeoRuntimeGateEvidence => ({
  ...evidence,
  verdict,
  completedAtUtc: new Date().toISOString(),
});

export const passMarkerLine = (): string => NEO_GATE_PASS_MARKER;

export const shouldPrintNeoPassMarker = (evidence: NeoRuntimeGateEvidence): boolean => {
  if (evidence.verdict !== 'PASS' || !hasExactNeoScenarioKeySet(evidence.scenarios)) return false;
  return Object.values(evidence.scenarios).every((scenario) => scenario.verdict === 'PASS');
};

export const redactNeoGateText = (text: string): string =>
  text
    .replace(/\/(?:var|run|etc|home|opt)[^\s'"]+/g, '<path>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>')
    .replace(/\b(token|secret|password|apikey|api_key)\b/gi, '<redacted>');
