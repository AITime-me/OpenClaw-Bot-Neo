import { registerOpenedPosixStorageRootCapability } from '../runtime/posix-storage-root-capability.internal.js';

export const createSqliteMemoryPort = (): unknown => registerOpenedPosixStorageRootCapability;
