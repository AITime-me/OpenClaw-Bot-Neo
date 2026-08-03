import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md',
);

const PRIMARY_COMMIT = 'eee734a2e4d4a5e0689c2e039dfa04d18e4d8880';
const CORRECTIVE_COMMIT = '7a1fbbd52b3ad4145955139c469c2e31fa4660f5';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';
const MANIFEST_SHA256 = 'ace16a4e3474de4596b8b253e1711d30bcd3ee43b8ac892ca9c411edcda95e3a';

const FINAL_DISPOSITION =
  'R6_M03_SECURITY_FINDING_CLOSED_WITH_LIVE_PROCESS_IDENTITY_BOUND_READINESS';

const LINUX_PASS_TOKEN =
  'R6_M03_FOCUSED_LINUX_READINESS_IDENTITY_REGRESSION_PASSED_READY_FOR_SECURITY_FINDING_CLOSEOUT';

const P_PROOFS = [
  'P1 exact process binding',
  'P2 PID reuse resistance',
  'P3 reboot resistance',
  'P4 dead-process rejection',
  'P5 zombie/dead rejection',
  'P6 legacy fail-closed',
  'P7 malformed fail-closed',
  'P8 probe errors fail-closed',
  'P9 publisher refuses unbound readiness',
  'P10 atomic publication preserved',
  'P11 R6-H01 preserved',
  'P12 status read-only',
  'P13 no process-lock disturbance',
  'P14 supported Linux compatibility proven in focused regression',
  'P15 diagnostics remain false',
  'P16 no supported raw-readiness bypass',
  'P17 start ticks remain precision-safe',
  'P18 production cannot silently use fake provider',
] as const;

describe('Codex Review 6 R6-M03 closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with both implementation commits recorded', () => {
    expect(record).toContain(PRIMARY_COMMIT);
    expect(record).toContain(CORRECTIVE_COMMIT);
    expect(record).toContain('fix(neo-runtime): bind readiness to the live process instance');
    expect(record).toContain('fix(neo-runtime): harden procfs reads and verified status snapshots');
    expect(record).toContain(PACKAGE_LOCK_SHA256);
  });

  it('records initial blocked review and corrective approval', () => {
    expect(record).toContain('BLOCK_R6_M03');
    expect(record).toContain('R6_M03_INDEPENDENT_SOURCE_REVIEW_BLOCKED');
    expect(record).toContain('R6_M03_PROCFS_SIZE_TRUSTED_EMPTY_READ');
    expect(record).toContain('R6_M03_STATUS_DOUBLE_READ_SKIPS_REVERIFY');
    expect(record).toContain(
      'APPROVE_WITH_NOTES_R6_M03_CORRECTIVE_SOURCE_FOR_FOCUSED_LINUX_READINESS_IDENTITY_REGRESSION',
    );
    expect(record).toContain(
      'R6_M03_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_LINUX_REGRESSION',
    );
    expect(record).toContain('BLOCKER-01 | CLOSED');
    expect(record).toContain('MEDIUM-01 | CLOSED');
  });

  it('records schema v2 identity fields and schema v1 fail-closed', () => {
    expect(record).toContain('readiness schema version **2**');
    expect(record).toContain('required PID');
    expect(record).toContain('required Linux boot ID');
    expect(record).toContain('start-time ticks stored as decimal string');
    expect(record).toContain('schema v1 never accepted as ready');
    expect(record).toContain('`/proc/<pid>/stat`');
  });

  it('records final Linux PASS token and procfs st_size zero proof', () => {
    expect(record).toContain(LINUX_PASS_TOKEN);
    expect(record).toContain('`/proc/self/stat`');
    expect(record).toContain('Reported `st_size`');
    expect(record).toContain('| 0 | 301 |');
    expect(record).toContain('| 0 | 37 |');
    expect(record).toContain('independently of reported size');
  });

  it('records live status exit 0 and identity proofs', () => {
    expect(record).toContain('exit **0**, `ready:true`');
    expect(record).toContain('Live Neo PID | **869**');
    expect(record).toContain('`2728` = `2728`');
    expect(record).toContain('`c79e9c17-8265-47a0-b983-06f1dbfdf241`');
    expect(record).toContain('**869** = **869**');
    expect(record).toContain('`ready.json` unchanged');
  });

  it('records mismatch and SIGKILL stale rejections', () => {
    expect(record).toContain('process-identity-mismatch');
    expect(record).toContain('process-boot-mismatch');
    expect(record).toContain('SIGKILL');
    expect(record).toContain('process-absent');
    expect(record).toContain('unchanged by status');
  });

  it('records P1–P18 PASS and manifest SHA', () => {
    for (const proof of P_PROOFS) {
      expect(record).toContain(proof);
      expect(record).toContain('| PASS |');
    }
    expect(record).toContain('OK=**93**');
    expect(record).toContain('FAIL=**0**');
    expect(record).toContain(MANIFEST_SHA256);
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
  });

  it('names R6-L01 as next and keeps Review №6 open', () => {
    const openFindingsIndex = record.indexOf('## Open findings');
    const l01Index = record.indexOf('**R6-L01**');
    expect(l01Index).toBeGreaterThan(openFindingsIndex);
    expect(record).toContain('starting with **R6-L01**');
    for (const id of ['R6-L02', 'R6-L03', 'R6-L04']) {
      expect(record).toContain(id);
    }
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
  });

  it('records full L1–L5 and systemd not required or run', () => {
    expect(record).toContain('FULL_LINUX_L1_L5_RUN=false');
    expect(record).toContain('FULL_LINUX_L1_L5_NOT_REQUIRED=true');
    expect(record).toContain('SYSTEMD_REGRESSION_RUN=false');
    expect(record).toContain('NONAUTHORITATIVE_R6_M03_LINUX_PROCFS_REGRESSION=true');
  });

  it('records INFO notes as non-blocking backlog', () => {
    expect(record).toContain('#### R6-M03-INFO-01');
    expect(record).toContain('#### R6-M03-INFO-02');
    expect(record).toContain('Do **not** convert INFO notes into new Review №6 findings');
  });

  it('does not claim production or VPS validation', () => {
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
    expect(record).toContain('does **not** establish');
    expect(record).toContain('Not production deployment');
  });

  it('does not store absolute evidence paths', () => {
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Codex Review 6 R6-M03 diagnostics unchanged', () => {
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
