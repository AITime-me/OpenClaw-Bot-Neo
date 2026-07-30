import sqlite from 'better-sqlite3';
export const leak = (): unknown => sqlite;
