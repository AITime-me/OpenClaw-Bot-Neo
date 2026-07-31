import { acquireOpenedPosixStorageRootLease } from '../runtime/posix-storage-root-lease.internal.js';

export const createSqliteMemoryPort = (openedRoot: unknown): unknown =>
  acquireOpenedPosixStorageRootLease(openedRoot);
