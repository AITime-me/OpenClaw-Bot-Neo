import { acquirePosixProcessLock } from '../host/storage/runtime/acquire-posix-process-lock.js';

export const leak = (): unknown => acquirePosixProcessLock;
