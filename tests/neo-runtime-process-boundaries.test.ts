import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';

const REPO_ROOT = process.cwd();
const NEO_RUNTIME_ROOT = join(REPO_ROOT, 'src', 'neo-runtime');

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

describe('neo runtime process boundaries', () => {
  it('launcher imports only compiled dist JavaScript', () => {
    const startNeo = readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'start-neo.mjs'), 'utf8');
    const neoStatus = readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'neo-status.mjs'), 'utf8');
    expect(startNeo).toContain('dist/neo-runtime/cli/run-neo-process.js');
    expect(neoStatus).toContain('dist/neo-runtime/cli/read-neo-status.js');
    for (const content of [startNeo, neoStatus]) {
      expect(content).not.toMatch(
        /\.ts['"]|tsx|ts-node|experimental-strip-types|ts-source-resolve/,
      );
    }
  });

  it('start-neo.mjs is the only Neo boundary that sets process.exitCode', () => {
    const launchers = [
      readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'start-neo.mjs'), 'utf8'),
      readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'neo-status.mjs'), 'utf8'),
    ];
    for (const launcher of launchers) {
      expect(launcher).toContain('process.exitCode');
      expect(launcher).not.toMatch(/\bprocess\.exit\s*\(/);
    }

    for (const filePath of collectTsFiles(NEO_RUNTIME_ROOT)) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/\bprocess\.exit\s*\(/);
      expect(content).not.toMatch(/\bprocess\.exitCode\s*=/);
    }
  });

  it('neo runtime modules do not read process.env', () => {
    for (const filePath of collectTsFiles(NEO_RUNTIME_ROOT)) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/\bprocess\.env\b/);
    }
  });

  it('run-neo-process does not use TypeScript runtime transpilation hooks', () => {
    const content = readFileSync(join(NEO_RUNTIME_ROOT, 'cli', 'run-neo-process.ts'), 'utf8');
    expect(content).not.toMatch(/experimental-strip-types|ts-source-resolve|module\.register/);
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

  it('diagnostics remain honest about deployment and systemd', () => {
    const diagnostics = readFileSync(join(NEO_RUNTIME_ROOT, 'neo-runtime-diagnostics.ts'), 'utf8');
    expect(diagnostics).toContain('neoCompiledProcessBoundaryImplemented: true');
    expect(diagnostics).toContain('processLockWiredToNeo: false');
    expect(diagnostics).toContain('systemdLayerConfigured: false');
    expect(diagnostics).toContain('deploymentReady: false');
  });

  it('lists neo-runtime source files for boundary coverage', () => {
    const relativePaths = collectTsFiles(NEO_RUNTIME_ROOT).map((file) => relative(REPO_ROOT, file));
    expect(relativePaths.length).toBeGreaterThan(10);
  });
});
