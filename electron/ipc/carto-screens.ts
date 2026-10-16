// electron/ipc/carto-screens.ts
//
// Canal IPC para el mapa de pantallas de Cartografía (tarea 1.4, mapear-pantallas-y-su-codigo).
// Expone `carto-screens:get` con validación estricta de autorización de repositorios.

import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { withRepoLock } from '../git/repo-queue';
import { authorizedRepoRoot, isContainedWithin } from './authorized-repos';
import { scanRepoFilePaths } from '../carto/repo-files';
import { graphFileDependencies } from '../carto/graph-engine';
import { buildScreenMap, type ScreenMapDeps } from '../carto/screen-map/build';
import type { ScreenMap } from '../../types/screen-map';
import { errMsg } from './shared';

export type Result<T> = { success: boolean; data?: T; error?: string };

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): Result<T> {
  return { success: false, error: errMsg(error) };
}

const MAX_READ_BYTES = 400 * 1024; // 400 KB

export async function handleCartoScreensGet(payload: unknown): Promise<Result<ScreenMap>> {
  try {
    const candidatePath = typeof payload === 'string'
      ? payload
      : (payload as { repoPath?: unknown })?.repoPath;

    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const deps: ScreenMapDeps = {
      async listFiles() {
        const scan = await scanRepoFilePaths(root);
        return { paths: scan.paths, truncated: scan.truncated };
      },
      async readFile(relPath: string) {
        try {
          const absPath = path.resolve(root, relPath);
          if (!isContainedWithin(root, absPath)) return null;
          const st = await fs.stat(absPath);
          if (st.size > MAX_READ_BYTES) return null;
          return await fs.readFile(absPath, 'utf8');
        } catch {
          return null;
        }
      },
      fileDependencies(relPath: string) {
        return graphFileDependencies(root, relPath);
      },
      async headSha() {
        try {
          return await withRepoLock(root, async () => {
            const git = simpleGit(root, { timeout: { block: 10_000 } });
            const sha = (await git.revparse(['HEAD'])).trim();
            return sha || null;
          });
        } catch {
          return null;
        }
      },
      now() {
        return new Date().toISOString();
      },
    };

    const screenMap = await buildScreenMap(root, deps);
    return ok(screenMap);
  } catch (error) {
    return fail(error);
  }
}

export function registerCartoScreensHandlers(): void {
  ipcMain.handle('carto-screens:get', async (_event, payload: unknown) => {
    return handleCartoScreensGet(payload);
  });
}
