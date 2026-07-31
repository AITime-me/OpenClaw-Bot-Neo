import { acquireOpenedPosixStorageRootLease } from '../storage/runtime/posix-storage-root-lease.internal.js';

export const leak = (): unknown => acquireOpenedPosixStorageRootLease;
