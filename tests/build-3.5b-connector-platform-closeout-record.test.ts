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
const FEATURE_BRANCH_CLOSEOUT_COMMIT = '16bf1f4136641de4901218c721237b64ee1651fe';
const APPROVAL_CLOCK_CORRECTIVE_COMMIT = '2237bd726eb1f65374d835e2584724718da325a5';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';

const INITIAL_VERDICT = 'BLOCK_BUILD_3_5B_CONNECTOR_PLATFORM_CORE';
const INITIAL_FINAL_STATUS = 'BUILD_3_5B_CONNECTOR_PLATFORM_CORE_SOURCE_REVIEW_BLOCKED';
const CORRECTIVE_VERDICT = 'APPROVE_WITH_NOTES_BUILD_3_5B_SECURITY_CORRECTIVE_FOR_CLOSEOUT';
const CORRECTIVE_FINAL_STATUS =
  'BUILD_3_5B_SECURITY_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT';
const CLOCK_CORRECTIVE_VERDICT = 'APPROVE_WITH_NOTES_BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE';
const CLOCK_CORRECTIVE_FINAL_STATUS =
  'BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_REREVIEW_APPROVED_WITH_NOTES';
const FINAL_DISPOSITION =
  'BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE';
const CLOCK_CORRECTIVE_DISPOSITION =
  'BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_CLOSED_WITH_SINGLE_INJECTED_TIME_DOMAIN';

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
const CLOCK_INVARIANTS = Array.from({ length: 15 }, (_, index) => `C${String(index + 1)}`);

describe('Build 3.5B connector platform core closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact build identities', () => {
    expect(record).toContain(BUILD_3_5B_BASE);
    expect(record).toContain(PRIMARY_IMPLEMENTATION_COMMIT);
    expect(record).toContain(SECURITY_CORRECTIVE_COMMIT);
    expect(record).toContain(FEATURE_BRANCH_CLOSEOUT_COMMIT);
    expect(record).toContain(APPROVAL_CLOCK_CORRECTIVE_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(
      'feat(connectors): add connector platform core and invocation pipeline',
    );
    expect(record).toContain(
      'fix(connectors): enforce approval and invocation security boundaries',
    );
    expect(record).toContain('docs(connectors): close Build 3.5B connector platform core');
    expect(record).toContain('fix(connectors): use injected clock for approval expiry');
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
    expect(record).toContain(
      'No remaining BLOCKER/HIGH/MEDIUM findings from the security corrective review',
    );
  });

  it('records I1–I20 PASS and security corrective verification evidence', () => {
    for (const invariant of INVARIANTS) {
      expect(record).toContain(`| ${invariant} | PASS |`);
    }
    expect(record).toContain('36/36 PASS');
    expect(record).toContain('1752 passed');
    expect(record).toContain('3 skipped');
  });

  it('records fast-forward integration into local main', () => {
    expect(record).toContain('git merge --ff-only build-3-5b-connector-platform-core');
    expect(record).toContain('fast-forward integration into local `main`');
    expect(record).toContain('Merge commit created | **no**');
    expect(record).toContain('SHA rewritten | **no**');
    expect(record).toContain('Push performed | **no**');
    expect(record).toContain(FEATURE_BRANCH_CLOSEOUT_COMMIT);
  });

  it('records Windows EOL worktree-only diagnosis', () => {
    expect(record).toContain('Committed blobs/index EOL | LF');
    expect(record).toContain('Initial Windows worktree EOL | CRLF (`core.autocrlf=true`)');
    expect(record).toContain('Repository-content defect | **no**');
    expect(record).toContain('EOL corrective commit required | **no**');
    expect(record).toContain('`.gitattributes` changed | **no**');
    expect(record).toContain('Persistent Git config changed | **no**');
  });

  it('records approval clock root cause and corrective', () => {
    expect(record).toContain('evaluated expiry using `Date.now()`');
    expect(record).toContain('generated `expiresAt` from the injected `ClockPort`');
    expect(record).toContain('different time domains');
    expect(record).toContain(APPROVAL_CLOCK_CORRECTIVE_COMMIT);
    expect(record).toContain('`ClockPort` is mandatory for in-memory approval ports');
    expect(record).toContain('no direct `Date.now`, `new Date`, `performance.now`');
    expect(record).toContain('valid only while `now < expiresAt`');
    expect(record).toContain('equality (`now === expiresAt`) and later time are expired');
    expect(record).toContain('malformed stored expiry fails closed');
    expect(record).toContain('malformed clock fails closed');
    expect(record).toContain('expired approval cannot resolve secrets or execute a connector');
  });

  it('records approval expiry evaluation semantics', () => {
    expect(record).toContain(
      'expiry is evaluated when a trusted decision attempts to grant a pending request',
    );
    expect(record).toContain(
      'expiry is evaluated when execution attempts to consume a granted approval',
    );
    expect(record).toContain('`createRequest` stores the requested expiry');
    expect(record).toContain(
      'deny and revoke are terminal state transitions and do not need an expiry evaluation to become more permissive',
    );
    expect(record).toContain('no expired approval can become executable');
  });

  it('records focused approval clock re-review verdict and C1–C15', () => {
    expect(record).toContain(CLOCK_CORRECTIVE_VERDICT);
    expect(record).toContain(CLOCK_CORRECTIVE_FINAL_STATUS);
    expect(record).toContain('| BLOCKER | none |');
    expect(record).toContain('| HIGH | none |');
    expect(record).toContain('| MEDIUM | none |');
    for (const invariant of CLOCK_INVARIANTS) {
      expect(record).toContain(`| ${invariant} | PASS |`);
    }
    expect(record).toContain('| C1–C15 | PASS |');
    expect(record).toContain('Previously failing tests | PASS');
  });

  it('records final postcheck verification evidence', () => {
    expect(record).toContain('47/47 PASS');
    expect(record).toContain('1771 passed');
    expect(record).toContain('OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check');
    expect(record).toContain('| PASS |');
  });

  it('records exact final dispositions and false security/deployment flags', () => {
    expect(record).toContain(FINAL_DISPOSITION);
    expect(record).toContain(CLOCK_CORRECTIVE_DISPOSITION);
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
    expect(record).toContain('production deployment absent');
    expect(record).toContain('push not performed');
    expect(record).toContain('test/development-only');
    expect(record).toContain('integrated into local `main`');
    expect(record).toContain('pending owner-directed synchronization');
    expect(record).toContain('no merge, rebase, cherry-pick or push occurred');
    expect(record).toContain('Linux/systemd/full L1–L5 are **not required**');
  });

  it('records LOW/INFO backlog without converting to blockers', () => {
    expect(record).toContain('### AC-L01 — Approval expiry evaluation wording');
    expect(record).toContain('CLOSED BY DOCUMENTATION CORRECTION');
    expect(record).toContain('### AC-I01 — Orchestrator health timestamp');
    expect(record).toContain('### AC-I02 — Financial test dead branch');
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
