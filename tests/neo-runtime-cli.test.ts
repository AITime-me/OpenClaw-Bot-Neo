import { describe, expect, it } from 'vitest';
import { parseNeoCliArguments } from '../src/neo-runtime/cli/parse-neo-cli-arguments.js';
import { NEO_TEST_PATHS, validRunArgv } from './support/neo-runtime-fixtures.js';

describe('neo runtime CLI arguments', () => {
  it('parses exact valid argument set', () => {
    const result = parseNeoCliArguments(validRunArgv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      kind: 'run',
      configPath: NEO_TEST_PATHS.config,
      storageBindingPath: NEO_TEST_PATHS.storageBinding,
      storagePolicyPath: NEO_TEST_PATHS.storagePolicy,
      executionRoot: NEO_TEST_PATHS.executionRoot,
    });
  });

  it('accepts --help alone', () => {
    const result = parseNeoCliArguments(['--help']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ kind: 'help' });
  });

  it.each([
    ['unknown flag', ['--unknown', 'C:\\neo\\x.json']],
    ['duplicate --config', ['--config', NEO_TEST_PATHS.config, '--config', NEO_TEST_PATHS.config]],
    ['missing value', ['--config']],
    ['relative path', ['--config', 'relative/config.json']],
    ['NUL in path', ['--config', 'C:\\neo\\bad\0.json']],
    ['positional argument', ['positional', '--help']],
    ['help with extra args', ['--help', '--config', NEO_TEST_PATHS.config]],
    ['empty argv', []],
    ['missing required flag', ['--config', NEO_TEST_PATHS.config]],
  ])('rejects %s', (_label, argv) => {
    const result = parseNeoCliArguments(argv);
    expect(result.ok).toBe(false);
  });
});
