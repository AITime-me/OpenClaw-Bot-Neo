import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md',
);

const IMPLEMENTATION_COMMIT = 'c73aaecd7e8e00e4f0a2ecfc64141063cabaeaf3';
const PARENT_COMMIT = '586940857a6cc5c9fd1225236b3ac21b5d4635c8';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';

const FINAL_DISPOSITION =
  'R6_M01_SECURITY_FINDING_CLOSED_WITH_RETRYABLE_DURABLE_OWNER_PRESERVATION';

const O_PROOFS = [
  'O1 failed cleanup retains exact owner',
  'O2 failed lifecycle remains terminal for normal operations',
  'O3 cleanup remains callable while failed',
  'O4 owner clears only after confirmed success',
  'O5 incomplete cleanup never returns false success',
  'O6 at most one owner.close attempt is in flight',
  'O7 every retry uses the same owner',
  'O8 no second owner opens while cleanup is pending',
  'O9 fatal lifecycle and failureClass remain after later cleanup success',
  'O10 exit semantics remain honest',
  'O11 no stopped event is emitted for incomplete cleanup',
  'O12 repeated close after cleanup is a safe no-op',
  'O13 startup rollback retains retryable owner where applicable',
  'O14 graceful shutdown compatibility is preserved',
  'O15 diagnostics and unrelated components remain unchanged',
] as const;

describe('Codex Review 6 R6-M01 closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact remediation identities', () => {
    expect(record).toContain(IMPLEMENTATION_COMMIT);
    expect(record).toContain(PARENT_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain('fix(neo-runtime): preserve durable owner across fatal close retries');
  });

  it('records independent approval with notes', () => {
    expect(record).toContain('APPROVE_WITH_NOTES_R6_M01_FOR_SECURITY_FINDING_CLOSEOUT');
    expect(record).toContain(
      'R6_M01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_SECURITY_FINDING_CLOSEOUT',
    );
  });

  it('records O1–O15 PASS and Linux disposition', () => {
    for (const proof of O_PROOFS) {
      expect(record).toContain(proof);
      expect(record).toContain('| PASS |');
    }
    expect(record).toContain('NO_LINUX_RERUN_REQUIRED');
  });

  it('records exact final disposition and diagnostics honesty', () => {
    expect(record).toContain(FINAL_DISPOSITION);
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('securityApprovalComplete');
    expect(record).toContain('deploymentReady');
    expect(record).toContain('secretProviderConfigured');
    expect(record).toContain('encryptionEnabled');
  });

  it('records fatal exit 12 and graceful timeout exit 13', () => {
    expect(record).toContain('process exit remains **12**');
    expect(record).toContain('fatal exit remains **12**');
    expect(record).toContain('graceful retry exhaustion remains exit **13**');
  });

  it('records INFO notes as non-blocking backlog', () => {
    expect(record).toContain('### INFO-01');
    expect(record).toContain('### INFO-02');
    expect(record).toContain('does not block closure');
    expect(record).toContain('Do **not** convert into a new R6 finding');
  });

  it('names R6-M02 as next and keeps remaining findings open', () => {
    const openFindingsIndex = record.indexOf('## Open findings');
    const m02Index = record.indexOf('**R6-M02**');
    expect(m02Index).toBeGreaterThan(openFindingsIndex);
    expect(record).toContain('starting with **R6-M02**');
    for (const id of ['R6-M03', 'R6-L01', 'R6-L02', 'R6-L03', 'R6-L04']) {
      expect(record).toContain(id);
    }
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
  });

  it('records honest focused-test counts without false reconciliation', () => {
    expect(record).toContain('**49** focused tests reported');
    expect(record).toContain('**46** tests across the two primary focused files');
    expect(record).toContain('are **not** the');
    expect(record).toContain('same measured subset');
  });

  it('does not claim production or VPS validation', () => {
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
    expect(record).toContain('does **not** establish');
    expect(record).toContain('production deployment');
    expect(record).toContain('VPS deployment');
  });

  it('does not store absolute evidence paths', () => {
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Codex Review 6 R6-M01 diagnostics unchanged', () => {
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
