import type { SqliteDatabase } from '../better-sqlite3-driver.js';

export const isSqliteBusyOrLocked = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
};

export const isSqliteUniqueConstraint = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
};

export const runImmediate = <T>(db: SqliteDatabase, fn: () => T): T => {
  const tx = db.transaction(fn);
  return tx.immediate();
};

export const assertSafeIntegerValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
