import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEO_GATE_BOOTSTRAP_FAILED,
  bootstrapNeoRuntimeLinuxGate,
} from '../scripts/integration/lib/neo-runtime-linux-gate-bootstrap.ts';
import {
  NEO_GATE_EXIT_ENVIRONMENT,
  NEO_GATE_EXIT_PROTOCOL,
  NEO_GATE_PASS_MARKER,
} from '../scripts/integration/lib/neo-runtime-gate-constants.ts';
import {
  extractObservedRuntimeEventNames,
  summarizeNeoChildObservability,
  UNSETTLED_TOP_LEVEL_AWAIT_PATTERN,
} from '../scripts/integration/lib/neo-runtime-child-observability.ts';
import { redactNeoGateText } from '../scripts/integration/lib/redaction.ts';

const REPO_ROOT = process.cwd();
const INTEGRATION_ROOT = join(REPO_ROOT, 'scripts', 'integration');
const GATE_LAUNCHER = join(INTEGRATION_ROOT, 'run-neo-runtime-linux-gate.mjs');
const GATE_ENTRY = join(INTEGRATION_ROOT, 'neo-runtime-linux-gate.ts');

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

const collectBootstrapGraphFiles = (): string[] => {
  const visited = new Set<string>();
  const queue = [GATE_ENTRY];
  while (queue.length > 0) {
    const absolute = queue.pop();
    if (absolute === undefined || visited.has(absolute)) continue;
    visited.add(absolute);
    const content = readFileSync(absolute, 'utf8');
    for (const match of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const resolved = join(dirname(absolute), specifier);
      const tsCandidate = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
      if (existsSync(tsCandidate)) queue.push(tsCandidate);
    }
  }
  return [...visited];
};

