/**
 * Offline communication persistence contracts (Build 3.7C0).
 * Documents the future package-private factory shape without implementing SQLite.
 */

/** Maximum plaintext outbox payload TTL for offline persistence (24 hours). */
export const OFFLINE_OUTBOX_MAX_TTL_MS = 86_400_000 as const;

/**
 * Exact future factory module path (Build 3.7C implementation).
 * Not present in 3.7C0 — allowlisted for persistence facades only.
 */
export const OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_MODULE =
  'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts' as const;

/** Future package-private factory symbol name. */
export const OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_NAME =
  'createOfflineSqliteCommunicationPorts' as const;

/**
 * Fixed offline factory flags. Caller-supplied booleans are not encryption evidence.
 * Live factory is not implemented in Build 3.7C0.
 */
export interface OfflineSqliteCommunicationPortsFactoryFlags {
  readonly maxOutboxTtlMs: typeof OFFLINE_OUTBOX_MAX_TTL_MS;
  readonly livePersistenceAllowed: false;
  readonly encryptionEnabled: false;
  readonly deliveryExecutionAvailable: false;
  readonly automaticResendAvailable: false;
  readonly productionWired: false;
}

export const OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS = Object.freeze({
  maxOutboxTtlMs: OFFLINE_OUTBOX_MAX_TTL_MS,
  livePersistenceAllowed: false,
  encryptionEnabled: false,
  deliveryExecutionAvailable: false,
  automaticResendAvailable: false,
  productionWired: false,
}) satisfies OfflineSqliteCommunicationPortsFactoryFlags;

/**
 * Diagnostics emitted by offline persistence. Forensic erase is never guaranteed.
 */
export interface OfflineCommunicationPersistenceDiagnostics {
  readonly forensicEraseGuaranteed: false;
  readonly livePersistenceAllowed: false;
  readonly encryptionEnabled: false;
  readonly deliveryExecutionAvailable: false;
  readonly automaticResendAvailable: false;
  readonly productionWired: false;
  readonly plaintextOutboxAllowedOfflineOnly: true;
  readonly maxOutboxTtlMs: typeof OFFLINE_OUTBOX_MAX_TTL_MS;
}

export const OFFLINE_COMMUNICATION_PERSISTENCE_DIAGNOSTICS = Object.freeze({
  forensicEraseGuaranteed: false,
  livePersistenceAllowed: false,
  encryptionEnabled: false,
  deliveryExecutionAvailable: false,
  automaticResendAvailable: false,
  productionWired: false,
  plaintextOutboxAllowedOfflineOnly: true,
  maxOutboxTtlMs: OFFLINE_OUTBOX_MAX_TTL_MS,
}) satisfies OfflineCommunicationPersistenceDiagnostics;

/**
 * Retention rules for durable communication stores (normative for 3.7C implementation).
 * Automatic VACUUM, compaction, and production cleanup are forbidden.
 */
export interface CommunicationPersistenceRetentionPolicy {
  readonly turnRowsRetainedIndefinitely: true;
  readonly dedupTombstonesRetainedIndefinitely: true;
  readonly sequenceCountersRetainedIndefinitely: true;
  readonly factualHistoryRetainedIndefinitely: true;
  readonly auditRetainedIndefinitely: true;
  readonly checkpointOperationsRetainedIndefinitely: true;
  readonly outboxTombstonesRetainedIndefinitely: true;
  readonly conversationStateKeepsCurrentSnapshotOnly: true;
  readonly outboxPlaintextMaxTtlMs: typeof OFFLINE_OUTBOX_MAX_TTL_MS;
  readonly outboxPlaintextScrubbedAfterExpiry: true;
  readonly deliveryOutcomeUnknownImmutable: true;
  readonly automaticVacuumForbidden: true;
  readonly automaticCompactionForbidden: true;
  readonly productionCleanupForbidden: true;
  readonly forensicEraseGuaranteed: false;
}

export const COMMUNICATION_PERSISTENCE_RETENTION_POLICY = Object.freeze({
  turnRowsRetainedIndefinitely: true,
  dedupTombstonesRetainedIndefinitely: true,
  sequenceCountersRetainedIndefinitely: true,
  factualHistoryRetainedIndefinitely: true,
  auditRetainedIndefinitely: true,
  checkpointOperationsRetainedIndefinitely: true,
  outboxTombstonesRetainedIndefinitely: true,
  conversationStateKeepsCurrentSnapshotOnly: true,
  outboxPlaintextMaxTtlMs: OFFLINE_OUTBOX_MAX_TTL_MS,
  outboxPlaintextScrubbedAfterExpiry: true,
  deliveryOutcomeUnknownImmutable: true,
  automaticVacuumForbidden: true,
  automaticCompactionForbidden: true,
  productionCleanupForbidden: true,
  forensicEraseGuaranteed: false,
}) satisfies CommunicationPersistenceRetentionPolicy;

/**
 * Offline factory obligations (documented for the future exact factory).
 * Scrub expired plaintext at open and before every outbox method.
 */
export interface OfflineSqliteCommunicationPortsFactoryObligations {
  readonly plaintextOutboxAndStateOfflineOnly: true;
  readonly scrubExpiredPlaintextOnOpen: true;
  readonly scrubExpiredPlaintextBeforeEveryOutboxMethod: true;
  readonly callerBooleanIsNotEncryptionEvidence: true;
  readonly liveFactoryNotImplementedInBuild37C0: true;
}
