import Database from 'better-sqlite3';
export const leak = (): unknown => Database;
