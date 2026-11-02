import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const txDepthMap = new WeakMap<DatabaseSync, number>();

/**
 * Atomic transaction wrapper for node:sqlite DatabaseSync (which lacks .transaction()).
 * Uses BEGIN IMMEDIATE on outer transaction and SAVEPOINT on nested transactions.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const depth = txDepthMap.get(db) ?? 0;
  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE');
    txDepthMap.set(db, 1);
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error if already rolled back
      }
      throw err;
    } finally {
      txDepthMap.set(db, 0);
    }
  } else {
    const spName = `sp_${depth}`;
    db.exec(`SAVEPOINT ${spName}`);
    txDepthMap.set(db, depth + 1);
    try {
      const result = fn();
      db.exec(`RELEASE SAVEPOINT ${spName}`);
      return result;
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
        db.exec(`RELEASE SAVEPOINT ${spName}`);
      } catch {
        // ignore
      }
      throw err;
    } finally {
      txDepthMap.set(db, depth);
    }
  }
}

export function openDatabase(customDbPath?: string): DatabaseSync {
  const resolvedPath =
    customDbPath ??
    process.env.GCCK_DB_PATH ??
    path.resolve(process.cwd(), 'data', 'gcck_mes.sqlite');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schemaSql);

  // Auto-migration for daily_schedule_rows overtime columns
  try {
    db.exec("ALTER TABLE daily_schedule_rows ADD COLUMN is_overtime INTEGER NOT NULL DEFAULT 0;");
  } catch {}
  try {
    db.exec("ALTER TABLE daily_schedule_rows ADD COLUMN overtime_hours REAL NOT NULL DEFAULT 0;");
  } catch {}

  return db;
}
