import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalStoragePlan } from '../src/host/index.js';
import { openPosixStorageRootWithSystem } from '../src/host/storage/runtime/open-posix-storage-root.js';
import {
  isPosixStorageRootOwnershipError,
  PosixStorageRootOwnershipError,
  type OpenedPosixStorageRoot,
} from '../src/host/storage/runtime/open-posix-storage-root.js';
import { resolveOpenedPosixStorageRootCapability } from '../src/host/storage/runtime/posix-storage-root-capability.internal.js';
import type {
  PosixDirectoryHandle,
  PosixPathIdentity,
  PosixStorageSystem,
  RuntimeOsFamily,
} from '../src/host/storage/runtime/posix-storage-system.js';
import type { StorageFailure } from '../src/host/storage/storage-failure.js';

const STORAGE_ROOT = '/var/lib/openclaw-neo';
const OTHER_ROOT = '/var/lib/openclaw-neo-other';
const REPO_ROOT = '/opt/openclaw-bot-neo';
const SERVICE_UID = 1001;

const posixPlan = (storageRoot = STORAGE_ROOT) => {
  const plan = createLocalStoragePlan({
    platform: 'posix',
    storageRoot,
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  return plan.value;
};

const policyInput = () =>
  Object.freeze({
    expectedUid: SERVICE_UID,
    allowedModeBits: 0o700,
    repositoryRoot: REPO_ROOT,
  });

type FakeOptions = {
  runtime?: RuntimeOsFamily;
  currentUid?: number;
  storageRoot?: string;
  closeError?: boolean | (() => boolean);
  fstatError?: boolean;
};

const dirIdentity = (
  partial: Partial<PosixPathIdentity> & Pick<PosixPathIdentity, 'ino'>,
): PosixPathIdentity =>
  Object.freeze({
    dev: '1',
    mode: 0o700,
    uid: SERVICE_UID,
    gid: SERVICE_UID,
    isDirectory: true,
    isSymbolicLink: false,
    isFile: false,
    ...partial,
  });

const createFakeSystem = (options: FakeOptions = {}) => {
  const storageRoot = options.storageRoot ?? STORAGE_ROOT;
  const nodes: Record<string, { identity: PosixPathIdentity }> = {
    '/var': { identity: dirIdentity({ ino: '10', uid: 0, mode: 0o755 }) },
    '/var/lib': { identity: dirIdentity({ ino: '11', uid: 0, mode: 0o755 }) },
    [storageRoot]: { identity: dirIdentity({ ino: storageRoot === OTHER_ROOT ? '22' : '12' }) },
    [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
  };
  let openCount = 0;
  let liveHandles = 0;
  const openHandleIds = new Set<number>();

  const shouldFailClose = (): boolean => {
    if (typeof options.closeError === 'function') return options.closeError();
    return options.closeError === true;
  };

  const system: PosixStorageSystem = Object.freeze({
    getRuntimeOsFamily: () => options.runtime ?? 'linux',
    getCurrentUid: () => options.currentUid ?? SERVICE_UID,
    lstat: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: node.identity };
    },
    realpath: (absolutePath: string) => {
      if (!nodes[absolutePath])
        return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: absolutePath };
    },
    openDirectory: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      openCount += 1;
      liveHandles += 1;
      openHandleIds.add(openCount);
      const handle = Object.freeze({
        __brand: 'PosixDirectoryHandle' as const,
        id: openCount,
      }) as PosixDirectoryHandle & { id: number };
      return { ok: true as const, value: handle };
    },
    fstat: (handle: PosixDirectoryHandle) => {
      void handle;
      if (options.fstatError) return { ok: false as const, error: { code: 'IO' as const } };
      const identity = nodes[storageRoot]?.identity;
      if (!identity) return { ok: false as const, error: { code: 'IO' as const } };
      return { ok: true as const, value: identity };
    },
    closeDirectory: (handle: PosixDirectoryHandle) => {
      if (shouldFailClose()) return { ok: false as const, error: { code: 'IO' as const } };
      const id = (handle as PosixDirectoryHandle & { id?: number }).id;
      if (typeof id === 'number' && openHandleIds.has(id)) {
        openHandleIds.delete(id);
        liveHandles = Math.max(0, liveHandles - 1);
      }
      return { ok: true as const, value: undefined };
    },
  });

  return { system, getLiveHandles: () => liveHandles };
};

