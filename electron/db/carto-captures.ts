// electron/db/carto-captures.ts
//
// Persistencia de capturas reales de pantallas y consentimientos de ejecución
// de proyectos para Cartografía (tarea 2.7, decisión 11).

import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './connection';

export interface CartoCapturesOptions {
  db?: DatabaseSync;
  userDataPath?: string;
  now?: () => string;
}

export interface ScreenCaptureRow {
  screenId: string;
  contentKey: string;
  image: Buffer;
  capturedAt: string;
}

export interface CaptureConsentRow {
  command: string;
  grantedAt: string;
}

type ScreenCaptureDbRow = {
  screen_id: string;
  content_key: string;
  image: Uint8Array | Buffer;
  captured_at: string;
};

type CaptureConsentDbRow = {
  command: string;
  granted_at: string;
};

function resolveDatabase(options: CartoCapturesOptions): DatabaseSync {
  return options.db ?? getDatabase(resolveUserDataPath(options));
}

function resolveUserDataPath(options: CartoCapturesOptions): string {
  if (options.userDataPath) return options.userDataPath;
  const electron = require('electron') as { app?: { getPath(name: 'userData'): string } };
  if (!electron.app) {
    throw new Error('Electron app is unavailable; pass a db/userDataPath in tests');
  }
  return electron.app.getPath('userData');
}

export function getScreenCaptures(
  repoPath: string,
  options: CartoCapturesOptions = {},
): ScreenCaptureRow[] {
  const db = resolveDatabase(options);
  const rows = db
    .prepare(
      `SELECT screen_id, content_key, image, captured_at
         FROM carto_screen_capture
        WHERE repo_path = ?`,
    )
    .all(repoPath) as ScreenCaptureDbRow[];

  return rows.map((r) => ({
    screenId: r.screen_id,
    contentKey: r.content_key,
    image: Buffer.isBuffer(r.image) ? r.image : Buffer.from(r.image),
    capturedAt: r.captured_at,
  }));
}

export function upsertScreenCapture(
  input: { repoPath: string; screenId: string; contentKey: string; image: Buffer },
  options: CartoCapturesOptions = {},
): void {
  const db = resolveDatabase(options);
  const capturedAt = options.now?.() ?? new Date().toISOString();

  db.prepare(
    `INSERT INTO carto_screen_capture (repo_path, screen_id, content_key, image, captured_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo_path, screen_id)
     DO UPDATE SET content_key = excluded.content_key,
                   image = excluded.image,
                   captured_at = excluded.captured_at`,
  ).run(input.repoPath, input.screenId, input.contentKey, input.image, capturedAt);
}

export function deleteScreenCapturesNotIn(
  repoPath: string,
  screenIds: string[],
  options: CartoCapturesOptions = {},
): void {
  const db = resolveDatabase(options);
  if (screenIds.length === 0) {
    db.prepare('DELETE FROM carto_screen_capture WHERE repo_path = ?').run(repoPath);
    return;
  }
  const placeholders = screenIds.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM carto_screen_capture WHERE repo_path = ? AND screen_id NOT IN (${placeholders})`,
  ).run(repoPath, ...screenIds);
}

export function getCaptureConsent(
  repoPath: string,
  options: CartoCapturesOptions = {},
): CaptureConsentRow | null {
  const db = resolveDatabase(options);
  const row = db
    .prepare('SELECT command, granted_at FROM carto_capture_consent WHERE repo_path = ?')
    .get(repoPath) as CaptureConsentDbRow | undefined;
  if (!row) return null;
  return {
    command: row.command,
    grantedAt: row.granted_at,
  };
}

export function setCaptureConsent(
  repoPath: string,
  command: string,
  options: CartoCapturesOptions = {},
): void {
  const db = resolveDatabase(options);
  const grantedAt = options.now?.() ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO carto_capture_consent (repo_path, command, granted_at)
     VALUES (?, ?, ?)
     ON CONFLICT(repo_path)
     DO UPDATE SET command = excluded.command,
                   granted_at = excluded.granted_at`,
  ).run(repoPath, command, grantedAt);
}

export function clearCaptureConsent(
  repoPath: string,
  options: CartoCapturesOptions = {},
): void {
  const db = resolveDatabase(options);
  db.prepare('DELETE FROM carto_capture_consent WHERE repo_path = ?').run(repoPath);
}
