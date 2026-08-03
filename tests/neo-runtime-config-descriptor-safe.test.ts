/* eslint-disable @typescript-eslint/require-await */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  createNodeConfigFileOpenDriverWithPrimitives,
  type ConfigFileOpenDriverPrimitives,
} from '../src/neo-runtime/production/config-file-open-driver.js';
import {
  createNodeProductionConfigFileReaderWithOpenDriver,
  NEO_CONFIG_MAX_FILE_BYTES,
} from '../src/neo-runtime/production/read-production-config-file.js';

const BASE_CONSTANTS = Object.freeze({
  O_RDONLY: 0b0001,
  O_NOFOLLOW: 0b0100,
});

type FakeHandle = {
  readonly stat: () => Promise<{ isFile: () => boolean; size: number }>;
  readonly read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  readonly close: () => Promise<void>;
};

const createFakeDriver = (
  behavior: {
    readonly open?: (path: string) => Promise<FakeHandle>;
    readonly platform?: string;
    readonly constants?: typeof BASE_CONSTANTS;
  } = {},
) => {
  const openCalls: string[] = [];
  const closeCalls: number[] = [];
  let closeCount = 0;
  const primitives: ConfigFileOpenDriverPrimitives = {
    platform: behavior.platform ?? process.platform,
    constants: behavior.constants ?? BASE_CONSTANTS,
    open: async (path: string, flags: number) => {
      void flags;
      openCalls.push(path);
      if (behavior.open !== undefined) return behavior.open(path) as never;
      return {
        stat: async () => ({ isFile: () => true, size: 2 }),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          void position;
          buffer.write('{}', offset, length, 'utf8');
          return { bytesRead: length };
        },
        close: async () => {
          closeCount += 1;
          closeCalls.push(closeCount);
        },
      } as never;
    },
  };
  const openDriver = createNodeConfigFileOpenDriverWithPrimitives(primitives);
  const reader = createNodeProductionConfigFileReaderWithOpenDriver(openDriver);
  return { reader, openCalls, closeCalls, openDriver };
};

const isLinux = process.platform === 'linux';
const canSymlink = isLinux || process.platform === 'darwin';

