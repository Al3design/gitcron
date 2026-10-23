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
import { readRecipes, type CaptureRecipes } from '../carto/screen-capture/recipes';
import { runViewCaptures, viewRunnerAvailable } from '../carto/screen-capture/view-runner';
import type {
  CaptureItem,
  CaptureItemState,
  CaptureProgressEvent,
  ScreenCapture,
  ScreenCaptureConsent,
  ScreenCaptureRunResult,
  ScreenCaptureSkipReason,
  ScreenCaptureState,
  ScreenEntry,
  ScreenMap,
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

/** El motivo en palabras de una vista que no se captura, para el detalle de la franja. */
/** Lo que dice una pantalla que no llegó a capturarse porque se tocó Detener. */
const STOPPED_DETAIL = 'detenida antes de llegar';

function skippedViewDetail(reason: ScreenCaptureSkipReason): string {
  // En palabras de todos los días (Alejandro, carto-05e: «sin receta en .gitcron/capturas.json»
  // no decía qué pasaba ni qué hacer).
  return reason === 'runner-missing'
    ? 'el proyecto no tiene pruebas de pantalla para llegar hasta acá'
    : 'GitCron todavía no sabe cómo llegar a esta pantalla (falta su receta)';
}

/** El nombre que se ve en el cuadro: el sugerido si lo hay. */
function screenDisplayName(screen: ScreenEntry): string {
  return screen.description?.suggestedName || screen.name;
}

function createStartCommandDeps(root: string) {
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

function createStatFn(root: string) {
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

async function resolveCaptureState(
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

async function handleCartoCapturesRevoke(
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

interface CapturePlan {
  routeCandidates: ScreenEntry[];
  viewCandidates: { screen: ScreenEntry; contentKey: string }[];
  skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[];
  planItems: CaptureItem[];
}

async function findRouteCandidates(
  screens: ScreenEntry[],
  statFn: (relPath: string) => Promise<{ mtimeMs: number; size: number } | null>,
  storedMap: Map<string, { contentKey: string }>,
): Promise<ScreenEntry[]> {
  const routeCandidates: ScreenEntry[] = [];
  for (const screen of screens) {
    if (screen.kind === 'route' && !screen.locator.includes('[')) {
      const key = await screenContentKey(screen, statFn);
      if (storedMap.get(screen.id)?.contentKey !== key) {
        routeCandidates.push(screen);
      }
    }
  }
  return routeCandidates;
}

async function findViewCandidates(
  screens: ScreenEntry[],
  statFn: (relPath: string) => Promise<{ mtimeMs: number; size: number } | null>,
  storedMap: Map<string, { contentKey: string }>,
  recipes: CaptureRecipes | null,
  runnerAvailable: boolean,
): Promise<{
  viewCandidates: { screen: ScreenEntry; contentKey: string }[];
  skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[];
}> {
  const viewCandidates: { screen: ScreenEntry; contentKey: string }[] = [];
  const skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[] = [];

  for (const screen of screens) {
    if (screen.kind !== 'view') continue;
    const hasRecipe = Boolean(recipes && recipes.screens[screen.id]);
    if (!recipes || !hasRecipe) {
      skippedViews.push({ screenId: screen.id, reason: 'no-recipe' });
    } else if (!runnerAvailable) {
      skippedViews.push({ screenId: screen.id, reason: 'runner-missing' });
    } else {
      const key = await screenContentKey(screen, statFn);
      if (storedMap.get(screen.id)?.contentKey !== key) {
        viewCandidates.push({ screen, contentKey: key });
      }
    }
  }
  return { viewCandidates, skippedViews };
}

function assemblePlanItems(
  routeCandidates: ScreenEntry[],
  viewCandidates: { screen: ScreenEntry; contentKey: string }[],
  skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[],
  screenById: Map<string, ScreenEntry>,
): CaptureItem[] {
  return [
    ...routeCandidates.map((screen): CaptureItem => ({
      screenId: screen.id,
      name: screenDisplayName(screen),
      via: 'route',
      state: 'pending',
    })),
    ...viewCandidates.map(({ screen }): CaptureItem => ({
      screenId: screen.id,
      name: screenDisplayName(screen),
      via: 'view',
      state: 'pending',
    })),
    ...skippedViews.flatMap((skippedView): CaptureItem[] => {
      const screen = screenById.get(skippedView.screenId);
      if (!screen) return [];
      return [{
        screenId: screen.id,
        name: screenDisplayName(screen),
        via: 'view',
        state: 'skipped',
        detail: skippedViewDetail(skippedView.reason),
      }];
    }),
  ];
}

async function buildCapturePlan(
  map: ScreenMap,
  statFn: (relPath: string) => Promise<{ mtimeMs: number; size: number } | null>,
  storedMap: Map<string, { contentKey: string }>,
  cmdInfo: Awaited<ReturnType<typeof resolveCaptureCommand>>,
  root: string,
): Promise<CapturePlan> {
  const routeCandidates = await findRouteCandidates(map.screens, statFn, storedMap);

  const recipesResult = cmdInfo.recipesResult;
  const recipes = recipesResult?.ok ? recipesResult.recipes : null;
  const runnerAvailable = recipes ? viewRunnerAvailable(root, recipes) : false;

  const { viewCandidates, skippedViews } = await findViewCandidates(
    map.screens,
    statFn,
    storedMap,
    recipes,
    runnerAvailable,
  );

  const screenById = new Map<string, ScreenEntry>(map.screens.map((s: ScreenEntry) => [s.id, s]));
  const planItems = assemblePlanItems(routeCandidates, viewCandidates, skippedViews, screenById);

  return { routeCandidates, viewCandidates, skippedViews, planItems };
}

async function executeRouteCaptures(
  map: ScreenMap,
  root: string,
  cmdInfo: Awaited<ReturnType<typeof resolveCaptureCommand>>,
  controller: AbortController,
  statFn: (relPath: string) => Promise<{ mtimeMs: number; size: number } | null>,
  force: boolean,
  options: CartoCapturesOptions | undefined,
  routeCandidates: ScreenEntry[],
  itemStates: Map<string, CaptureItemState>,
  sendItem: (screenId: string, state: CaptureItemState, detail?: string) => void,
  runner: typeof runScreenCaptures,
): Promise<ScreenCaptureRunResult> {
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
      const captures = force ? [] : getScreenCaptures(root, options);
      return new Map(captures.map((c) => [c.screenId, { contentKey: c.contentKey }]));
    },
    save: async (screenId, contentKey, image) => {
      upsertScreenCapture({ repoPath: root, screenId, contentKey, image }, options);
    },
  };

  const routeResult = await runner(map, deps, {
    signal: controller.signal,
    onScreen(screenId, state, detail) {
      sendItem(screenId, state, detail);
    },
  });

  if (routeResult.error) {
    for (const screen of routeCandidates) {
      if (itemStates.get(screen.id) === 'pending') {
        sendItem(screen.id, 'failed', routeResult.error);
      }
    }
  }

  return routeResult;
}

interface ViewExecutionResult {
  captured: number;
  viewError?: string;
  skipped: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[];
}

async function executeViewCaptures(
  root: string,
  viewCandidates: { screen: ScreenEntry; contentKey: string }[],
  recipes: CaptureRecipes,
  controller: AbortController,
  options: CartoCapturesOptions | undefined,
  itemStates: Map<string, CaptureItemState>,
  sendItem: (screenId: string, state: CaptureItemState, detail?: string) => void,
  viewRunner: typeof runViewCaptures,
): Promise<ViewExecutionResult> {
  if (viewCandidates.length === 0 || controller.signal.aborted) {
    return { captured: 0, skipped: [] };
  }

  const candidateById = new Map(viewCandidates.map((c) => [c.screen.id, c]));
  const savedViews = new Set<string>();
  let captured = 0;
  const skipped: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[] = [];

  const saveViewImage = (screenId: string, png: Buffer) => {
    const candidate = candidateById.get(screenId);
    if (!candidate || savedViews.has(screenId)) return;
    const jpeg = nativeImage.createFromBuffer(png).resize({ width: 960 }).toJPEG(75);
    upsertScreenCapture(
      { repoPath: root, screenId, contentKey: candidate.contentKey, image: jpeg },
      options,
    );
    savedViews.add(screenId);
    captured++;
  };

  const screensForRunner = viewCandidates.map((c) => ({ id: c.screen.id, name: c.screen.name }));
  const viewResult = await viewRunner(root, recipes, screensForRunner, {
    signal: controller.signal,
    onEvent(viewEvent) {
      if (!candidateById.has(viewEvent.screenId)) return;
      if (viewEvent.image) saveViewImage(viewEvent.screenId, viewEvent.image);
      sendItem(viewEvent.screenId, viewEvent.state, viewEvent.detail);
    },
  });

  for (const candidate of viewCandidates) {
    const png = viewResult.images.get(candidate.screen.id);
    if (png && !savedViews.has(candidate.screen.id)) {
      saveViewImage(candidate.screen.id, png);
      sendItem(candidate.screen.id, 'done');
    }
  }

  for (const failItem of viewResult.failed) {
    if (controller.signal.aborted && itemStates.get(failItem.screenId) !== 'failed') continue;
    skipped.push({
      screenId: failItem.screenId,
      reason: 'recipe-failed',
      detail: failItem.detail,
    });
    if (itemStates.get(failItem.screenId) !== 'failed') {
      sendItem(failItem.screenId, 'failed', failItem.detail);
    }
  }

  return { captured, viewError: viewResult.error, skipped };
}

function buildFinalCaptureResult(
  routeResult: ScreenCaptureRunResult,
  viewRes: ViewExecutionResult,
  skippedViews: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[],
  recipesResult: Awaited<ReturnType<typeof resolveCaptureCommand>>['recipesResult'],
  aborted: boolean,
): ScreenCaptureRunResult {
  const totalCaptured = routeResult.captured + viewRes.captured;
  const skipped: { screenId: string; reason: ScreenCaptureSkipReason; detail?: string }[] =
    routeResult.skipped.filter((s) => s.reason !== 'view');
  skipped.push(...skippedViews);
  skipped.push(...viewRes.skipped);

  let finalError = routeResult.error;
  if (recipesResult && !recipesResult.ok) {
    finalError = recipesResult.error;
  } else if (!finalError && viewRes.viewError && totalCaptured === 0) {
    finalError = viewRes.viewError;
  }

  return {
    captured: totalCaptured,
    skipped,
    cancelled: routeResult.cancelled || aborted,
    error: finalError,
  };
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
    const force = typeof payload === 'object' && payload !== null && (payload as { force?: unknown }).force === true;
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

    // El avance va por un solo canal: plan, un item por cambio de estado y finished (decisión 14).
    const sendProgress = (progress: CaptureProgressEvent) => {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('carto-captures:progress', progress);
      }
    };
    const itemStates = new Map<string, CaptureItemState>();
    const sendItem = (screenId: string, state: CaptureItemState, detail?: string) => {
      itemStates.set(screenId, state);
      sendProgress({ repoPath: root, kind: 'item', screenId, state, ...(detail ? { detail } : {}) });
    };

    const runPromise = (async (): Promise<Result<ScreenCaptureRunResult>> => {
      try {
        const map =
          getCachedScreenMap(root) ??
          (await buildScreenMap(root, createScreenMapDeps(root)));
        const statFn = createStatFn(root);
        const storedCaptures = force ? [] : getScreenCaptures(root, options);
        const storedMap = new Map(storedCaptures.map((c) => [c.screenId, { contentKey: c.contentKey }]));

        const plan = await buildCapturePlan(map, statFn, storedMap, cmdInfo, root);
        for (const item of plan.planItems) itemStates.set(item.screenId, item.state);
        sendProgress({ repoPath: root, kind: 'plan', items: plan.planItems });

        const routeResult = await executeRouteCaptures(
          map,
          root,
          cmdInfo,
          controller,
          statFn,
          force,
          options,
          plan.routeCandidates,
          itemStates,
          sendItem,
          injectedRunner,
        );

        const recipes = cmdInfo.recipesResult?.ok ? cmdInfo.recipesResult.recipes : null;
        const viewRes = recipes
          ? await executeViewCaptures(
              root,
              plan.viewCandidates,
              recipes,
              controller,
              options,
              itemStates,
              sendItem,
              injectedViewRunner,
            )
          : { captured: 0, skipped: [] };

        const currentScreenIds = map.screens.map((s) => s.id);
        deleteScreenCapturesNotIn(root, currentScreenIds, options);

        const finalResult = buildFinalCaptureResult(
          routeResult,
          viewRes,
          plan.skippedViews,
          cmdInfo.recipesResult,
          controller.signal.aborted,
        );

        return ok(finalResult);
      } catch (err) {
        return fail(err);
      } finally {
        if (controller.signal.aborted) {
          for (const [screenId, state] of itemStates) {
            if (state === 'pending' || state === 'running') sendItem(screenId, 'stopped', STOPPED_DETAIL);
          }
        }
        sendProgress({ repoPath: root, kind: 'finished' });
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

function handleCartoCapturesCancel(payload: unknown): Result<boolean> {
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
