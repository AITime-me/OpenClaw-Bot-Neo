import { posix as pathPosix } from 'node:path';
import type { MemoryPort } from '../../../core/ports/index.js';
import type { Result } from '../../../core/domain/result.js';
import type { DomainError } from '../../../core/domain/errors.js';
import { failStorage, okStorage, type StorageFailure } from '../storage-failure.js';
import {
  acquireOpenedPosixStorageRootLease,
  type AcquiredPosixStorageRootLease,
} from '../runtime/posix-storage-root-lease.internal.js';
import { resolveOpenedPosixStorageRootCapability } from '../runtime/posix-storage-root-resolve.internal.js';
import { openSqliteDatabaseFile, type SqliteDatabase } from './better-sqlite3-driver.js';
import {
  SQLITE_MEMORY_DATABASE_FILENAME,
  SQLITE_MEMORY_SCHEMA_VERSION,
} from './sqlite-memory-constants.js';
import {
  applySqliteMemoryPragmas,
  bootstrapSqliteMemorySchemaV1,
  isSqliteDatabaseEmpty,
  runSqliteQuickCheck,
  verifySqliteMemoryPragmas,
  verifySqliteMemorySchemaV1,
} from './sqlite-memory-schema.js';
import { createSqliteMemoryPortConnection } from './sqlite-memory-port.js';

export interface SqliteMemoryPortDiagnostics {
  readonly safeRootCapabilityVerified: true;
  readonly storageBackend: 'sqlite';
  readonly databaseOpened: true;
  readonly schemaVersion: typeof SQLITE_MEMORY_SCHEMA_VERSION;
  readonly schemaVerified: true;
  readonly foreignKeysEnabled: true;
  readonly busyTimeoutVerified: true;
  readonly journalMode: 'wal';
  readonly integrityVerified: true;
  readonly writesEnabled: true;
  readonly memoryPortDurability: 'sqlite-local';
  readonly localHostWired: false;
  readonly approvalDurable: false;
  readonly auditDurable: false;
  readonly crossPortAtomicity: false;
  readonly encryptionEnabled: false;
  readonly exclusiveProcessLock: false;
  readonly secondInstanceProtection: false;
  readonly linuxContainerValidated: false;
  readonly deploymentReady: false;
  /**
   * Same-process root↔adapter lease: root.close() is busy while this adapter holds an open
   * or close-pending connection. Not a process lock or second-instance protection.
   */
  readonly storageRootLeaseCoordinated: true;
}

export interface SqliteMemoryPortPendingCleanup {
  readonly retryClose: () => Result<void, StorageFailure>;
}

export type SqliteMemoryPortCloseFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: 'SQLITE_CLOSE_FAILED';
    readonly reason: string;
  };
  readonly pendingCleanup: SqliteMemoryPortPendingCleanup;
};

export type SqliteMemoryPortOpenResult =
  | { readonly ok: true; readonly value: SqliteMemoryPortHandle }
  | { readonly ok: false; readonly error: StorageFailure }
  | SqliteMemoryPortCloseFailure;

export interface SqliteMemoryPortHandle {
  readonly memory: MemoryPort;
  readonly diagnostics: SqliteMemoryPortDiagnostics;
  readonly close: () => Result<void, StorageFailure>;
}

/**
 * Test-only hooks for fault injection. Not exported from host barrels / package root.
 * Production {@link createSqliteMemoryPort} never accepts hooks.
 */
export type SqliteMemoryPortTestHooks = {
  readonly wrapDatabase?: (db: SqliteDatabase) => SqliteDatabase;
};

const SUCCESS_DIAGNOSTICS: SqliteMemoryPortDiagnostics = Object.freeze({
  safeRootCapabilityVerified: true,
  storageBackend: 'sqlite',
  databaseOpened: true,
  schemaVersion: SQLITE_MEMORY_SCHEMA_VERSION,
  schemaVerified: true,
  foreignKeysEnabled: true,
  busyTimeoutVerified: true,
  journalMode: 'wal',
  integrityVerified: true,
  writesEnabled: true,
  memoryPortDurability: 'sqlite-local',
  localHostWired: false,
  approvalDurable: false,
  auditDurable: false,
  crossPortAtomicity: false,
  encryptionEnabled: false,
  exclusiveProcessLock: false,
  secondInstanceProtection: false,
  linuxContainerValidated: false,
  deploymentReady: false,
  storageRootLeaseCoordinated: true,
});

const closedPortError = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'SQLite memory port is closed.',
});

type ConnectionState = 'opening' | 'open' | 'close-pending' | 'closed';

