import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md',
);

const IMPLEMENTATION_COMMIT = '6427a34b07ef9a4b031cafa9737d660a2fc265b4';
const PARENT_COMMIT = '893c2adb93b19bbbfb5157d067a88376693cfaa2';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';
const PREV_INVENTORY_SHA256 = 'b94004304f12ca7c538db452726f2015a5e00164f64ffc41a7d0b05d577c5a80';
const MANIFEST_SHA256 = '4766988d0505478cf9310c1c139c6f1984fe673e1ba8d0389660b69ef7b74be5';

const FINAL_DISPOSITION =
  'R6_M02_SECURITY_FINDING_CLOSED_WITH_PREIMPORT_NODE_GATE_AND_SYSTEMD_EXIT3_NONRESTART_PROOF';

const N_PROOFS = [
  'N1 supported production launcher always gates',
  'N2 no runtime opt-in bypass',
  'N3 gate precedes application/runtime imports',
  'N4 gate precedes config/native/durable side effects',
  'N5 CI and runtime share the canonical contract',
  'N6 no supported lower-level production entrypoint bypass',
  'N7 unsupported and malformed failures are deterministic and bounded',
  'N8 Node 22.13.0 and later Node 22 compatibility preserved',
  'N9 production launcher requires no npm',
  'N10 unsupported runtime cannot publish readiness',
  'N11 diagnostics remain false',
  'N12 status CLI decision is explicit and non-bypassing',
  'N13 exit code 3 propagates through the launcher to systemd',
  'N14 systemd suppresses restart for status 3',
  'N15 package-lock and dependencies remain unchanged',
] as const;

describe('Codex Review 6 R6-M02 closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact remediation identities', () => {
    expect(record).toContain(IMPLEMENTATION_COMMIT);
    expect(record).toContain(PARENT_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(
      'fix(neo-runtime): enforce Node runtime contract in production launcher',
    );
    expect(record).toContain('>=22.13.0 <23');
  });

  it('records independent source approval with notes', () => {
    expect(record).toContain('APPROVE_WITH_NOTES_R6_M02_SOURCE_FOR_FOCUSED_SYSTEMD_REGRESSION');
    expect(record).toContain(
      'R6_M02_INDEPENDENT_SOURCE_REVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_SYSTEMD_REGRESSION',
    );
  });

  it('records N1–N15 PASS', () => {
    for (const proof of N_PROOFS) {
      expect(record).toContain(proof);
      expect(record).toContain('| PASS |');
    }
  });

  it('records exact final disposition and broad security flags false', () => {
    expect(record).toContain(FINAL_DISPOSITION);
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('AUTHORITATIVE_SECURITY_VALIDATION=false');
    expect(record).toContain('SECRET_PROVIDER_CONFIGURED=false');
    expect(record).toContain('ENCRYPTION_ENABLED=false');
    expect(record).toContain('securityApprovalComplete');
    expect(record).toContain('deploymentReady');
    expect(record).toContain('secretProviderConfigured');
    expect(record).toContain('encryptionEnabled');
  });

  it('records exit 3 and RestartPreventExitStatus=10 3', () => {
    expect(record).toContain('RestartPreventExitStatus=10 3');
    expect(record).toContain('exit code **3**');
    expect(record).toContain('application status **3**');
  });

  it('records supported scenario PASS', () => {
    expect(record).toContain('### 1. Supported scenario — PASS');
    expect(record).toContain('runtimeReady=true');
    expect(record).toContain(PREV_INVENTORY_SHA256);
  });

  it('records first unsupported harness failure at 226/NAMESPACE honestly', () => {
    expect(record).toContain('### 2. First unsupported companion attempt — harness failure');
    expect(record).toContain('226/NAMESPACE');
    expect(record).toContain('Wrapper invocations | 0');
    expect(record).toContain('**not** a source remediation failure');
    expect(record).toContain('must not be merged into successful unsupported');
  });

  it('records unsupported rerun PASS with importer-not-called proof', () => {
    expect(record).toContain(
      'R6_M02_FOCUSED_SYSTEMD_UNSUPPORTED_RERUN_PASSED_READY_FOR_SECURITY_FINDING_CLOSEOUT',
    );
    expect(record).toContain('Wrapper invocations | exactly **1**');
    expect(record).toContain('Importer sentinel | absent');
    expect(record).toContain('Node 23.0.0 is outside the production support range >=22.13.0 <23.');
    expect(record).toContain(MANIFEST_SHA256);
  });

  it('records ExecMainCode CLD_EXITED semantics and ExecMainStatus 3', () => {
    expect(record).toContain('ExecMainCode=1');
    expect(record).toContain('CLD_EXITED');
    expect(record).toContain('ExecMainStatus=3');
    expect(record).toContain('semantic interpretation only');
    expect(record).toContain('without issuing another `systemctl start`');
  });

  it('records NRestarts=0 and no restart loop', () => {
    expect(record).toContain('`NRestarts=0`');
    expect(record).toContain('no restart loop was observed after 12 seconds');
  });

  it('records artifact isolation and status CLI ungated disposition', () => {
    expect(record).toContain('readiness file | absent');
    expect(record).toContain('process lock | absent');
    expect(record).toContain('SQLite / WAL / SHM | absent');
    expect(record).toContain('intentionally ungated');
    expect(record).toContain('{"ready":false,"reason":"readiness-absent"}');
  });

  it('records full L1–L5 not required and focused regression PASS', () => {
    expect(record).toContain('FOCUSED_SYSTEMD_REGRESSION_PASSED');
    expect(record).toContain('FULL_LINUX_L1_L5_RUN=false');
    expect(record).toContain('FULL_LINUX_L1_L5_NOT_REQUIRED=true');
  });

  it('names R6-M03 as next and keeps remaining findings open', () => {
    const openFindingsIndex = record.indexOf('## Open findings');
    const m03Index = record.indexOf('**R6-M03**');
    expect(m03Index).toBeGreaterThan(openFindingsIndex);
    expect(record).toContain('starting with **R6-M03**');
    for (const id of ['R6-L01', 'R6-L02', 'R6-L03', 'R6-L04']) {
      expect(record).toContain(id);
    }
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
  });

  it('records INFO notes as non-blocking backlog', () => {
    expect(record).toContain('#### R6-M02-INFO-01');
    expect(record).toContain('#### R6-M02-INFO-02');
    expect(record).toContain('#### R6-M02-INFO-03');
    expect(record).toContain('#### R6-M02-INFO-04');
    expect(record).toContain('Do **not** convert INFO notes into new Review №6 findings');
  });

  it('does not claim production or VPS validation', () => {
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
    expect(record).toContain('does **not** establish');
    expect(record).toContain('Not production deployment');
    expect(record).toContain('NONAUTHORITATIVE_R6_M02_SYSTEMD_REGRESSION=true');
  });

  it('does not store absolute evidence paths', () => {
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Codex Review 6 R6-M02 diagnostics unchanged', () => {
  it('keeps deployment, security, and integration flags false', () => {
    for (const diagnostics of [
      NEO_RUNTIME_DIAGNOSTICS,
      POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS,
    ]) {
      expect(diagnostics.deploymentReady).toBe(false);
      expect(diagnostics.securityApprovalComplete).toBe(false);
      expect(diagnostics.secretProviderConfigured).toBe(false);
      expect(diagnostics.encryptionEnabled).toBe(false);
      expect(diagnostics.durableApprovalPort).toBe(false);
      expect(diagnostics.durableAuditPort).toBe(false);
    }
  });
});
