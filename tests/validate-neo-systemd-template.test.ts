import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateNeoSystemdTemplate } from '../scripts/validate-neo-systemd-template.mjs';
describe('validate-neo-systemd-template script', () => {
  it('rejects forbidden TypeScript execution', () => {
    const base = readFileSync(
      join(process.cwd(), 'deploy/systemd/openclaw-neo.service.template'),
      'utf8',
    );
    const violations = validateNeoSystemdTemplate(
      base.replace('start-neo.mjs', 'start-neo.ts --experimental-strip-types'),
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('rejects EnvironmentFile', () => {
    const base = readFileSync(
      join(process.cwd(), 'deploy/systemd/openclaw-neo.service.template'),
      'utf8',
    );
    const violations = validateNeoSystemdTemplate(`${base}\nEnvironmentFile=/etc/openclaw/neo.env`);
    expect(violations.some((v: string) => v.includes('Forbidden pattern'))).toBe(true);
  });

  it('requires RestartPreventExitStatus for process lock and unsupported runtime', () => {
    const base = readFileSync(
      join(process.cwd(), 'deploy/systemd/openclaw-neo.service.template'),
      'utf8',
    );
    const violations = validateNeoSystemdTemplate(
      base.replace('RestartPreventExitStatus=10 3', 'RestartPreventExitStatus=10'),
    );
    expect(violations.some((v: string) => v.includes('unsupported Node runtime'))).toBe(true);
  });

  it('rejects direct compiled CLI launch', () => {
    const base = readFileSync(
      join(process.cwd(), 'deploy/systemd/openclaw-neo.service.template'),
      'utf8',
    );
    const violations = validateNeoSystemdTemplate(
      base.replace('start-neo.mjs', 'dist/neo-runtime/cli/run-neo-process.js'),
    );
    expect(violations.length).toBeGreaterThan(0);
  });
});
