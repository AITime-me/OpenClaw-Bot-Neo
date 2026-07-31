import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import { createLocalHost } from '../src/host/create-local-host.js';
import { createLocalStoragePlan } from '../src/host/index.js';
import {
  acquirePosixProcessLock,
  acquirePosixProcessLockWithTestHooks,
  isPosixProcessLockOwnershipError,
} from '../src/host/storage/runtime/acquire-posix-process-lock.js';
import { POSIX_PROCESS_LOCK_FILENAME } from '../src/host/storage/runtime/posix-process-lock-constants.js';
import type { PosixProcessLockDriver } from '../src/host/storage/runtime/posix-process-lock-driver.js';
import { createNodePosixProcessLockDriverWithPrimitives } from '../src/host/storage/runtime/posix-process-lock-driver.js';
import { openPosixStorageRootWithSystem } from '../src/host/storage/runtime/open-posix-storage-root.js';
import type { OpenedPosixStorageRoot } from '../src/host/storage/runtime/open-posix-storage-root.js';
import type {
  PosixDirectoryHandle,
  PosixPathIdentity,
  PosixStorageSystem,
} from '../src/host/storage/runtime/posix-storage-system.js';

const REPO_ROOT = '/opt/openclaw-bot-neo-b3b3';
const SERVICE_UID = 1001;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root === undefined) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

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

const createTempStorageRoot = (): string => {
  const posixRoot =
    '/openclaw-neo-b3b3-' +
    String(process.pid) +
    '-' +
    String(Date.now()) +
    '-' +
    Math.random().toString(16).slice(2);
  mkdirSync(posixRoot, { recursive: true });
  tempRoots.push(posixRoot);
  return posixRoot;
};

type FakeSystem = PosixStorageSystem & { readonly closeDirectoryCalls: number[] };

const createFakeSystem = (storageRoot: string): FakeSystem => {
  const nodes: Record<string, { identity: PosixPathIdentity }> = {
    [storageRoot]: { identity: dirIdentity({ ino: '12' }) },
    [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
  };
  const parts = storageRoot.split('/').filter((part) => part.length > 0);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    if (segment === undefined) continue;
    current = current + '/' + segment;
    nodes[current] = { identity: dirIdentity({ ino: String(20 + index), uid: 0, mode: 0o755 }) };
  }

  let openCount = 0;
  const closeDirectoryCalls: number[] = [];
  return Object.freeze({
    closeDirectoryCalls,
    getRuntimeOsFamily: () => 'linux' as const,
    getCurrentUid: () => SERVICE_UID,
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
      const handle = Object.freeze({
        __brand: 'PosixDirectoryHandle' as const,
        id: openCount,
      }) as PosixDirectoryHandle & { id: number };
      return { ok: true as const, value: handle };
    },
    fstat: (handle: PosixDirectoryHandle) => {
      void handle;
      const identity = nodes[storageRoot]?.identity;
      if (identity === undefined) return { ok: false as const, error: { code: 'IO' as const } };
      return { ok: true as const, value: identity };
    },
    closeDirectory: (handle: PosixDirectoryHandle) => {
      const id = (handle as PosixDirectoryHandle & { id?: number }).id;
      closeDirectoryCalls.push(id ?? -1);
      return { ok: true as const, value: undefined };
    },
  });
};

