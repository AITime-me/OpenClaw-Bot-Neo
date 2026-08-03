import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md',
);

const INITIAL_IMPLEMENTATION_COMMIT = 'e385d66af93b889f2b9424a4ed85d326c875c4e4';
const CORRECTIVE_IMPLEMENTATION_COMMIT = '21a637fd619fd1c1e3de496e508ce9a4b673b9ff';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';

const FINAL_DISPOSITION =
  'R6_H02_SECURITY_FINDING_CLOSED_WITH_NON_OVERRIDEABLE_SECRET_PROVENANCE_BOUNDARY';

const P_PROOFS = [
  'P1 runtime-opaque SecretData',
  'P2 SecretsPort no-string contract',
  'P3 secret provenance monotonicity for tagged/SecretData paths',
  'P4 mandatory guard before product policy',
  'P5 product allow-policy cannot override',
  'P6 approval cannot override',
  'P7 clearance cannot be structurally forged',
  'P8 clearance cannot be reused or substituted',
  'P9 sinks reject missing clearance',
  'P10 SQLite rejection before transaction execution',
  'P11 in-memory rejection before mutation',
  'P12 direct production bypass prevented within enforced boundaries',
  'P13 raw value absent from errors/log/audit',
  'P14 scanner-unknown secret-provenance regression valid',
  'P15 ordinary memory compatibility preserved',
  'P16 no SQLite schema migration',
  'P17 dependency/import boundaries not weakened',
  'P18 diagnostics remain honest',
] as const;

describe('Codex Review 6 R6-H02 closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with both implementation commit identities', () => {
    expect(record).toContain(INITIAL_IMPLEMENTATION_COMMIT);
    expect(record).toContain(CORRECTIVE_IMPLEMENTATION_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
  });

  it('records independent review history and final approval', () => {
    expect(record).toContain('R6_H02_INDEPENDENT_REVIEW_BLOCKED');
    expect(record).toContain('R6H02-IR-M01');
    expect(record).toContain('R6H02-IR-M02');
    expect(record).toContain('R6H02-IR-M03');
    expect(record).toContain('R6_H02_INDEPENDENT_REREVIEW_APPROVED_FOR_SECURITY_FINDING_CLOSEOUT');
  });

  it('records P1–P18 PASS and Linux disposition', () => {
    for (const proof of P_PROOFS) {
      expect(record).toContain(proof);
      expect(record).toContain('| PASS |');
    }
    expect(record).toContain('NO_LINUX_RERUN_REQUIRED');
  });

  it('records exact final disposition and diagnostics honesty', () => {
    expect(record).toContain(FINAL_DISPOSITION);
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('SECRET_PROVIDER_CONFIGURED=false');
    expect(record).toContain('ENCRYPTION_ENABLED=false');
    expect(record).toContain('securityApprovalComplete');
    expect(record).toContain('secretProviderConfigured');
    expect(record).toContain('encryptionEnabled');
  });

  it('disclaims universal free-text detection and names next finding', () => {
    expect(record).toContain('does **not** claim universal free-text credential detection');
    expect(record).toContain('Arbitrary untyped free text may contain an unknown secret format');
    const m02Index = record.indexOf('**R6-M02**');
    const openFindingsIndex = record.indexOf('## Open findings');
    expect(m02Index).toBeGreaterThan(openFindingsIndex);
    expect(record).toContain('starting with **R6-M02**');
    expect(record).toContain('R6-M01');
    expect(record).toContain('CLOSED');
  });

  it('lists remaining M/L findings without production readiness claims', () => {
    for (const id of ['R6-M02', 'R6-M03', 'R6-L01', 'R6-L02', 'R6-L03', 'R6-L04']) {
      expect(record).toContain(id);
    }
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toContain('secretBoundaryProductionReady=true');
  });

  it('does not store absolute evidence paths', () => {
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Codex Review 6 R6-H02 diagnostics unchanged', () => {
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
