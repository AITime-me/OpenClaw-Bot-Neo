export const loadSqlite = async (): Promise<unknown> =>
  import('../storage/sqlite/create-sqlite-memory-port.js');
