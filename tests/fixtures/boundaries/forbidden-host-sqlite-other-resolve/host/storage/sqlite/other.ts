import { resolveOpenedPosixStorageRootCapability } from '../runtime/posix-storage-root-resolve.internal.js';

export const leak = (): unknown => resolveOpenedPosixStorageRootCapability;
