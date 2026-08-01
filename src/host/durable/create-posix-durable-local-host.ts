import type {
  ClockPort,
  MemoryPolicyPort,
  SensitiveDataScannerPort,
} from '../../core/ports/index.js';
import type { Result } from '../../core/domain/result.js';
import { assembleLocalHostFromPorts } from '../assemble-local-host.js';
import { parseLocalHostConfig } from '../config/parse-local-host-config.js';
import type { CreateLocalHostInput, LocalHost } from '../local-host.js';
import { SQLITE_BACKED_LOCAL_HOST_DIAGNOSTICS } from '../diagnostics.js';
import { createInMemoryApprovalStore } from '../in-memory/approval-store.js';
import { createInMemoryAuditLog } from '../in-memory/audit-log.js';
import { createDenyByDefaultMemoryPolicy } from '../in-memory/memory-policy.js';
import { createInMemorySensitiveDataScanner } from '../in-memory/sensitive-data-scanner.js';
import {
  createLocalStoragePlan,
  type LocalStoragePlan,
} from '../storage/create-local-storage-plan.js';
import type { StorageFailure } from '../storage/storage-failure.js';
import type {
  OpenedPosixStorageRoot,
  OpenPosixStorageRootResult,
} from '../storage/runtime/open-posix-storage-root.js';
import type { PosixStorageRootPolicy } from '../storage/runtime/posix-storage-root-policy.js';
import { parsePosixStorageRootPolicy } from '../storage/runtime/posix-storage-root-policy.js';
import type {
  PosixProcessLockAcquireResult,
  PosixProcessLockHandle,
} from '../storage/runtime/acquire-posix-process-lock.js';
import type {
  SqliteMemoryPortHandle,
  SqliteMemoryPortOpenResult,
} from '../storage/sqlite/create-sqlite-memory-port.js';
import {
  createDurableLocalHostOwner,
  type DurableLocalHostOwner,
} from './create-durable-local-host-owner.js';
import {
  failResourceClose,
  okResourceClose,
  type DurableLocalHostOwnerCloseResult,
  type DurableResourceCloseResult,
} from './durable-local-host-owner-failures.js';
import {
  POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS,
  type PosixDurableLocalHostCompositionDiagnostics,
} from './posix-durable-local-host-composition-diagnostics.js';
import {
  failComposition,
  failCompositionCleanupRequired,
  type PosixDurableCompositionCleanupRequired,
  type PosixDurableCompositionCleanupResult,
  type PosixDurableCompositionFailure,
  type PosixDurableCompositionOrdinaryFailure,
  type PosixDurableCompositionPendingCleanup,
  type PosixDurableCompositionStage,
} from './posix-durable-local-host-composition-failures.js';

/**
 * Production input for Linux-only POSIX durable LocalHost composition.
 * Does not accept filesystem/native drivers or caller-controlled diagnostics.
 */
export interface CreatePosixDurableLocalHostInput {
  readonly config: unknown;
  readonly host: CreateLocalHostInput;
  readonly storageBinding: unknown;
  readonly storagePolicy: unknown;
}

/**
 * Frozen durable owner returned after complete startup success.
 * Reuses B3C1 host gate / close; diagnostics are trusted B3C2 composition evidence.
 */
export interface PosixDurableLocalHostOwner {
  readonly host: LocalHost;
  readonly diagnostics: PosixDurableLocalHostCompositionDiagnostics;
  readonly close: () => DurableLocalHostOwnerCloseResult;
}

export type PosixDurableLocalHostCompositionResult =
  | { readonly ok: true; readonly value: PosixDurableLocalHostOwner }
  | { readonly ok: false; readonly error: PosixDurableCompositionFailure }
  | PosixDurableCompositionCleanupRequired;

/**
 * App-private test seam. Not exported from host/package barrels.
 * Must not allow callers to replace production composition diagnostics.
 */
