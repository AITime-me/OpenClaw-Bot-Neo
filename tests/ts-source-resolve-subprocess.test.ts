import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const REGISTER_PATH = join(REPO_ROOT, 'scripts/integration/lib/ts-source-resolve-register.mjs');
const REGISTER_HREF = pathToFileURL(REGISTER_PATH).href;

const runFixture = (opts: {
  readonly withHook: boolean;
  readonly fixtureRoot: string;
  readonly entryRel: string;
}): ReturnType<typeof spawnSync> => {
  const entry = join(opts.fixtureRoot, opts.entryRel);
  const argv = opts.withHook
    ? ['--import', REGISTER_HREF, '--experimental-strip-types', entry]
    : ['--experimental-strip-types', entry];
  return spawnSync(process.execPath, argv, {
    cwd: opts.fixtureRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      OPENCLAW_B3C4_REPOSITORY_ROOT: opts.fixtureRoot,
    },
    timeout: 15_000,
  });
};

describe('ts-source-resolve subprocess (production register/hook)', () => {
  it('without hook reproduces ERR_MODULE_NOT_FOUND for NodeNext .js specifier', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-sub-'));
    try {
      const src = join(root, 'src', 'core');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'identity.ts'), 'export const value = 42;\n');
      writeFileSync(join(src, 'index.ts'), 'export * from "./identity.js";\n');
      writeFileSync(
        join(root, 'entry.ts'),
        'import { value } from "./src/core/index.ts";\nconsole.log("READY", value);\n',
      );
      const result = runFixture({ withHook: false, fixtureRoot: root, entryRel: 'entry.ts' });
      expect(result.status).not.toBe(0);
      expect(`${String(result.stderr)}${String(result.stdout)}`).toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('with production --import bootstrap remaps and reaches controlled READY', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-sub-'));
    try {
      const src = join(root, 'src', 'core');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'identity.ts'), 'export const value = 42;\n');
      writeFileSync(join(src, 'index.ts'), 'export * from "./identity.js";\n');
      writeFileSync(
        join(root, 'entry.ts'),
        'import { value } from "./src/core/index.ts";\nconsole.log(`READY ${value}`);\n',
      );
      const result = runFixture({ withHook: true, fixtureRoot: root, entryRel: 'entry.ts' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('READY 42');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('existing .js wins over sibling .ts', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-sub-'));
    try {
      const src = join(root, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'mod.js'), 'export const which = "js";\n');
      writeFileSync(join(src, 'mod.ts'), 'export const which = "ts";\n');
      writeFileSync(
        join(root, 'entry.ts'),
        'import { which } from "./src/mod.js";\nconsole.log(`READY ${which}`);\n',
      );
      const result = runFixture({ withHook: true, fixtureRoot: root, entryRel: 'entry.ts' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('READY js');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('both missing keeps ERR_MODULE_NOT_FOUND', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-sub-'));
    try {
      const src = join(root, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'index.ts'), 'export * from "./missing.js";\n');
      writeFileSync(join(root, 'entry.ts'), 'import "./src/index.ts";\nconsole.log("READY");\n');
      const result = runFixture({ withHook: true, fixtureRoot: root, entryRel: 'entry.ts' });
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('register module path is the committed integration-private bootstrap', () => {
    expect(REGISTER_PATH.replace(/\\/g, '/')).toContain(
      'scripts/integration/lib/ts-source-resolve-register.mjs',
    );
    expect(REGISTER_HREF.startsWith('file:')).toBe(true);
    expect(dirname(fileURLToPath(import.meta.url))).not.toContain('node_modules');
  });

  it('symlink escape outside src is not remapped', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-sub-'));
    try {
      const src = join(root, 'src');
      const outside = join(root, 'outside');
      mkdirSync(src, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'secret.ts'), 'export const which = "outside";\n');
      try {
        symlinkSync(join(outside, 'secret.ts'), join(src, 'mod.ts'));
      } catch {
        return;
      }
      writeFileSync(join(src, 'index.ts'), 'export * from "./mod.js";\n');
      writeFileSync(
        join(root, 'entry.ts'),
        'import { which } from "./src/index.ts";\nconsole.log(`READY ${which}`);\n',
      );
      const result = runFixture({ withHook: true, fixtureRoot: root, entryRel: 'entry.ts' });
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
