import { createNodePosixProcessLockDriver } from './posix-process-lock-driver.js';

export const leak = (): unknown => createNodePosixProcessLockDriver();
