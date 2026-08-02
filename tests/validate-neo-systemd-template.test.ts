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
});