const openGenuineRoot = (
  storageRoot: string,
  system?: FakeSystem,
): { readonly root: OpenedPosixStorageRoot; readonly system: FakeSystem } => {
  const fake = system ?? createFakeSystem(storageRoot);
  const plan = createLocalStoragePlan({ platform: 'posix', storageRoot });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  const opened = openPosixStorageRootWithSystem(
    plan.value,
    {
      expectedUid: SERVICE_UID,
      allowedModeBits: 0o700,
      repositoryRoot: REPO_ROOT,
    },
    fake,
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('open');
  return { root: opened.value, system: fake };
};

type FakeKernelState = {
  readonly fdToPath: Map<number, string>;
  readonly pathOwnerFd: Map<string, number>;
  readonly contents: Map<string, string>;
  readonly nextFd: { value: number };
};

const createSharedFakeKernel = (): FakeKernelState => ({
  fdToPath: new Map(),
  pathOwnerFd: new Map(),
  contents: new Map(),
  nextFd: { value: 100 },
});

type FakeDriverOptions = {
  readonly openError?: NodeJS.ErrnoException;
  readonly fstatError?: NodeJS.ErrnoException;
  readonly flockError?: NodeJS.ErrnoException | Error;
  readonly flockErrorOnce?: NodeJS.ErrnoException;
  readonly closeFailures?: number;
  readonly fileMode?: number;
  readonly fileUid?: number;
  readonly nlink?: number;
  readonly isFile?: boolean;
  /** Shared fake kernel flock state — required for multi-driver contention tests. */
  readonly kernel?: FakeKernelState;
};

type FakeDriver = PosixProcessLockDriver & {
  readonly openedPaths: string[];
  readonly closeCalls: number;
  readonly flockCalls: number;
  readonly unlinkCalls: number;
  readonly contents: Map<string, string>;
  readonly kernel: FakeKernelState;
  readonly ownerFdFor: (path: string) => number | undefined;
  readonly hasOpenFd: (fd: number) => boolean;
  readonly setCloseFailures: (count: number) => void;
};

/**
 * Fake lock driver with owning-fd semantics:
 * - path → owning fd (not a path boolean set);
 * - close releases the path lock only when the closed fd is the owner;
 * - contender close after EAGAIN must not unlock the holder;
 * - injected close failure is decided before any fd/owner map mutation.
 */
const createFakeDriver = (options: FakeDriverOptions = {}): FakeDriver => {
  const kernel = options.kernel ?? createSharedFakeKernel();
  const openedPaths: string[] = [];
  const closeCalls = { count: 0 };
  const flockCalls = { count: 0 };
  const unlinkCalls = { count: 0 };
  let closeFailuresLeft = options.closeFailures ?? 0;
  let flockErrorOnce = options.flockErrorOnce;

  return Object.freeze({
    openedPaths,
    get closeCalls() {
      return closeCalls.count;
    },
    get flockCalls() {
      return flockCalls.count;
    },
    get unlinkCalls() {
      return unlinkCalls.count;
    },
    contents: kernel.contents,
    kernel,
    ownerFdFor: (path: string): number | undefined => kernel.pathOwnerFd.get(path),
    hasOpenFd: (fd: number): boolean => kernel.fdToPath.has(fd),
    setCloseFailures: (count: number): void => {
      closeFailuresLeft = count;
    },
    openLockFile: (absoluteLockPath: string): number => {
      if (options.openError !== undefined) throw options.openError;
      openedPaths.push(absoluteLockPath);
      if (!kernel.contents.has(absoluteLockPath)) kernel.contents.set(absoluteLockPath, '');
      const fd = kernel.nextFd.value;
      kernel.nextFd.value += 1;
      kernel.fdToPath.set(fd, absoluteLockPath);
      return fd;
    },
    fstatLockFd: (fd: number) => {
      if (options.fstatError !== undefined) throw options.fstatError;
      if (!kernel.fdToPath.has(fd)) {
        const error = new Error('bad fd') as NodeJS.ErrnoException;
        error.code = 'EBADF';
        throw error;
      }
      return Object.freeze({
        isFile: options.isFile ?? true,
        mode: options.fileMode ?? 0o600,
        uid: options.fileUid ?? SERVICE_UID,
        nlink: options.nlink ?? 1,
      });
    },
    flockExclusiveNonblocking: (fd: number): void => {
      flockCalls.count += 1;
      if (flockErrorOnce !== undefined) {
        const once = flockErrorOnce;
        flockErrorOnce = undefined;
        throw once;
      }
      if (options.flockError !== undefined) throw options.flockError;
      const path = kernel.fdToPath.get(fd);
      if (path === undefined) {
        const error = new Error('bad fd') as NodeJS.ErrnoException;
        error.code = 'EBADF';
        throw error;
      }
      const owner = kernel.pathOwnerFd.get(path);
      if (owner !== undefined && owner !== fd) {
        const error = new Error('would block') as NodeJS.ErrnoException;
        error.code = 'EAGAIN';
        throw error;
      }
      // First acquire or idempotent re-flock by the owning fd.
      kernel.pathOwnerFd.set(path, fd);
    },
    closeFd: (fd: number): void => {
      closeCalls.count += 1;
      // Failure must be decided before any ownership/fd map mutation.
      if (closeFailuresLeft > 0) {
        closeFailuresLeft -= 1;
        const error = new Error('close failed') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
      const path = kernel.fdToPath.get(fd);
      if (path !== undefined) {
        // Owner-only unlock — contender/unrelated fd close must not clear holder ownership.
        if (kernel.pathOwnerFd.get(path) === fd) kernel.pathOwnerFd.delete(path);
        kernel.fdToPath.delete(fd);
      }
    },
  });
};

const errno = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const errnoCodeOf = (error: unknown): string => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : '';
};

const linuxHooks = (driver: PosixProcessLockDriver) =>
  Object.freeze({
    getPlatform: () => 'linux',
    getEffectiveUid: () => SERVICE_UID,
    driver,
  });

const assertNoLeak = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /neo\.primary\.lock|openclaw-neo|fd\b|EAGAIN|EWOULDBLOCK|errno|syscall|stack|fs-ext|pid/i,
  );
  expect(serialized).not.toMatch(/\/var\/|\\\\|C:\\\\/i);
};