const openGenuine = (options: FakeOptions = {}) => {
  const fake = createFakeSystem(options);
  const result = openPosixStorageRootWithSystem(
    posixPlan(options.storageRoot ?? STORAGE_ROOT),
    policyInput(),
    fake.system,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected genuine open');
  return { root: result.value, fake };
};

const expectRedactedCapabilityFailure = (failure: StorageFailure, ...needles: string[]) => {
  const blob = `${failure.code}:${failure.reason}:${failure.field ?? ''}:${JSON.stringify(failure)}`;
  for (const needle of needles) expect(blob).not.toContain(needle);
  expect(blob).not.toMatch(/\bfd\b|WeakMap|handle|UID|0o700|repositoryRoot/i);
  expect(failure).not.toHaveProperty('stack');
  expect(failure).not.toHaveProperty('cause');
  expect(failure).not.toHaveProperty('storageRoot');
};

describe('POSIX storage-root capability seal (Build 3.3B2B)', () => {
  it('accepts a genuine successful open as an open capability', () => {
    const { root, fake } = openGenuine();
    const resolved = resolveOpenedPosixStorageRootCapability(root);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('resolve');
    expect(resolved.value.storageRootPath).toBe(STORAGE_ROOT);
    expect(resolved.value.lifecycleState).toBe('open');
    expect(Object.isFrozen(resolved.value)).toBe(true);
    expect(Object.isFrozen(root)).toBe(true);
    root.close();
    expect(fake.getLiveHandles()).toBe(0);
  });

  it('allows repeated resolve while open without mutating lifecycle', () => {
    const { root } = openGenuine();
    const first = resolveOpenedPosixStorageRootCapability(root);
    const second = resolveOpenedPosixStorageRootCapability(root);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.storageRootPath).toBe(second.value.storageRootPath);
      expect(first.value).not.toBe(second.value);
    }
    root.close();
  });

  it('treats independent genuine roots as independent capabilities', () => {
    const a = openGenuine({ storageRoot: STORAGE_ROOT });
    const b = openGenuine({ storageRoot: OTHER_ROOT });
    const ra = resolveOpenedPosixStorageRootCapability(a.root);
    const rb = resolveOpenedPosixStorageRootCapability(b.root);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.value.storageRootPath).toBe(STORAGE_ROOT);
      expect(rb.value.storageRootPath).toBe(OTHER_ROOT);
    }
    a.root.close();
    expect(resolveOpenedPosixStorageRootCapability(a.root).ok).toBe(false);
    expect(resolveOpenedPosixStorageRootCapability(b.root).ok).toBe(true);
    b.root.close();
  });

  describe('structural forgery rejection', () => {
    const reject = (value: unknown) => {
      const resolved = resolveOpenedPosixStorageRootCapability(value);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.code).toBe('STORAGE_ROOT_CAPABILITY_INVALID');
        expectRedactedCapabilityFailure(
          resolved.error,
          STORAGE_ROOT,
          REPO_ROOT,
          'openclaw',
          String(SERVICE_UID),
        );
      }
    };

    it('rejects manually forged plain objects and frozen clones of shape', () => {
      const { root } = openGenuine();
      const forged = {
        plan: root.plan,
        policy: root.policy,
        diagnostics: root.diagnostics,
        close: root.close,
      };
      reject(forged);
      reject(Object.freeze({ ...forged }));
      root.close();
    });

    it('rejects spread, Object.assign, JSON roundtrip, and property copies', () => {
      const { root } = openGenuine();
      reject({ ...root });
      reject(Object.assign({}, root));
      reject(JSON.parse(JSON.stringify({ plan: root.plan, diagnostics: root.diagnostics })));
      const copied: Record<string, unknown> = {};
      for (const key of Object.keys(root) as (keyof OpenedPosixStorageRoot)[]) {
        copied[key] = root[key];
      }
      reject(copied);
      root.close();
    });

    it('rejects Object.create(genuine), same prototype, and custom prototypes', () => {
      const { root } = openGenuine();
      reject(Object.create(root));
      const proto: object | null = Object.getPrototypeOf(root) as object | null;
      reject(Object.create(proto, Object.getOwnPropertyDescriptors(root)));
      reject(Object.create(null));
      reject(Object.create({ close: root.close }));
      root.close();
    });

    it('rejects brand/string/symbol copies and non-object values', () => {
      const brand = Symbol.for('OpenedPosixStorageRoot');
      reject(Object.freeze({ __brand: 'OpenedPosixStorageRoot', [brand]: true }));
      reject(() => undefined);
      reject([]);
      reject(new Map());
      reject(new Date());
      reject('capability');
      reject(42);
      reject(true);
      reject(undefined);
      reject(null);
    });
  });

  describe('Proxy and getter safety', () => {
    it('rejects Proxy wrapping a genuine result without executing traps', () => {
      const { root } = openGenuine();
      let trapCount = 0;
      const proxy = new Proxy(root, {
        get(target, prop, receiver): unknown {
          trapCount += 1;
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop): boolean {
          trapCount += 1;
          return Reflect.has(target, prop);
        },
        ownKeys(target): (string | symbol)[] {
          trapCount += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, prop): PropertyDescriptor | undefined {
          trapCount += 1;
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
      const resolved = resolveOpenedPosixStorageRootCapability(proxy);
      expect(resolved.ok).toBe(false);
      expect(trapCount).toBe(0);
      if (!resolved.ok) expectRedactedCapabilityFailure(resolved.error, STORAGE_ROOT);
      root.close();
    });

    it('rejects a revoked Proxy without programmer crash or trap execution', () => {
      const { root } = openGenuine();
      const { proxy, revoke } = Proxy.revocable(root, {
        get() {
          throw new Error('trap must not run');
        },
      });
      revoke();
      expect(() => resolveOpenedPosixStorageRootCapability(proxy)).not.toThrow();
      const resolved = resolveOpenedPosixStorageRootCapability(proxy);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expectRedactedCapabilityFailure(resolved.error, STORAGE_ROOT);
      root.close();
    });

    it('rejects getter-bearing fakes without invoking getters', () => {
      let getterCount = 0;
      const fake = {
        get plan() {
          getterCount += 1;
          return 'leaked';
        },
        get close() {
          getterCount += 1;
          return () => undefined;
        },
      };
      const resolved = resolveOpenedPosixStorageRootCapability(fake);
      expect(resolved.ok).toBe(false);
      expect(getterCount).toBe(0);
      if (!resolved.ok) expectRedactedCapabilityFailure(resolved.error, 'leaked', STORAGE_ROOT);
    });
  });

  describe('close lifecycle invalidation', () => {
    it('invalidates capability at the start of a successful close and keeps it rejected', () => {
      const { root } = openGenuine();
      expect(resolveOpenedPosixStorageRootCapability(root).ok).toBe(true);
      const closed = root.close();
      expect(closed.ok).toBe(true);
      const after = resolveOpenedPosixStorageRootCapability(root);
      expect(after.ok).toBe(false);
      if (!after.ok) {
        expect(after.error.code).toBe('STORAGE_ROOT_CAPABILITY_UNAVAILABLE');
        expectRedactedCapabilityFailure(after.error, STORAGE_ROOT);
      }
      expect(root.close().ok).toBe(true);
      expect(resolveOpenedPosixStorageRootCapability(root).ok).toBe(false);
    });

    it('invalidates capability when close fails and does not reactivate after retry success', () => {
      let failOnce = true;
      const { root, fake } = openGenuine({
        closeError: () => {
          if (failOnce) {
            failOnce = false;
            return true;
          }
          return false;
        },
      });
      expect(resolveOpenedPosixStorageRootCapability(root).ok).toBe(true);
      const first = root.close();
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.error.code).toBe('STORAGE_ROOT_CLOSE_FAILED');
      const retired = resolveOpenedPosixStorageRootCapability(root);
      expect(retired.ok).toBe(false);
      if (!retired.ok) expect(retired.error.code).toBe('STORAGE_ROOT_CAPABILITY_UNAVAILABLE');
      const retry = root.close();
      expect(retry.ok).toBe(true);
      expect(fake.getLiveHandles()).toBe(0);
      expect(resolveOpenedPosixStorageRootCapability(root).ok).toBe(false);
    });

    it('replacing close on a mutable copy cannot restore authority', () => {
      const { root } = openGenuine();
      root.close();
      const impostor = {
        plan: root.plan,
        policy: root.policy,
        diagnostics: root.diagnostics,
        close: () => ({ ok: true as const, value: undefined }),
      };
      expect(resolveOpenedPosixStorageRootCapability(impostor).ok).toBe(false);
      expect(() => {
        (root as { close?: unknown }).close = impostor.close;
      }).toThrow();
    });

    it('mutating diagnostics or plan does not affect authority', () => {
      const { root } = openGenuine();
      expect(() => {
        (root.diagnostics as { storageLock?: string }).storageLock = 'exclusive';
      }).toThrow();
      expect(() => {
        (root.plan as { schemaVersion?: number }).schemaVersion = 99;
      }).toThrow();
      expect(resolveOpenedPosixStorageRootCapability(root).ok).toBe(true);
      root.close();
    });
  });

  describe('pendingCleanup and OwnershipError are not capabilities', () => {
    it('rejects PosixStorageRootOwnershipError and its pendingCleanup', () => {
      const pending = Object.freeze({
        retryClose: () => ({ ok: true as const, value: undefined }),
      });
      const ownershipError = new PosixStorageRootOwnershipError(pending, new Error('original'));
      expect(isPosixStorageRootOwnershipError(ownershipError)).toBe(true);
      expect(resolveOpenedPosixStorageRootCapability(ownershipError).ok).toBe(false);
      expect(resolveOpenedPosixStorageRootCapability(ownershipError.pendingCleanup).ok).toBe(false);
    });

    it('post-validation CLOSE_FAILED pendingCleanup is not a capability', () => {
      const failing = createFakeSystem({ fstatError: true, closeError: true });
      const result = openPosixStorageRootWithSystem(posixPlan(), policyInput(), failing.system);
      expect(result.ok).toBe(false);
      if (!result.ok && 'pendingCleanup' in result) {
        expect(resolveOpenedPosixStorageRootCapability(result.pendingCleanup).ok).toBe(false);
        expect(resolveOpenedPosixStorageRootCapability(result).ok).toBe(false);
        expect(resolveOpenedPosixStorageRootCapability(result.error).ok).toBe(false);
        result.pendingCleanup.retryClose();
      }
    });
  });

  describe('export and authority surface containment', () => {
    it('does not export sealer or resolver from package root, host, or storage barrels', () => {
      const roots = [
        readFileSync('src/index.ts', 'utf8'),
        readFileSync('src/host/index.ts', 'utf8'),
        readFileSync('src/host/storage/index.ts', 'utf8'),
        readFileSync('src/host/storage/runtime/index.ts', 'utf8'),
        readFileSync('package.json', 'utf8'),
      ];
      for (const source of roots) {
        expect(source).not.toMatch(/posix-storage-root-capability/);
        expect(source).not.toMatch(/posix-storage-root-lease/);
        expect(source).not.toMatch(/resolveOpenedPosixStorageRootCapability/);
        expect(source).not.toMatch(/acquireOpenedPosixStorageRootLease/);
        expect(source).not.toMatch(/registerOpenedPosixStorageRootCapability/);
      }
    });

    it('does not expose enumerable capability markers on the success object', () => {
      const { root } = openGenuine();
      expect(Object.keys(root).sort()).toEqual(['close', 'diagnostics', 'plan', 'policy']);
      expect(Object.getOwnPropertySymbols(root)).toEqual([]);
      const blob = JSON.stringify({
        plan: root.plan.binding,
        diagnostics: root.diagnostics,
      });
      expect(blob).not.toMatch(/WeakMap|capability|authority|storageRootPath/);
      root.close();
    });

    it('resolver view does not expose handle, fd, policy, or repositoryRoot', () => {
      const { root } = openGenuine();
      const resolved = resolveOpenedPosixStorageRootCapability(root);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) throw new Error('resolve');
      expect(Object.keys(resolved.value).sort()).toEqual(['lifecycleState', 'storageRootPath']);
      expect(resolved.value).not.toHaveProperty('handle');
      expect(resolved.value).not.toHaveProperty('fd');
      expect(resolved.value).not.toHaveProperty('policy');
      expect(resolved.value).not.toHaveProperty('repositoryRoot');
      expect(resolved.value).not.toHaveProperty('diagnostics');
      root.close();
    });
  });
});
