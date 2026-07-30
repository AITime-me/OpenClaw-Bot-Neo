import { registerOpenedPosixStorageRootCapability } from './posix-storage-root-capability.internal.js';

export const openPosixStorageRoot = (): void => {
  const capability = Object.freeze({ close: () => undefined });
  registerOpenedPosixStorageRootCapability(capability, '/var/lib/openclaw-neo');
};