describe('acquirePosixProcessLock platform gate', () => {
  it('fails closed on non-Linux before root lease or file open', () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, {
      getPlatform: () => 'win32',
      driver,
      getEffectiveUid: () => SERVICE_UID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_UNAVAILABLE');
    expect(driver.openedPaths).toEqual([]);
    expect(driver.flockCalls).toBe(0);
    const closed = root.close();
    expect(closed.ok).toBe(true);
    expect(system.closeDirectoryCalls.length).toBe(1);
    assertNoLeak(result);
  });

  it('default factory on this host fails closed without opening a lock file', () => {
    if (process.platform === 'linux') return;
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const result = acquirePosixProcessLock(root);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_UNAVAILABLE');
    expect(existsSync(join(storageRoot, POSIX_PROCESS_LOCK_FILENAME))).toBe(false);
    expect(root.close().ok).toBe(true);
  });

  it('injected Linux platform permits the test path', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(driver.openedPaths).toEqual([`${storageRoot}/${POSIX_PROCESS_LOCK_FILENAME}`]);
    expect(result.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('maps native load / flags unavailable to STORAGE_LOCK_UNAVAILABLE', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ openError: errno('STORAGE_LOCK_FLAGS_UNAVAILABLE') });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_UNAVAILABLE');
    expect(root.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock authenticity', () => {
  it('accepts a genuine open root', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(createFakeDriver()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(Object.keys(result.value)).toEqual(['diagnostics', 'release']);
    expect(result.value.release().ok).toBe(true);
  });

  it('rejects forged clones without creating a lock file or busy root', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const fakes: unknown[] = [
      { diagnostics: {}, close: () => undefined },
      { ...root },
      Object.freeze({ ...root }),
      JSON.parse(JSON.stringify({ plan: root.plan, diagnostics: root.diagnostics })),
      Object.create(root),
    ];
    for (const fake of fakes) {
      const driver = createFakeDriver();
      const result = acquirePosixProcessLockWithTestHooks(fake, linuxHooks(driver));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected fail');
      expect(result.error.code).toMatch(/STORAGE_ROOT_CAPABILITY/);
      expect(driver.openedPaths).toEqual([]);
    }
    expect(root.close().ok).toBe(true);
  });

  it('rejects Proxy and revoked Proxy without invoking traps for authority', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    let trapHits = 0;
    const proxied = new Proxy(root, {
      get(target, prop, receiver): unknown {
        trapHits += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
    const proxyResult = acquirePosixProcessLockWithTestHooks(proxied, linuxHooks(driver));
    expect(proxyResult.ok).toBe(false);
    expect(trapHits).toBe(0);

    const revocable = Proxy.revocable(root, {});
    revocable.revoke();
    const revokedResult = acquirePosixProcessLockWithTestHooks(revocable.proxy, linuxHooks(driver));
    expect(revokedResult.ok).toBe(false);
    expect(driver.openedPaths).toEqual([]);
    expect(root.close().ok).toBe(true);
  });

  it('rejects getter fake without invoking getters', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    let getterHits = 0;
    const fake = {};
    Object.defineProperty(fake, 'close', {
      enumerable: true,
      get: () => {
        getterHits += 1;
        return root.close;
      },
    });
    const result = acquirePosixProcessLockWithTestHooks(fake, linuxHooks(driver));
    expect(result.ok).toBe(false);
    expect(getterHits).toBe(0);
    expect(driver.openedPaths).toEqual([]);
    expect(root.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock path and file policy', () => {
  it('opens only the fixed direct-child lock filename', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    expect(driver.openedPaths).toEqual([`${storageRoot}/${POSIX_PROCESS_LOCK_FILENAME}`]);
    expect(POSIX_PROCESS_LOCK_FILENAME).toBe('neo.primary.lock');
    expect(POSIX_PROCESS_LOCK_FILENAME).not.toMatch(/\.sqlite|wal|shm|pid/i);
    if (result.ok) expect(result.value.release().ok).toBe(true);
  });

  it('rejects non-regular / unsafe mode / owner / hard-link / special-bit policy', () => {
    const cases: FakeDriverOptions[] = [
      { isFile: false },
      { fileMode: 0o644 },
      { fileMode: 0o660 },
      { fileMode: 0o400 },
      { fileMode: 0o4600 }, // setuid + owner rw
      { fileMode: 0o2600 }, // setgid + owner rw
      { fileMode: 0o1600 }, // sticky + owner rw
      { fileUid: SERVICE_UID + 1 },
      { nlink: 2 },
    ];
    for (const options of cases) {
      const storageRoot = createTempStorageRoot();
      const { root } = openGenuineRoot(storageRoot);
      const driver = createFakeDriver(options);
      const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected fail');
      expect(result.error.code).toBe('STORAGE_LOCK_ACQUIRE_FAILED');
      expect(driver.closeCalls).toBe(1);
      expect(root.close().ok).toBe(true);
      assertNoLeak(result);
    }
  });

  it('maps O_NOFOLLOW-style open rejection without truncating content', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ openError: errno('ELOOP') });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_ACQUIRE_FAILED');
    expect(driver.contents.size).toBe(0);
    expect(root.close().ok).toBe(true);
  });

  it('leaves the placeholder after release and never unlinks', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const lockPath = driver.openedPaths[0];
    expect(lockPath).toBeDefined();
    if (lockPath === undefined) throw new Error('path');
    driver.contents.set(lockPath, 'placeholder-bytes');
    expect(result.value.release().ok).toBe(true);
    expect(driver.contents.get(lockPath)).toBe('placeholder-bytes');
    expect(driver.unlinkCalls).toBe(0);
    expect(root.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock contention', () => {
  it('second cooperative acquire on the same path fails with STORAGE_LOCK_HELD', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const kernel = createSharedFakeKernel();
    const firstDriver = createFakeDriver({ kernel });
    const secondDriver = createFakeDriver({ kernel });
    const first = acquirePosixProcessLockWithTestHooks(root, linuxHooks(firstDriver));
    expect(first.ok).toBe(true);
    const second = acquirePosixProcessLockWithTestHooks(root, linuxHooks(secondDriver));
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected fail');
    expect(second.error.code).toBe('STORAGE_LOCK_HELD');
    expect(secondDriver.closeCalls).toBe(1);
    assertNoLeak(second);
    if (first.ok) expect(first.value.release().ok).toBe(true);
    // Reacquire must use the same shared kernel — not a fresh independent fake state.
    const third = acquirePosixProcessLockWithTestHooks(
      root,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('contender cleanup close does not unlock the owning fd', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const kernel = createSharedFakeKernel();
    const lockPath = `${storageRoot}/${POSIX_PROCESS_LOCK_FILENAME}`;

    const holder = acquirePosixProcessLockWithTestHooks(
      root,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(holder.ok).toBe(true);
    const ownerFd = kernel.pathOwnerFd.get(lockPath);
    expect(ownerFd).toBeTypeOf('number');

    const contender = acquirePosixProcessLockWithTestHooks(
      root,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(contender.ok).toBe(false);
    if (contender.ok) throw new Error('expected held');
    expect(contender.error.code).toBe('STORAGE_LOCK_HELD');
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);

    const stillHeld = acquirePosixProcessLockWithTestHooks(
      root,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(stillHeld.ok).toBe(false);
    if (stillHeld.ok) throw new Error('expected held');
    expect(stillHeld.error.code).toBe('STORAGE_LOCK_HELD');
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);

    if (holder.ok) expect(holder.value.release().ok).toBe(true);
    expect(kernel.pathOwnerFd.has(lockPath)).toBe(false);

    const afterRelease = acquirePosixProcessLockWithTestHooks(
      root,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(afterRelease.ok).toBe(true);
    if (afterRelease.ok) expect(afterRelease.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('owner-only release: contender/unrelated close leave holder; owner close frees path', () => {
    const kernel = createSharedFakeKernel();
    const pathA = '/tmp/fake-lock-a';
    const pathB = '/tmp/fake-lock-b';
    const driver = createFakeDriver({ kernel });

    const fdA = driver.openLockFile(pathA);
    const fdB = driver.openLockFile(pathB);
    const fdContenderA = driver.openLockFile(pathA);
    driver.flockExclusiveNonblocking(fdA);
    driver.flockExclusiveNonblocking(fdB);
    expect(() => {
      driver.flockExclusiveNonblocking(fdContenderA);
    }).toThrow();
    expect(driver.ownerFdFor(pathA)).toBe(fdA);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);

    driver.closeFd(fdContenderA);
    expect(driver.ownerFdFor(pathA)).toBe(fdA);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);

    driver.closeFd(fdB);
    expect(driver.ownerFdFor(pathA)).toBe(fdA);
    expect(driver.ownerFdFor(pathB)).toBeUndefined();

    driver.closeFd(fdA);
    expect(driver.ownerFdFor(pathA)).toBeUndefined();
    // Repeated close of already-closed owner must not invent unlock of another path.
    expect(() => {
      driver.closeFd(fdA);
    }).not.toThrow();
    expect(driver.ownerFdFor(pathB)).toBeUndefined();
  });

  it.each([
    ['EAGAIN', 'STORAGE_LOCK_HELD'],
    ['EWOULDBLOCK', 'STORAGE_LOCK_HELD'],
    ['EIO', 'STORAGE_LOCK_ACQUIRE_FAILED'],
  ] as const)('maps flock %s to %s without raw leakage', (code, expected) => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ flockError: errno(code) });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe(expected);
    expect(driver.closeCalls).toBe(1);
    expect(root.close().ok).toBe(true);
    assertNoLeak(result);
  });
});

describe('acquirePosixProcessLock release lifecycle', () => {
  it('successful close releases root lease; root.close busy while held', () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const busy = root.close();
    expect(busy.ok).toBe(false);
    if (busy.ok) throw new Error('expected busy');
    expect(busy.error.code).toBe('STORAGE_ROOT_CLOSE_BUSY');
    expect(system.closeDirectoryCalls.length).toBe(0);
    expect(result.value.release().ok).toBe(true);
    expect(result.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
    expect(system.closeDirectoryCalls.length).toBe(1);
  });

  it('release.call(fake) and copied release stay bound to original ownership', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver();
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const { release } = result.value;
    const copied = release;
    expect(release.call({} as never).ok).toBe(true);
    expect(copied().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });

  it('freeze prevents handle field reassignment', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(createFakeDriver()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(() => {
      (result.value as { diagnostics: unknown }).diagnostics = {};
    }).toThrow();
    expect(result.value.release().ok).toBe(true);
  });
});

describe('fake kernel atomic close semantics', () => {
  it('failed owner close mutates nothing; retry success clears only that owner', () => {
    const kernel = createSharedFakeKernel();
    const pathA = '/tmp/fake-lock-a';
    const pathB = '/tmp/fake-lock-b';
    const driver = createFakeDriver({ kernel });
    const fdA = driver.openLockFile(pathA);
    const fdB = driver.openLockFile(pathB);
    const fdContender = driver.openLockFile(pathA);
    driver.flockExclusiveNonblocking(fdA);
    driver.flockExclusiveNonblocking(fdB);
    expect(driver.ownerFdFor(pathA)).toBe(fdA);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);

    driver.setCloseFailures(2);
    expect(() => {
      driver.closeFd(fdA);
    }).toThrow();
    expect(driver.closeCalls).toBe(1);
    expect(driver.hasOpenFd(fdA)).toBe(true);
    expect(driver.ownerFdFor(pathA)).toBe(fdA);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);

    expect(() => {
      driver.closeFd(fdA);
    }).toThrow();
    expect(driver.closeCalls).toBe(2);
    expect(driver.hasOpenFd(fdA)).toBe(true);
    expect(driver.ownerFdFor(pathA)).toBe(fdA);

    driver.closeFd(fdA);
    expect(driver.closeCalls).toBe(3);
    expect(driver.hasOpenFd(fdA)).toBe(false);
    expect(driver.ownerFdFor(pathA)).toBeUndefined();
    expect(driver.ownerFdFor(pathB)).toBe(fdB);

    driver.closeFd(fdContender);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);
    expect(driver.hasOpenFd(fdContender)).toBe(false);

    driver.setCloseFailures(1);
    expect(() => {
      driver.closeFd(fdB);
    }).toThrow();
    expect(driver.hasOpenFd(fdB)).toBe(true);
    expect(driver.ownerFdFor(pathB)).toBe(fdB);
    driver.closeFd(fdB);
    expect(driver.ownerFdFor(pathB)).toBeUndefined();
  });
});

describe('acquirePosixProcessLock release failure and retry', () => {
  it('close failure stays release-pending; retry success releases once', () => {
    const storageRoot = createTempStorageRoot();
    const { root, system } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ closeFailures: 2 });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const first = result.value.release();
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('expected fail');
    expect(first.error.code).toBe('STORAGE_LOCK_RELEASE_FAILED');
    expect(root.close().ok).toBe(false);
    const second = result.value.release();
    expect(second.ok).toBe(false);
    expect(root.close().ok).toBe(false);
    const third = result.value.release();
    expect(third.ok).toBe(true);
    expect(result.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
    expect(system.closeDirectoryCalls.length).toBe(1);
  });

  it('holder close failure retains flock ownership; contenders stay HELD until successful retry', () => {
    const sharedPath = createTempStorageRoot();
    const { root: rootA } = openGenuineRoot(sharedPath);
    const { root: rootB } = openGenuineRoot(sharedPath);
    expect(rootA).not.toBe(rootB);
    const kernel = createSharedFakeKernel();
    const lockPath = `${sharedPath}/${POSIX_PROCESS_LOCK_FILENAME}`;
    const holderDriver = createFakeDriver({ kernel });

    const held = acquirePosixProcessLockWithTestHooks(rootA, linuxHooks(holderDriver));
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error('expected holder');
    const ownerFd = kernel.pathOwnerFd.get(lockPath);
    expect(ownerFd).toBeTypeOf('number');
    if (typeof ownerFd !== 'number') throw new Error('ownerFd');
    expect(holderDriver.hasOpenFd(ownerFd)).toBe(true);
    expect(rootA.close().ok).toBe(false);

    holderDriver.setCloseFailures(1);
    const firstRelease = held.value.release();
    expect(firstRelease.ok).toBe(false);
    if (firstRelease.ok) throw new Error('expected fail');
    expect(firstRelease.error.code).toBe('STORAGE_LOCK_RELEASE_FAILED');
    expect(holderDriver.closeCalls).toBe(1);
    expect(holderDriver.hasOpenFd(ownerFd)).toBe(true);
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);
    expect(kernel.fdToPath.get(ownerFd)).toBe(lockPath);
    expect(rootA.close().ok).toBe(false);

    const contenderB = acquirePosixProcessLockWithTestHooks(
      rootB,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(contenderB.ok).toBe(false);
    if (contenderB.ok) throw new Error('expected held');
    expect(contenderB.error.code).toBe('STORAGE_LOCK_HELD');
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);
    expect(holderDriver.hasOpenFd(ownerFd)).toBe(true);

    holderDriver.setCloseFailures(1);
    const secondRelease = held.value.release();
    expect(secondRelease.ok).toBe(false);
    if (secondRelease.ok) throw new Error('expected fail');
    expect(secondRelease.error.code).toBe('STORAGE_LOCK_RELEASE_FAILED');
    expect(holderDriver.closeCalls).toBe(2);
    expect(holderDriver.hasOpenFd(ownerFd)).toBe(true);
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);
    expect(rootA.close().ok).toBe(false);

    const contenderC = acquirePosixProcessLockWithTestHooks(
      rootB,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(contenderC.ok).toBe(false);
    if (contenderC.ok) throw new Error('expected held');
    expect(contenderC.error.code).toBe('STORAGE_LOCK_HELD');
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);

    holderDriver.setCloseFailures(0);
    const thirdRelease = held.value.release();
    expect(thirdRelease.ok).toBe(true);
    expect(holderDriver.closeCalls).toBe(3);
    expect(holderDriver.hasOpenFd(ownerFd)).toBe(false);
    expect(kernel.pathOwnerFd.has(lockPath)).toBe(false);
    expect(kernel.fdToPath.has(ownerFd)).toBe(false);
    // Idempotent release must not reopen/reuse the cleared fd or invent another unlock.
    expect(held.value.release().ok).toBe(true);
    expect(holderDriver.closeCalls).toBe(3);
    expect(rootA.close().ok).toBe(true);

    const reacquire = acquirePosixProcessLockWithTestHooks(
      rootB,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(reacquire.ok).toBe(true);
    if (!reacquire.ok) throw new Error('expected reacquire');
    expect(reacquire.value.release().ok).toBe(true);
    expect(rootB.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock acquisition cleanup', () => {
  it('open failure releases root lease without pendingCleanup', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ openError: errno('EACCES') });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_ACQUIRE_FAILED');
    expect('pendingCleanup' in result).toBe(false);
    expect(root.close().ok).toBe(true);
  });

  it('fstat failure with close success releases lease', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({ fstatError: errno('EIO') });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_ACQUIRE_FAILED');
    expect(driver.closeCalls).toBe(1);
    expect(root.close().ok).toBe(true);
  });

  it('contention close failure yields ownership pendingCleanup', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({
      flockError: errno('EAGAIN'),
      closeFailures: 1,
    });
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect('pendingCleanup' in result).toBe(true);
    if (!('pendingCleanup' in result)) throw new Error('pending');
    expect(result.error.code).toBe('STORAGE_LOCK_RELEASE_FAILED');
    expect(root.close().ok).toBe(false);
    const retryFail = result.pendingCleanup.retryRelease();
    // closeFailures was 1; first close in failAfterFdOpen consumed it; retry should succeed
    // Actually: failAfterFdOpen calls retryRelease once immediately which fails (closeFailures=1),
    // then returns pendingCleanup. So first acquire close already happened once.
    // Wait - closeFailures=1 means first close throws, then closeFailuresLeft=0.
    // failAfterFdOpen: retryRelease called once → fails → asReleaseFailure.
    // Then pendingCleanup.retryRelease → should succeed.
    expect(retryFail.ok).toBe(true);
    expect(root.close().ok).toBe(true);
    assertNoLeak(result);
  });

  it('programmer flock error with close failure throws ownership error', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const driver = createFakeDriver({
      flockError: new TypeError('boom'),
      closeFailures: 1,
    });
    let caught: unknown;
    try {
      acquirePosixProcessLockWithTestHooks(root, linuxHooks(driver));
    } catch (error) {
      caught = error;
    }
    expect(isPosixProcessLockOwnershipError(caught)).toBe(true);
    if (!isPosixProcessLockOwnershipError(caught)) throw new Error('expected ownership error');
    expect(root.close().ok).toBe(false);
    expect(caught.pendingCleanup.retryRelease().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock isolation and diagnostics', () => {
  it('two roots are independent; same-path roots contend via shared kernel state', () => {
    const rootAPath = createTempStorageRoot();
    const rootBPath = createTempStorageRoot();
    const { root: rootA } = openGenuineRoot(rootAPath);
    const { root: rootB } = openGenuineRoot(rootBPath);
    const kernel = createSharedFakeKernel();
    const lockA = acquirePosixProcessLockWithTestHooks(
      rootA,
      linuxHooks(createFakeDriver({ kernel })),
    );
    const lockB = acquirePosixProcessLockWithTestHooks(
      rootB,
      linuxHooks(createFakeDriver({ kernel })),
    );
    expect(lockA.ok).toBe(true);
    expect(lockB.ok).toBe(true);
    if (lockA.ok) expect(lockA.value.release().ok).toBe(true);
    if (lockB.ok) expect(lockB.value.release().ok).toBe(true);
    expect(rootA.close().ok).toBe(true);
    expect(rootB.close().ok).toBe(true);

    // Distinct genuine roots that share a filesystem path contend through one fake kernel.
    const sharedPath = createTempStorageRoot();
    const { root: firstRoot } = openGenuineRoot(sharedPath);
    const { root: secondRoot } = openGenuineRoot(sharedPath);
    const sharedKernel = createSharedFakeKernel();
    const first = acquirePosixProcessLockWithTestHooks(
      firstRoot,
      linuxHooks(createFakeDriver({ kernel: sharedKernel })),
    );
    const second = acquirePosixProcessLockWithTestHooks(
      secondRoot,
      linuxHooks(createFakeDriver({ kernel: sharedKernel })),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected held');
    expect(second.error.code).toBe('STORAGE_LOCK_HELD');
    // Contender cleanup must leave holder ownership intact on the shared path.
    const lockPath = `${sharedPath}/${POSIX_PROCESS_LOCK_FILENAME}`;
    expect(sharedKernel.pathOwnerFd.has(lockPath)).toBe(true);
    if (first.ok) expect(first.value.release().ok).toBe(true);
    expect(firstRoot.close().ok).toBe(true);
    expect(secondRoot.close().ok).toBe(true);
  });

  it('contender close-failure pendingCleanup does not unlock holder ownership', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const kernel = createSharedFakeKernel();
    const lockPath = `${storageRoot}/${POSIX_PROCESS_LOCK_FILENAME}`;

    const holderDriver = createFakeDriver({ kernel });
    const holder = acquirePosixProcessLockWithTestHooks(root, linuxHooks(holderDriver));
    expect(holder.ok).toBe(true);
    const ownerFd = kernel.pathOwnerFd.get(lockPath);
    expect(ownerFd).toBeTypeOf('number');

    const contenderDriver = createFakeDriver({ kernel, closeFailures: 1 });
    const contender = acquirePosixProcessLockWithTestHooks(root, linuxHooks(contenderDriver));
    expect(contender.ok).toBe(false);
    if (contender.ok) throw new Error('expected fail');
    expect('pendingCleanup' in contender).toBe(true);
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);
    expect(root.close().ok).toBe(false);

    if (!('pendingCleanup' in contender)) throw new Error('pending');
    expect(contender.pendingCleanup.retryRelease().ok).toBe(true);
    expect(kernel.pathOwnerFd.get(lockPath)).toBe(ownerFd);

    if (holder.ok) expect(holder.value.release().ok).toBe(true);
    expect(kernel.pathOwnerFd.has(lockPath)).toBe(false);
    expect(root.close().ok).toBe(true);
  });

  it('diagnostics are honest and frozen; LocalHost remains in-memory', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(createFakeDriver()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const d = result.value.diagnostics;
    expect(d.storageLock).toBe('flock');
    expect(d.exclusiveProcessLockHeld).toBe(true);
    expect(d.cooperativeSecondInstanceProtection).toBe(true);
    expect(d.storageRootLeaseCoordinated).toBe(true);
    expect(d.lockFilePolicyVerified).toBe(true);
    expect(d.releaseUsesFdClose).toBe(true);
    expect(d.localHostWired).toBe(false);
    expect(d.processLockWiredToNeo).toBe(false);
    expect(d.secondInstanceProtectionActiveForNeo).toBe(false);
    expect(d.systemdLayerConfigured).toBe(false);
    expect(d.privilegedAttackerResistant).toBe(false);
    expect(d.pathReplacementResistant).toBe(false);
    expect(d.distributedFilesystemSupported).toBe(false);
    expect(d.linuxIntegrationValidatedForPrimitive).toBe(false);
    expect(d.deploymentReady).toBe(false);
    assertNoLeak(d);

    const host = createLocalHost({ clock: { now: () => new Date('2020-01-01T00:00:00.000Z') } });
    expect(host.diagnostics.storage).toBe('in-memory');
    expect(result.value.release().ok).toBe(true);
    expect(root.close().ok).toBe(true);
  });
});

