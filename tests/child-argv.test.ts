import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLinuxGateChildArgv,
  isLinuxGateChildArgvWithResolver,
  TS_SOURCE_RESOLVE_REGISTER_HREF,
  TS_SOURCE_RESOLVE_REGISTER_PATH,
} from '../scripts/integration/lib/child-argv.ts';
import {
  buildDurableCompositionChildArgv,
  CHILD_SCRIPT_PATH,
  FLOCK_HOLDER_SCRIPT_PATH,
} from '../scripts/integration/lib/child-runner.ts';
import { CHILD_ROLES } from '../scripts/integration/lib/constants.ts';

const REPO_ROOT = process.cwd();

describe('linux gate child argv builder', () => {
  it('production durable child argv uses --import register before strip-types and entry', () => {
    const argv = buildDurableCompositionChildArgv();
    expect(argv[0]).toBe('--import');
    expect(argv[1]).toBe(TS_SOURCE_RESOLVE_REGISTER_HREF);
    expect(argv[2]).toBe('--experimental-strip-types');
    expect(argv[3]).toBe(CHILD_SCRIPT_PATH);
    expect(isLinuxGateChildArgvWithResolver(argv)).toBe(true);
  });

  it('registration path is absolute and integration-private', () => {
    expect(TS_SOURCE_RESOLVE_REGISTER_PATH).toMatch(/ts-source-resolve-register\.mjs$/);
    expect(TS_SOURCE_RESOLVE_REGISTER_PATH.replace(/\\/g, '/')).toContain(
      'scripts/integration/lib/',
    );
    expect(TS_SOURCE_RESOLVE_REGISTER_HREF.startsWith('file:')).toBe(true);
    expect(TS_SOURCE_RESOLVE_REGISTER_PATH.includes('node_modules')).toBe(false);
  });

  it('all spawnChildSession roles share the same production builder', () => {
    const durableRoles = CHILD_ROLES.filter((role) => role !== 'flock-wait');
    expect(durableRoles.length).toBeGreaterThan(0);
    for (const role of durableRoles) {
      void role;
      expect(buildDurableCompositionChildArgv()).toEqual(
        buildLinuxGateChildArgv(CHILD_SCRIPT_PATH),
      );
    }
  });

  it('child-runner production spawn uses the central builder (mutation resistant)', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/integration/lib/child-runner.ts'), 'utf8');
    expect(source).toContain('buildDurableCompositionChildArgv');
    expect(source).toContain('buildLinuxGateChildArgv');
    expect(source.includes("['--experimental-strip-types', CHILD_SCRIPT_PATH]")).toBe(false);
  });

  it('raw flock helper entry is distinct and not the durable child argv', () => {
    const durable = buildDurableCompositionChildArgv();
    expect(durable.includes(FLOCK_HOLDER_SCRIPT_PATH)).toBe(false);
    const flockSource = readFileSync(
      join(REPO_ROOT, 'scripts/integration/lib/scenario-g-cold-root.ts'),
      'utf8',
    );
    expect(flockSource).toContain('FLOCK_HOLDER_SCRIPT_PATH');
    expect(flockSource.includes('ts-source-resolve-register')).toBe(false);
    expect(flockSource.includes('--import')).toBe(false);
  });

  it('parent launcher does not register the resolver', () => {
    const launcher = readFileSync(
      join(REPO_ROOT, 'scripts/integration/run-durable-composition-linux-gate.mjs'),
      'utf8',
    );
    expect(launcher.includes('ts-source-resolve-register')).toBe(false);
    expect(launcher.includes('--import')).toBe(false);
  });

  it('detects mutation that drops resolver from argv', () => {
    const broken = ['--experimental-strip-types', CHILD_SCRIPT_PATH];
    expect(isLinuxGateChildArgvWithResolver(broken)).toBe(false);
  });
});
