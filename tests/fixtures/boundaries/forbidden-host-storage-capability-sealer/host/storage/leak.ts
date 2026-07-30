import {
  registerOpenedPosixStorageRootCapability,
  resolveOpenedPosixStorageRootCapability,
} from './runtime/posix-storage-root-capability.internal.js';

export const leakSealer = (): unknown => registerOpenedPosixStorageRootCapability;
export const leakResolver = (): unknown => resolveOpenedPosixStorageRootCapability;
