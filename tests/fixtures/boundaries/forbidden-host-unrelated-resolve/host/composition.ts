import { resolveOpenedPosixStorageRootCapability } from './storage/runtime/posix-storage-root-resolve.internal.js';

export const leak = (): unknown => resolveOpenedPosixStorageRootCapability;
