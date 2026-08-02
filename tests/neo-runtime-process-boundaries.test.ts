import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
  it('start-neo.mjs does not use process.stdin lifetime hack', () => {
    const startNeo = readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'start-neo.mjs'), 'utf8');
    expect(startNeo).not.toMatch(/process\.stdin\.resume\s*\(/);
    expect(startNeo).not.toMatch(/\bprocess\.exit\s*\(/);
    expect(startNeo).toContain('process.exitCode');
    expect(startNeo).toContain('dist/neo-runtime/cli/run-neo-process.js');
  });

  it('keep-alive adapter uses a ref interval without unref', () => {
    const keepAliveAdapter = readFileSync(
      join(NEO_RUNTIME_ROOT, 'adapters', 'create-node-process-keep-alive-port.ts'),
      'utf8',
    );
    expect(keepAliveAdapter).toContain('NEO_PROCESS_KEEP_ALIVE_INTERVAL_MS');
    expect(keepAliveAdapter).toContain('setInterval');
    expect(keepAliveAdapter).not.toContain('.unref()');
  });

  it('production output adapter writes bounded JSON lines', () => {
    const outputAdapter = readFileSync(
      join(NEO_RUNTIME_ROOT, 'adapters', 'create-node-process-output-port.ts'),
      'utf8',
    );
    expect(outputAdapter).toContain('writeStdoutLine');
    expect(outputAdapter).toContain('writeStderrLine');
    expect(outputAdapter).not.toContain('JSON.stringify');
  });

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

  it('shutdown timeout exit 13 collides with Node unfinished TLA and requires structured event', () => {
    const exitCodes = readFileSync(join(NEO_RUNTIME_ROOT, 'neo-runtime-exit-codes.ts'), 'utf8');
    expect(exitCodes).toContain('NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT = 13');
    expect(exitCodes).toContain('unfinished top-level await');
  });

  it('run-neo-process wires production keep-alive and structured logging', () => {
    const content = readFileSync(join(NEO_RUNTIME_ROOT, 'cli', 'run-neo-process.ts'), 'utf8');
    expect(content).toContain('createNodeProcessKeepAlivePort');
    expect(content).toContain('createProductionNeoRuntimeLogSink');
    expect(content).toContain('keepAliveLease.release()');
  });
});
