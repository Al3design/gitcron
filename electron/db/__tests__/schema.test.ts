import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase, runMigrations } from '../connection';
import {
  BRANCH_DECISION_TABLE,
  LATEST_SCHEMA_VERSION,
  PREDICTION_RUN_TABLE,
  SPECULATIVE_BRANCH_TABLE,
  TEMPORAL_AGENT_INDEXES,
  PIPELINE_REPO_TABLE,
  PIPELINE_SNAPSHOT_TABLE,
  PIPELINE_EVENT_TABLE,
  PIPELINE_CURSOR_TABLE,
  PIPELINE_RUNTIME_SESSION_TABLE,
  AI_USE_RECORD_TABLE,
  ASSIST_CONVERSATION_TABLE,
  ASSIST_MESSAGE_TABLE,
  ASSIST_MESSAGE_REFERENCE_TABLE,
} from '../schema';

type SqliteNameRow = { name: string };
type PragmaIntRow = Record<string, number>;
type TableColumnRow = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
};

function withDb(test: (db: DatabaseSync) => void): void {
  const db = openTemporalAgentDatabase(':memory:');
  try {
    test(db);
  } finally {
    db.close();
  }
}

function pragmaNumber(db: DatabaseSync, pragma: string): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as PragmaIntRow;
  return Number(row[pragma]);
}

function tableColumns(db: DatabaseSync, table: string): TableColumnRow[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnRow[];
}

function sqliteNames(db: DatabaseSync, type: 'table' | 'index'): string[] {
  return (db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name')
    .all(type) as SqliteNameRow[])
    .map((row) => row.name);
}

