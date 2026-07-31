import { resolveOpenedPosixStorageRootCapability } from '../runtime/posix-storage-root-resolve.internal.js';

export const createSqliteMemoryPort = (openedRoot: unknown): unknown =>
  resolveOpenedPosixStorageRootCapability(openedRoot);