const createPendingCleanup = (
  closeOnce: () => Result<void, StorageFailure>,
): SqliteMemoryPortPendingCleanup =>
  Object.freeze({
    retryClose: (): Result<void, StorageFailure> => closeOnce(),
  });

const asCloseFailure = (
  pendingCleanup: SqliteMemoryPortPendingCleanup,
): SqliteMemoryPortCloseFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'SQLITE_CLOSE_FAILED' as const,
      reason: 'Failed to close SQLite memory database.',
    }),
    pendingCleanup,
  });

const closeDatabase = (db: SqliteDatabase): Result<void, StorageFailure> => {
  try {
    db.close();
    return okStorage(undefined);
  } catch {
    return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite memory database.');
  }
};

/**
 * Close DB then release root lease only after successful database.close().
 * Failed close retains both connection ownership and the lease.
 */
const closeDatabaseAndReleaseLease = (
  db: SqliteDatabase,
  lease: AcquiredPosixStorageRootLease,
): Result<void, StorageFailure> => {
  const closed = closeDatabase(db);
  if (closed.ok) lease.release();
  return closed;
};

/**
 * Best-effort close after a failed bootstrap. On close failure, returns CLOSE_FAILED with lifecycle
 * that retains the root lease until a successful connection close. Operations are not exposed.
 */
const failAfterOpen = (
  db: SqliteDatabase,
  lease: AcquiredPosixStorageRootLease,
  primary: StorageFailure,
): SqliteMemoryPortOpenResult => {
  let state: ConnectionState = 'close-pending';
  const retryClose = (): Result<void, StorageFailure> => {
    if (state === 'closed') return okStorage(undefined);
    state = 'close-pending';
    const closed = closeDatabaseAndReleaseLease(db, lease);
    if (closed.ok) state = 'closed';
    return closed;
  };
  const closed = retryClose();
  if (closed.ok) {
    return Object.freeze({ ok: false as const, error: primary });
  }
  return asCloseFailure(createPendingCleanup(retryClose));
};

