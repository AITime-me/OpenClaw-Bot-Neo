import { posix as pathPosix } from 'node:path';
import type { Result } from '../../../../core/domain/result.js';
import type { DomainError } from '../../../../core/domain/errors.js';
import type { SensitiveDataScannerPort } from '../../../../core/ports/sensitive-data-scanner.port.js';
import type { CommunicationTurnLedgerPort } from '../../../../core/communication/ports/communication-turn-ledger.port.js';
import type { ConversationStatePort } from '../../../../core/communication/ports/conversation-state.port.js';
import type { CommunicationAuditPort } from '../../../../core/communication/ports/communication-audit.port.js';
import type { CommunicationDeliveryOutboxPort } from '../../../../core/communication/ports/communication-delivery-outbox.port.js';
import {
  OFFLINE_OUTBOX_MAX_TTL_MS,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS,
} from '../../../../core/communication/ports/offline-communication-persistence.contract.js';
import {
  defaultCommunicationQueueConfig,
  parseCommunicationQueueConfig,
  type CommunicationQueueConfig,
} from '../../../../core/communication/domain/communication-turn.js';
import { sealFreshObservedAdmissionEvidenceForPersistence } from '../../../../core/communication/domain/fresh-observed-admission-evidence.persistence.internal.js';
import { readAuthenticatedCommunicationPrincipalPersistenceClaims } from '../../../../core/communication/domain/authenticated-communication-principal.persistence.internal.js';
import {
  isGenuineValidatedTextOutputForPersistence,
  readValidatedTextOutputPlaintextForOfflineOutbox,
} from '../../../../core/communication/domain/validated-text-output.persistence.internal.js';
import { failStorage, okStorage, type StorageFailure } from '../../storage-failure.js';
import {
  acquireOpenedPosixStorageRootLease,
  type AcquiredPosixStorageRootLease,
} from '../../runtime/posix-storage-root-lease.internal.js';
import { resolveOpenedPosixStorageRootCapability } from '../../runtime/posix-storage-root-resolve.internal.js';
import { openSqliteDatabaseFile, type SqliteDatabase } from '../better-sqlite3-driver.js';
import {
  SQLITE_COMMUNICATION_DATABASE_FILENAME,
  SQLITE_COMMUNICATION_SCHEMA_VERSION,
} from './sqlite-communication-constants.js';
import {
  applySqliteCommunicationPragmas,
  isSqliteDatabaseEmpty,
  migrateCommunicationSchema0To1,
  readCommunicationSchemaVersion,
  runSqliteQuickCheck,
  verifyCommunicationSchemaV1,
  verifySqliteCommunicationPragmas,
} from './sqlite-communication-schema.js';
import { createSqliteCommunicationTurnLedgerPort } from './sqlite-communication-turn-ledger-port.js';
import { createSqliteConversationStatePort } from './sqlite-conversation-state-port.js';
import { createSqliteCommunicationAuditPort } from './sqlite-communication-audit-port.js';
import {
  createSqliteCommunicationDeliveryOutboxPort,
  scrubExpiredOutboxPlaintext,
} from './sqlite-communication-delivery-outbox-port.js';

export interface OfflineSqliteCommunicationPortsDiagnostics {
  readonly mode: 'offline-only';
  readonly storageBackend: 'sqlite';
  readonly plaintextOutboxEnabled: true;
  readonly plaintextConversationStateEnabled: true;
  readonly encryptionEnabled: false;
  readonly livePersistenceAllowed: false;
  readonly maxOutboxTtlMs: typeof OFFLINE_OUTBOX_MAX_TTL_MS;
  readonly forensicEraseGuaranteed: false;
  readonly deliveryExecutionAvailable: false;
  readonly automaticResendAvailable: false;
  readonly productionWired: false;
  readonly safeRootCapabilityVerified: true;
  readonly databaseOpened: true;
  readonly schemaVersion: typeof SQLITE_COMMUNICATION_SCHEMA_VERSION;
  readonly schemaVerified: true;
  readonly foreignKeysEnabled: true;
  readonly busyTimeoutVerified: true;
  readonly journalMode: 'wal';
  readonly integrityVerified: true;
  readonly storageRootLeaseCoordinated: true;
  readonly plaintextOutboxAllowedOfflineOnly: true;
}

