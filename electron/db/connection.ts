import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS } from './schema';

const TEMPORAL_AGENT_DB_FILENAME = 'temporal-agent-history.db';

let database: DatabaseSync | null = null;

function pragmaInt(db: DatabaseSync, pragma: string): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row?.[pragma];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function temporalAgentDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, TEMPORAL_AGENT_DB_FILENAME);
}

export function runMigrations(db: DatabaseSync): void {
  const currentVersion = pragmaInt(db, 'user_version');
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    db.exec('BEGIN');
    try {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openTemporalAgentDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL');
  runMigrations(db);
  return db;
}

export function bootstrapDatabase(dbPath: string): DatabaseSync {
  const db = openTemporalAgentDatabase(dbPath);
  if (database && database !== db) {
    database.close();
  }
  database = db;
  return db;
}

/** La base ya abierta (la que abre GitCron al arrancar, o una prueba), o `null`. */
export function currentDatabase(): DatabaseSync | null {
  return database;
}

export function getDatabase(userDataPath: string): DatabaseSync {
  if (!database) {
    database = openTemporalAgentDatabase(temporalAgentDatabasePath(userDataPath));
  }
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
