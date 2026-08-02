import { GATE_SCHEMA_VERSION, PASS_MARKER, REQUIRED_SCENARIO_KEYS } from './constants.ts';

export type ScenarioVerdict = 'PASS' | 'FAIL' | 'SKIP';

export type ScenarioResult = {
  readonly verdict: ScenarioVerdict;
  readonly detail?: string;
};

export type GateEvidence = {
  readonly schemaVersion: typeof GATE_SCHEMA_VERSION;
  readonly runId: string;
  readonly verdict: 'PASS' | 'FAIL';
  readonly gitHead: string;
  readonly packageLockSha256: string;
  readonly os: {
    readonly id: string;
    readonly versionId: string;
    readonly architecture: string;
    readonly libc: string;
    readonly libcFamily: string;
    readonly libcVersion: string;
  };
  readonly runtime: {
    readonly node: string;
    readonly npm: string;
  };
  readonly filesystem: {
    readonly type: string;
    readonly localVerified: boolean;
    readonly overlayFilesystem?: boolean;
  };
  readonly networkIsolationVerified: boolean;
  readonly nonRootUserVerified: boolean;
  readonly scenarios: Record<string, ScenarioResult>;
  readonly childExitCodes: Record<string, number>;
  readonly contentionClassification: string | null;
  readonly quickCheckVerifiedBySuccessfulCompositionOpen: boolean;
  readonly artifactModes: Record<string, number | null>;
  readonly redactionChecks: Record<string, boolean>;
  readonly cleanup: {
    readonly childrenTerminated: boolean;
    readonly executionRootOwnershipVerified: boolean;
    readonly storageRootOwnershipVerified: boolean;
    readonly disposableRootRemoved: boolean;
    readonly noOrphans: boolean;
    readonly interruptedBySignal: boolean;
    readonly pendingEventWaitersCleared: boolean;
  };
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
};

export const UNRUN_AFTER_PRIOR_FAILURE_DETAIL = 'not-run-after-prior-failure' as const;

export const fillUnrunScenariosAfterFailure = (
  evidence: GateEvidence,
  detail: string = UNRUN_AFTER_PRIOR_FAILURE_DETAIL,
): GateEvidence => {
  let scenarios = { ...evidence.scenarios };
  for (const key of REQUIRED_SCENARIO_KEYS) {
    if (scenarios[key] === undefined) {
      scenarios = { ...scenarios, [key]: { verdict: 'SKIP', detail } };
    }
  }
  return { ...evidence, scenarios };
};

export const hasExactScenarioKeySet = (scenarios: Record<string, ScenarioResult>): boolean => {
  const keys = Object.keys(scenarios).sort();
  const required = [...REQUIRED_SCENARIO_KEYS].sort();
  if (keys.length !== required.length) return false;
  return keys.every((key, index) => key === required[index]);
};

export const createInitialEvidence = (
  runId: string,
  gate: {
    gitHead: string;
    packageLockSha256: string;
    osId: string;
    osVersionId: string;
    architecture: string;
    libc: string;
    libcFamily: string;
    libcVersion: string;
    nodeVersion: string;
    npmVersion: string;
    filesystemType: string;
    localVerified: boolean;
    networkIsolationVerified: boolean;
    nonRootUserVerified: boolean;
    overlayFilesystem: boolean;
  },
): GateEvidence => ({
  schemaVersion: GATE_SCHEMA_VERSION,
  runId,
  verdict: 'FAIL',
  gitHead: gate.gitHead,
  packageLockSha256: gate.packageLockSha256,
  os: {
    id: gate.osId,
    versionId: gate.osVersionId,
    architecture: gate.architecture,
    libc: gate.libc,
    libcFamily: gate.libcFamily,
    libcVersion: gate.libcVersion,
  },
  runtime: { node: gate.nodeVersion, npm: gate.npmVersion },
  filesystem: {
    type: gate.filesystemType,
    localVerified: gate.localVerified,
    ...(gate.overlayFilesystem ? { overlayFilesystem: true } : {}),
  },
  networkIsolationVerified: gate.networkIsolationVerified,
  nonRootUserVerified: gate.nonRootUserVerified,
  scenarios: {},
  childExitCodes: {},
  contentionClassification: null,
  quickCheckVerifiedBySuccessfulCompositionOpen: false,
  artifactModes: {},
  redactionChecks: {},
  cleanup: {
    childrenTerminated: false,
    executionRootOwnershipVerified: false,
    storageRootOwnershipVerified: false,
    disposableRootRemoved: false,
    noOrphans: false,
    interruptedBySignal: false,
    pendingEventWaitersCleared: false,
  },
  startedAtUtc: new Date().toISOString(),
  completedAtUtc: new Date().toISOString(),
});

export const finalizeEvidence = (evidence: GateEvidence): GateEvidence => {
  const exactKeys = hasExactScenarioKeySet(evidence.scenarios);
  const allPass =
    exactKeys && REQUIRED_SCENARIO_KEYS.every((key) => evidence.scenarios[key]?.verdict === 'PASS');
  const noSkip =
    exactKeys && REQUIRED_SCENARIO_KEYS.every((key) => evidence.scenarios[key]?.verdict !== 'SKIP');
  const cleanupOk =
    evidence.cleanup.childrenTerminated &&
    evidence.cleanup.executionRootOwnershipVerified &&
    evidence.cleanup.storageRootOwnershipVerified &&
    evidence.cleanup.disposableRootRemoved &&
    evidence.cleanup.noOrphans &&
    evidence.cleanup.pendingEventWaitersCleared &&
    !evidence.cleanup.interruptedBySignal;
  const verdict = allPass && noSkip && cleanupOk ? 'PASS' : 'FAIL';
  return {
    ...evidence,
    verdict,
    completedAtUtc: new Date().toISOString(),
  };
};

export const shouldPrintPassMarker = (evidence: GateEvidence): boolean =>
  evidence.verdict === 'PASS' &&
  hasExactScenarioKeySet(evidence.scenarios) &&
  REQUIRED_SCENARIO_KEYS.every((key) => evidence.scenarios[key]?.verdict === 'PASS') &&
  evidence.cleanup.disposableRootRemoved &&
  evidence.cleanup.noOrphans &&
  evidence.cleanup.childrenTerminated &&
  evidence.cleanup.executionRootOwnershipVerified &&
  evidence.cleanup.storageRootOwnershipVerified &&
  evidence.cleanup.pendingEventWaitersCleared &&
  !evidence.cleanup.interruptedBySignal;

export const passMarkerLine = (): string => PASS_MARKER;
