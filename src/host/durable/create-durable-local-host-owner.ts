import type {
  MemoryWriteCommand,
  MemoryWriteFailure,
  MemoryWriteOutcome,
} from '../../core/application/index.js';
import {
  err,
  type ApprovalGrant,
  type AuthenticatedMemoryAccessContext,
  type DomainError,
  type MemoryReadRequest,
  type MemoryRecord,
  type Result,
} from '../../core/domain/index.js';
import type { LocalHost } from '../create-local-host.js';
import {
  DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS,
  type DurableLocalHostOwnerDiagnostics,
} from './durable-local-host-owner-diagnostics.js';
import {
  failDurableCloseBusy,
  failDurableCloseStage,
  okDurableClose,
  type DurableLocalHostOwnerCloseResult,
  type DurableResourceCloseResult,
} from './durable-local-host-owner-failures.js';

type OwnerLifecycle = 'open' | 'closing' | 'close-pending' | 'closed';

type ShutdownStageCursor = 'memory' | 'process-lock' | 'storage-root' | 'done';

/**
 * Injected narrow resource closures for B3C1 fake lifecycle tests and future B3C2 wiring.
 * Must not expose root/path/lock handle/fd/SQLite handle.
 *
 * B3C2 closer adapters must:
 * - encapsulate primitive ownership-aware retry inside the closure;
 * - never throw raw OwnershipError across this boundary;
 * - return success only after terminal cleanup of that resource;
 * - retain primitive handle/closure state until a successful retry.
 */
export type DurableLocalHostOwnerResourceClosures = {
  readonly closeMemory: () => DurableResourceCloseResult;
  readonly releaseProcessLock: () => DurableResourceCloseResult;
  readonly closeStorageRoot: () => DurableResourceCloseResult;
};

/**
 * App-private test/composition input. Accepts an already-assembled LocalHost surface plus
 * narrow resource closures. Does not accept filesystem/native drivers.
 */
export interface CreateDurableLocalHostOwnerInput {
  readonly host: LocalHost;
  readonly resources: DurableLocalHostOwnerResourceClosures;
}

/**
 * Frozen durable owner/controller. Ownership and retry live on `close`, not a separate
 * pendingCleanup object. Shutdown is non-reentrant; closers are snapshotted at construction.
 */
export interface DurableLocalHostOwner {
  readonly host: LocalHost;
  readonly diagnostics: DurableLocalHostOwnerDiagnostics;
  readonly close: () => DurableLocalHostOwnerCloseResult;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return typeof (value as { then?: unknown }).then === 'function';
};

const hostClosedWriteFailure = (): MemoryWriteFailure => ({ code: 'MEMORY_UNAVAILABLE' });

const hostClosedReadFailure = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'Durable local host is closed.',
});

const runResourceCloser = (
  closer: () => DurableResourceCloseResult,
): DurableResourceCloseResult | 'threw' => {
  try {
    return closer();
  } catch {
    // Raw closer throws must not escape as ordinary public failures; stage ownership retained.
    return 'threw';
  }
};

/**
 * Pure durable owner/controller with operation gate and ordered retryable shutdown.
 * B3C1 uses injected fake closures only — no POSIX root, process lock, or SQLite open.
 *
 * Lifecycle:
 * - open: host operations allowed;
 * - closing: outer shutdown pass executing (reentrancy latch via shutdownInProgress);
 * - close-pending: shutdown started but blocked by active ops or a failed stage (retryable);
 * - closed: terminal success (idempotent close).
 */
