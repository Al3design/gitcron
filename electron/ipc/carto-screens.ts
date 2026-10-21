// electron/ipc/carto-screens.ts
//
// Canal IPC para el mapa de pantallas de Cartografía (tarea 1.4, mapear-pantallas-y-su-codigo).
// Expone `carto-screens:get` con validación estricta de autorización de repositorios.

import { ipcMain } from 'electron';
import * as crypto from 'node:crypto';
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
import {
  MANUAL_PATH,
  clearDescription,
  clearLink,
  readManualData,
  serializeManualData,
  setDescription,
  setLink,
} from '../carto/screen-map/manual';
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
  manualHash: string;
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
    async statFile(relPath: string) {
      try {
        const absPath = path.resolve(root, relPath);
        if (!isContainedWithin(root, absPath)) return null;
        const st = await fs.stat(absPath);
        return { mtimeMs: st.mtimeMs };
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
    async readManual() {
      const res = await readManualData(async (rel) => {
        try {
          const absPath = path.resolve(root, rel);
          if (!isContainedWithin(root, absPath)) return null;
          return await fs.readFile(absPath, 'utf8');
        } catch {
          return null;
        }
      });
      return res.ok ? res.data : null;
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

    let manualHash = 'none';
    const manualContent = await deps.readFile(MANUAL_PATH);
    if (manualContent !== null) {
      manualHash = crypto.createHash('sha256').update(manualContent).digest('hex').slice(0, 12);
    }

    const cached = mapCache.get(root);
    if (
      cached &&
      cached.headSha === headSha &&
      cached.indexKey === indexKey &&
      cached.manualHash === manualHash
    ) {
      return ok(cached.map);
    }

    const screenMap = await injectedBuilder(root, deps);
    mapCache.set(root, { headSha, indexKey, manualHash, map: screenMap });
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

export type ManualOp =
  | { type: 'link'; screenId: string; path: string; action: 'add' | 'remove' }
  | { type: 'unlink'; screenId: string; path: string }
  | { type: 'describe'; screenId: string; text: string; name?: string }
  | { type: 'undescribe'; screenId: string };

function validateLinkPath(
  root: string,
  rawPath: unknown,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0 || rawPath.length > 500) {
    return { ok: false, error: 'path debe ser una cadena entre 1 y 500 caracteres' };
  }
  const normRel = rawPath.replace(/\\/g, '/');
  if (normRel.split('/').includes('..') || path.isAbsolute(normRel)) {
    return { ok: false, error: 'path no puede contener ".." ni ser una ruta absoluta' };
  }
  const absPath = path.resolve(root, normRel);
  if (!isContainedWithin(root, absPath)) {
    return { ok: false, error: 'La ruta debe quedar dentro del repositorio' };
  }
  return { ok: true, path: normRel };
}

function validateLinkOrUnlinkOp(
  root: string,
  o: Record<string, unknown>,
  screenId: string,
): { ok: true; op: ManualOp } | { ok: false; error: string } {
  const pathRes = validateLinkPath(root, o.path);
  if (!pathRes.ok) return pathRes;

  if (o.type === 'link') {
    if (o.action !== 'add' && o.action !== 'remove') {
      return { ok: false, error: 'action debe ser "add" o "remove"' };
    }
    return {
      ok: true,
      op: {
        type: 'link',
        screenId,
        path: pathRes.path,
        action: o.action,
      },
    };
  }

  return {
    ok: true,
    op: {
      type: 'unlink',
      screenId,
      path: pathRes.path,
    },
  };
}

function validateDescribeOp(
  o: Record<string, unknown>,
  screenId: string,
): { ok: true; op: ManualOp } | { ok: false; error: string } {
  if (typeof o.text !== 'string' || o.text.length === 0 || o.text.length > 2000) {
    return { ok: false, error: 'text debe tener entre 1 y 2000 caracteres' };
  }
  if ('name' in o && o.name !== undefined) {
    if (typeof o.name !== 'string' || o.name.length > 40) {
      return { ok: false, error: 'name no puede superar los 40 caracteres' };
    }
  }
  return {
    ok: true,
    op: {
      type: 'describe',
      screenId,
      text: o.text,
      name: typeof o.name === 'string' && o.name.trim().length > 0 ? o.name.trim() : undefined,
    },
  };
}

function validateManualOp(
  root: string,
  op: unknown,
): { ok: true; op: ManualOp } | { ok: false; error: string } {
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return { ok: false, error: 'Operación manual inválida' };
  }
  const o = op as Record<string, unknown>;

  if (typeof o.screenId !== 'string' || o.screenId.length === 0 || o.screenId.length > 200) {
    return { ok: false, error: 'screenId debe tener entre 1 y 200 caracteres' };
  }

  if (o.type === 'link' || o.type === 'unlink') {
    return validateLinkOrUnlinkOp(root, o, o.screenId);
  }

  if (o.type === 'describe') {
    return validateDescribeOp(o, o.screenId);
  }

  if (o.type === 'undescribe') {
    return {
      ok: true,
      op: {
        type: 'undescribe',
        screenId: o.screenId,
      },
    };
  }

  return { ok: false, error: `Tipo de operación desconocido "${String(o.type)}"` };
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function handleCartoScreensManual(
  payload: unknown,
  injectedDeps?: ScreenMapDeps,
  injectedBuilder: typeof buildScreenMap = buildScreenMap,
): Promise<Result<ScreenMap>> {
  try {
    if (!payload || typeof payload !== 'object') {
      return fail('Parámetros inválidos');
    }
    const { repoPath, op: rawOp } = payload as { repoPath?: unknown; op?: unknown };

    const root = authorizedRepoRoot(repoPath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const opValidation = validateManualOp(root, rawOp);
    if (!opValidation.ok) {
      return fail(opValidation.error);
    }
    const op = opValidation.op;

    const deps = injectedDeps ?? createScreenMapDeps(root);
    const absManualPath = path.resolve(root, MANUAL_PATH);
    // Un archivo que existe pero no se pudo leer (permisos, más de 400 KB) se tomaba como ausente
    // y se pisaba: lo escrito por una persona no se pierde (auditoría de carto-07).
    if ((await deps.readFile(MANUAL_PATH)) === null && (await pathExists(absManualPath))) {
      return fail('No se pudo leer .gitcron/pantallas.json; revisá sus permisos o su tamaño');
    }
    const readRes = await readManualData(deps.readFile);
    if (!readRes.ok) {
      return fail(`El archivo .gitcron/pantallas.json tiene un error: ${readRes.error}; arreglalo o borralo`);
    }

    const now = deps.now();
    let data = readRes.data;

    if (op.type === 'link') {
      data = setLink(data, op.screenId, op.path, op.action, now);
    } else if (op.type === 'unlink') {
      data = clearLink(data, op.screenId, op.path);
    } else if (op.type === 'describe') {
      data = setDescription(data, op.screenId, op.text, op.name, now);
    } else if (op.type === 'undescribe') {
      data = clearDescription(data, op.screenId);
    }

    const serialized = serializeManualData(data);

    if (serialized === null) {
      try {
        await fs.unlink(absManualPath);
      } catch (err) {
        // Solo «no existía» se ignora; cualquier otro error se avisa.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    } else {
      await fs.mkdir(path.dirname(absManualPath), { recursive: true });
      await fs.writeFile(absManualPath, serialized, 'utf8');
    }

    mapCache.delete(root);
    return handleCartoScreensGet({ repoPath: root }, injectedDeps, injectedBuilder);
  } catch (error) {
    return fail(error);
  }
}

async function handleCartoScreensFiles(payload: unknown): Promise<Result<string[]>> {
  try {
    const candidatePath = typeof payload === 'string'
      ? payload
      : (payload as { repoPath?: unknown })?.repoPath;

    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const scan = await scanRepoFilePaths(root);
    const sorted = scan.paths
      .map((p) => p.replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5000);

    return ok(sorted);
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
  ipcMain.handle('carto-screens:manual', async (_event, payload: unknown) => {
    return handleCartoScreensManual(payload);
  });
  ipcMain.handle('carto-screens:files', async (_event, payload: unknown) => {
    return handleCartoScreensFiles(payload);
  });
}