export type PosixDurableLocalHostTestHooks = {
  readonly getPlatform?: () => string;
  readonly loadRootFactory?: () => Promise<{
    readonly openPosixStorageRoot: (
      plan: LocalStoragePlan,
      policy: PosixStorageRootPolicy,
    ) => unknown;
  }>;
  readonly loadProcessLockFactory?: () => Promise<{
    readonly acquirePosixProcessLock: (openedRoot: unknown) => unknown;
  }>;
  readonly loadSqliteFactory?: () => Promise<{
    readonly createSqliteMemoryPort: (openedRoot: unknown) => unknown;
  }>;
  readonly assembleLocalHost?: typeof assembleLocalHostFromPorts;
  readonly createOwner?: typeof createDurableLocalHostOwner;
};

type OwnedResources = {
  root: OpenedPosixStorageRoot | undefined;
  lock: PosixProcessLockHandle | undefined;
  sqlite: SqliteMemoryPortHandle | undefined;
  rootPending: (() => Result<void, StorageFailure>) | undefined;
  lockPending: (() => Result<void, StorageFailure>) | undefined;
  sqlitePending: (() => Result<void, StorageFailure>) | undefined;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const assertClock = (clock: unknown): ClockPort => {
  if (!isObjectRecord(clock))
    throw new TypeError('createPosixDurableLocalHost requires an injected clock.');
  const now = clock['now'];
  if (typeof now !== 'function')
    throw new TypeError('createPosixDurableLocalHost clock.now must be a function.');
  const nowFn = now as (this: object) => unknown;
  return {
    now: (): Date => {
      const value = nowFn.call(clock);
      if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new TypeError('createPosixDurableLocalHost clock.now must return a valid Date.');
      return value;
    },
  };
};

const assertScanner = (scanner: unknown): SensitiveDataScannerPort => {
  if (!isObjectRecord(scanner))
    throw new TypeError('createPosixDurableLocalHost scanner must be an object.');
  const scanText = scanner['scanText'];
  const scanMetadata = scanner['scanMetadata'];
  if (typeof scanText !== 'function' || typeof scanMetadata !== 'function')
    throw new TypeError('createPosixDurableLocalHost scanner has an invalid shape.');
  const scanTextFn = scanText as SensitiveDataScannerPort['scanText'];
  const scanMetadataFn = scanMetadata as SensitiveDataScannerPort['scanMetadata'];
  return {
    scanText: (input, context) => scanTextFn.call(scanner, input, context),
    scanMetadata: (input, context) => scanMetadataFn.call(scanner, input, context),
  };
};

const assertPolicy = (policy: unknown): MemoryPolicyPort => {
  if (!isObjectRecord(policy))
    throw new TypeError('createPosixDurableLocalHost policy has an invalid shape.');
  const evaluate = policy['evaluate'];
  if (typeof evaluate !== 'function')
    throw new TypeError('createPosixDurableLocalHost policy has an invalid shape.');
  const evaluateFn = evaluate as MemoryPolicyPort['evaluate'];
  return {
    evaluate: (request, access) => evaluateFn.call(policy, request, access),
  };
};

/**
 * Pure host-input shape check mirroring config bootstrap — fail before opening resources.
 */
const rejectInvalidHostCompositionInput = (hostInput: unknown): boolean => {
  if (hostInput === null || typeof hostInput !== 'object' || Array.isArray(hostInput)) return true;
  const input = hostInput as Record<string, unknown>;
  const clock = input['clock'];
  if (clock === null || typeof clock !== 'object' || Array.isArray(clock)) return true;
  const clockRecord = clock as Record<string, unknown>;
  if (typeof clockRecord['now'] !== 'function') return true;

  if (input['scanner'] !== undefined) {
    const scanner = input['scanner'];
    if (scanner === null || typeof scanner !== 'object' || Array.isArray(scanner)) return true;
    const scannerRecord = scanner as Record<string, unknown>;
    if (
      typeof scannerRecord['scanText'] !== 'function' ||
      typeof scannerRecord['scanMetadata'] !== 'function'
    )
      return true;
  }

  if (input['policy'] !== undefined) {
    const policy = input['policy'];
    if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return true;
    const policyRecord = policy as Record<string, unknown>;
    if (typeof policyRecord['evaluate'] !== 'function') return true;
  }

  return false;
};

const hasPendingCleanup = (result: {
  readonly ok: false;
}): result is {
  readonly ok: false;
  readonly pendingCleanup: {
    readonly retryClose?: () => Result<void, StorageFailure>;
    readonly retryRelease?: () => Result<void, StorageFailure>;
  };
} =>
  'pendingCleanup' in result &&
  result.pendingCleanup !== null &&
  typeof result.pendingCleanup === 'object';

/**
 * Post-success handle closer adapter for B3C1 resource closures.
 *
 * Contract (after successful resource acquisition):
 * - the captured handle retains its own internal retry/close-pending state;
 * - this adapter retries by calling the same handle `close()` / `release()` again;
 * - success only after terminal handle cleanup;
 * - raw throws are mapped to a redacted RESOURCE_CLOSE_FAILED Result (never rethrown);
 * - does not extract a separate external OwnershipError.pendingCleanup — that shape applies to
 *   bootstrap/programmer-error open paths, not to post-success handle close/release Results.
 */
const createHandleCloser = (
  closeOnce: () => Result<void, StorageFailure>,
  reason: string,
): (() => DurableResourceCloseResult) => {
  let done = false;
  return (): DurableResourceCloseResult => {
    if (done) return okResourceClose();
    try {
      const closed = closeOnce();
      if (closed.ok) {
        done = true;
        return okResourceClose();
      }
      return failResourceClose(reason);
    } catch {
      return failResourceClose(reason);
    }
  };
};

const freezeTerminalOutcome = (
  outcome: PosixDurableCompositionOrdinaryFailure,
): PosixDurableCompositionOrdinaryFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: outcome.error.code,
      reason: outcome.error.reason,
      ...(outcome.error.stage === undefined ? {} : { stage: outcome.error.stage }),
    }),
  });

