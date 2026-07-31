/**
 * Resolver-only facade for POSIX storage-root capability (Build 3.3B2).
 *
 * Exposes resolveOpenedPosixStorageRootCapability without register/retire/markClosed/abandon.
 * Intended importer: exact SQLite MemoryPort factory. Not re-exported from barrels or package root.
 */
export {
  resolveOpenedPosixStorageRootCapability,
  type ResolvedPosixStorageRootCapability,
} from './posix-storage-root-capability.internal.js';
