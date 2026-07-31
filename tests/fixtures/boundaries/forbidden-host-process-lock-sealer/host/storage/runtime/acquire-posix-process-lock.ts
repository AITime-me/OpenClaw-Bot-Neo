import { registerOpenedPosixStorageRootCapability } from './posix-storage-root-capability.internal.js';

export const acquirePosixProcessLock = (): unknown => registerOpenedPosixStorageRootCapability();
