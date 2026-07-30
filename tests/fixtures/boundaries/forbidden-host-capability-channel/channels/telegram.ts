import { resolveOpenedPosixStorageRootCapability } from '../host/storage/runtime/posix-storage-root-capability.internal.js';

export const leak = (): unknown => resolveOpenedPosixStorageRootCapability;