export interface OfflineSqliteCommunicationPortsPendingCleanup {
  readonly retryClose: () => Result<void, StorageFailure>;
}

export type OfflineSqliteCommunicationPortsCloseFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: 'SQLITE_CLOSE_FAILED';
    readonly reason: string;
  };
  readonly pendingCleanup: OfflineSqliteCommunicationPortsPendingCleanup;
};

export type OfflineSqliteCommunicationPortsOpenResult =
  | { readonly ok: true; readonly value: OfflineSqliteCommunicationPortsHandle }
  | { readonly ok: false; readonly error: StorageFailure }
  | OfflineSqliteCommunicationPortsCloseFailure;

export interface OfflineSqliteCommunicationPortsHandle {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly conversationState: ConversationStatePort;
  readonly audit: CommunicationAuditPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly diagnostics: OfflineSqliteCommunicationPortsDiagnostics;
  /** Absolute POSIX path of neo-communication.sqlite — exclusive runtime ownership key. */
  readonly ownershipKey: string;
  /** Effective frozen queueConfig used by the ledger (identity-checkable). */
  readonly queueConfig: CommunicationQueueConfig;
  readonly close: () => Result<void, StorageFailure>;
}

export type OfflineSqliteCommunicationPortsOptions = {
  readonly scanner: SensitiveDataScannerPort;
  readonly queueConfig?: CommunicationQueueConfig;
};

export type OfflineSqliteCommunicationPortsTestHooks = {
  readonly wrapDatabase?: (db: SqliteDatabase) => SqliteDatabase;
};

const SUCCESS_DIAGNOSTICS: OfflineSqliteCommunicationPortsDiagnostics = Object.freeze({
  mode: 'offline-only',
  storageBackend: 'sqlite',
  plaintextOutboxEnabled: true,
  plaintextConversationStateEnabled: true,
  encryptionEnabled: false,
  livePersistenceAllowed: false,
  maxOutboxTtlMs: OFFLINE_OUTBOX_MAX_TTL_MS,
  forensicEraseGuaranteed: false,
  deliveryExecutionAvailable: false,
  automaticResendAvailable: false,
  productionWired: false,
  safeRootCapabilityVerified: true,
  databaseOpened: true,
  schemaVersion: SQLITE_COMMUNICATION_SCHEMA_VERSION,
  schemaVerified: true,
  foreignKeysEnabled: true,
  busyTimeoutVerified: true,
  journalMode: 'wal',
  integrityVerified: true,
  storageRootLeaseCoordinated: true,
  plaintextOutboxAllowedOfflineOnly: true,
});

const closedPortError = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'SQLite communication ports are closed.',
});

type ConnectionState = 'opening' | 'open' | 'close-pending' | 'closed';

const createPendingCleanup = (
  closeOnce: () => Result<void, StorageFailure>,
): OfflineSqliteCommunicationPortsPendingCleanup =>
  Object.freeze({
    retryClose: (): Result<void, StorageFailure> => closeOnce(),
  });

const asCloseFailure = (
  pendingCleanup: OfflineSqliteCommunicationPortsPendingCleanup,
): OfflineSqliteCommunicationPortsCloseFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'SQLITE_CLOSE_FAILED' as const,
      reason: 'Failed to close SQLite communication database.',
    }),
    pendingCleanup,
  });

const closeDatabase = (db: SqliteDatabase): Result<void, StorageFailure> => {
  try {
    db.close();
    return okStorage(undefined);
  } catch {
    return failStorage('SQLITE_CLOSE_FAILED', 'Failed to close SQLite communication database.');
  }
};

const closeDatabaseAndReleaseLease = (
  db: SqliteDatabase,
  lease: AcquiredPosixStorageRootLease,
): Result<void, StorageFailure> => {
  const closed = closeDatabase(db);
  if (closed.ok) lease.release();
  return closed;
};

