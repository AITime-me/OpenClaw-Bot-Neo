import { resolveOpenedPosixStorageRootCapability } from './posix-storage-root-capability.internal.js';

export const leak = (): unknown => resolveOpenedPosixStorageRootCapability;
