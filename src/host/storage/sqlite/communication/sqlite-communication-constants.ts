/**
 * Compile-time SQLite communication persistence constants (Build 3.7C).
 * Filename and schema identifiers are not caller-configurable.
 */

/** Immediate child of the trusted storage root. Separate from neo-memory.sqlite. */
export const SQLITE_COMMUNICATION_DATABASE_FILENAME = 'neo-communication.sqlite' as const;

/** Durable communication schema version stored in communication_meta. */
export const SQLITE_COMMUNICATION_SCHEMA_VERSION = 1 as const;

/** Bounded busy_timeout in milliseconds (matches MemoryPort stack). */
export const SQLITE_COMMUNICATION_BUSY_TIMEOUT_MS = 5_000 as const;

/** Maximum UTF-8 byte length for serialized JSON blobs. */
export const SQLITE_COMMUNICATION_MAX_JSON_BYTES = 65_536 as const;

/** Maximum UTF-8 bytes for offline outbox plaintext payload. */
export const SQLITE_COMMUNICATION_MAX_OUTBOX_PLAINTEXT_BYTES = 65_536 as const;

/** Maximum identifier / key string length. */
export const SQLITE_COMMUNICATION_MAX_ID_CHARS = 128 as const;

/** Maximum redacted audit metadata entries. */
export const SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_ENTRIES = 32 as const;

/** Maximum UTF-8 bytes per audit metadata value. */
export const SQLITE_COMMUNICATION_MAX_AUDIT_METADATA_VALUE_BYTES = 1_024 as const;
