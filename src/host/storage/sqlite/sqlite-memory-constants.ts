/**
 * Compile-time SQLite MemoryPort constants (Build 3.3B2).
 * Filename and schema identifiers are not caller-configurable.
 */

/** Immediate child of the trusted storage root. Not exportable as a public path API. */
export const SQLITE_MEMORY_DATABASE_FILENAME = 'neo-memory.sqlite' as const;

/** Durable MemoryPort schema version stored in memory_meta. */
export const SQLITE_MEMORY_SCHEMA_VERSION = 1 as const;

/** Bounded busy_timeout in milliseconds. */
export const SQLITE_MEMORY_BUSY_TIMEOUT_MS = 5_000 as const;

/**
 * Maximum UTF-8 byte length for serialized nested JSON columns (source/provenance/retention).
 * Aligns with core content ceiling; rejects oversized blobs fail-closed.
 */
export const SQLITE_MEMORY_MAX_JSON_BYTES = 65_536 as const;

/** Maximum stored content UTF-8 bytes (matches memory-write content ceiling). */
export const SQLITE_MEMORY_MAX_CONTENT_BYTES = 65_536 as const;

/** Maximum identifier string length (matches core ID max). */
export const SQLITE_MEMORY_MAX_ID_CHARS = 128 as const;