/**
 * Startup ownership cleanup controller.
 * Stores a frozen terminal ordinary composition failure and returns it only after full cleanup.
 * Successful resource cleanup is never reported as composition success.
 */
const createStartupCleanupController = (
  owned: OwnedResources,
  initialStage: PosixDurableCompositionStage,
  terminalOutcome: PosixDurableCompositionOrdinaryFailure,
): PosixDurableCompositionPendingCleanup => {
  let stage: PosixDurableCompositionStage | 'done' = initialStage;
  let inProgress = false;
  let terminalReached = false;
  const frozenTerminal = freezeTerminalOutcome(terminalOutcome);

  const advance = (
    pendingCleanup: PosixDurableCompositionPendingCleanup,
  ): PosixDurableCompositionCleanupResult => {
    while (stage !== 'done') {
      if (stage === 'sqlite') {
        if (owned.sqlitePending !== undefined) {
          const cleaned = owned.sqlitePending();
          if (!cleaned.ok) {
            return failCompositionCleanupRequired('sqlite', pendingCleanup);
          }
          owned.sqlitePending = undefined;
          owned.sqlite = undefined;
        } else if (owned.sqlite !== undefined) {
          const closed = owned.sqlite.close();
          if (!closed.ok) {
            return failCompositionCleanupRequired('sqlite', pendingCleanup);
          }
          owned.sqlite = undefined;
        }
        stage = 'process-lock';
        continue;
      }

      if (stage === 'process-lock') {
        if (owned.lockPending !== undefined) {
          const cleaned = owned.lockPending();
          if (!cleaned.ok) {
            return failCompositionCleanupRequired('process-lock', pendingCleanup);
          }
          owned.lockPending = undefined;
          owned.lock = undefined;
        } else if (owned.lock !== undefined) {
          const released = owned.lock.release();
          if (!released.ok) {
            return failCompositionCleanupRequired('process-lock', pendingCleanup);
          }
          owned.lock = undefined;
        }
        stage = 'storage-root';
        continue;
      }

      // storage-root — handle.close() is itself the ownership-aware retry; keep handle until success.
      if (owned.rootPending !== undefined) {
        const cleaned = owned.rootPending();
        if (!cleaned.ok) {
          return failCompositionCleanupRequired('storage-root', pendingCleanup);
        }
        owned.rootPending = undefined;
        owned.root = undefined;
      } else if (owned.root !== undefined) {
        const closed = owned.root.close();
        if (!closed.ok) {
          return failCompositionCleanupRequired('storage-root', pendingCleanup);
        }
        owned.root = undefined;
      }
      stage = 'done';
    }

    terminalReached = true;
    return frozenTerminal;
  };

  const pendingCleanup: PosixDurableCompositionPendingCleanup = Object.freeze({
    retry: (): PosixDurableCompositionCleanupResult => {
      if (terminalReached) return frozenTerminal;
      if (inProgress) {
        return failCompositionCleanupRequired(
          stage === 'done' ? 'storage-root' : stage,
          pendingCleanup,
        );
      }
      inProgress = true;
      try {
        return advance(pendingCleanup);
      } finally {
        inProgress = false;
      }
    },
  });

  return pendingCleanup;
};

