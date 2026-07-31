/**
 * Lease-only facade for POSIX storage-root capability (Build 3.3B3A / B3B3B3).
 *
 * Exposes acquireOpenedPosixStorageRootLease without register / prepare-close / markClosed /
 * abandon / retire. Intended importers: exact SQLite MemoryPort factory and exact POSIX
 * process-lock factory. Not re-exported from barrels or package root.
 *
 * Combines trusted path resolution and child lease acquisition so factories do not
 * resolve-then-lease separately. Not itself a process lock, exclusive lock, or transferable token.
 */
export {
  acquireOpenedPosixStorageRootLease,
  type AcquiredPosixStorageRootLease,
} from './posix-storage-root-capability.internal.js';
