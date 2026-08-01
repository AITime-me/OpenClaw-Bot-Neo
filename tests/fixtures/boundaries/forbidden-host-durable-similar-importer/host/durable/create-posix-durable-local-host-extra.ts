export const loadRoot = async (): Promise<unknown> =>
  import('../storage/runtime/open-posix-storage-root.js');
