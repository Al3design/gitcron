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
import {
  getGraphStatus,
  graphFileDependencies,
} from '../carto/graph-engine';
import { buildScreenMap, type ScreenMapDeps } from '../carto/screen-map/build';
import { describeScreen, type DescribeScreenDeps } from '../ai/carto/describe-screen';
import { resolveForUse } from '../ai/use-resolution';
import { runTextUse } from '../ai/text-use';
import { getCartoExplanation, upsertCartoExplanation } from '../db/carto-cache';
import type { ScreenDescription, ScreenMap } from '../../types/screen-map';
import { errMsg } from './shared';

export type Result<T> = { success: boolean; data?: T; error?: string };

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): Result<T> {
  return { success: false, error: errMsg(error) };
}

const MAX_READ_BYTES = 400 * 1024; // 400 KB

interface CachedMapEntry {
  headSha: string | null;
  indexKey: string;
  map: ScreenMap;
}

const mapCache = new Map<string, CachedMapEntry>();

/** Exponé el mapa en caché de un repositorio; null si no está en memoria o no está autorizado. */
export function getCachedScreenMap(repoPath: string): ScreenMap | null {
  const root = authorizedRepoRoot(repoPath);
  if (!root) return null;
  return mapCache.get(root)?.map ?? null;
}

export function clearScreenMapCache(): void {
  mapCache.clear();
}

function resolveIndexKey(root: string): string {
  const status = getGraphStatus(root);
  if (status.state !== 'ready' || !status.stats) {
    return status.state;
  }
  return `${status.state}:${status.stats.files}:${status.stats.nodes}:${status.stats.edges}:${status.lastIndexedAt ?? ''}`;
}

export function createScreenMapDeps(root: string): ScreenMapDeps {
  return {
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
}

export async function handleCartoScreensGet(
  payload: unknown,
  injectedDeps?: ScreenMapDeps,
  injectedBuilder: typeof buildScreenMap = buildScreenMap,
): Promise<Result<ScreenMap>> {
  try {
    const candidatePath = typeof payload === 'string'
      ? payload
      : (payload as { repoPath?: unknown })?.repoPath;

    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const deps = injectedDeps ?? createScreenMapDeps(root);
    const headSha = await deps.headSha();
    const indexKey = resolveIndexKey(root);

    const cached = mapCache.get(root);
    if (cached && cached.headSha === headSha && cached.indexKey === indexKey) {
      return ok(cached.map);
    }

    const screenMap = await injectedBuilder(root, deps);
    mapCache.set(root, { headSha, indexKey, map: screenMap });
    return ok(screenMap);
  } catch (error) {
    return fail(error);
  }
}

export async function handleCartoScreensDescribe(
  payload: unknown,
): Promise<Result<{ status: 'ok'; description: ScreenDescription } | { status: 'unavailable'; message: string } | null>> {
  try {
    if (!payload || typeof payload !== 'object') {
      return fail('Parámetros inválidos');
    }
    const { repoPath, screenId, language, cacheOnly } = payload as {
      repoPath?: unknown;
      screenId?: unknown;
      language?: unknown;
      cacheOnly?: unknown;
    };

    if (typeof repoPath !== 'string' || typeof screenId !== 'string') {
      return fail('Parámetros inválidos');
    }

    const root = authorizedRepoRoot(repoPath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const lang: 'es' | 'en' | 'zh' =
      language === 'en' || language === 'zh' ? language : 'es';

    const mapDeps = createScreenMapDeps(root);
    const describeDeps: DescribeScreenDeps = {
      buildMap: () => buildScreenMap(root, mapDeps),
      readFile: mapDeps.readFile,
      resolveModel: (use, repo) => resolveForUse(use, repo),
      runText: runTextUse,
      cache: {
        get: getCartoExplanation,
        put: upsertCartoExplanation,
      },
      now: () => new Date().toISOString(),
    };

    const result = await describeScreen(
      {
        repoPath: root,
        screenId,
        language: lang,
        cacheOnly: Boolean(cacheOnly),
      },
      describeDeps,
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}

export function registerCartoScreensHandlers(): void {
  ipcMain.handle('carto-screens:get', async (_event, payload: unknown) => {
    return handleCartoScreensGet(payload);
  });
  ipcMain.handle('carto-screens:describe', async (_event, payload: unknown) => {
    return handleCartoScreensDescribe(payload);
  });
}