/** Attempt cleanup immediately; return ownership-required or frozen terminal ordinary failure. */
const runStartupCleanup = (
  owned: OwnedResources,
  stage: PosixDurableCompositionStage,
  terminalOutcome: PosixDurableCompositionOrdinaryFailure,
): PosixDurableCompositionCleanupResult => {
  const pending = createStartupCleanupController(owned, stage, terminalOutcome);
  return pending.retry();
};

/** Defer cleanup to caller while preserving the frozen terminal ordinary failure. */
const deferStartupCleanup = (
  owned: OwnedResources,
  stage: PosixDurableCompositionStage,
  terminalOutcome: PosixDurableCompositionOrdinaryFailure,
): ReturnType<typeof failCompositionCleanupRequired> => {
  const pending = createStartupCleanupController(owned, stage, terminalOutcome);
  return failCompositionCleanupRequired(stage, pending);
};

const extractRetryClose = (error: unknown): (() => Result<void, StorageFailure>) | undefined => {
  if (typeof error !== 'object' || error === null || !('pendingCleanup' in error)) return undefined;
  const pending: unknown = Reflect.get(error, 'pendingCleanup');
  if (typeof pending !== 'object' || pending === null) return undefined;
  const retryClose: unknown = Reflect.get(pending, 'retryClose');
  if (typeof retryClose !== 'function') return undefined;
  return () => (retryClose as () => Result<void, StorageFailure>)();
};

const extractRetryRelease = (error: unknown): (() => Result<void, StorageFailure>) | undefined => {
  if (typeof error !== 'object' || error === null || !('pendingCleanup' in error)) return undefined;
  const pending: unknown = Reflect.get(error, 'pendingCleanup');
  if (typeof pending !== 'object' || pending === null) return undefined;
  const retryRelease: unknown = Reflect.get(pending, 'retryRelease');
  if (typeof retryRelease !== 'function') return undefined;
  return () => (retryRelease as () => Result<void, StorageFailure>)();
};

const wrapOwnerWithCompositionDiagnostics = (
  owner: DurableLocalHostOwner,
): PosixDurableLocalHostOwner =>
  Object.freeze({
    host: owner.host,
    diagnostics: POSIX_DURABLE_LOCAL_HOST_COMPOSITION_DIAGNOSTICS,
    close: owner.close,
  });

const loadProductionRootFactory = async (): Promise<{
  readonly openPosixStorageRoot: (
    plan: LocalStoragePlan,
    policy: PosixStorageRootPolicy,
  ) => unknown;
}> => {
  const mod = await import('../storage/runtime/open-posix-storage-root.js');
  return { openPosixStorageRoot: mod.openPosixStorageRoot };
};

const loadProductionProcessLockFactory = async (): Promise<{
  readonly acquirePosixProcessLock: (openedRoot: unknown) => unknown;
}> => {
  const mod = await import('../storage/runtime/acquire-posix-process-lock.js');
  return { acquirePosixProcessLock: mod.acquirePosixProcessLock };
};

