import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/codex-review-6-r6-h01-readiness-race-closeout.md',
);

const IMPLEMENTATION_COMMIT = '6b89e7a2d3be072328828bb465b66a937a48349e';
const PARENT_COMMIT = '2524bb04bebef1b3356f059e6a52c5520a84b322';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';
const BUNDLE_SHA256 = 'add467465d7dea7d7c165110fc215781fcf9dd224a252da5251c97a8f6602304';
const DEPENDENCY_IMAGE = 'sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834';

const FINAL_DISPOSITION_PARTS = [
  'R6-H01 is closed for cooperative shutdown/readiness-publication ordering based on deterministic',
  'race tests, independent source review and disposable Linux L1–L5 regression.',
] as const;

describe('Codex Review 6 R6-H01 closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');

  it('exists with exact remediation identities', () => {
    expect(record).toContain(IMPLEMENTATION_COMMIT);
    expect(record).toContain(PARENT_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(BUNDLE_SHA256);
    expect(record).toContain(DEPENDENCY_IMAGE);
    expect(record).toContain('non-authoritative');
  });

  it('records combined evidence layers and exact final disposition', () => {
    expect(record).toContain('tests/neo-runtime-readiness-shutdown-race.test.ts');
    expect(record).toContain('20 passed');
    expect(record).toContain('1485 passed');
    expect(record).toContain('R6_H01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_LINUX_REGRESSION');
    expect(record).toContain('BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED');
    expect(record).toContain('31/31');
    for (const part of FINAL_DISPOSITION_PARTS) {
      expect(record).toContain(part);
    }
  });

  it('records claim boundaries without overstating approval', () => {
    expect(record).toContain('does **not** establish');
    expect(record).toContain('securityApprovalComplete=true');
    expect(record).toContain('deploymentReady=true');
    expect(record).toContain('Codex Review №6 as a whole remains **blocked**');
    expect(record).toContain('does **not** mean all readiness security is complete');
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
  });

  it('lists remaining findings with R6-M01 first after R6-H02 closure', () => {
    const m01Index = record.indexOf('R6-M01');
    const h01CloseIndex = record.indexOf('## Open findings');
    expect(m01Index).toBeGreaterThan(h01CloseIndex);
    expect(record).toContain('R6-H02');
    expect(record).toContain('CLOSED');
    for (const id of ['R6-M02', 'R6-M03', 'R6-L01', 'R6-L02', 'R6-L03', 'R6-L04']) {
      expect(record).toContain(id);
    }
  });

  it('does not store absolute evidence paths', () => {
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Codex Review 6 R6-H01 diagnostics unchanged', () => {
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