describe('neo runtime linux gate bootstrap', () => {
  it('loads integration child-observability from source', async () => {
    const mod = await import('../scripts/integration/lib/neo-runtime-child-observability.ts');
    expect(typeof mod.summarizeNeoChildObservability).toBe('function');
    expect(typeof mod.extractObservedRuntimeEventNames).toBe('function');
  });

  it('bootstrap graph has no unresolved sibling .js imports in integration sources', () => {
    const violations: string[] = [];
    for (const filePath of collectBootstrapGraphFiles()) {
      const content = readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+\.js)['"]/g)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = join(dirname(filePath), specifier);
        if (!existsSync(resolved)) {
          violations.push(`${relative(REPO_ROOT, filePath)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('launcher without opt-in reaches environment gate with exit 20', () => {
    const env = { ...process.env };
    delete env.OPENCLAW_LINUX_NEO_RUNTIME_GATE;
    const result = spawnSync(process.execPath, [GATE_LAUNCHER], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    expect(result.status).toBe(NEO_GATE_EXIT_ENVIRONMENT);
    expect(result.stderr).toContain('GATE_OPT_IN_MISSING');
    expect(result.stdout).not.toContain(NEO_GATE_PASS_MARKER);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).not.toContain('NEO_GATE_BOOTSTRAP_FAILED');
  });

  it('maps simulated bootstrap import failure to exit 50', async () => {
    const chunks: string[] = [];
    const stderr = { write: (line: string) => chunks.push(line) };
    const code = await bootstrapNeoRuntimeLinuxGate(
      () => Promise.reject(new Error('ERR_MODULE_NOT_FOUND')),
      stderr as unknown as NodeJS.WritableStream,
    );
    expect(code).toBe(NEO_GATE_EXIT_PROTOCOL);
    expect(chunks.join('')).toContain(NEO_GATE_BOOTSTRAP_FAILED);
  });

  it('bootstrap failure emits no raw stack or absolute module URL', async () => {
    const chunks: string[] = [];
    const stderr = { write: (line: string) => chunks.push(line) };
    await bootstrapNeoRuntimeLinuxGate(
      () =>
        Promise.reject(
          new Error(
            'Cannot find module file:///workspace/openclaw-src/src/foo.js\n    at finalizeResolution',
          ),
        ),
      stderr as unknown as NodeJS.WritableStream,
    );
    const output = chunks.join('');
    expect(output).not.toMatch(/\bat\s+/);
    expect(output).not.toContain('file://');
    expect(output).not.toContain('/workspace/');
  });

  it('bootstrap failure with missing export maps to exit 50', async () => {
    const chunks: string[] = [];
    const stderr = { write: (line: string) => chunks.push(line) };
    const code = await bootstrapNeoRuntimeLinuxGate(
      () => Promise.resolve({}),
      stderr as unknown as NodeJS.WritableStream,
    );
    expect(code).toBe(NEO_GATE_EXIT_PROTOCOL);
    expect(chunks.join('')).toContain(NEO_GATE_BOOTSTRAP_FAILED);
  });

  it('launcher wraps bootstrap in bounded failure contract', () => {
    const launcher = readFileSync(GATE_LAUNCHER, 'utf8');
    expect(launcher).toContain('bootstrapNeoRuntimeLinuxGate');
    expect(launcher).toContain('process.exitCode');
    expect(launcher).toMatch(/await import\('\.\/lib\/neo-runtime-linux-gate-bootstrap\.ts'\)/);
  });

  it('extracts allowed Neo event names and ignores unknown events', () => {
    const stdout =
      '{"event":"neo.runtime.ready","pid":1}\n{"event":"custom.unknown","pid":1}\nnot-json\n';
    expect(extractObservedRuntimeEventNames(stdout, '')).toEqual(['neo.runtime.ready']);
  });

  it('requires structured shutdown_timeout event for internal timeout classification', () => {
    const withoutEvent = summarizeNeoChildObservability({
      stdout: '',
      stderr: 'Warning: Detected unsettled top-level await',
      neoChildAliveBeforeSignal: false,
    });
    expect(withoutEvent.shutdownTimeoutEventObserved).toBe(false);

    const withEvent = summarizeNeoChildObservability({
      stdout: '',
      stderr: '{"event":"neo.runtime.shutdown_timeout","pid":1,"atUtc":"t"}',
      neoChildAliveBeforeSignal: true,
    });
    expect(withEvent.shutdownTimeoutEventObserved).toBe(true);
  });

  it('detects unsettled top-level-await warning independently', () => {
    const observability = summarizeNeoChildObservability({
      stdout: '',
      stderr: 'Warning: Detected unsettled top-level await at file:///tmp/start-neo.mjs:10',
      neoChildAliveBeforeSignal: false,
    });
    expect(observability.unsettledTopLevelAwaitWarning).toBe(true);
    expect(UNSETTLED_TOP_LEVEL_AWAIT_PATTERN.test(observability.childStderrSummary)).toBe(true);
  });

  it('keeps stdout/stderr summaries bounded and redacted', () => {
    const long = 'x'.repeat(400);
    const observability = summarizeNeoChildObservability({
      stdout: `${long}/var/lib/openclaw token=abc`,
      stderr: 'user@example.com',
      neoChildAliveBeforeSignal: true,
    });
    expect(observability.childStdoutSummary.length).toBeLessThanOrEqual(256);
    expect(observability.childStderrSummary.length).toBeLessThanOrEqual(256);
    expect(observability.childStdoutSummary).not.toContain('/var/lib/openclaw');
    expect(observability.childStdoutSummary).not.toMatch(/token=abc/i);
    expect(observability.childStderrSummary).not.toContain('user@example.com');
    expect(redactNeoGateText('/home/neo/secret password=secret')).toContain('<path>');
  });

  it('integration modules do not import production child-observability from src', () => {
    for (const filePath of collectTsFiles(INTEGRATION_ROOT)) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/src\/neo-runtime\/logging\/neo-runtime-child-observability/);
    }
    const evidence = readFileSync(join(INTEGRATION_ROOT, 'lib', 'neo-runtime-evidence.ts'), 'utf8');
    expect(evidence).toContain('./neo-runtime-child-observability.ts');
  });
});
