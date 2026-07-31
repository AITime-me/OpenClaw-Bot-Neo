import { acquireOpenedPosixStorageRootLease } from '../runtime/posix-storage-root-lease.internal.js';

export const leak = (): unknown => acquireOpenedPosixStorageRootLease;
