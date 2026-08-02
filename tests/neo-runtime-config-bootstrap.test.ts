import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapProductionConfig } from '../src/neo-runtime/production/production-config-bootstrap.js';
import {
  createInMemoryProductionConfigFileReader,
  createNodeProductionConfigFileReader,
  NEO_CONFIG_MAX_FILE_BYTES,
} from '../src/neo-runtime/production/read-production-config-file.js';
import {
  NEO_TEST_PATHS,
  validConfigFiles,
  validLocalHostConfig,
  validStorageBinding,
  validStoragePolicy,
} from './support/neo-runtime-fixtures.js';

const fixedClock = () => ({ now: () => new Date('2026-08-02T12:00:00.000Z') });

describe('neo runtime production config bootstrap', () => {
  it('loads only explicit allowlisted paths via in-memory reader', async () => {
    const readPaths: string[] = [];
    const files = validConfigFiles();
    const reader = {
      readJsonFile: async (absolutePath: string) => {
        readPaths.push(absolutePath);
        return createInMemoryProductionConfigFileReader(files).readJsonFile(absolutePath);
      },
    };
    const result = await bootstrapProductionConfig(reader, {
      configPath: NEO_TEST_PATHS.config,
      storageBindingPath: NEO_TEST_PATHS.storageBinding,
      storagePolicyPath: NEO_TEST_PATHS.storagePolicy,
      clock: fixedClock(),
    });
    expect(result.ok).toBe(true);
    expect(readPaths.sort()).toEqual(
      [NEO_TEST_PATHS.config, NEO_TEST_PATHS.storageBinding, NEO_TEST_PATHS.storagePolicy].sort(),
    );
  });

  it('invokes existing parsers for valid files', async () => {
    const result = await bootstrapProductionConfig(
      createInMemoryProductionConfigFileReader(validConfigFiles()),
      {
        configPath: NEO_TEST_PATHS.config,
        storageBindingPath: NEO_TEST_PATHS.storageBinding,
        storagePolicyPath: NEO_TEST_PATHS.storagePolicy,
        clock: fixedClock(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compositionInput.config).toEqual(validLocalHostConfig());
    expect(result.compositionInput.storageBinding).toEqual(validStorageBinding());
    expect(result.compositionInput.storagePolicy).toEqual(validStoragePolicy());
  });

  it('rejects malformed config without env expansion', async () => {
    const files = {
      ...validConfigFiles(),
      [NEO_TEST_PATHS.config]: { broken: true },
    };
    const result = await bootstrapProductionConfig(
      createInMemoryProductionConfigFileReader(files),
      {
        configPath: NEO_TEST_PATHS.config,
        storageBindingPath: NEO_TEST_PATHS.storageBinding,
        storagePolicyPath: NEO_TEST_PATHS.storagePolicy,
        clock: fixedClock(),
      },
    );
    expect(result.ok).toBe(false);
  });

  it('node reader rejects interpolation and oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neo-config-'));
    const configPath = join(root, 'host.json');
    await writeFile(configPath, '{"modelRouting": "${HOME}"}', 'utf8');
    const reader = createNodeProductionConfigFileReader();
    const interpolated = await reader.readJsonFile(configPath);
    expect(interpolated.ok).toBe(false);

    const bigPath = join(root, 'big.json');
    await writeFile(bigPath, 'x'.repeat(NEO_CONFIG_MAX_FILE_BYTES + 1), 'utf8');
    const oversized = await reader.readJsonFile(bigPath);
    expect(oversized.ok).toBe(false);
  });

  it('node reader rejects non-regular paths', async () => {
    const reader = createNodeProductionConfigFileReader();
    const missing = await reader.readJsonFile(join(tmpdir(), 'neo-missing-config.json'));
    expect(missing.ok).toBe(false);
  });
});