describe('neo runtime config descriptor-safe read (R6-L01)', () => {
  it('rejects symlink before open via defense-in-depth path walk', async () => {
    if (!canSymlink) return;
    const root = await mkdtemp(join(tmpdir(), 'neo-config-symlink-'));
    const secret = join(root, 'secret.json');
    const link = join(root, 'host.json');
    await writeFile(secret, '{"broken":true}', 'utf8');
    symlinkSync(secret, link);
    const reader = createNodeProductionConfigFileReaderWithOpenDriver(
      createNodeConfigFileOpenDriverWithPrimitives({
        platform: 'linux',
        constants: BASE_CONSTANTS,
        open: async () => {
          throw new Error('open should not run');
        },
      }),
    );
    const result = await reader.readJsonFile(link);
    expect(result.ok).toBe(false);
  });

  it('uses opened descriptor as authority and does not reopen by pathname', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neo-config-toctou-'));
    const configPath = join(root, 'host.json');
    await writeFile(configPath, '{"ok":true}', 'utf8');
    const { reader, openCalls } = createFakeDriver();
    const result = await reader.readJsonFile(configPath);
    expect(result.ok).toBe(true);
    expect(openCalls).toEqual([configPath]);
  });

  it('rejects non-regular file from descriptor fstat', async () => {
    const { reader } = createFakeDriver({
      open: async () => ({
        stat: async () => ({ isFile: () => false, size: 0 }),
        read: async () => ({ bytesRead: 0 }),
        close: async () => undefined,
      }),
    });
    const result = await reader.readJsonFile(join(tmpdir(), 'not-a-file'));
    expect(result.ok).toBe(false);
  });

  it('accepts exactly the maximum allowed size', async () => {
    const fillerLength = NEO_CONFIG_MAX_FILE_BYTES - `{"p":""}`.length;
    const maxJson = `{"p":"${'a'.repeat(fillerLength)}"}`;
    expect(maxJson.length).toBe(NEO_CONFIG_MAX_FILE_BYTES);
    const root = await mkdtemp(join(tmpdir(), 'neo-config-max-'));
    const configPath = join(root, 'max.json');
    await writeFile(configPath, '{}', 'utf8');
    let maxCloseCount = 0;
    const { reader, openCalls } = createFakeDriver({
      open: async (path) => {
        expect(path).toBe(configPath);
        return {
          stat: async () => ({ isFile: () => true, size: maxJson.length }),
          read: async (buffer, offset, length, position) => {
            const slice = maxJson.slice(position, position + length);
            buffer.write(slice, offset, slice.length, 'utf8');
            return { bytesRead: slice.length };
          },
          close: async () => {
            maxCloseCount += 1;
          },
        };
      },
    });
    const result = await reader.readJsonFile(configPath);
    expect(result.ok).toBe(true);
    expect(openCalls).toEqual([configPath]);
    expect(maxCloseCount).toBe(1);
  });

  it('rejects oversized files from descriptor fstat', async () => {
    const { reader } = createFakeDriver({
      open: async () => ({
        stat: async () => ({
          isFile: () => true,
          size: NEO_CONFIG_MAX_FILE_BYTES + 1,
        }),
        read: async () => ({ bytesRead: 0 }),
        close: async () => undefined,
      }),
    });
    const result = await reader.readJsonFile(join(tmpdir(), 'big.json'));
    expect(result.ok).toBe(false);
  });

  it('rejects short reads', async () => {
    const { reader } = createFakeDriver({
      open: async () => ({
        stat: async () => ({ isFile: () => true, size: 4 }),
        read: async () => ({ bytesRead: 0 }),
        close: async () => undefined,
      }),
    });
    const result = await reader.readJsonFile(join(tmpdir(), 'short.json'));
    expect(result.ok).toBe(false);
  });

  it('closes descriptor after success and validation failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neo-config-close-'));
    const okPath = join(root, 'ok.json');
    const badPath = join(root, 'bad.json');
    await writeFile(okPath, '{}', 'utf8');
    await writeFile(badPath, '{}', 'utf8');

    const { reader: okReader, closeCalls: okClose, openCalls: okOpen } = createFakeDriver();
    await okReader.readJsonFile(okPath);
    expect(okOpen).toEqual([okPath]);
    expect(okClose.length).toBe(1);

    let validationCloseCalls = 0;
    const { reader: badReader, openCalls: badOpen } = createFakeDriver({
      open: async (path) => {
        expect(path).toBe(badPath);
        return {
          stat: async () => ({ isFile: () => false, size: 0 }),
          read: async () => ({ bytesRead: 0 }),
          close: async () => {
            validationCloseCalls += 1;
          },
        };
      },
    });
    await badReader.readJsonFile(badPath);
    expect(badOpen).toEqual([badPath]);
    expect(validationCloseCalls).toBe(1);
  });

  it('rejects missing pathname before open without reaching injected driver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neo-config-missing-'));
    const missingPath = join(root, 'missing', 'config.json');
    let openCalled = false;
    const reader = createNodeProductionConfigFileReaderWithOpenDriver(
      createNodeConfigFileOpenDriverWithPrimitives({
        platform: 'linux',
        constants: BASE_CONSTANTS,
        open: async () => {
          openCalled = true;
          throw new Error('open should not run');
        },
      }),
    );
    const result = await reader.readJsonFile(missingPath);
    expect(result.ok).toBe(false);
    expect(openCalled).toBe(false);
  });

  it('fails closed when Linux no-follow flags are unavailable', async () => {
    const openDriver = createNodeConfigFileOpenDriverWithPrimitives({
      platform: 'linux',
      constants: { O_RDONLY: BASE_CONSTANTS.O_RDONLY },
      open: async () => {
        throw new Error('open should not run');
      },
    });
    expect(openDriver.requiresNoFollow).toBe(true);
    await expect(openDriver.openConfigFile(join(tmpdir(), 'flags.json'))).rejects.toMatchObject({
      code: 'CONFIG_OPEN_FLAGS_UNAVAILABLE',
    });
    if (!isLinux) return;
    const reader = createNodeProductionConfigFileReaderWithOpenDriver(openDriver);
    const root = await mkdtemp(join(tmpdir(), 'neo-config-nofollow-'));
    const configPath = join(root, 'host.json');
    await writeFile(configPath, '{}', 'utf8');
    const result = await reader.readJsonFile(configPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unavailable');
  });

  it('Windows test seam works without claiming POSIX production enforcement', async () => {
    const { reader, openDriver } = createFakeDriver({ platform: 'win32' });
    expect(openDriver.requiresNoFollow).toBe(false);
    const result = await reader.readJsonFile(join(tmpdir(), 'win.json'));
    expect(result.ok).toBe(true);
  });

  it('node reader rejects interpolation on real files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neo-config-interp-'));
    const configPath = join(root, 'host.json');
    mkdirSync(root, { recursive: true });
    writeFileSync(configPath, '{"modelRouting": "${HOME}"}', { mode: 0o600 });
    const reader = createNodeProductionConfigFileReaderWithOpenDriver(
      createNodeConfigFileOpenDriverWithPrimitives({
        platform: process.platform,
        constants: {
          O_RDONLY: fs.constants.O_RDONLY,
          O_NOFOLLOW: fs.constants.O_NOFOLLOW,
        },
        open: (path, flags) => import('node:fs/promises').then((m) => m.open(path, flags)),
      }),
    );
    const result = await reader.readJsonFile(configPath);
    expect(result.ok).toBe(false);
  });

  it('rejects regular path replaced by symlink when open uses no-follow', async () => {
    if (!canSymlink) return;
    const root = await mkdtemp(join(tmpdir(), 'neo-config-replace-'));
    const target = join(root, 'target.json');
    const configPath = join(root, 'host.json');
    await writeFile(target, '{"from":"b"}', 'utf8');
    await writeFile(configPath, '{"from":"a"}', 'utf8');
    await unlink(configPath);
    symlinkSync(target, configPath);
    const reader = createNodeProductionConfigFileReaderWithOpenDriver(
      createNodeConfigFileOpenDriverWithPrimitives({
        platform: 'linux',
        constants: BASE_CONSTANTS,
        open: (path, flags) => import('node:fs/promises').then((m) => m.open(path, flags)),
      }),
    );
    const result = await reader.readJsonFile(configPath);
    expect(result.ok).toBe(false);
  });
});
