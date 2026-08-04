import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/build-3.6b-infrastructure-fleet-foundation-closeout.md',
);

const BUILD_3_6B_BASE_MAIN = 'e4a89a0282603531f3454ad0f73e5bbdedfd1e18';
const INITIAL_IMPLEMENTATION_COMMIT = '2c08dea9f66ff5984aa2a3bf24f9396d69fa855c';
const CORRECTIVE_1_COMMIT = '8bc4a8ceda02eaae82e6a2915ff076a1e022e61d';
const CORRECTIVE_2_COMMIT = '50ba4867a15b1d558559dfb0a8ae498e5d8baa1f';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';

const INITIAL_VERDICT = 'BLOCK_BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION';
const INITIAL_FINAL_STATUS = 'BUILD_3_6B_INFRASTRUCTURE_FLEET_SOURCE_REVIEW_BLOCKED';
const CORRECTIVE_1_VERDICT = 'BLOCK_BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVE';
const CORRECTIVE_1_FINAL_STATUS = 'BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVE_REREVIEW_BLOCKED';
const FINAL_VERDICT = 'APPROVE_WITH_NOTES_BUILD_3_6B_INFRASTRUCTURE_CORRECTIVE_2_FOR_CLOSEOUT';
const FINAL_STATUS =
  'BUILD_3_6B_INFRASTRUCTURE_CORRECTIVE_2_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT';
const SECURITY_DISPOSITION =
  'BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVES_CLOSED_WITH_STATELESS_SECRET_DETECTION_AND_TYPED_OUTCOME_UNKNOWN';
const FLEET_DISPOSITION =
  'BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION_CLOSED_WITH_BOUNDED_INVENTORIES_RESTRICTED_OPERATIONS_AND_UNTRUSTED_OBSERVATIONS';

const CLOSED_FINDINGS = [
  'IF-H01',
  'IF-H02',
  'IF-H03',
  'IF-M01',
  'IF-M02',
  'IF-M03',
  'IF-M04',
  'IF-M05',
  'IF-M06',
  'IF-M07',
  'IF-CR01',
  'IF-CR02',
  'IF-CM01',
] as const;

const INVARIANTS = Array.from({ length: 25 }, (_, index) => `F${String(index + 1)}`);

describe('Build 3.6B infrastructure fleet foundation closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact build identities', () => {
    expect(record).toContain(BUILD_3_6B_BASE_MAIN);
    expect(record).toContain(INITIAL_IMPLEMENTATION_COMMIT);
    expect(record).toContain(CORRECTIVE_1_COMMIT);
    expect(record).toContain(CORRECTIVE_2_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(
      'feat(infrastructure): add fleet inventory foundation and restricted ops contracts',
    );
    expect(record).toContain(
      'fix(infrastructure): enforce bounded inventory and safe operation results',
    );
    expect(record).toContain(
      'fix(infrastructure): type uncertain outcomes and stabilize secret detection',
    );
    expect(record).toContain('build-3-6b-infrastructure-fleet-foundation');
  });

  it('records complete review history', () => {
    expect(record).toContain(INITIAL_VERDICT);
    expect(record).toContain(INITIAL_FINAL_STATUS);
    expect(record).toContain(CORRECTIVE_1_VERDICT);
    expect(record).toContain(CORRECTIVE_1_FINAL_STATUS);
    expect(record).toContain(FINAL_VERDICT);
    expect(record).toContain(FINAL_STATUS);
  });

  it('records finding closure and F1–F25 PASS', () => {
    for (const finding of CLOSED_FINDINGS) {
      expect(record).toContain(finding);
      expect(record).toContain('| CLOSED |');
    }
    for (const invariant of INVARIANTS) {
      expect(record).toContain(`| ${invariant} | PASS |`);
    }
    expect(record).toContain('1825 passed');
    expect(record).toContain('3 skipped');
  });

  it('records exact final dispositions and false security/deployment flags', () => {
    expect(record).toContain(SECURITY_DISPOSITION);
    expect(record).toContain(FLEET_DISPOSITION);
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('AUTHORITATIVE_SECURITY_VALIDATION=false');
    expect(record).toContain('SECRET_PROVIDER_CONFIGURED=false');
    expect(record).toContain('ENCRYPTION_ENABLED=false');
  });

  it('records INFO notes IF-N01 and IF-N02 as non-blocking backlog', () => {
    expect(record).toContain('### IF-N01');
    expect(record).toContain('### IF-N02');
    expect(record).toContain('non-blocking test-hardening backlog');
    expect(record).toContain('documented limitation, not a production-readiness claim');
    expect(record).toContain(
      'Do **not** convert these into security approval blockers for Build 3.6B.',
    );
  });

  it('records integration and push pending without production claims', () => {
    expect(record).toContain('integration into local `main` pending');
    expect(record).toContain('push not performed');
    expect(record).toContain('No Timeweb network client');
    expect(record).toContain('No SSH implementation');
    expect(record).toContain('production deployment absent');
    expect(record).toContain('Linux/systemd/full L1–L5 are **not required**');
    expect(record).not.toMatch(/Timeweb connected/i);
    expect(record).not.toMatch(/SSH implemented/i);
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/security approval (was|is) complete/i);
  });
});