describe('acquirePosixProcessLock public export containment', () => {
  it('is not exported from package root, host, storage, or runtime barrels', () => {
    expect(publicApi).not.toHaveProperty('acquirePosixProcessLock');
    expect(publicApi).not.toHaveProperty('POSIX_PROCESS_LOCK_FILENAME');
    expect(Object.keys(publicApi).join(',')).not.toMatch(/ProcessLock|processLock|primary\.lock/i);

    const barrelPaths = [
      'src/index.ts',
      'src/host/index.ts',
      'src/host/storage/index.ts',
      'src/host/storage/runtime/index.ts',
    ];
    for (const relative of barrelPaths) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(source).not.toMatch(
        /acquirePosixProcessLock|posix-process-lock|POSIX_PROCESS_LOCK_FILENAME|fs-ext-extra-prebuilt/,
      );
    }

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      readonly exports?: unknown;
      readonly dependencies?: Record<string, string>;
    };
    expect(JSON.stringify(packageJson.exports)).not.toMatch(
      /process-lock|ProcessLock|primary\.lock|fs-ext/i,
    );
    expect(packageJson.dependencies?.['fs-ext-extra-prebuilt']).toBe('2.2.10');
  });

  it('does not export WithPrimitives test seam from barrels', () => {
    for (const relative of [
      'src/index.ts',
      'src/host/index.ts',
      'src/host/storage/index.ts',
      'src/host/storage/runtime/index.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(source).not.toMatch(/WithPrimitives|PosixProcessLockDriverPrimitives/);
    }
    expect(publicApi).not.toHaveProperty('createNodePosixProcessLockDriverWithPrimitives');
    expect(publicApi).not.toHaveProperty('createNodePosixProcessLockDriver');
  });
});

