import { acquireOpenedPosixStorageRootLease } from './posix-storage-root-lease.internal.js';

export const acquirePosixProcessLock = (openedRoot: unknown): unknown =>
  acquireOpenedPosixStorageRootLease(openedRoot);