const failAfterOpen = (
  db: SqliteDatabase,
  lease: AcquiredPosixStorageRootLease,
  primary: StorageFailure,
): OfflineSqliteCommunicationPortsOpenResult => {
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

const openOfflineSqliteCommunicationPortsInternal = (
  openedRoot: unknown,
  options: OfflineSqliteCommunicationPortsOptions,
  hooks?: OfflineSqliteCommunicationPortsTestHooks,
): OfflineSqliteCommunicationPortsOpenResult => {
  if (typeof options.scanner.scanText !== 'function') {
    return Object.freeze({
      ok: false as const,
      error: {
        code: 'SQLITE_OPEN_FAILED' as const,
        reason: 'Offline communication ports require a SensitiveDataScannerPort.',
      },
    });
  }

  let resolvedQueueConfig: CommunicationQueueConfig;
  if (options.queueConfig === undefined) {
    resolvedQueueConfig = defaultCommunicationQueueConfig();
  } else {
    const parsedQueue = parseCommunicationQueueConfig(options.queueConfig);
    if (!parsedQueue.ok) {
      return Object.freeze({
        ok: false as const,
        error: {
          code: 'SQLITE_OPEN_FAILED' as const,
          reason: 'Offline communication ports queueConfig failed runtime validation.',
        },
      });
    }
    // Preserve caller-supplied frozen instance for verified reference composition identity checks.
    resolvedQueueConfig = options.queueConfig;
  }

  const acquired = acquireOpenedPosixStorageRootLease(openedRoot);
  if (!acquired.ok) return Object.freeze({ ok: false as const, error: acquired.error });
  const lease = acquired.value;

  const storageRootPath = lease.storageRootPath;
  const databasePath = pathPosix.join(storageRootPath, SQLITE_COMMUNICATION_DATABASE_FILENAME);
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
        throw new OfflineSqliteCommunicationPortsOwnershipError(
          createPendingCleanup(retryClose),
          error,
        );
      }
      throw error;
    }
  }

  try {
    const pragmas = applySqliteCommunicationPragmas(db);
    const pragmaOk = verifySqliteCommunicationPragmas(pragmas);
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

    const version = readCommunicationSchemaVersion(db);
    if (!version.ok)
      return failAfterOpen(db, lease, {
        code: 'SQLITE_SCHEMA_MISMATCH',
        reason: 'SQLite schema version read failed.',
      });

    if (version.version === 0 || isSqliteDatabaseEmpty(db)) {
      try {
        migrateCommunicationSchema0To1(db);
      } catch {
        return failAfterOpen(db, lease, {
          code: 'SQLITE_SCHEMA_MISMATCH',
          reason: 'SQLite communication schema migration 0→1 failed.',
        });
      }
    } else if (version.version > SQLITE_COMMUNICATION_SCHEMA_VERSION) {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_SCHEMA_MISMATCH',
        reason: 'SQLite communication schema future version is unsupported.',
      });
    } else if (version.version !== SQLITE_COMMUNICATION_SCHEMA_VERSION) {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_SCHEMA_MISMATCH',
        reason: 'SQLite communication schema unsupported version.',
      });
    }

    const schema = verifyCommunicationSchemaV1(db);
    if (!schema.ok)
      return failAfterOpen(db, lease, {
        code: 'SQLITE_SCHEMA_MISMATCH',
        reason: 'SQLite communication schema verification failed.',
      });

    try {
      scrubExpiredOutboxPlaintext(db, new Date().toISOString());
    } catch {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_OPEN_FAILED',
        reason: 'SQLite outbox plaintext scrub on open failed.',
      });
    }

    const stillOpen = resolveOpenedPosixStorageRootCapability(openedRoot);
    if (!stillOpen.ok) return failAfterOpen(db, lease, stillOpen.error);

    let connectionState: ConnectionState = 'opening';
    const assertOpen = (): DomainError | null =>
      connectionState === 'open' ? null : closedPortError();

    let ledger: CommunicationTurnLedgerPort;
    let conversationState: ConversationStatePort;
    let audit: CommunicationAuditPort;
    let outbox: CommunicationDeliveryOutboxPort;
    try {
      ledger = createSqliteCommunicationTurnLedgerPort(
        db,
        assertOpen,
        {
          sealAdmissionEvidence: sealFreshObservedAdmissionEvidenceForPersistence,
          readPrincipalClaims: (principal) => {
            const claims = readAuthenticatedCommunicationPrincipalPersistenceClaims(
              principal as never,
            );
            if (claims === null) return null;
            return Object.freeze({
              turnId: claims.turnId,
              ownerId: claims.ownerId,
              conversationId: claims.conversationId,
            });
          },
        },
        resolvedQueueConfig,
      );
      conversationState = createSqliteConversationStatePort(db, assertOpen, options.scanner);
      audit = createSqliteCommunicationAuditPort(db, assertOpen, options.scanner);
      outbox = createSqliteCommunicationDeliveryOutboxPort(
        db,
        assertOpen,
        {
          isGenuineValidatedOutput: isGenuineValidatedTextOutputForPersistence,
          readOutputPlaintext: readValidatedTextOutputPlaintextForOfflineOutbox,
          isGenuinePrincipal: (principal) =>
            readAuthenticatedCommunicationPrincipalPersistenceClaims(principal as never) !== null,
          readPrincipalBindingVersion: (principal) => {
            const claims = readAuthenticatedCommunicationPrincipalPersistenceClaims(
              principal as never,
            );
            return claims?.bindingVersion ?? null;
          },
        },
        { maxOutboxTtlMs: OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS.maxOutboxTtlMs },
      );
    } catch {
      return failAfterOpen(db, lease, {
        code: 'SQLITE_OPEN_FAILED',
        reason: 'SQLite communication statement prepare failed.',
      });
    }

    connectionState = 'open';

    const close = (): Result<void, StorageFailure> => {
      if (connectionState === 'closed') return okStorage(undefined);
      connectionState = 'close-pending';
      const closed = closeDatabaseAndReleaseLease(db, lease);
      if (closed.ok) {
        connectionState = 'closed';
        return closed;
      }
      return closed;
    };

    return okStorage(
      Object.freeze({
        ledger,
        conversationState,
        audit,
        outbox,
        diagnostics: SUCCESS_DIAGNOSTICS,
        ownershipKey: databasePath,
        queueConfig: resolvedQueueConfig,
        close,
      }),
    );
  } catch (error) {
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
      throw new OfflineSqliteCommunicationPortsOwnershipError(
        createPendingCleanup(retryClose),
        error,
      );
    }
    throw error;
  }
};