export function createDurableLocalHostOwner(
  input: CreateDurableLocalHostOwnerInput,
): DurableLocalHostOwner {
  const underlying = input.host;
  // Snapshot closer functions immediately — later mutation of input.resources must not retarget shutdown.
  const closeMemory = input.resources.closeMemory;
  const releaseProcessLock = input.resources.releaseProcessLock;
  const closeStorageRoot = input.resources.closeStorageRoot;

  let lifecycle: OwnerLifecycle = 'open';
  let activeOperationCount = 0;
  let stageCursor: ShutdownStageCursor = 'memory';
  // Private reentrancy latch: only one advanceShutdown pass may run; not exposed on owner surface.
  let shutdownInProgress = false;

  const runGated = <T>(operation: () => T, whenClosed: () => T): T => {
    if (lifecycle !== 'open') return whenClosed();
    activeOperationCount += 1;
    let decremented = false;
    const decrementOnce = (): void => {
      if (decremented) return;
      decremented = true;
      activeOperationCount -= 1;
    };
    try {
      const result = operation();
      if (isThenable(result)) {
        try {
          return result.then(
            (value) => {
              decrementOnce();
              return value;
            },
            (reason: unknown) => {
              decrementOnce();
              throw reason;
            },
          ) as T;
        } catch (thenError) {
          // Synchronous throw from thenable.then — still a single decrement.
          decrementOnce();
          throw thenError;
        }
      }
      decrementOnce();
      return result;
    } catch (error) {
      decrementOnce();
      throw error;
    }
  };

  const gatedHost: LocalHost = Object.freeze({
    diagnostics: underlying.diagnostics,
    writeMemory: (
      access: AuthenticatedMemoryAccessContext,
      command: MemoryWriteCommand,
    ): Promise<Result<MemoryWriteOutcome, MemoryWriteFailure>> =>
      runGated(
        () => underlying.writeMemory(access, command),
        () => Promise.resolve(err(hostClosedWriteFailure())),
      ),
    readMemory: (
      access: AuthenticatedMemoryAccessContext,
      request: MemoryReadRequest,
    ): Promise<Result<MemoryRecord, DomainError>> =>
      runGated(
        () => underlying.readMemory(access, request),
        () => Promise.resolve(err(hostClosedReadFailure())),
      ),
    seedLocalApprovalGrant: (grant: ApprovalGrant): void => {
      runGated(
        () => {
          underlying.seedLocalApprovalGrant(grant);
        },
        () => {
          throw new TypeError('Durable local host is closed.');
        },
      );
    },
  });

  const advanceShutdown = (): DurableLocalHostOwnerCloseResult => {
    while (stageCursor !== 'done') {
      if (stageCursor === 'memory') {
        const closed = runResourceCloser(closeMemory);
        if (closed === 'threw' || !closed.ok) {
          lifecycle = 'close-pending';
          return failDurableCloseStage('memory');
        }
        stageCursor = 'process-lock';
        continue;
      }
      if (stageCursor === 'process-lock') {
        const released = runResourceCloser(releaseProcessLock);
        if (released === 'threw' || !released.ok) {
          lifecycle = 'close-pending';
          return failDurableCloseStage('process-lock');
        }
        stageCursor = 'storage-root';
        continue;
      }
      const rootClosed = runResourceCloser(closeStorageRoot);
      if (rootClosed === 'threw' || !rootClosed.ok) {
        lifecycle = 'close-pending';
        return failDurableCloseStage('storage-root');
      }
      stageCursor = 'done';
    }
    lifecycle = 'closed';
    return okDurableClose();
  };

  // Closed over controller state — must not use `this`, so close.call(fake) keeps ownership.
  const close = (): DurableLocalHostOwnerCloseResult => {
    if (lifecycle === 'closed') return okDurableClose();

    // Nested/reentrant close during an outer shutdown pass: stable busy, no closer re-entry.
    if (shutdownInProgress) {
      return failDurableCloseBusy();
    }

    // First close and retries leave open permanently; never return to open.
    lifecycle = 'closing';

    if (activeOperationCount > 0) {
      lifecycle = 'close-pending';
      return failDurableCloseBusy();
    }

    shutdownInProgress = true;
    try {
      return advanceShutdown();
    } finally {
      // Clear latch only; do not continue cleanup after a failed stage.
      shutdownInProgress = false;
    }
  };

  return Object.freeze({
    host: gatedHost,
    diagnostics: DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS,
    close,
  });
}
