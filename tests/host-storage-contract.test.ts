import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  createLocalHost,
  createLocalStoragePlan,
  evaluateStorageSchemaCompatibility,
  LOCAL_HOST_DIAGNOSTICS,
  parseStorageBindingRequest,
} from '../src/host/index.js';
import { fixedClock } from './support/fixtures.js';

const win32Request = () =>
  Object.freeze({
    platform: 'win32' as const,
    storageRoot: 'C:\\openclaw-neo\\storage',
  });

const posixRequest = () =>
  Object.freeze({
    platform: 'posix' as const,
    storageRoot: '/var/lib/openclaw-neo',
  });

const listStorageSources = (root = 'src/host/storage'): string[] => {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const name of entries) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...listStorageSources(path));
    else if (name.endsWith('.ts')) files.push(path.replaceAll('\\', '/'));
  }
  return files;
};

describe('parseStorageBindingRequest container safety', () => {
  it('accepts a valid win32 request', () => {
    const result = parseStorageBindingRequest(win32Request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.platform).toBe('win32');
    expect(result.value.storageRoot).toBe('C:\\openclaw-neo\\storage');
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('accepts a valid posix request', () => {
    const result = parseStorageBindingRequest(posixRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.platform).toBe('posix');
    expect(result.value.storageRoot).toBe('/var/lib/openclaw-neo');
  });

  it.each([[null], [[]], ['string'], [42], [true]])('denies non-object container %p', (value) => {
    const result = parseStorageBindingRequest(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STORAGE_REQUEST');
  });

  it('denies class instances and custom prototypes', () => {
    class RequestBag {
      readonly marker = true;
    }
    const custom = {};
    Object.assign(custom, win32Request());
    Object.setPrototypeOf(custom, { polluted: true });
    expect(parseStorageBindingRequest(new RequestBag()).ok).toBe(false);
    expect(parseStorageBindingRequest(custom).ok).toBe(false);
  });

  it('does not invoke top-level getters', () => {
    let getterCalls = 0;
    const input = { ...win32Request() } as Record<string, unknown>;
    Object.defineProperty(input, 'storageRoot', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter-must-not-run');
      },
    });
    const result = parseStorageBindingRequest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
    expect(getterCalls).toBe(0);
  });

  it('rejects Proxy containers before any observable trap runs', () => {
    const traps = {
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      get: 0,
      has: 0,
    };
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          traps.getPrototypeOf += 1;
          throw new Error('getPrototypeOf-must-not-run');
        },
        ownKeys() {
          traps.ownKeys += 1;
          throw new Error('ownKeys-must-not-run');
        },
        getOwnPropertyDescriptor() {
          traps.getOwnPropertyDescriptor += 1;
          throw new Error('getOwnPropertyDescriptor-must-not-run');
        },
        get() {
          traps.get += 1;
          throw new Error('get-must-not-run');
        },
        has() {
          traps.has += 1;
          throw new Error('has-must-not-run');
        },
      },
    );
    const result = parseStorageBindingRequest(proxy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
    expect(traps).toEqual({
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      get: 0,
      has: 0,
    });
  });

  it('denies revoked Proxy containers safely', () => {
    const { proxy, revoke } = Proxy.revocable(
      { platform: 'posix', storageRoot: '/var/lib/openclaw-neo' },
      {},
    );
    revoke();
    const result = parseStorageBindingRequest(proxy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
  });

  it('denies Symbol fields', () => {
    const input = { ...win32Request() } as Record<string | symbol, unknown>;
    input[Symbol('extra')] = 'nope';
    const result = parseStorageBindingRequest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_STORAGE_INPUT');
  });

  it('denies non-enumerable unknown fields', () => {
    const input = { ...win32Request() } as Record<string, unknown>;
    Object.defineProperty(input, 'hidden', {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const result = parseStorageBindingRequest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_STORAGE_FIELD');
      expect(result.error.field).toBe('hidden');
    }
  });

  it('denies unknown normal fields', () => {
    const result = parseStorageBindingRequest({ ...win32Request(), backend: 'sqlite' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_STORAGE_FIELD');
      expect(result.error.field).toBe('backend');
    }
  });

  it.each([['platform'], ['storageRoot']] as const)('denies missing %s', (missing) => {
    const base = win32Request();
    const input: Record<string, unknown> = {
      platform: base.platform,
      storageRoot: base.storageRoot,
    };
    Reflect.deleteProperty(input, missing);
    const result = parseStorageBindingRequest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_STORAGE_FIELD');
    expect(result.error.field).toBe(missing);
  });

  it('denies undefined platform and storageRoot values', () => {
    const missingPlatform = parseStorageBindingRequest({
      platform: undefined,
      storageRoot: 'C:\\openclaw-neo\\storage',
    });
    expect(missingPlatform.ok).toBe(false);
    if (!missingPlatform.ok) expect(missingPlatform.error.code).toBe('INVALID_PLATFORM');

    const missingRoot = parseStorageBindingRequest({
      platform: 'win32',
      storageRoot: undefined,
    });
    expect(missingRoot.ok).toBe(false);
    if (!missingRoot.ok) expect(missingRoot.error.code).toBe('INVALID_STORAGE_ROOT');
  });
});

describe('parseStorageBindingRequest windows paths', () => {
  it('accepts a local absolute drive path', () => {
    expect(parseStorageBindingRequest(win32Request()).ok).toBe(true);
  });

  it('accepts lowercase drive letters when otherwise valid', () => {
    const result = parseStorageBindingRequest({
      platform: 'win32',
      storageRoot: 'c:\\openclaw-neo\\storage',
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['relative', 'openclaw\\storage'],
    ['drive-relative', 'C:storage'],
    ['UNC', '\\\\server\\share\\storage'],
    ['device-question', '\\\\?\\C:\\openclaw-neo\\storage'],
    ['device-dot', '\\\\.\\C:\\openclaw-neo\\storage'],
    ['NUL-char', 'C:\\openclaw-neo\\storage\0x'],
    ['dot-segment', 'C:\\openclaw-neo\\.\\storage'],
    ['dotdot-segment', 'C:\\openclaw-neo\\..\\storage'],
    ['mixed-separators', 'C:\\openclaw-neo/storage'],
    ['trailing-dot', 'C:\\openclaw-neo\\storage.'],
    ['trailing-space', 'C:\\openclaw-neo\\storage '],
    ['drive-root-only', 'C:\\'],
    ['ads-file', 'C:\\storage:file'],
    ['ads-mid-segment', 'C:\\sto:rage'],
    ['ads-nested', 'C:\\one\\two:stream'],
    ['ads-early-segment', 'C:\\one:two\\three'],
    ['ads-lowercase-drive', 'c:\\storage:file'],
  ])('denies %s win32 path', (_label, storageRoot) => {
    const result = parseStorageBindingRequest({ platform: 'win32', storageRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['UNSAFE_PATH', 'INVALID_STORAGE_ROOT']).toContain(result.error.code);
      expect(result.error.reason).not.toContain('openclaw');
      expect(result.error.reason).not.toContain('storage:file');
      expect(result.error.reason).not.toContain('one:two');
      expect(result.error.reason).not.toMatch(/[A-Za-z]:\\/i);
      expect(result.error).not.toHaveProperty('stack');
    }
  });

  it.each([
    ['CON', 'C:\\CON\\storage'],
    ['prn-case', 'C:\\data\\Prn'],
    ['AUX', 'C:\\data\\AUX'],
    ['NUL', 'C:\\data\\NUL'],
    ['COM1', 'C:\\data\\COM1'],
    ['COM9', 'C:\\data\\COM9'],
    ['LPT1', 'C:\\data\\LPT1'],
    ['LPT9', 'C:\\data\\LPT9'],
    ['CON.txt', 'C:\\data\\CON.txt'],
    ['NUL.log', 'C:\\data\\NUL.log'],
    ['NUL.txt', 'C:\\data\\NUL.txt'],
    ['COM1.data', 'C:\\data\\COM1.data'],
    ['com1.TXT', 'C:\\data\\com1.TXT'],
    ['LPT9.tmp', 'C:\\data\\LPT9.tmp'],
    ['mid-CON', 'C:\\CON\\storage'],
  ])('denies reserved device path %s', (_label, storageRoot) => {
    const result = parseStorageBindingRequest({ platform: 'win32', storageRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSAFE_PATH');
      expect(result.error.reason).not.toMatch(/[A-Za-z]:\\/i);
      expect(result.error.reason).not.toContain('NUL.txt');
      expect(result.error.reason).not.toContain('com1.TXT');
      expect(result.error).not.toHaveProperty('stack');
    }
  });

  it.each([
    ['CONSOLE', 'C:\\data\\CONSOLE'],
    ['COM10', 'C:\\data\\COM10'],
    ['LPT10', 'C:\\data\\LPT10'],
    ['AUXILIARY', 'C:\\data\\AUXILIARY'],
    ['NULLED', 'C:\\data\\NULLED'],
    ['PRINTER', 'C:\\data\\PRINTER'],
  ])('allows similar non-reserved name %s', (_label, storageRoot) => {
    expect(parseStorageBindingRequest({ platform: 'win32', storageRoot }).ok).toBe(true);
  });
});

describe('parseStorageBindingRequest posix paths', () => {
  it('accepts an ordinary absolute path', () => {
    expect(parseStorageBindingRequest(posixRequest()).ok).toBe(true);
  });

  it.each([
    ['relative', 'var/lib/openclaw-neo'],
    ['root-only', '/'],
    ['double-root', '//server/share'],
    ['NUL', '/var/lib/openclaw-neo\0x'],
    ['dot-segment', '/var/lib/./openclaw-neo'],
    ['dotdot-segment', '/var/lib/../openclaw-neo'],
    ['normalization-changing', '/var/lib//openclaw-neo'],
  ])('denies %s posix path', (_label, storageRoot) => {
    const result = parseStorageBindingRequest({ platform: 'posix', storageRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['UNSAFE_PATH', 'INVALID_STORAGE_ROOT']).toContain(result.error.code);
      expect(JSON.stringify(result.error)).not.toContain('openclaw-neo');
    }
  });
});

describe('evaluateStorageSchemaCompatibility', () => {
  it('accepts only a single observedVersion argument against CURRENT', () => {
    // Supplementary arity hint only; Function.length alone cannot detect optional/default/rest.
    expect(evaluateStorageSchemaCompatibility.length).toBe(1);
    expect(CURRENT_STORAGE_SCHEMA_VERSION).toBe(1);
  });

  it('ignores a second runtime argument and still mismatches 99 against CURRENT=1', () => {
    // Bypass TypeScript arity checking without changing the production signature.
    const forged = Reflect.apply(
      evaluateStorageSchemaCompatibility,
      undefined,
      [99, 99],
    ) as ReturnType<typeof evaluateStorageSchemaCompatibility>;
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.error.code).toBe('SCHEMA_MISMATCH');
      expect(forged.error).not.toHaveProperty('stack');
    }
    expect(CURRENT_STORAGE_SCHEMA_VERSION).toBe(1);
  });

  it('accepts observed version 1 as compatible with frozen CURRENT', () => {
    const result = evaluateStorageSchemaCompatibility(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('compatible');
    expect(result.value.observedVersion).toBe(1);
    expect(result.value.currentVersion).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    expect(result.value.migrationEnabled).toBe(false);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('denies observed version 2 as SCHEMA_MISMATCH and never reports compatible for 99', () => {
    const newer = evaluateStorageSchemaCompatibility(2);
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.error.code).toBe('SCHEMA_MISMATCH');

    const forged = evaluateStorageSchemaCompatibility(99);
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe('SCHEMA_MISMATCH');
    expect(CURRENT_STORAGE_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', '1'],
    ['boolean', true],
    ['object', { version: 1 }],
    ['array', [1]],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fraction', 1.5],
    ['zero', 0],
    ['negative', -1],
    ['unsafe-integer', Number.MAX_SAFE_INTEGER + 1],
  ])('denies invalid schema version (%s) without echoing the raw value', (_label, value) => {
    const result = evaluateStorageSchemaCompatibility(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA_VERSION');
      const serialized = JSON.stringify(result.error);
      if (typeof value === 'string') expect(serialized).not.toContain(value);
      if (typeof value === 'number' && Number.isFinite(value))
        expect(serialized).not.toContain(String(value));
      expect(result.error).not.toHaveProperty('stack');
    }
  });

  it('does not enable or perform migration side effects', () => {
    const before = CURRENT_STORAGE_SCHEMA_VERSION;
    const result = evaluateStorageSchemaCompatibility(2);
    expect(result.ok).toBe(false);
    expect(CURRENT_STORAGE_SCHEMA_VERSION).toBe(before);
    expect(CURRENT_STORAGE_SCHEMA_VERSION).toBe(1);
  });
});

describe('createLocalStoragePlan', () => {
  it('returns a frozen plan with honest unbound diagnostics', () => {
    const result = createLocalStoragePlan(posixRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.binding)).toBe(true);
    expect(Object.isFrozen(result.value.diagnostics)).toBe(true);
    expect(result.value.schemaVersion).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    expect(result.value.diagnostics).toEqual({
      bindingKind: 'explicit-path',
      platformSource: 'explicit-input',
      pathValidation: 'lexical-only',
      filesystemProbed: false,
      directoryExistenceVerified: false,
      symlinkOrJunctionChecked: false,
      permissionsVerified: false,
      storageBackend: 'unbound',
      writesEnabled: false,
      durability: 'none',
      migrationEnabled: false,
      encryptionEnabled: false,
      credentialsLoaded: false,
      networkClients: 'none',
      deploymentReady: false,
    });
  });

  it('isolates results from later input mutation', () => {
    const input: Record<string, unknown> = {
      platform: 'posix',
      storageRoot: '/var/lib/openclaw-neo',
    };
    const result = createLocalStoragePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input['storageRoot'] = '/tmp/mutated';
    input['platform'] = 'win32';
    expect(result.value.binding.storageRoot).toBe('/var/lib/openclaw-neo');
    expect(result.value.binding.platform).toBe('posix');
  });

  it('returns independent binding objects for two plans', () => {
    const first = createLocalStoragePlan(posixRequest());
    const second = createLocalStoragePlan(posixRequest());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).not.toBe(second.value);
    expect(first.value.binding).not.toBe(second.value.binding);
  });

  it('returns parse failures without creating a plan', () => {
    const result = createLocalStoragePlan({ broken: true });
    expect(result.ok).toBe(false);
  });
});

describe('storage platform and hygiene', () => {
  it('denies non-contract platforms without reading process.platform', () => {
    const hostPlatform = process.platform;
    const darwin = parseStorageBindingRequest({
      platform: 'darwin',
      storageRoot: '/tmp/x',
    });
    expect(darwin.ok).toBe(false);
    if (!darwin.ok) expect(darwin.error.code).toBe('INVALID_PLATFORM');

    const linux = parseStorageBindingRequest({
      platform: 'linux',
      storageRoot: '/tmp/x',
    });
    expect(linux.ok).toBe(false);
    if (!linux.ok) expect(linux.error.code).toBe('INVALID_PLATFORM');

    const missing = parseStorageBindingRequest({ storageRoot: '/var/lib/openclaw-neo' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('MISSING_STORAGE_FIELD');

    const posix = parseStorageBindingRequest(posixRequest());
    const win32 = parseStorageBindingRequest(win32Request());
    expect(posix.ok && win32.ok).toBe(true);
    if (!posix.ok || !win32.ok) return;
    expect(posix.value.platform).toBe('posix');
    expect(win32.value.platform).toBe('win32');
    expect(process.platform).toBe(hostPlatform);
  });

  it('does not alter LocalHost diagnostics or ephemeral host composition', () => {
    const host = createLocalHost({ clock: fixedClock() });
    const plan = createLocalStoragePlan(posixRequest());
    expect(plan.ok).toBe(true);
    expect(host.diagnostics).toBe(LOCAL_HOST_DIAGNOSTICS);
    expect(host.diagnostics.defaultMemoryPolicy).toBe('deny');
    expect(host.diagnostics.builtInNetworkClients).toBe('none');
    expect(host.diagnostics.storage).toBe('in-memory');
    expect(host.diagnostics.durability).toBe('ephemeral');
  });

  it('production storage sources avoid env/cwd/platform/fs I/O call sites', () => {
    const sources = listStorageSources()
      .filter((path) => !path.includes('/storage/runtime/') && !path.includes('/storage/sqlite/'))
      .map((path) => ({
        path,
        text: readFileSync(path, 'utf8'),
      }));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.path.startsWith('src/host/storage/')).toBe(true);
      expect(source.text).not.toMatch(/\bfrom ['"]node:fs(?:\/promises)?['"]/);
      expect(source.text).not.toMatch(/\bfrom ['"]node:(http|https|net|tls|child_process|os)['"]/);
      expect(source.text).not.toMatch(/\bJSON\.parse\b/);
      expect(source.text).not.toMatch(/\bprocess\.env\b/);
      expect(source.text).not.toMatch(/\bprocess\.cwd\b/);
      expect(source.text).not.toMatch(/\bprocess\.platform\b/);
      expect(source.text).not.toMatch(/\bos\.homedir\b/);
      expect(source.text).not.toMatch(/\bpath(?:Win32|Posix)?\.resolve\s*\(/);
      expect(source.text).not.toMatch(
        /\b(?:stat|lstat|realpath|readFile|writeFile|open|mkdir)\s*\(/,
      );
      expect(source.text).not.toMatch(/\.internal/);
      expect(source.text).not.toMatch(/from ['"].*tests\//);
      expect(source.text).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bfetch\b/);
    }
  });

  it('keeps secret-looking path fragments out of failure payloads', () => {
    const denied = parseStorageBindingRequest({
      platform: 'win32',
      storageRoot: 'C:\\Users\\Admin\\secret-token-dir\\..\\storage',
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      const serialized = JSON.stringify(denied.error);
      expect(serialized).not.toContain('secret-token-dir');
      expect(serialized).not.toContain('Admin');
      expect(denied.error).not.toHaveProperty('stack');
    }
  });
});
