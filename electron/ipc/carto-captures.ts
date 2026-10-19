// electron/ipc/carto-captures.ts
//
// Canal IPC para la captura real de pantallas y permisos de ejecución (decisión 11, tarea 2.7).

import { ipcMain, nativeImage } from 'electron';
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
import { readRecipes } from '../carto/screen-capture/recipes';
import { runViewCaptures, viewRunnerAvailable } from '../carto/screen-capture/view-runner';
import type {
  ScreenCapture,
  ScreenCaptureConsent,
  ScreenCaptureRunResult,
  ScreenCaptureSkipReason,
  ScreenCaptureState,
  ScreenEntry,
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

async function resolveCaptureCommand(
  root: string,
  deps = createStartCommandDeps(root),
): Promise<{
  command?: string;
  unsupported?: ScreenCaptureConsent & { status: 'unsupported' };
  startCmd: Awaited<ReturnType<typeof detectStartCommand>>;
  recipesResult: Awaited<ReturnType<typeof readRecipes>>;
  viewsRunner?: string;
  hasRecipes: boolean;
  runnerConfig?: string;
}> {
  const startCmd = await detectStartCommand(root, deps);
  const recipesResult = await readRecipes(deps.readFile);
  const hasRecipes = Boolean(recipesResult?.ok);
  const runnerConfig = recipesResult?.ok ? recipesResult.recipes.runner.config : undefined;

  let viewsRunner: string | undefined;
  if (recipesResult?.ok && viewRunnerAvailable(root, recipesResult.recipes)) {
    viewsRunner = `e2e (${recipesResult.recipes.runner.config})`;
  }

  let command: string | undefined;
  let unsupported: (ScreenCaptureConsent & { status: 'unsupported' }) | undefined;

  if ('unsupported' in startCmd) {
    if (viewsRunner) {
      command = `vistas con pruebas: ${viewsRunner}`;
    } else {
      unsupported = { status: 'unsupported', reason: startCmd.unsupported };
    }
  } else {
    command = viewsRunner
      ? `${startCmd.display} · vistas con pruebas: ${viewsRunner}`
      : startCmd.display;
  }

  return {
    command,
    unsupported,
    startCmd,
    recipesResult,
    viewsRunner,
    hasRecipes,
    runnerConfig,
  };
}

export async function resolveCaptureState(
  root: string,
  options: CartoCapturesOptions = {},
  injectedDeps?: ScreenMapDeps,
): Promise<ScreenCaptureState> {
  const cmdInfo = await resolveCaptureCommand(root);
  const savedConsent = getCaptureConsent(root, options);

  let consent: ScreenCaptureConsent;
  if (cmdInfo.unsupported || !cmdInfo.command) {
    consent = cmdInfo.unsupported ?? { status: 'unsupported', reason: 'no-start-command' };
  } else if (savedConsent && savedConsent.command === cmdInfo.command) {
    consent = {
      status: 'granted',
      command: savedConsent.command,
      grantedAt: savedConsent.grantedAt,
    };
  } else {
    consent = {
      status: 'needs-consent',
      command: cmdInfo.command,
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
    viewsRunner: cmdInfo.viewsRunner,
    hasRecipes: cmdInfo.hasRecipes,
    runnerConfig: cmdInfo.runnerConfig,
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

    const cmdInfo = await resolveCaptureCommand(root);
    if (cmdInfo.unsupported || cmdInfo.command !== command) {
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
  injectedViewRunner: typeof runViewCaptures = runViewCaptures,
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

    const cmdInfo = await resolveCaptureCommand(root);
    const savedConsent = getCaptureConsent(root, options);
    if (cmdInfo.unsupported || !cmdInfo.command || !savedConsent || savedConsent.command !== cmdInfo.command) {
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
        const storedCaptures = getScreenCaptures(root, options);
        const storedMap = new Map(storedCaptures.map((c) => [c.screenId, { contentKey: c.contentKey }]));

        // Contar candidatos de rutas
        let routeCandidatesCount = 0;
        for (const screen of map.screens) {
          if (screen.kind === 'route' && !screen.locator.includes('[')) {
            const key = await screenContentKey(screen, statFn);
            if (storedMap.get(screen.id)?.contentKey !== key) {
              routeCandidatesCount++;
            }
          }
        }

        // 1. Recetas y vistas
        const recipesResult = cmdInfo.recipesResult;
        const recipes = recipesResult?.ok ? recipesResult.recipes : null;
        const runnerAvailable = recipes ? viewRunnerAvailable(root, recipes) : false;

        const viewCandidates: { screen: ScreenEntry; contentKey: string }[] = [];
        const skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[] = [];

        for (const screen of map.screens) {
          if (screen.kind === 'view') {
            const hasRecipe = Boolean(recipes && recipes.screens[screen.id]);
            if (!recipes || !hasRecipe) {
              skippedViews.push({ screenId: screen.id, reason: 'no-recipe' });
            } else if (!runnerAvailable) {
              skippedViews.push({ screenId: screen.id, reason: 'runner-missing' });
            } else {
              const key = await screenContentKey(screen, statFn);
              if (storedMap.get(screen.id)?.contentKey === key) {
                // Ya al día
                continue;
              }
              viewCandidates.push({ screen, contentKey: key });
            }
          }
        }

        const totalToCapture = routeCandidatesCount + viewCandidates.length;

        const deps: CaptureRunDeps = {
          startServer: async () => {
            if ('unsupported' in cmdInfo.startCmd) {
              throw new Error('Comando de arranque no disponible');
            }
            const running = await findRunningServer(cmdInfo.startCmd.knownPorts ?? []);
            if (running) return running;
            const server = await startDevServer(root, cmdInfo.startCmd, { signal: controller.signal });
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

        const routeResult = await injectedRunner(map, deps, {
          signal: controller.signal,
          onProgress(done, _total) {
            if (event?.sender && !event.sender.isDestroyed()) {
              event.sender.send('carto-captures:progress', {
                repoPath: root,
                done,
                total: totalToCapture,
                phase: 'routes',
              });
            }
          },
        });

        let totalCaptured = routeResult.captured;
        const skipped: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[] =
          routeResult.skipped.filter((s) => s.reason !== 'view');
        skipped.push(...skippedViews);

        // Vistas
        let viewError: string | undefined;
        if (viewCandidates.length > 0 && !controller.signal.aborted) {
          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('carto-captures:progress', {
              repoPath: root,
              done: totalCaptured,
              total: totalToCapture,
              phase: 'views',
            });
          }

          const screensForRunner = viewCandidates.map((c) => ({ id: c.screen.id, name: c.screen.name }));
          const viewResult = await injectedViewRunner(root, recipes!, screensForRunner, {
            signal: controller.signal,
          });

          viewError = viewResult.error;

          for (const candidate of viewCandidates) {
            const png = viewResult.images.get(candidate.screen.id);
            if (png) {
              const jpeg = nativeImage.createFromBuffer(png).resize({ width: 960 }).toJPEG(75);
              upsertScreenCapture(
                { repoPath: root, screenId: candidate.screen.id, contentKey: candidate.contentKey, image: jpeg },
                options,
              );
              totalCaptured++;
            }
          }

          for (const failItem of viewResult.failed) {
            skipped.push({
              screenId: failItem.screenId,
              reason: 'recipe-failed',
              detail: failItem.detail,
            });
          }

          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('carto-captures:progress', {
              repoPath: root,
              done: totalToCapture,
              total: totalToCapture,
              phase: 'views',
            });
          }
        }

        const currentScreenIds = map.screens.map((s) => s.id);
        deleteScreenCapturesNotIn(root, currentScreenIds, options);

        let finalError = routeResult.error;
        if (recipesResult && !recipesResult.ok) {
          finalError = recipesResult.error;
        } else if (!finalError && viewError && totalCaptured === 0) {
          finalError = viewError;
        }

        return ok({
          captured: totalCaptured,
          skipped,
          cancelled: routeResult.cancelled || controller.signal.aborted,
          error: finalError,
        });
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