function insertRun(db: DatabaseSync, id = randomUUID()): string {
  db.prepare(`
    INSERT INTO prediction_run (
      id, repo_path, device_id, provider, context_scope, web_trends, generated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'C:/work/repo',
    randomUUID(),
    'openrouter',
    'metadata',
    0,
    '2026-06-03T00:00:00.000Z',
    '2026-06-03T00:00:01.000Z',
  );
  return id;
}

function insertBranch(db: DatabaseSync, runId: string, id = randomUUID()): string {
  db.prepare(`
    INSERT INTO speculative_branch (
      id, run_id, source_id, message, description, rationale, type, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId,
    'branch-1',
    'Extract IPC layer into a typed contract module',
    'Introduce a shared contract for main/preload calls.',
    'Recent changes keep touching Electron IPC handlers.',
    'improvement',
    0.82,
  );
  return id;
}

describe('Temporal Agent SQLite schema', () => {
  it('sets user_version on a fresh bootstrap', () => {
    withDb((db) => {
      expect(pragmaNumber(db, 'user_version')).toBe(LATEST_SCHEMA_VERSION);
    });
  });

  it('creates the three history tables', () => {
    withDb((db) => {
      expect(sqliteNames(db, 'table')).toEqual(expect.arrayContaining([
        PREDICTION_RUN_TABLE,
        SPECULATIVE_BRANCH_TABLE,
        BRANCH_DECISION_TABLE,
      ]));
    });
  });

  it('creates the Pipeline evidence tables', () => {
    withDb((db) => {
      expect(sqliteNames(db, 'table')).toEqual(expect.arrayContaining([
        PIPELINE_REPO_TABLE,
        PIPELINE_SNAPSHOT_TABLE,
        PIPELINE_EVENT_TABLE,
        PIPELINE_RUNTIME_SESSION_TABLE,
      ]));
    });
  });

  // La tabla se creaba en la migracion 4 y la 6 la elimina: registraba el avance
  // de lectura de los JSONL del kit retirado y ya no tiene nada que registrar.
  it('drops the cursor table while keeping the rest of the Pipeline schema', () => {
    withDb((db) => {
      const tables = sqliteNames(db, 'table');
      expect(tables).not.toContain(PIPELINE_CURSOR_TABLE);
      expect(tables).toEqual(expect.arrayContaining([
        PIPELINE_REPO_TABLE,
        PIPELINE_SNAPSHOT_TABLE,
        PIPELINE_EVENT_TABLE,
        PIPELINE_RUNTIME_SESSION_TABLE,
      ]));
    });
  });

  it('creates the expected indexes', () => {
    withDb((db) => {
      expect(sqliteNames(db, 'index')).toEqual(expect.arrayContaining([...TEMPORAL_AGENT_INDEXES]));
    });
  });

  it('keeps the forward-looking analysis columns in the schema', () => {
    withDb((db) => {
      const runColumns = tableColumns(db, PREDICTION_RUN_TABLE).map((column) => column.name);
      expect(runColumns).toEqual(expect.arrayContaining([
        'device_id',
        'device_label',
        'app_version',
        'head_sha',
        'input_hash',
      ]));

      const branchColumns = tableColumns(db, SPECULATIVE_BRANCH_TABLE).map((column) => column.name);
      expect(branchColumns).toContain('description');

      const decisionColumns = tableColumns(db, BRANCH_DECISION_TABLE).map((column) => column.name);
      expect(decisionColumns).toContain('device_id');
    });
  });

  it('uses TEXT primary keys for all tables', () => {
    withDb((db) => {
      for (const table of [PREDICTION_RUN_TABLE, SPECULATIVE_BRANCH_TABLE, BRANCH_DECISION_TABLE]) {
        const idColumn = tableColumns(db, table).find((column) => column.name === 'id');
        expect(idColumn).toMatchObject({ type: 'TEXT', pk: 1 });
      }
    });
  });

  it('stores and reads back UUID string primary keys', () => {
    withDb((db) => {
      const id = insertRun(db);
      const row = db.prepare('SELECT id FROM prediction_run WHERE id = ?').get(id) as { id: string };
      expect(row.id).toBe(id);
    });
  });

  it('accepts a run to branch to decision chain using text foreign keys', () => {
    withDb((db) => {
      const runId = insertRun(db);
      const branchId = insertBranch(db, runId);
      const decisionId = randomUUID();

      db.prepare(`
        INSERT INTO branch_decision (
          id, branch_id, device_id, decision, materialized_ref, note, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        decisionId,
        branchId,
        randomUUID(),
        'materialized',
        'flight/conservative',
        'Worth trying.',
        '2026-06-03T00:00:02.000Z',
      );

      const row = db
        .prepare('SELECT branch_id FROM branch_decision WHERE id = ?')
        .get(decisionId) as { branch_id: string };
      expect(row.branch_id).toBe(branchId);
    });
  });

  it('enables foreign key enforcement for the connection', () => {
    withDb((db) => {
      expect(pragmaNumber(db, 'foreign_keys')).toBe(1);
      expect(() => {
        db.prepare(`
          INSERT INTO branch_decision (id, branch_id, device_id, decision, decided_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          randomUUID(),
          randomUUID(),
          'rejected',
          '2026-06-03T00:00:02.000Z',
        );
      }).toThrow();
    });
  });

  it('enforces STRICT table typing for confidence', () => {
    withDb((db) => {
      const runId = insertRun(db);
      expect(() => {
        db.prepare(`
          INSERT INTO speculative_branch (
            id, run_id, message, rationale, type, confidence
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          runId,
          'Add a dashboard',
          'Future analysis needs durable observations.',
          'trend',
          'not-a-number',
        );
      }).toThrow();
    });
  });

  it('is idempotent on the same connection', () => {
    withDb((db) => {
      runMigrations(db);
      expect(pragmaNumber(db, 'user_version')).toBe(LATEST_SCHEMA_VERSION);
      expect(sqliteNames(db, 'table').filter((name) => name === PREDICTION_RUN_TABLE)).toHaveLength(1);
    });
  });

  it('upgrades an existing Pipeline v4 database without recreating its evidence tables', () => {
    withDb((db) => {
      // Se reconstruye el estado de una base v4 real: sin la tabla de sesiones,
      // que llega en la 5, sin la tabla de historial de IA de la 7, sin las de assist de la 8, y **con** la de cursores, que la 6 elimina.
      db.exec(`DROP TABLE ${PIPELINE_RUNTIME_SESSION_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${AI_USE_RECORD_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_MESSAGE_REFERENCE_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_MESSAGE_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_CONVERSATION_TABLE}`);
      db.exec('DROP TABLE IF EXISTS carto_screen_capture');
      db.exec('DROP TABLE IF EXISTS carto_capture_consent');
      db.exec(`CREATE TABLE ${PIPELINE_CURSOR_TABLE} (
        repo_id TEXT NOT NULL, source_ref TEXT NOT NULL, offset INTEGER NOT NULL,
        pending TEXT NOT NULL, generation TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (repo_id, source_ref)
      ) STRICT;`);
      db.exec('PRAGMA user_version = 4');

      runMigrations(db);

      expect(pragmaNumber(db, 'user_version')).toBe(LATEST_SCHEMA_VERSION);
      const tables = sqliteNames(db, 'table');
      expect(tables).toContain(PIPELINE_RUNTIME_SESSION_TABLE);
      expect(tables).toContain(PIPELINE_SNAPSHOT_TABLE);
      // La migración elimina sólo la tabla de cursores: el resto sobrevive.
      expect(tables).not.toContain(PIPELINE_CURSOR_TABLE);
      expect(tables).toContain(PIPELINE_EVENT_TABLE);
      expect(tables).toContain(PIPELINE_REPO_TABLE);
    });
  });

  it('upgrades an existing database from version 6 to the latest preserving all data', () => {
    withDb((db) => {
      const runId = insertRun(db);
      const branchId = insertBranch(db, runId);
      db.exec(`DROP TABLE IF EXISTS ${AI_USE_RECORD_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_MESSAGE_REFERENCE_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_MESSAGE_TABLE}`);
      db.exec(`DROP TABLE IF EXISTS ${ASSIST_CONVERSATION_TABLE}`);
      db.exec('DROP TABLE IF EXISTS carto_screen_capture');
      db.exec('DROP TABLE IF EXISTS carto_capture_consent');
      db.exec('PRAGMA user_version = 6');

      runMigrations(db);

      expect(pragmaNumber(db, 'user_version')).toBe(LATEST_SCHEMA_VERSION);
      const tables = sqliteNames(db, 'table');
      expect(tables).toContain(AI_USE_RECORD_TABLE);
      expect(tables).toContain(ASSIST_CONVERSATION_TABLE);

      // Verify columns added in migration 9
      const columns = tableColumns(db, ASSIST_MESSAGE_TABLE).map((c) => c.name);
      expect(columns).toContain('prompt_tokens');
      expect(columns).toContain('cached_prompt_tokens');
      expect(columns).toContain('completion_tokens');
      expect(columns).toContain('reasoning_tokens');
      expect(columns).toContain('duration_ms');
      expect(columns).toContain('context_length');

      // Verify columns added in migration 10
      const convColumns = tableColumns(db, ASSIST_CONVERSATION_TABLE).map((c) => c.name);
      expect(convColumns).toContain('pinned_at');
      expect(convColumns).toContain('archived_at');

      // Verify data from v6 was preserved
      const runRow = db.prepare('SELECT id FROM prediction_run WHERE id = ?').get(runId) as { id: string };
      expect(runRow.id).toBe(runId);
      const branchRow = db.prepare('SELECT id FROM speculative_branch WHERE id = ?').get(branchId) as { id: string };
      expect(branchRow.id).toBe(branchId);
    });
  });
});
