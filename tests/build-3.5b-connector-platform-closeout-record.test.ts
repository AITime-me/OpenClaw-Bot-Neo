import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/build-3.5b-connector-platform-core-closeout.md',
);

const BUILD_3_5B_BASE = '9ee5e8a28aa021e7fbc27add05b427d7b6cb37fa';
const PRIMARY_IMPLEMENTATION_COMMIT = '91f1cf64e1204e4a211b1eafe763139efd05fe53';
const SECURITY_CORRECTIVE_COMMIT = '74c9637b2030460b1daf67d75e6f7dfb8c8bfae0';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';

const INITIAL_VERDICT = 'BLOCK_BUILD_3_5B_CONNECTOR_PLATFORM_CORE';
const INITIAL_FINAL_STATUS = 'BUILD_3_5B_CONNECTOR_PLATFORM_CORE_SOURCE_REVIEW_BLOCKED';
const CORRECTIVE_VERDICT = 'APPROVE_WITH_NOTES_BUILD_3_5B_SECURITY_CORRECTIVE_FOR_CLOSEOUT';
const CORRECTIVE_FINAL_STATUS =
  'BUILD_3_5B_SECURITY_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT';
const FINAL_DISPOSITION =
  'BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE';

const BLOCKED_FINDINGS = [
  'CP-B01',
  'CP-H01',
  'CP-H02',
  'CP-H03',
  'CP-H04',
  'CP-H05',
  'CP-M01',
  'CP-M02',
  'CP-M03',
  'CP-M04',
  'CP-M05',
  'CP-M06',
] as const;

const INVARIANTS = Array.from({ length: 20 }, (_, index) => `I${String(index + 1)}`);

describe('Build 3.5B connector platform core closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact build identities', () => {
    expect(record).toContain(BUILD_3_5B_BASE);
    expect(record).toContain(PRIMARY_IMPLEMENTATION_COMMIT);
    expect(record).toContain(SECURITY_CORRECTIVE_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(
      'feat(connectors): add connector platform core and invocation pipeline',
    );
    expect(record).toContain(
      'fix(connectors): enforce approval and invocation security boundaries',
    );
    expect(record).toContain('build-3-5b-connector-platform-core');
  });

  it('records initial blocked review and corrective re-review', () => {
    expect(record).toContain(INITIAL_VERDICT);
    expect(record).toContain(INITIAL_FINAL_STATUS);
    expect(record).toContain('first implementation was **blocked**');
    expect(record).toContain(CORRECTIVE_VERDICT);
    expect(record).toContain(CORRECTIVE_FINAL_STATUS);
  });

  it('records blocked findings and CLOSED disposition', () => {
    for (const finding of BLOCKED_FINDINGS) {
      expect(record).toContain(finding);
      expect(record).toContain('| CLOSED |');
    }
    expect(record).toContain('No remaining BLOCKER/HIGH/MEDIUM findings');
  });

  it('records I1–I20 PASS and verification evidence', () => {
    for (const invariant of INVARIANTS) {
      expect(record).toContain(`| ${invariant} | PASS |`);
    }
    expect(record).toContain('36/36 PASS');
    expect(record).toContain('1752 passed');
    expect(record).toContain('3 skipped');
    expect(record).toContain('OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check');
    expect(record).toContain('| PASS |');
  });

  it('records exact final disposition and false security/deployment flags', () => {
    expect(record).toContain(FINAL_DISPOSITION);
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('AUTHORITATIVE_SECURITY_VALIDATION=false');
    expect(record).toContain('SECRET_PROVIDER_CONFIGURED=false');
    expect(record).toContain('ENCRYPTION_ENABLED=false');
  });

  it('records deferred production scope and branch integration status', () => {
    expect(record).toContain('production connector wiring absent');
    expect(record).toContain('real connectors absent');
    expect(record).toContain('production Secret Provider absent');
    expect(record).toContain('durable approval/audit persistence absent');
    expect(record).toContain('test/development-only');
    expect(record).toContain(
      'transfer/integration into `main` remains a separate owner-directed Git operation',
    );
    expect(record).toContain('no merge, rebase, cherry-pick or push occurred');
    expect(record).toContain('Linux/systemd/full L1–L5 are **not required**');
  });

  it('records LOW/INFO backlog without converting to blockers', () => {
    expect(record).toContain('### CP-L01 — Audit-first vs resolve-first');
    expect(record).toContain(
      'Prior LOW: tool/connector resolve before invocation-requested audit. Unchanged; limited impact.',
    );
    expect(record).toContain('### CP-L03 — approvingActorId omitted from bindingsMatch');
    expect(record).toContain(
      'Orchestrator passes `approvingActorId:null`; consume requires stored non-null from grant. Not a',
    );
    expect(record).toContain('### CP-L04 — No connector-boundary mutation fixtures');
    expect(record).toContain(
      'depcruise + allowlists + verify-connector-boundaries green; unlike memory isolation, no self-test',
    );
    expect(record).toContain('### CP-I01 — Cooperative cancellation only');
    expect(record).toContain('Docs honest: ignoring `AbortSignal` is not hard-stopped.');
    expect(record).toContain(
      'Do **not** convert these into security approval blockers for Build 3.5B.',
    );
  });

  it('does not claim production integrations or broad security approval', () => {
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/security approval (was|is) complete/i);
    expect(record).not.toMatch(/already integrated into main/i);
    expect(record).toContain('real OAuth or real GitHub/amoCRM/email/Telegram/Timeweb integration');
  });
});
