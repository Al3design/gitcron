// electron/ipc/carto-captures.ts
//
// Canal IPC para la captura real de pantallas y permisos de ejecución (decisión 11, tarea 2.7).

import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { authorizedRepoRoot, isContainedWithin } from './authorized-repos';
import { errMsg } from './shared';
import { getCachedScreenMap, createScreenMapDeps } from './carto-screens';
import { buildScreenMap, type ScreenMapDeps } from '../carto/screen-map/build';
import {
  getCaptureConsent,
  setCaptureConsent,
  clearCaptureConsent,
  getScreenCaptures,
  upsertScreenCapture,
  deleteScreenCapturesNotIn,
  type CartoCapturesOptions,
} from '../db/carto-captures';
import { detectStartCommand } from '../carto/screen-capture/start-command';
import { findRunningServer, startDevServer, type DevServerHandle } from '../carto/screen-capture/dev-server';
import { captureUrl } from '../carto/screen-capture/capture-page';
import { screenContentKey } from '../carto/screen-capture/content-key';
import { runScreenCaptures, type CaptureRunDeps } from '../carto/screen-capture/run';
import type {
  ScreenCapture,
  ScreenCaptureConsent,
  ScreenCaptureRunResult,
  ScreenCaptureState,
} from '../../types/screen-map';

export type Result<T> = { success: boolean; data?: T; error?: string };

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): Result<T> {
  return { success: false, error: errMsg(error) };
}

const activeRuns = new Set<string>();
const activeControllers = new Map<string, AbortController>();
const activePromises = new Map<string, Promise<Result<ScreenCaptureRunResult>>>();
// El servidor de cada corrida, para detenerlo enseguida al cancelar o al cerrar GitCron sin
// esperar a que termine la captura en curso (hasta 30 s).
const activeServers = new Map<string, DevServerHandle>();

export function createStartCommandDeps(root: string) {
  return {
    async readFile(rel: string) {
      try {
        const abs = path.resolve(root, rel);
        if (!isContainedWithin(root, abs)) return null;
        return await fs.readFile(abs, 'utf8');
      } catch {
        return null;
      }
    },
    async exists(rel: string) {
      try {
        const abs = path.resolve(root, rel);
        if (!isContainedWithin(root, abs)) return false;
        await fs.access(abs);
        return true;
      } catch {
        if (process.platform === 'win32') {
          try {
            const absCmd = path.resolve(root, `${rel}.cmd`);
            if (isContainedWithin(root, absCmd)) {
              await fs.access(absCmd);
              return true;
            }
          } catch {
            // Tampoco está el acceso `.cmd`: no existe.
          }
        }
        return false;
      }
    },
  };
}

