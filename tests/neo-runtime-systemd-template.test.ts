import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const TEMPLATE_PATH = join(process.cwd(), 'deploy/systemd/openclaw-neo.service.template');

const runValidator = (): { readonly status: number | null; readonly stderr: string } => {
  const result = spawnSync(process.execPath, ['scripts/validate-neo-systemd-template.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  return { status: result.status, stderr: result.stderr };
};

describe('neo runtime systemd template', () => {
  const content = readFileSync(TEMPLATE_PATH, 'utf8');

  it('passes static validator script', () => {
    const result = runValidator();
    expect(result.status).toBe(0);
  });

  it('uses compiled launcher only in ExecStart', () => {
    expect(content).toContain('start-neo.mjs');
    expect(content).not.toMatch(/\.ts\b|experimental-strip-types|ts-source-resolve|tsx|ts-node/);
  });

  it('places StartLimit directives in Unit and uses KillMode=mixed', () => {
    expect(content).toMatch(/\[Unit\][\s\S]*StartLimitIntervalSec=300/);
    expect(content).toContain('KillMode=mixed');
    expect(content).toContain('RestartPreventExitStatus=10');
  });

  it('does not claim deployment or credentials readiness', () => {
    expect(content).toContain('deploymentReady remains false');
    expect(content).toContain('Validated in disposable Ubuntu 24.04/systemd during Build 3.4F');
    expect(content).not.toContain('NOT installed or Linux-validated in Build 3.4D');
    expect(content).not.toMatch(/EnvironmentFile=|LoadCredential=/i);
    expect(content).not.toContain('network-online.target');
  });

  it('includes required hardening directives', () => {
    for (const directive of [
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'CapabilityBoundingSet=',
      'ReadWritePaths=/var/lib/openclaw-neo /run/openclaw/neo',
    ]) {
      expect(content).toContain(directive);
    }
  });
});