const loadProductionSqliteFactory = async (): Promise<{
  readonly createSqliteMemoryPort: (openedRoot: unknown) => unknown;
}> => {
  const mod = await import('../storage/sqlite/create-sqlite-memory-port.js');
  return { createSqliteMemoryPort: mod.createSqliteMemoryPort };
};

const createPosixDurableLocalHostInternal = async (
  input: CreatePosixDurableLocalHostInput,
  hooks: PosixDurableLocalHostTestHooks = {},
): Promise<PosixDurableLocalHostCompositionResult> => {
  if (!isObjectRecord(input))
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition input must be a plain object.',
    );

  // --- Pure validation (no loaders, no native modules, no rollback) ---
  const parsedConfig = parseLocalHostConfig(input['config']);
  if (!parsedConfig.ok)
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition config validation failed.',
    );

  const plan = createLocalStoragePlan(input['storageBinding']);
  if (!plan.ok)
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition storage plan validation failed.',
    );

  const policy = parsePosixStorageRootPolicy(input['storagePolicy']);
  if (!policy.ok)
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition storage policy validation failed.',
    );

  if (rejectInvalidHostCompositionInput(input['host']))
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition host input was rejected.',
    );

  // Snapshot validated host options before any resource open (programmer asserts may still throw later).
  let clock: ClockPort;
  let scanner: SensitiveDataScannerPort;
  let memoryPolicy: MemoryPolicyPort;
  try {
    const hostInput = input.host;
    clock = assertClock(hostInput.clock);
    scanner = assertScanner(
      hostInput.scanner === undefined ? createInMemorySensitiveDataScanner() : hostInput.scanner,
    );
    memoryPolicy = assertPolicy(
      hostInput.policy === undefined ? createDenyByDefaultMemoryPolicy() : hostInput.policy,
    );
  } catch {
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'Durable composition host input was rejected.',
    );
  }

  // --- Linux platform gate (before any resource loader / native module) ---
  const getPlatform = hooks.getPlatform ?? (() => process.platform);
  if (getPlatform() !== 'linux')
    return failComposition(
      'DURABLE_COMPOSITION_UNAVAILABLE',
      'POSIX durable LocalHost composition requires Linux.',
    );

  const loadRoot = hooks.loadRootFactory ?? loadProductionRootFactory;
  const loadLock = hooks.loadProcessLockFactory ?? loadProductionProcessLockFactory;
  const loadSqlite = hooks.loadSqliteFactory ?? loadProductionSqliteFactory;
  const assemble = hooks.assembleLocalHost ?? assembleLocalHostFromPorts;
  const createOwner = hooks.createOwner ?? createDurableLocalHostOwner;

  const owned: OwnedResources = {
    root: undefined,
    lock: undefined,
    sqlite: undefined,
    rootPending: undefined,
    lockPending: undefined,
    sqlitePending: undefined,
  };

  // 1. Open genuine POSIX storage root
  let rootFactory: Awaited<
    ReturnType<NonNullable<PosixDurableLocalHostTestHooks['loadRootFactory']>>
  >;
  try {
    rootFactory = await loadRoot();
  } catch {
    return failComposition(
      'DURABLE_STORAGE_BOOTSTRAP_FAILED',
      'Durable storage root factory is unavailable.',
    );
  }

  let opened: OpenPosixStorageRootResult;
  try {
    opened = rootFactory.openPosixStorageRoot(
      plan.value,
      policy.value,
    ) as OpenPosixStorageRootResult;
  } catch (error) {
    // OwnershipError from root open — preserve pending cleanup; no lock/SQLite yet.
    const retryClose = extractRetryClose(error);
    if (retryClose !== undefined) {
      owned.rootPending = retryClose;
      return deferStartupCleanup(
        owned,
        'storage-root',
        failComposition('DURABLE_STORAGE_BOOTSTRAP_FAILED', 'Durable storage root open failed.'),
      );
    }
    return failComposition('DURABLE_STORAGE_BOOTSTRAP_FAILED', 'Durable storage root open failed.');
  }

  if (!opened.ok) {
    if (hasPendingCleanup(opened) && typeof opened.pendingCleanup.retryClose === 'function') {
      const retryClose = opened.pendingCleanup.retryClose;
      owned.rootPending = () => retryClose();
      return deferStartupCleanup(
        owned,
        'storage-root',
        failComposition('DURABLE_STORAGE_BOOTSTRAP_FAILED', 'Durable storage root open failed.'),
      );
    }
    return failComposition('DURABLE_STORAGE_BOOTSTRAP_FAILED', 'Durable storage root open failed.');
  }
  owned.root = opened.value;

  // 2. Acquire exclusive process lock (SQLite must not run before held lock)
  let lockFactory: Awaited<
    ReturnType<NonNullable<PosixDurableLocalHostTestHooks['loadProcessLockFactory']>>
  >;
  try {
    lockFactory = await loadLock();
  } catch {
    return runStartupCleanup(
      owned,
      'process-lock',
      failComposition(
        'DURABLE_STORAGE_BOOTSTRAP_FAILED',
        'Durable process lock factory is unavailable.',
      ),
    );
  }

  let lockResult: PosixProcessLockAcquireResult;
  try {
    lockResult = lockFactory.acquirePosixProcessLock(owned.root) as PosixProcessLockAcquireResult;
  } catch (error) {
    const retryRelease = extractRetryRelease(error);
    if (retryRelease !== undefined) {
      // Lock ownership retained — do not close root until lock cleanup succeeds.
      owned.lockPending = retryRelease;
      return deferStartupCleanup(
        owned,
        'process-lock',
        failComposition(
          'DURABLE_STORAGE_BOOTSTRAP_FAILED',
          'Durable process lock acquisition failed.',
        ),
      );
    }
    return runStartupCleanup(
      owned,
      'process-lock',
      failComposition(
        'DURABLE_STORAGE_BOOTSTRAP_FAILED',
        'Durable process lock acquisition failed.',
      ),
    );
  }

  if (!lockResult.ok) {
    if (
      hasPendingCleanup(lockResult) &&
      typeof lockResult.pendingCleanup.retryRelease === 'function'
    ) {
      const retryRelease = lockResult.pendingCleanup.retryRelease;
      owned.lockPending = () => retryRelease();
      return deferStartupCleanup(
        owned,
        'process-lock',
        failComposition(
          'DURABLE_STORAGE_BOOTSTRAP_FAILED',
          'Durable process lock acquisition failed.',
        ),
      );
    }

    const terminal =
      lockResult.error.code === 'STORAGE_LOCK_HELD'
        ? failComposition(
            'DURABLE_COMPOSITION_LOCK_HELD',
            'Exclusive durable composition process lock is already held.',
          )
        : failComposition(
            'DURABLE_STORAGE_BOOTSTRAP_FAILED',
            'Durable process lock acquisition failed.',
          );
    return runStartupCleanup(owned, 'process-lock', terminal);
  }
  owned.lock = lockResult.value;

  // 3. Create SQLite MemoryPort (only after held lock)
  let sqliteFactory: Awaited<
    ReturnType<NonNullable<PosixDurableLocalHostTestHooks['loadSqliteFactory']>>
  >;
  try {
    sqliteFactory = await loadSqlite();
  } catch {
    return runStartupCleanup(
      owned,
      'sqlite',
      failComposition(
        'DURABLE_STORAGE_BOOTSTRAP_FAILED',
        'Durable SQLite memory factory is unavailable.',
      ),
    );
  }

  let sqliteResult: SqliteMemoryPortOpenResult;
  try {
    sqliteResult = sqliteFactory.createSqliteMemoryPort(owned.root) as SqliteMemoryPortOpenResult;
  } catch (error) {
    const retryClose = extractRetryClose(error);
    if (retryClose !== undefined) {
      owned.sqlitePending = retryClose;
      // Lock remains held; root remains busy with leases.
      return deferStartupCleanup(
        owned,
        'sqlite',
        failComposition(
          'DURABLE_STORAGE_BOOTSTRAP_FAILED',
          'Durable SQLite memory bootstrap failed.',
        ),
      );
    }
    return runStartupCleanup(
      owned,
      'sqlite',
      failComposition(
        'DURABLE_STORAGE_BOOTSTRAP_FAILED',
        'Durable SQLite memory bootstrap failed.',
      ),
    );
  }

  if (!sqliteResult.ok) {
    if (
      hasPendingCleanup(sqliteResult) &&
      typeof sqliteResult.pendingCleanup.retryClose === 'function'
    ) {
      const retryClose = sqliteResult.pendingCleanup.retryClose;
      owned.sqlitePending = () => retryClose();
      return deferStartupCleanup(
        owned,
        'sqlite',
        failComposition(
          'DURABLE_STORAGE_BOOTSTRAP_FAILED',
          'Durable SQLite memory bootstrap failed.',
        ),
      );
    }

    return runStartupCleanup(
      owned,
      'sqlite',
      failComposition(
        'DURABLE_STORAGE_BOOTSTRAP_FAILED',
        'Durable SQLite memory bootstrap failed.',
      ),
    );
  }
  owned.sqlite = sqliteResult.value;

  // 4–7. In-memory Approval/Audit, assemble LocalHost, create B3C1 owner
  try {
    const approvals = createInMemoryApprovalStore();
    const audit = createInMemoryAuditLog();
    const host = assemble({
      memory: owned.sqlite.memory,
      approvals,
      audit,
      scanner,
      policy: memoryPolicy,
      clock,
      diagnostics: SQLITE_BACKED_LOCAL_HOST_DIAGNOSTICS,
    });

    const sqliteHandle = sqliteResult.value;
    const lockHandle = lockResult.value;
    const rootHandle = opened.value;

    const closeMemory = createHandleCloser(
      () => sqliteHandle.close(),
      'Failed to close durable SQLite memory.',
    );
    const releaseProcessLock = createHandleCloser(
      () => lockHandle.release(),
      'Failed to release durable process lock.',
    );
    const closeStorageRoot = createHandleCloser(
      () => rootHandle.close(),
      'Failed to close durable storage root.',
    );

    const owner = createOwner({
      host,
      resources: {
        closeMemory,
        releaseProcessLock,
        closeStorageRoot,
      },
    });

    return Object.freeze({
      ok: true as const,
      value: wrapOwnerWithCompositionDiagnostics(owner),
    });
  } catch {
    return runStartupCleanup(
      owned,
      'sqlite',
      failComposition('DURABLE_COMPOSITION_ASSEMBLY_FAILED', 'Durable LocalHost assembly failed.'),
    );
  }
};

/**
 * Linux-only app-private production factory for POSIX durable LocalHost composition.
 *
 * Startup order: validate pure config/plan/policy → Linux gate → root → process lock →
 * SQLite → in-memory Approval/Audit → assemble LocalHost → B3C1 owner.
 * Startup rollback: SQLite → process lock → storage root.
 *
 * Not exported from `src/index.ts`, package exports, or `src/host/index.ts`.
 * Does not accept caller-controlled filesystem/native drivers or diagnostics.
 */
export function createPosixDurableLocalHost(
  input: CreatePosixDurableLocalHostInput,
): Promise<PosixDurableLocalHostCompositionResult> {
  return createPosixDurableLocalHostInternal(input);
}

/**
 * Test-only composition with injected platform/loaders/assembly hooks.
 * Not re-exported from host barrels or the package root.
 * Hooks cannot replace trusted B3C2 composition diagnostics.
 */
export function createPosixDurableLocalHostWithTestHooks(
  input: CreatePosixDurableLocalHostInput,
  hooks: PosixDurableLocalHostTestHooks,
): Promise<PosixDurableLocalHostCompositionResult> {
  return createPosixDurableLocalHostInternal(input, hooks);
}
