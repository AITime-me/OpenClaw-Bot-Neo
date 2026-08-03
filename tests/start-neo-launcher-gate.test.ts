import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchNeoProcess } from '../scripts/neo/launch-neo-process.mjs';
import { NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME } from '../scripts/lib/neo-launcher-exit-codes.mjs';
import {
  NEO_START_NEO_LAUNCHER,
  NEO_COMPILED_PROCESS_ENTRY,
} from '../scripts/integration/lib/neo-runtime-gate-constants.js';

const REPO_ROOT = process.cwd();
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
  exports: Record<string, unknown>;
};

const makeRuntimeModule = (exitCode: number) => ({
  runNeoProcessFromNode: () => Promise.resolve({ exitCode }),
});

describe('start-neo production launcher gate', () => {
  it('rejects unsupported versions before runtime import', async () => {
    let importCount = 0;
    const stderrChunks: string[] = [];
    const result = await launchNeoProcess({
      nodeVersion: '23.0.0',
      importRunNeoProcess: () => {
        importCount += 1;
        return Promise.resolve(makeRuntimeModule(0));
      },
      stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
    });
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME);
    expect(importCount).toBe(0);
    expect(stderrChunks.join('')).toContain('>=22.13.0 <23');
    expect(stderrChunks.join('')).not.toMatch(/stack|config|secret|OPENCLAW/i);
  });

  it('rejects malformed versions before runtime import', async () => {
    let importCount = 0;
    const result = await launchNeoProcess({
      nodeVersion: 'not-a-version',
      importRunNeoProcess: () => {
        importCount += 1;
        return Promise.resolve(makeRuntimeModule(0));
      },
      stderr: { write: () => {} },
    });
    expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME);
    expect(importCount).toBe(0);
  });

  it('ignores review override and production gate environment variables', async () => {
    const previousReview = process.env.OPENCLAW_REVIEW_NODE_OVERRIDE;
    const previousGate = process.env.OPENCLAW_PRODUCTION_NODE_GATE;
    process.env.OPENCLAW_REVIEW_NODE_OVERRIDE = '1';
    process.env.OPENCLAW_PRODUCTION_NODE_GATE = '1';
    try {
      let importCount = 0;
      const result = await launchNeoProcess({
        nodeVersion: '24.0.0',
        importRunNeoProcess: () => {
          importCount += 1;
          return Promise.resolve(makeRuntimeModule(0));
        },
        stderr: { write: () => {} },
      });
      expect(result.exitCode).toBe(NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME);
      expect(importCount).toBe(0);
    } finally {
      if (previousReview === undefined) delete process.env.OPENCLAW_REVIEW_NODE_OVERRIDE;
      else process.env.OPENCLAW_REVIEW_NODE_OVERRIDE = previousReview;
      if (previousGate === undefined) delete process.env.OPENCLAW_PRODUCTION_NODE_GATE;
      else process.env.OPENCLAW_PRODUCTION_NODE_GATE = previousGate;
    }
  });

  it('allows supported Node 22 and invokes runtime exactly once', async () => {
    let importCount = 0;
    let runCount = 0;
    const result = await launchNeoProcess({
      nodeVersion: '22.13.0',
      importRunNeoProcess: () => {
        importCount += 1;
        return Promise.resolve({
          runNeoProcessFromNode: () => {
            runCount += 1;
            return Promise.resolve({ exitCode: 11 });
          },
        });
      },
      stderr: { write: () => {} },
    });
    expect(result.exitCode).toBe(11);
    expect(importCount).toBe(1);
    expect(runCount).toBe(1);
  });

  it('allows later Node 22.x releases', async () => {
    const result = await launchNeoProcess({
      nodeVersion: '22.18.0',
      importRunNeoProcess: () => Promise.resolve(makeRuntimeModule(0)),
      stderr: { write: () => {} },
    });
    expect(result.exitCode).toBe(0);
  });

  it('start-neo static import ordering is safe', () => {
    const startNeo = readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'start-neo.mjs'), 'utf8');
    expect(startNeo).toContain("from './launch-neo-process.mjs'");
    expect(startNeo).not.toMatch(/await\s+import\([^)]*run-neo-process/);
    expect(startNeo).not.toMatch(/from\s+['"].*dist\/neo-runtime/);
    expect(startNeo).toContain('process.exitCode');
    expect(startNeo).not.toMatch(/\bprocess\.exit\s*\(/);
  });

  it('launch helper has no static runtime imports', () => {
    const helper = readFileSync(
      join(REPO_ROOT, 'scripts', 'neo', 'launch-neo-process.mjs'),
      'utf8',
    );
    expect(helper).not.toMatch(/dist\/neo-runtime/);
    expect(helper).toContain('evaluateSupportedNodeVersion');
  });

  it('linux integration gate targets start-neo launcher', () => {
    expect(NEO_START_NEO_LAUNCHER).toBe('scripts/neo/start-neo.mjs');
  });

  it('package scripts do not launch compiled CLI directly', () => {
    const scripts = Object.values(packageJson.scripts).join('\n');
    expect(scripts).not.toContain(NEO_COMPILED_PROCESS_ENTRY);
    expect(packageJson.exports).not.toHaveProperty('./dist/neo-runtime/cli/run-neo-process.js');
  });

  it('neo-status remains ungated', () => {
    const neoStatus = readFileSync(join(REPO_ROOT, 'scripts', 'neo', 'neo-status.mjs'), 'utf8');
    expect(neoStatus).not.toContain('launch-neo-process');
    expect(neoStatus).not.toContain('node-version-contract');
    expect(neoStatus).toContain('dist/neo-runtime/cli/read-neo-status.js');
  });
});
