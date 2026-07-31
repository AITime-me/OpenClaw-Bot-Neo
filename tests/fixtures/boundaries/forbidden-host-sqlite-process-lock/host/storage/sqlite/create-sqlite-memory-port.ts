import { createNodePosixProcessLockDriver } from '../runtime/posix-process-lock-driver.js';

export const createSqliteMemoryPort = (): unknown => createNodePosixProcessLockDriver();
