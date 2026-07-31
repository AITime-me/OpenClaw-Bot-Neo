import { acquireOpenedPosixStorageRootLease } from '../runtime/posix-storage-root-lease.internal.js';

export const openSqliteDatabaseFile = (): unknown => acquireOpenedPosixStorageRootLease;
