import { describe, expect, it } from 'vitest';
import {
  NEO_GATE_EXIT_ENVIRONMENT,
  NEO_GATE_PASS_MARKER,
  NEO_RUNTIME_PROCESS_LOCK_EXIT,
  REQUIRED_SCENARIO_KEYS,
} from '../scripts/integration/lib/neo-runtime-gate-constants.ts';
import {
  detectInheritedCredentialEnv,
  runNeoRuntimeEnvironmentGate,
} from '../scripts/integration/lib/neo-runtime-environment-gate.ts';
import {
  fillUnrunNeoScenariosAfterFailure,
  hasExactNeoScenarioKeySet,
  redactNeoGateText,
  shouldPrintNeoPassMarker,
  createInitialNeoRuntimeEvidence,
  finalizeNeoRuntimeEvidence,
  type NeoReadinessWaitOutcome,
} from '../scripts/integration/lib/neo-runtime-evidence.ts';
import { summarizeBoundedReadinessWaitText } from '../scripts/integration/lib/neo-runtime-scenarios.ts';
import { PASS_MARKER as BUILD_33_PASS_MARKER } from '../scripts/integration/lib/constants.ts';

describe('neo runtime linux gate foundation', () => {
  it('classifies missing opt-in as GATE_OPT_IN_MISSING on Windows', () => {
    const result = runNeoRuntimeEnvironmentGate({}, process.cwd());
    expect(result.classification).toBe('GATE_OPT_IN_MISSING');
  });

  it('uses separate opt-in env from Build 3.3 gate', () => {
    expect(NEO_GATE_PASS_MARKER).not.toBe(BUILD_33_PASS_MARKER);
    expect(REQUIRED_SCENARIO_KEYS).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
  });

  it('requires exact scenario key set L1-L5', () => {
    expect(
      hasExactNeoScenarioKeySet({
        L1: { verdict: 'PASS' },
        L2: { verdict: 'PASS' },
        L3: { verdict: 'PASS' },
        L4: { verdict: 'PASS' },
        L5: { verdict: 'PASS' },
      }),
    ).toBe(true);
    expect(hasExactNeoScenarioKeySet({ L1: { verdict: 'PASS' } })).toBe(false);
  });

  it('fail-fast marks later scenarios SKIP after failure', () => {
    const evidence = fillUnrunNeoScenariosAfterFailure(
      createInitialNeoRuntimeEvidence('run', {
        gitHead: 'abc',
        packageLockSha256: 'def',
        nodeVersion: '22.13.0',
        npmVersion: '10.9.2',
      }),
    );
    expect(evidence.scenarios.L3.verdict).toBe('SKIP');
    expect(evidence.scenarios.L5.verdict).toBe('SKIP');
  });

  it('prints PASS marker only when all scenarios PASS', () => {
    const passEvidence = finalizeNeoRuntimeEvidence(
      {
        ...createInitialNeoRuntimeEvidence('run', {
          gitHead: 'abc',
          packageLockSha256: 'def',
          nodeVersion: '22.13.0',
          npmVersion: '10.9.2',
        }),
        scenarios: {
          L1: { verdict: 'PASS' },
          L2: { verdict: 'PASS' },
          L3: { verdict: 'PASS' },
          L4: { verdict: 'PASS' },
          L5: { verdict: 'PASS' },
        },
      },
      'PASS',
    );
    expect(shouldPrintNeoPassMarker(passEvidence)).toBe(true);
    const failEvidence = {
      ...passEvidence,
      scenarios: { ...passEvidence.scenarios, L2: { verdict: 'FAIL' as const } },
    };
    expect(shouldPrintNeoPassMarker(failEvidence)).toBe(false);
  });

  it('maps L2 second-instance expectation to exit 10 constant', () => {
    expect(NEO_RUNTIME_PROCESS_LOCK_EXIT).toBe(10);
  });

  it('redacts credentials and absolute paths in gate text', () => {
    const redacted = redactNeoGateText(
      'failed at /var/lib/openclaw-neo with token=abc password=secret',
    );
    expect(redacted).not.toContain('/var/lib/openclaw-neo');
    expect(redacted).not.toMatch(/token=abc/i);
  });

  it('detects inherited credential environment variables', () => {
    expect(detectInheritedCredentialEnv({ OPENAI_API_KEY: 'x' })).toBe(true);
    expect(detectInheritedCredentialEnv({ PATH: '/usr/bin' })).toBe(false);
  });

  it('Windows gate without opt-in exits 20 without PASS marker', async () => {
    const { runNeoRuntimeLinuxGate } =
      await import('../scripts/integration/neo-runtime-linux-gate.ts');
    const code = await runNeoRuntimeLinuxGate();
    expect(code).toBe(NEO_GATE_EXIT_ENVIRONMENT);
  });

  it('readiness wait outcomes are bounded and redacted', () => {
    const outcome: NeoReadinessWaitOutcome = {
      ready: false,
      reason: 'readiness-invalid',
      statusExitCode: 2,
      elapsedMs: 98,
      neoChildState: 'alive',
      neoChildExitCode: null,
      neoChildSignal: null,
      statusStdoutSummary: redactNeoGateText(
        summarizeBoundedReadinessWaitText(
          '{"ready":false,"reason":"readiness-invalid","path":"/var/lib/openclaw"}',
        ),
      ),
      statusStderrSummary: '',
    };
    expect(outcome.statusStdoutSummary.length).toBeLessThanOrEqual(256);
    expect(outcome.statusStdoutSummary).not.toContain('/var/lib/openclaw');
    expect(outcome.reason).toBe('readiness-invalid');
    expect(outcome.neoChildState).toBe('alive');
  });
});
