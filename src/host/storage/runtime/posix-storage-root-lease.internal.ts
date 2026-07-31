/**
 * Lease-only facade for POSIX storage-root capability (Build 3.3B3A).
 *
 * Exposes acquireOpenedPosixStorageRootLease without register / prepare-close / markClosed /
 * abandon / retire. Intended importer: exact SQLite MemoryPort factory.
 * Not re-exported from barrels or package root.
 *
 * Combines trusted path resolution and child lease acquisition so the factory does not
 * resolve-then-lease separately. Not a process lock, exclusive lock, or transferable token.
 */
export {
  acquireOpenedPosixStorageRootLease,
  type AcquiredPosixStorageRootLease,
} from './posix-storage-root-capability.internal.js';
