import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Narrow ESM→CJS interop for better-sqlite3.
 * App-private. Only this module may import better-sqlite3.
 * Does not export the raw Database constructor or open connections.
 */

const require = createRequire(import.meta.url);

type BetterSqlite3Constructor = typeof BetterSqlite3;

const DatabaseCtor = require('better-sqlite3') as BetterSqlite3Constructor;

/** Opaque file-backed or memory database handle owned by the SQLite MemoryPort adapter. */
export type SqliteDatabase = BetterSqlite3.Database;

export type SqliteStatement = BetterSqlite3.Statement;

export type SqliteRunResult = BetterSqlite3.RunResult;

/**
 * Opens a SQLite database at an absolute filesystem path.
 * Caller supplies a trusted absolute path only — never a caller-controlled module name.
 */
export const openSqliteDatabaseFile = (absoluteDatabasePath: string): SqliteDatabase => {
  if (typeof absoluteDatabasePath !== 'string' || absoluteDatabasePath.length === 0)
    throw new TypeError('SQLite database path must be a non-empty string.');
  return new DatabaseCtor(absoluteDatabasePath, { fileMustExist: false });
};