export function createStatFn(root: string) {
  return async (rel: string) => {
    try {
      const abs = path.resolve(root, rel);
      if (!isContainedWithin(root, abs)) return null;
      const st = await fs.stat(abs);
      return { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  };
}

export async function resolveCaptureState(
  root: string,
  options: CartoCapturesOptions = {},
  injectedDeps?: ScreenMapDeps,
): Promise<ScreenCaptureState> {
  const startCmd = await detectStartCommand(root, createStartCommandDeps(root));
  const savedConsent = getCaptureConsent(root, options);

  let consent: ScreenCaptureConsent;
  if ('unsupported' in startCmd) {
    consent = { status: 'unsupported', reason: startCmd.unsupported };
  } else if (savedConsent && savedConsent.command === startCmd.display) {
    consent = {
      status: 'granted',
      command: savedConsent.command,
      grantedAt: savedConsent.grantedAt,
    };
  } else {
    consent = {
      status: 'needs-consent',
      command: startCmd.display,
    };
  }

  const map =
    getCachedScreenMap(root) ??
    (await buildScreenMap(root, injectedDeps ?? createScreenMapDeps(root)));
  const savedCaptures = getScreenCaptures(root, options);
  const screenMapById = new Map(map.screens.map((s) => [s.id, s]));

  const captures: Record<string, ScreenCapture> = {};
  const statFn = createStatFn(root);

  for (const saved of savedCaptures) {
    const screen = screenMapById.get(saved.screenId);
    if (!screen) continue;

    const currentKey = await screenContentKey(screen, statFn);
    const stale = saved.contentKey !== currentKey;
    const dataUrl = `data:image/jpeg;base64,${saved.image.toString('base64')}`;

    captures[saved.screenId] = {
      screenId: saved.screenId,
      dataUrl,
      capturedAt: saved.capturedAt,
      stale,
    };
  }

  return {
    consent,
    captures,
    running: activeRuns.has(root),
  };
}

export async function handleCartoCapturesGet(
  payload: unknown,
  options: CartoCapturesOptions = {},
): Promise<Result<ScreenCaptureState>> {
  try {
    const candidatePath =
      typeof payload === 'string' ? payload : (payload as { repoPath?: unknown })?.repoPath;
    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const state = await resolveCaptureState(root, options);
    return ok(state);
  } catch (error) {
    return fail(error);
  }
}

export async function handleCartoCapturesConsent(
  payload: unknown,
  options: CartoCapturesOptions = {},
): Promise<Result<ScreenCaptureState>> {
  try {
    const { repoPath, command } = (payload ?? {}) as { repoPath?: unknown; command?: unknown };
    if (typeof repoPath !== 'string' || typeof command !== 'string') {
      return fail('Parámetros inválidos');
    }
    const root = authorizedRepoRoot(repoPath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const startCmd = await detectStartCommand(root, createStartCommandDeps(root));
    if ('unsupported' in startCmd || startCmd.display !== command) {
      return fail('La orden cambió; volvé a revisarla');
    }

    setCaptureConsent(root, command, options);
    const state = await resolveCaptureState(root, options);
    return ok(state);
  } catch (error) {
    return fail(error);
  }
}

export async function handleCartoCapturesRevoke(
  payload: unknown,
  options: CartoCapturesOptions = {},
): Promise<Result<ScreenCaptureState>> {
  try {
    const candidatePath =
      typeof payload === 'string' ? payload : (payload as { repoPath?: unknown })?.repoPath;
    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    clearCaptureConsent(root, options);
    const state = await resolveCaptureState(root, options);
    return ok(state);
  } catch (error) {
    return fail(error);
  }
}

export async function handleCartoCapturesRun(
  payload: unknown,
  event?: Electron.IpcMainInvokeEvent,
  options: CartoCapturesOptions = {},
  injectedRunner: typeof runScreenCaptures = runScreenCaptures,
): Promise<Result<ScreenCaptureRunResult>> {
  try {
    const candidatePath =
      typeof payload === 'string' ? payload : (payload as { repoPath?: unknown })?.repoPath;
    const root = authorizedRepoRoot(candidatePath);
    if (!root) {
      return fail('Repositorio no autorizado');
    }

    const existingPromise = activePromises.get(root);
    if (existingPromise) {
      return existingPromise;
    }

    const startCmd = await detectStartCommand(root, createStartCommandDeps(root));
    const savedConsent = getCaptureConsent(root, options);
    if ('unsupported' in startCmd || !savedConsent || savedConsent.command !== startCmd.display) {
      return fail('No hay permiso vigente');
    }

    const controller = new AbortController();
    activeControllers.set(root, controller);
    activeRuns.add(root);

    const runPromise = (async (): Promise<Result<ScreenCaptureRunResult>> => {
      try {
        const map =
          getCachedScreenMap(root) ??
          (await buildScreenMap(root, createScreenMapDeps(root)));
        const statFn = createStatFn(root);

        const deps: CaptureRunDeps = {
          startServer: async () => {
            const running = await findRunningServer(startCmd.knownPorts ?? []);
            if (running) return running;
            const server = await startDevServer(root, startCmd, { signal: controller.signal });
            activeServers.set(root, server);
            return server;
          },
          capture: (url, allowedOrigin) => captureUrl(url, { allowedOrigin }),
          contentKey: (screen) => screenContentKey(screen, statFn),
          stored: async () => {
            const captures = getScreenCaptures(root, options);
            return new Map(captures.map((c) => [c.screenId, { contentKey: c.contentKey }]));
          },
          save: async (screenId, contentKey, image) => {
            upsertScreenCapture({ repoPath: root, screenId, contentKey, image }, options);
          },
        };

        const result = await injectedRunner(map, deps, {
          signal: controller.signal,
          onProgress(done, total) {
            if (event?.sender && !event.sender.isDestroyed()) {
              event.sender.send('carto-captures:progress', { repoPath: root, done, total });
            }
          },
        });

        const currentScreenIds = map.screens.map((s) => s.id);
        deleteScreenCapturesNotIn(root, currentScreenIds, options);

        return ok(result);
      } catch (err) {
        return fail(err);
      } finally {
        activeServers.get(root)?.stop();
        activeServers.delete(root);
        activeRuns.delete(root);
        activeControllers.delete(root);
        activePromises.delete(root);
      }
    })();

    activePromises.set(root, runPromise);
    return await runPromise;
  } catch (error) {
    return fail(error);
  }
}

export function handleCartoCapturesCancel(payload: unknown): Result<boolean> {
  const candidatePath =
    typeof payload === 'string' ? payload : (payload as { repoPath?: unknown })?.repoPath;
  const root = authorizedRepoRoot(candidatePath);
  if (!root) {
    return fail('Repositorio no autorizado');
  }
  const controller = activeControllers.get(root);
  if (controller) {
    controller.abort();
  }
  activeServers.get(root)?.stop();
  return ok(true);
}

export function stopAllScreenCaptures(): void {
  for (const controller of activeControllers.values()) {
    controller.abort();
  }
  for (const server of activeServers.values()) {
    server.stop();
  }
  activeServers.clear();
  activeControllers.clear();
  activeRuns.clear();
  activePromises.clear();
}

export function registerCartoCapturesHandlers(): void {
  ipcMain.handle('carto-captures:get', async (_event, payload: unknown) => {
    return handleCartoCapturesGet(payload);
  });
  ipcMain.handle('carto-captures:consent', async (_event, payload: unknown) => {
    return handleCartoCapturesConsent(payload);
  });
  ipcMain.handle('carto-captures:revoke', async (_event, payload: unknown) => {
    return handleCartoCapturesRevoke(payload);
  });
  ipcMain.handle('carto-captures:run', async (event, payload: unknown) => {
    return handleCartoCapturesRun(payload, event);
  });
  ipcMain.handle('carto-captures:cancel', async (_event, payload: unknown) => {
    return handleCartoCapturesCancel(payload);
  });
}
