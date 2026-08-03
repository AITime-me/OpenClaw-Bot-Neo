import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-low-hardening-package-closeout.md',
);

const IMPLEMENTATION_COMMIT = '486403811250651e0e547237c2acdc5be29ee63b';
const TC01_COMMIT = '5aef38a9b989198e37d51f5a237e74cb4378e714';
const FIXTURE_COMMIT = '6309432d06a8db2bce463a5cf87f865470af7aae';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';
const MANIFEST_SHA256 = '97d97c3f692098d15874a1046b8bc8d20c4ae340d6087be7f483d178556e7b25';

const FINAL_DISPOSITION =
  'R6_LOW_HARDENING_PACKAGE_CLOSED_WITH_DESCRIPTOR_SAFE_CONFIG_EXCLUSIVE_READINESS_CORRELATED_EVIDENCE_AND_OWNER_ONLY_STATE';

const LINUX_PASS_TOKEN =
  'R6_LOW_HARDENING_FOCUSED_LINUX_FILESYSTEM_REGRESSION_PASSED_READY_FOR_PACKAGE_CLOSEOUT';

const FIRST_LINUX_FAIL =
  'R6_LOW_HARDENING_FOCUSED_LINUX_FILESYSTEM_REGRESSION_NEXT_FAILURE_IDENTIFIED';

describe('Codex Review 6 R6 LOW hardening package closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('records all three package commits', () => {
    expect(record).toContain(IMPLEMENTATION_COMMIT);
    expect(record).toContain(
      'fix(security): harden config, readiness, evidence and state boundaries',
    );
    expect(record).toContain(TC01_COMMIT);
    expect(record).toContain('fix(test): place correlation test in integration typecheck graph');
    expect(record).toContain(FIXTURE_COMMIT);
    expect(record).toContain('fix(test): use real paths in config descriptor fixtures');
    expect(record).toContain(PACKAGE_LOCK_SHA256);
  });

  it('records initial blocked source review and TC01 correction', () => {
    expect(record).toContain('BLOCK_R6_LOW_HARDENING_SOURCE');
    expect(record).toContain('R6-L-TC01');
    expect(record).toContain('TS5097');
    expect(record).toContain('unchanged by TC01 correction');
    expect(record).toContain('Main typecheck');
    expect(record).toContain('Integration typecheck');
    expect(record).toContain('Aggregate check');
  });

  it('records corrective re-review approval', () => {
    expect(record).toContain(
      'APPROVE_R6_LOW_HARDENING_CORRECTIVE_SOURCE_FOR_FOCUSED_LINUX_FILESYSTEM_REGRESSION',
    );
    expect(record).toContain(
      'R6_LOW_HARDENING_CORRECTIVE_SOURCE_REREVIEW_APPROVED_FOR_FOCUSED_LINUX_REGRESSION',
    );
  });

  it('records first Linux fixture-only failure without production defect claim', () => {
    expect(record).toContain(FIRST_LINUX_FAIL);
    expect(record).toContain('BUILD');
    expect(record).toContain('hasSymlinkInPath');
    expect(record).toContain('no production security defect established');
    expect(record).toContain('accepts exactly the maximum allowed size');
    expect(record).toContain('closes descriptor after success and validation failure');
  });

  it('records fixture correction and final Linux PASS token', () => {
    expect(record).toContain(
      'R6_LOW_CONFIG_FIXTURE_CORRECTIVE_COMMITTED_READY_FOR_SINGLE_LINUX_RERUN',
    );
    expect(record).toContain(LINUX_PASS_TOKEN);
    expect(record).toContain('30/30 PASS');
    expect(record).toContain('12/12');
  });

  it('records L01 O_NOFOLLOW descriptor proof', () => {
    expect(record).toContain('O_RDONLY | O_NOFOLLOW');
    expect(record).toContain('opened descriptor is the security authority');
    expect(record).toContain('ELOOP');
    expect(record).toContain('no pathname reopen');
  });

  it('records L02 exclusive/no-follow readiness proof', () => {
    expect(record).toContain('O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW');
    expect(record).toContain('32 hex');
    expect(record).toContain('NEO_READINESS_TEMP_MAX_ATTEMPTS = 5');
    expect(record).toContain('attacker-controlled candidate');
  });

  it('records L03 exact correlation proof', () => {
    expect(record).toContain('exact event type');
    expect(record).toContain('exact `runId` and role/session correlation');
    expect(record).toContain('exact lifecycle order');
    expect(record).toContain('missing correlated event READY runId=run-a role=holder');
  });

  it('records L04 umask and owner-only modes proof', () => {
    expect(record).toContain('umask 0077');
    expect(record).toContain('Umask=0077');
    expect(record).toContain('0700');
    expect(record).toContain('0600');
    expect(record).toContain('status caused no hash, mode, or durable inventory mutation');
  });

  it('records manifest SHA and all four findings CLOSED', () => {
    expect(record).toContain('OK=**87**');
    expect(record).toContain('FAIL=**0**');
    expect(record).toContain(MANIFEST_SHA256);
    expect(record).toContain('**R6-L01 — CLOSED**');
    expect(record).toContain('**R6-L02 — CLOSED**');
    expect(record).toContain('**R6-L03 — CLOSED**');
    expect(record).toContain('**R6-L04 — CLOSED**');
  });

  it('records exact package disposition', () => {
    expect(record).toContain(FINAL_DISPOSITION);
  });

  it('records encryption, security approval, and deployment remain false', () => {
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('AUTHORITATIVE_SECURITY_VALIDATION=false');
    expect(record).toContain('ENCRYPTION_ENABLED=false');
    expect(record).toContain('SECRET_PROVIDER_CONFIGURED=false');
    expect(record).toContain('securityApprovalComplete');
    expect(record).toContain('deploymentReady');
    expect(record).toContain('encryption remains disabled and deferred');
  });

  it('records no full L1–L5 or systemd regression claims', () => {
    expect(record).toContain('FULL_LINUX_L1_L5_RUN=false');
    expect(record).toContain('SYSTEMD_REGRESSION_RUN=false');
    expect(record).not.toContain('FULL_LINUX_L1_L5_PASS');
    expect(record).not.toContain('SYSTEMD_REGRESSION_PASSED');
  });

  it('records remaining deferred work and honest Review №6 status', () => {
    expect(record).toContain('deferred systemd security hardening');
    expect(record).toContain('online dependency/provenance review');
    expect(record).toContain('non-blocking INFO/LOW backlog');
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
    for (const id of [
      'R6-H01',
      'R6-H02',
      'R6-M01',
      'R6-M02',
      'R6-M03',
      'R6-L01',
      'R6-L02',
      'R6-L03',
      'R6-L04',
    ]) {
      expect(record).toContain(id);
    }
  });
});

describe('Codex Review 6 R6 LOW hardening diagnostics unchanged', () => {
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