/**
 * Opens package-private offline SQLite communication ports inside a genuine open POSIX storage-root.
 * Not exported from host barrels or the package root.
 */
export function createOfflineSqliteCommunicationPorts(
  openedRoot: unknown,
  options: OfflineSqliteCommunicationPortsOptions,
): OfflineSqliteCommunicationPortsOpenResult {
  return openOfflineSqliteCommunicationPortsInternal(openedRoot, options);
}

/** Test-only open with optional database wrap. Not re-exported from host barrels. */
export function createOfflineSqliteCommunicationPortsWithTestHooks(
  openedRoot: unknown,
  options: OfflineSqliteCommunicationPortsOptions,
  hooks: OfflineSqliteCommunicationPortsTestHooks,
): OfflineSqliteCommunicationPortsOpenResult {
  return openOfflineSqliteCommunicationPortsInternal(openedRoot, options, hooks);
}

export class OfflineSqliteCommunicationPortsOwnershipError extends Error {
  readonly pendingCleanup: OfflineSqliteCommunicationPortsPendingCleanup;
  readonly originalError: unknown;

  constructor(
    pendingCleanup: OfflineSqliteCommunicationPortsPendingCleanup,
    originalError: unknown,
  ) {
    super('SQLite communication database remains open after a bootstrap programmer-error path.');
    this.name = 'OfflineSqliteCommunicationPortsOwnershipError';
    this.pendingCleanup = pendingCleanup;
    this.originalError = originalError;
  }
}

export const isOfflineSqliteCommunicationPortsOwnershipError = (
  value: unknown,
): value is OfflineSqliteCommunicationPortsOwnershipError =>
  value instanceof OfflineSqliteCommunicationPortsOwnershipError;
