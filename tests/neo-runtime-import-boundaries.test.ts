import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import { createNeoRuntime } from '../src/neo-runtime/create-neo-runtime.js';

const REPO_ROOT = process.cwd();
const NEO_RUNTIME_ROOT = join(REPO_ROOT, 'src', 'neo-runtime');
const FACTORY_IMPORT = 'create-posix-durable-local-host';
const PRODUCTION_WRAPPER = join(NEO_RUNTIME_ROOT, 'production', 'create-production-neo-runtime.ts');
const PRODUCTION_CONFIG_BOOTSTRAP = join(
  NEO_RUNTIME_ROOT,
  'production',
  'production-config-bootstrap.ts',
);
const PRODUCTION_HOST_IMPORTERS = new Set([PRODUCTION_WRAPPER, PRODUCTION_CONFIG_BOOTSTRAP]);

const collectTsFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...collectTsFiles(absolute));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(absolute);
  }
  return files;
};

const stripImportTypeBlocks = (content: string): string =>
  content.replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

const hasRuntimeFactoryImport = (content: string): boolean => {
  const stripped = stripImportTypeBlocks(content);
  return (
    /\bimport\s*\(\s*['"][^'"]*create-posix-durable-local-host/.test(stripped) ||
    /\bfrom\s+['"][^'"]*create-posix-durable-local-host/.test(stripped)
  );
};

describe('neo runtime import boundaries', () => {
  it('keeps neo runtime out of package public exports', () => {
    const exported = Object.keys(publicApi);
    for (const forbidden of [
      'createNeoRuntime',
      'createProductionNeoRuntime',
      'NEO_RUNTIME_DIAGNOSTICS',
      'mapNeoRuntimeFailureClassToExitCode',
    ]) {
      expect(exported).not.toContain(forbidden);
    }
  });

  it('allows only production modules to import durable composition factory', () => {
    const offenders: string[] = [];
    for (const filePath of collectTsFiles(NEO_RUNTIME_ROOT)) {
      const content = readFileSync(filePath, 'utf8');
      if (hasRuntimeFactoryImport(content) && !PRODUCTION_HOST_IMPORTERS.has(filePath)) {
        offenders.push(relative(REPO_ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
    expect(readFileSync(PRODUCTION_WRAPPER, 'utf8')).toContain(FACTORY_IMPORT);
  });

  it('create-neo-runtime does not import integration resolver or strip-types harness', () => {
    const content = readFileSync(join(NEO_RUNTIME_ROOT, 'create-neo-runtime.ts'), 'utf8');
    expect(content).not.toMatch(/ts-source-resolve|experimental-strip-types|lazy-production/);
    expect(content).not.toMatch(/scripts\/integration/);
  });

  it('neo runtime modules do not import host except production wrapper and config bootstrap', () => {
    const offenders: string[] = [];
    for (const filePath of collectTsFiles(NEO_RUNTIME_ROOT)) {
      if (PRODUCTION_HOST_IMPORTERS.has(filePath)) continue;
      const content = readFileSync(filePath, 'utf8');
      if (
        /\bfrom\s+['"][^'"]*\/host\//.test(content) ||
        /\bfrom\s+['"]\.\.\/host\//.test(content)
      ) {
        offenders.push(relative(REPO_ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('createNeoRuntime does not reference integration harness modules', () => {
    const runtime = createNeoRuntime({
      openDurableHost: () => Promise.resolve({ ok: true, value: { close: () => ({ ok: true }) } }),
    });
    expect(runtime.diagnostics.processLockWiredToNeo).toBe(true);
    expect(runtime.diagnostics.neoSecondInstanceProtectionActive).toBe(true);
    expect(runtime.diagnostics.systemdLayerConfigured).toBe(true);
    expect(runtime.diagnostics.deploymentReady).toBe(false);
  });
});
