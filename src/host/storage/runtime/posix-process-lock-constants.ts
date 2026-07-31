/**
 * Compile-time exclusive process-lock constants (Build 3.3B3B3).
 * Filename is not caller-, env-, or config-controlled.
 */

/**
 * Immediate child of the trusted storage root. Dedicated lock placeholder — not the SQLite
 * database, WAL, SHM, or a PID file. May exist before acquire and may remain after release/crash;
 * presence alone is not proof of a held lock and is never unlinked for stale recovery.
 */
export const POSIX_PROCESS_LOCK_FILENAME = 'neo.primary.lock' as const;