describe('production process-lock driver secure-open contract', () => {
  const BASE_CONSTANTS = Object.freeze({
    O_RDWR: 0b0001,
    O_CREAT: 0b0010,
    O_NOFOLLOW: 0b0100,
    O_CLOEXEC: 0b1000,
    O_TRUNC: 0b1_0000,
    O_APPEND: 0b10_0000,
    O_EXCL: 0b100_0000,
  });

  type Capture = {
    openCalls: Array<{ path: string; flags: number; mode: number | undefined }>;
    openInvoked: boolean;
  };

  const createCapturingPrimitives = (
    constants: typeof BASE_CONSTANTS | Record<string, number | undefined>,
  ): {
    readonly primitives: Parameters<typeof createNodePosixProcessLockDriverWithPrimitives>[0];
    readonly capture: Capture;
  } => {
    const capture: Capture = { openCalls: [], openInvoked: false };
    const primitives = Object.freeze({
      openSync: (path: string, flags: number, mode?: number): number => {
        capture.openInvoked = true;
        capture.openCalls.push({ path, flags, mode });
        return 7;
      },
      fstatSync: () =>
        Object.freeze({
          isFile: () => true,
          mode: 0o600,
          uid: SERVICE_UID,
          nlink: 1,
        }),
      closeSync: (): void => undefined,
      flockSync: (): void => undefined,
      constants: Object.freeze({ ...constants }),
    });
    return { primitives, capture };
  };

  it('passes exact combined secure flags and mode 0o600 without TRUNC/APPEND/EXCL', () => {
    const { primitives, capture } = createCapturingPrimitives(BASE_CONSTANTS);
    const driver = createNodePosixProcessLockDriverWithPrimitives(primitives);
    const fd = driver.openLockFile('/tmp/neo-contract.lock');
    expect(fd).toBe(7);
    expect(capture.openCalls).toHaveLength(1);
    const call = capture.openCalls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error('call');
    const expected =
      BASE_CONSTANTS.O_RDWR |
      BASE_CONSTANTS.O_CREAT |
      BASE_CONSTANTS.O_NOFOLLOW |
      BASE_CONSTANTS.O_CLOEXEC;
    expect(call.flags).toBe(expected);
    expect(call.mode).toBe(0o600);
    expect((call.flags & BASE_CONSTANTS.O_TRUNC) === 0).toBe(true);
    expect((call.flags & BASE_CONSTANTS.O_APPEND) === 0).toBe(true);
    expect((call.flags & BASE_CONSTANTS.O_EXCL) === 0).toBe(true);
    expect(call.flags & BASE_CONSTANTS.O_RDWR).toBe(BASE_CONSTANTS.O_RDWR);
    expect(call.flags & BASE_CONSTANTS.O_CREAT).toBe(BASE_CONSTANTS.O_CREAT);
    expect(call.flags & BASE_CONSTANTS.O_NOFOLLOW).toBe(BASE_CONSTANTS.O_NOFOLLOW);
    expect(call.flags & BASE_CONSTANTS.O_CLOEXEC).toBe(BASE_CONSTANTS.O_CLOEXEC);
  });

  it.each([
    ['O_NOFOLLOW', { ...BASE_CONSTANTS, O_NOFOLLOW: undefined }],
    ['O_CLOEXEC', { ...BASE_CONSTANTS, O_CLOEXEC: undefined }],
    ['O_RDWR', { ...BASE_CONSTANTS, O_RDWR: undefined }],
    ['O_CREAT', { ...BASE_CONSTANTS, O_CREAT: undefined }],
  ] as const)('missing %s fails closed before openSync', (_label, constants) => {
    const { primitives, capture } = createCapturingPrimitives(constants);
    const driver = createNodePosixProcessLockDriverWithPrimitives(primitives);
    let thrown: unknown;
    try {
      driver.openLockFile('/tmp/neo-contract.lock');
    } catch (error) {
      thrown = error;
    }
    expect(capture.openInvoked).toBe(false);
    expect(errnoCodeOf(thrown)).toBe('STORAGE_LOCK_FLAGS_UNAVAILABLE');
  });

  it('open failure stays redacted when wired through the acquire factory', () => {
    const storageRoot = createTempStorageRoot();
    const { root } = openGenuineRoot(storageRoot);
    const { primitives } = createCapturingPrimitives(BASE_CONSTANTS);
    const failing = createNodePosixProcessLockDriverWithPrimitives(
      Object.freeze({
        ...primitives,
        openSync: (): number => {
          throw errno('EACCES');
        },
      }),
    );
    const result = acquirePosixProcessLockWithTestHooks(root, linuxHooks(failing));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.error.code).toBe('STORAGE_LOCK_ACQUIRE_FAILED');
    assertNoLeak(result);
    expect(root.close().ok).toBe(true);
  });

  it('does not truncate existing placeholder content semantics (no O_TRUNC in flags)', () => {
    const { primitives, capture } = createCapturingPrimitives(BASE_CONSTANTS);
    const driver = createNodePosixProcessLockDriverWithPrimitives(primitives);
    driver.openLockFile('/tmp/existing.lock');
    const flags = capture.openCalls[0]?.flags ?? 0;
    expect(flags & BASE_CONSTANTS.O_TRUNC).toBe(0);
  });
});

describe('fs-ext-extra-prebuilt module-load smoke (informational, not Linux production proof)', () => {
  it('loads the pinned package API without claiming Linux production support', () => {
    const require = createRequire(import.meta.url);
    const mod = require('fs-ext-extra-prebuilt') as {
      flockSync?: unknown;
      constants?: unknown;
    };
    expect(typeof mod.flockSync).toBe('function');
    expect(mod.constants).toBeTypeOf('object');
    // Any local LockFileEx/flock exercise here is informational only — not Ubuntu primitive validation.
  });
});
