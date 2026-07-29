import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckEnvironment,
  npmExecutableFor,
  runCheckSteps,
  validateNpmCliPath,
} from '../scripts/run-check.mjs';
import * as runCheckModule from '../scripts/run-check.mjs';

describe('quality-check process wrapper', () => {
  it('selects npm.cmd on Windows and npm on POSIX', () => {
    expect(npmExecutableFor('win32')).toBe('npm.cmd');
    expect(npmExecutableFor('linux')).toBe('npm');
    expect(npmExecutableFor('darwin')).toBe('npm');
  });

  it('keeps production precedence over the review override', () => {
    expect(
      buildCheckEnvironment({
        OPENCLAW_PRODUCTION_NODE_GATE: '1',
        OPENCLAW_REVIEW_NODE_OVERRIDE: '1',
      }).OPENCLAW_REVIEW_NODE_OVERRIDE,
    ).toBe('');
    expect(buildCheckEnvironment({}).OPENCLAW_REVIEW_NODE_OVERRIDE).toBe('1');
  });

  it('keeps the checked declaration aligned with runtime exports', () => {
    expect(Object.keys(runCheckModule).sort()).toEqual([
      'buildCheckEnvironment',
      'npmExecutableFor',
      'runCheckSteps',
      'validateNpmCliPath',
    ]);
  });

  it('uses argument arrays, disables the shell and preserves a failing status', () => {
    const spawn = vi.fn().mockReturnValue({
      status: 7,
      signal: null,
      error: undefined,
    });
    expect(runCheckSteps({ platform: 'win32', environment: {}, spawn })).toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      'npm.cmd',
      ['run', 'check:node'],
      expect.objectContaining({ shell: false, stdio: 'inherit' }),
    );
  });

  it('fails safely on spawn errors and signals', () => {
    const errorSpawn = vi.fn().mockReturnValue({
      status: null,
      signal: null,
      error: new Error('synthetic'),
    });
    expect(runCheckSteps({ spawn: errorSpawn })).toBe(1);

    const signalSpawn = vi.fn().mockReturnValue({
      status: null,
      signal: 'SIGTERM',
      error: undefined,
    });
    expect(runCheckSteps({ spawn: signalSpawn })).toBe(1);
  });

  it('falls back to node plus npm_execpath when Node rejects direct npm.cmd spawning', () => {
    const spawnError = Object.assign(new Error('spawnSync npm.cmd EINVAL'), { code: 'EINVAL' });
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: null, signal: null, error: spawnError })
      .mockReturnValue({ status: 0, signal: null, error: undefined });
    expect(
      runCheckSteps({
        platform: 'win32',
        environment: {
          npm_execpath: 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
          npm_node_execpath: 'C:\\node\\node.exe',
        },
        nodeExecutable: 'C:\\node\\node.exe',
        spawn,
        validateCliPath: () => 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
      }),
    ).toBe(0);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'npm.cmd',
      ['run', 'check:node'],
      expect.objectContaining({ shell: false }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'C:\\node\\node.exe',
      ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'check:node'],
      expect.objectContaining({ shell: false }),
    );
    expect(spawn).toHaveBeenLastCalledWith(
      'C:\\node\\node.exe',
      ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'check:hygiene'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('validates npm CLI paths against the real Node installation root', () => {
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    const identityRealpath = (path: string): string => path;
    expect(
      validateNpmCliPath({
        candidate: cli,
        nodeExecutable: node,
        npmNodeExecutable: node,
        platform: 'win32',
        realpath: identityRealpath,
      }),
    ).toBe(cli);
    for (const candidate of [
      'node_modules\\npm\\bin\\npm-cli.js',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\other.js',
      'C:\\arbitrary\\npm-cli.js',
      'C:\\repo\\node_modules\\npm\\bin\\npm-cli.js',
      'C:\\Program Files\\nodejs\\fake\\..\\node_modules\\npm\\bin\\npm-cli.js',
    ])
      expect(
        validateNpmCliPath({
          candidate,
          nodeExecutable: node,
          npmNodeExecutable: node,
          platform: 'win32',
          realpath: identityRealpath,
        }),
      ).toBeNull();
    expect(
      validateNpmCliPath({
        candidate: cli,
        nodeExecutable: node,
        npmNodeExecutable: 'C:\\other\\node.exe',
        platform: 'win32',
        realpath: identityRealpath,
      }),
    ).toBeNull();
    expect(
      validateNpmCliPath({
        candidate: cli,
        nodeExecutable: node,
        platform: 'win32',
        realpath: (path) => (path === cli ? 'C:\\temp\\npm-cli.js' : path),
      }),
    ).toBeNull();
  });

  it('refuses an untrusted Windows fallback without executing arbitrary JavaScript', () => {
    const spawnError = Object.assign(new Error('spawnSync npm.cmd EINVAL'), { code: 'EINVAL' });
    const spawn = vi.fn().mockReturnValue({ status: null, signal: null, error: spawnError });
    expect(
      runCheckSteps({
        platform: 'win32',
        environment: { npm_execpath: 'C:\\repo\\npm-cli.js' },
        nodeExecutable: 'C:\\node\\node.exe',
        spawn,
      }),
    ).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
