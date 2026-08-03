import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import { NEO_RUNTIME_DIAGNOSTICS } from '../src/neo-runtime/neo-runtime-diagnostics.js';
import { POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS } from '../src/host/durable/posix-durable-local-host-composition-diagnostics.js';

const REPO_ROOT = process.cwd();
const VALIDATION_RECORD = join(
  REPO_ROOT,
  'docs/validation/build-3.4-neo-linux-systemd-validation.md',
);
const TEMPLATE_PATH = join(REPO_ROOT, 'deploy/systemd/openclaw-neo.service.template');

const SOURCE_COMMIT = '4096a87586475aacb01dc27596c1e1dd494f9778';
const PACKAGE_LOCK_SHA256 = 'f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54';
const BUNDLE_SHA256 = 'c067aa98c9f4e1fa927ec2dbab9a461d43ccda94c332b67eb734f198cb28a69b';
const DEPENDENCY_IMAGE = 'sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834';

describe('Build 3.4 Neo Linux/systemd validation record', () => {
  const record = readFileSync(VALIDATION_RECORD, 'utf8');

  it('exists with exact validated identities', () => {
    expect(record).toContain(SOURCE_COMMIT);
    expect(record).toContain(PACKAGE_LOCK_SHA256);
    expect(record).toContain(BUNDLE_SHA256);
    expect(record).toContain(DEPENDENCY_IMAGE);
    expect(record).toContain('non-authoritative');
  });

  it('records disposable/non-production limitations', () => {
    expect(record).toContain('disposable Linux');
    expect(record).toContain('does **not** establish');
    expect(record).toContain('production deployment');
    expect(record).toContain('VPS deployment');
    expect(record).toContain('BUILD_3_4G_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT');
  });

  it('does not claim production or VPS deployment', () => {
    expect(record).not.toMatch(/production deployment (was|is) (complete|approved|performed)/i);
    expect(record).not.toMatch(/VPS deployment (was|is) (complete|approved|performed)/i);
    expect(record).toContain(
      'Host-side WSL distribution unregister is **not** independently evidenced',
    );
  });

  it('records STAB10 and Build 3.4F markers without overstating manifest coverage', () => {
    expect(record).toContain('BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED');
    expect(record).toContain('BUILD_3_4F_NEO_SYSTEMD_LINUX_VALIDATION_PASSED');
    expect(record).toContain('36/36');
    expect(record).toContain('64/65');
    expect(record).toMatch(/Do \*\*not\*\* record .manifest 65\/65/);
  });

  it('records post-Build-3.4 backlog without absolute evidence paths', () => {
    expect(record).toContain('Known non-blocking notes');
    expect(record).toContain('wrapper-stdout.txt');
    expect(record).not.toMatch(/C:\\Users\\/);
    expect(record).not.toMatch(/AppData\\Local\\Temp/);
  });
});

describe('Build 3.4 diagnostics closeout', () => {
  it('enables only independently approved Neo wiring flags', () => {
    expect(NEO_RUNTIME_DIAGNOSTICS.processLockWiredToNeo).toBe(true);
    expect(NEO_RUNTIME_DIAGNOSTICS.neoSecondInstanceProtectionActive).toBe(true);
    expect(NEO_RUNTIME_DIAGNOSTICS.systemdLayerConfigured).toBe(true);
    expect(POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS.processLockWiredToNeo).toBe(true);
    expect(POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS.neoSecondInstanceProtectionActive).toBe(
      true,
    );
    expect(POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS.systemdLayerConfigured).toBe(true);
  });

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

  it('keeps neo runtime out of package public exports', () => {
    const exported = Object.keys(publicApi);
    for (const forbidden of [
      'createNeoRuntime',
      'createProductionNeoRuntime',
      'runNeoProcess',
      'NEO_RUNTIME_DIAGNOSTICS',
    ]) {
      expect(exported).not.toContain(forbidden);
    }
  });
});

describe('Build 3.4 systemd template comment closeout', () => {
  const content = readFileSync(TEMPLATE_PATH, 'utf8');

  it('replaces stale Build 3.4D wording', () => {
    expect(content).not.toContain('NOT installed or Linux-validated in Build 3.4D');
    expect(content).toContain('Validated in disposable Ubuntu 24.04/systemd during Build 3.4F');
    expect(content).toContain('deploymentReady remains false');
    expect(content).toContain('not security-approved');
  });

  it('keeps functional directives unchanged', () => {
    for (const directive of [
      'Type=simple',
      'Restart=on-failure',
      'RestartSec=5',
      'RestartPreventExitStatus=10 3',
      'TimeoutStartSec=60',
      'TimeoutStopSec=45',
      'KillMode=mixed',
      'ExecStart=/usr/bin/node /opt/openclaw-neo/scripts/neo/start-neo.mjs',
      'ProtectSystem=strict',
      'ReadWritePaths=/var/lib/openclaw-neo /run/openclaw/neo',
    ]) {
      expect(content).toContain(directive);
    }
    expect(content).not.toMatch(/\bExecStop=/);
  });
});