const openSqliteMemoryPortInternal = (
  openedRoot: unknown,
  hooks?: SqliteMemoryPortTestHooks,
): SqliteMemoryPortOpenResult => {
  const acquired = acquireOpenedPosixStorageRootLease(openedRoot);
  if (!acquired.ok) return Object.freeze({ ok: false as const, error: acquired.error });
  const lease = acquired.value;

  const storageRootPath = lease.storageRootPath;
  // Compile-time filename only — never caller-controlled; immediate child of trusted root.
  const databasePath = pathPosix.join(storageRootPath, SQLITE_MEMORY_DATABASE_FILENAME);
  if (databasePath === storageRootPath || !databasePath.startsWith(`${storageRootPath}/`)) {
    lease.release();
    return Object.freeze({
      ok: false as const,
      error: {
        code: 'SQLITE_OPEN_FAILED' as const,
        reason: 'SQLite database path escaped the storage root.',
      },
    });
  }

  let db: SqliteDatabase;
  try {
    db = openSqliteDatabaseFile(databasePath);
  } catch {
    lease.release();
    return Object.freeze({
      ok: false as const,
      error: {
        code: 'SQLITE_OPEN_FAILED' as const,
        reason: 'SQLite database open failed.',
      },
    });
  }

  if (hooks?.wrapDatabase !== undefined) {
    try {
      db = hooks.wrapDatabase(db);
    } catch (error) {
      const closed = closeDatabaseAndReleaseLease(db, lease);
      if (!closed.ok) {
        let state: ConnectionState = 'close-pending';
        const retryClose = (): Result<void, StorageFailure> => {
          if (state === 'closed') return okStorage(undefined);
          state = 'close-pending';
          const result = closeDatabaseAndReleaseLease(db, lease);
          if (result.ok) state = 'closed';
          return result;
        };
        throw new SqliteMemoryPortOwnershipError(createPendingCleanup(retryClose), error);
      }
      throw error;
    }
  }

  try {
    const pragmas = applySqliteMemoryPragmas(db);
    const pragmaOk = verifySqliteMemoryPragmas(pragmas);
    if (!pragmaOk.ok)
      return failAfterOpen(db, lease, {
        code: 'SQLITE_PRAGMA_FAILED',
        reason: 'SQLite pragma verification failed.',
      });

    const integrity = runSqliteQuickCheck(db);
    if (!integrity.ok)
      return failAfterOpen(db, lease, {
        code: 'SQLITE_INTEGRITY_FAILED',
        reason: 'SQLite integrity verification failed.',
      });

    if (isSqliteDatabaseEmpty(db)) {
      try {
        bootstrapSqliteMemorySchemaV1(db);
      } catch {
        return failAfterOpen(db, lease, {
          code: 'SQLITE_SCHEMA_MISMATCH',
          reason: 'SQLite schema bootstrap failed.',
        });
      }
      const afterBootstrap = verifySqliteMemorySchemaV1(db);
      if (!afterBootstrap.ok)
        return failAfterOpen(db, lease, {
          code: 'SQLITE_SCHEMA_MISMATCH',
          reason: 'SQLite schema verification failed.',
        });
    } else {
      const schema = verifySqliteMemorySchemaV1(db);
      if (!schema.ok)
        return failAfterOpen(db, lease, {
          code: 'SQLITE_SCHEMA_MISMATCH',
          reason: 'SQLite schema verification failed.',
        });
    }

    // Re-check capability remains open after bootstrap work (factory lease still held).
    const stillOpen = resolveOpenedPosixStorageRootCapability(openedRoot);
    if (!stillOpen.ok) return failAfterOpen(db, lease, stillOpen.error);

    let connectionState: ConnectionState = 'opening';

    const assertOpen = (): DomainError | null =>
      connectionState === 'open' ? null : closedPortError();

    let memory: MemoryPort;
    try {
      ({ memory } = createSqliteMemoryPortConnection(db, assertOpen));
    } catch {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_OPEN_FAILED',
        reason: 'SQLite statement prepare failed.',
      });
    }

    connectionState = 'open';

    const close = (): Result<void, StorageFailure> => {
      if (connectionState === 'closed') return okStorage(undefined);
      // Transition to close-pending before attempting database.close so operations stop immediately.
      connectionState = 'close-pending';
      const closed = closeDatabaseAndReleaseLease(db, lease);
      if (closed.ok) {
        connectionState = 'closed';
        return closed;
      }
      // Remain close-pending; ownership and lease retained for deterministic retry. Never return to open.
      return closed;
    };

    return okStorage(
      Object.freeze({
        memory,
        diagnostics: SUCCESS_DIAGNOSTICS,
        close,
      }),
    );
  } catch (error) {
    // Map filesystem/SQLite errno failures to redacted Results; preserve programmer errors.
    const isErrnoLike =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof Reflect.get(error, 'code') === 'string';

    if (isErrnoLike) {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_OPEN_FAILED',
        reason: 'SQLite database open failed.',
      });
    }

    const closed = closeDatabaseAndReleaseLease(db, lease);
    if (!closed.ok) {
      let state: ConnectionState = 'close-pending';
      const retryClose = (): Result<void, StorageFailure> => {
        if (state === 'closed') return okStorage(undefined);
        state = 'close-pending';
        const result = closeDatabaseAndReleaseLease(db, lease);
        if (result.ok) state = 'closed';
        return result;
      };
      throw new SqliteMemoryPortOwnershipError(createPendingCleanup(retryClose), error);
    }
    throw error;
  }
};

/**
 * Opens an app-private SQLite MemoryPort inside a genuine open POSIX storage-root capability.
 *
 * Does not accept raw paths, filenames, env, cwd, home, platform, or fake capabilities.
 * Does not wire LocalHost. Acquires a same-process root child lease for the adapter lifetime.
 */
export function createSqliteMemoryPort(openedRoot: unknown): SqliteMemoryPortOpenResult {
  return openSqliteMemoryPortInternal(openedRoot);
}

/**
 * Test-only open with optional database wrap for fault injection.
 * Not re-exported from `src/host/index.ts` or the package root.
 */
export function createSqliteMemoryPortWithTestHooks(
  openedRoot: unknown,
  hooks: SqliteMemoryPortTestHooks,
): SqliteMemoryPortOpenResult {
  return openSqliteMemoryPortInternal(openedRoot, hooks);
}

/**
 * Programmer-error path where bootstrap cleanup close also failed.
 * Not an ordinary StorageFailure Result. Pending cleanup retains connection and root lease.
 */
export class SqliteMemoryPortOwnershipError extends Error {
  readonly pendingCleanup: SqliteMemoryPortPendingCleanup;
  readonly originalError: unknown;

  constructor(pendingCleanup: SqliteMemoryPortPendingCleanup, originalError: unknown) {
    super('SQLite memory database remains open after a bootstrap programmer-error path.');
    this.name = 'SqliteMemoryPortOwnershipError';
    this.pendingCleanup = pendingCleanup;
    this.originalError = originalError;
  }
}

export const isSqliteMemoryPortOwnershipError = (
  value: unknown,
): value is SqliteMemoryPortOwnershipError => value instanceof SqliteMemoryPortOwnershipError;
