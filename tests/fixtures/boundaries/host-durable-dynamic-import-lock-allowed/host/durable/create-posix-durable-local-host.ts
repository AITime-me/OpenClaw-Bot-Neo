export const loadLock = async (): Promise<unknown> =>
  import('../storage/runtime/acquire-posix-process-lock.js');
