import { acquirePosixProcessLock } from '../storage/runtime/acquire-posix-process-lock.js';

export const leak = (): unknown => acquirePosixProcessLock;
