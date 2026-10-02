// electron/ipc/commit-message-ai.ts
//
// Puente IPC para redactar el asunto de un commit con un modelo local.
//
// Invariante heredada de Cartografía y que acá vale doble: **la IA nunca se
// dispara sola**. Estos handlers corren sólo cuando alguien aprieta el botón. Un
// refresco del panel no puede costar 47 segundos de GPU ni ocupar 7 GB de VRAM.
//
// Lo que viaja es el diff del repositorio, más sensible que el contexto que
// manda Cartografía. Por eso el proveedor es local y el endpoint se declara.

import * as fs from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import { simpleGit } from 'simple-git';
import type {
  CommitAiConfigFileStatus,
  CommitAiLastRequest,
  CommitAiResolvedModel,
  CommitAiResolvedResult,
  CommitDraftResult,
  DraftChunk,
  DraftStateEvent,
  HeaderProvenance,
  LoadOutcome,
  LocalModel,
  ParameterProvenance,
} from '../../types/commit-message-ai';
import { createChunkPump } from '../ai/commit-message/chunk-pump';
import { buildCodexDraftArgs, draftCommitWithCodex, type ResolveExecutableFunction, type SpawnFunction } from '../ai/commit-message/codex-cli';
import {
  getDefaultConfigPath,
  GitCronConfigError,
  loadGitCronConfig,
  resolveUse,
  type GitCronConfigFileStatus,
  type ResolvedUse,
} from '../ai/config/gitcron-config';
import { authorizedRepoStore } from './authorized-repos';
import { createGitCronConfigWatcher, type GitCronConfigWatcher } from '../ai/config/gitcron-config-watcher';
import { buildChatCompletionsEndpoint, buildStreamRequestBody, streamText, type TextClientConfig } from '../ai/text-client';
import {
  readCachedDeviceNames,
  resolveDeviceNames,
  writeCachedDeviceNames,
  type DeviceNames,
} from '../ai/commit-message/device-names';
import {
  DEFAULT_LOCAL_BASE_URL,
  draftCommitSubject,
  parseDraftResponse,
  fetchModelCatalog,
  hasEnoughContext,
  isKnownModel,
  loadLocalModel,
  DEFAULT_TTL_SECONDS,
  MIN_CONTEXT_LENGTH,
  PREFERRED_CONTEXT_LENGTH,
  unloadLocalModel,
} from '../ai/commit-message/local-provider';

/**
 * Qué instancia cargó esta aplicación, por servidor.
 *
 * Sirve para liberar la anterior al cargar otra, sin tocar las que la persona
 * haya levantado por su cuenta.
 */
const loadedByUs = new Map<string, string>();

/**
 * Elemento en la fila de redacción de commits (tarea 2.4 / D16).
 *
 * Los pedidos corren de a uno por orden de llegada para no saturar los
 * servidores locales (Unsloth o LM Studio procesan un pedido a la vez).
 *
 * Cada uno lleva su `AbortController` para poder cortarlo de verdad: el botón
 * «Cancelar» de la primera versión sólo descartaba la respuesta, la petición
 * seguía corriendo del otro lado y el modelo seguía ocupado. Un control que dice
 * cancelar y no cancela es peor que no tenerlo, y Ale pidió explícitamente
 * poder frenar el proceso.
 */
interface QueuedDraftItem {
  draftId: string;
  repoPath: string;
  sender: Electron.WebContents;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<Result<CommitDraftResult>>;
  resolve: (res: Result<CommitDraftResult>) => void;
  status: 'queued' | 'running' | 'completed' | 'cancelled';
}

let runningDraft: QueuedDraftItem | null = null;
const draftQueue: QueuedDraftItem[] = [];
let serverDraftCounter = 0;

export function resetDraftQueueForTesting(): void {
  if (runningDraft) {
    runningDraft.controller.abort();
    runningDraft = null;
  }
  for (const item of draftQueue) {
    item.controller.abort();
  }
  draftQueue.length = 0;
}

function notifyDraftState(sender: Electron.WebContents, event: DraftStateEvent): void {
  if (!sender.isDestroyed()) {
    sender.send('commit-ai:draft-state', event);
  }
}

async function startQueueItem(item: QueuedDraftItem): Promise<void> {
  runningDraft = item;
  item.status = 'running';
  const startedAt = Date.now();
  notifyDraftState(item.sender, {
    draftId: item.draftId,
    repoPath: item.repoPath,
    status: 'running',
    startedAt,
  });

  let result: Result<CommitDraftResult>;
  try {
    if (item.controller.signal.aborted) {
      result = ok({ status: 'unavailable', detail: 'Redacción cancelada.' });
    } else {
      result = await item.run(item.controller.signal);
    }
  } catch (error) {
    result = ok(toUnavailable(error));
  }

  const finishedAt = Date.now();
  const finalStatus = item.controller.signal.aborted ? 'cancelled' : 'completed';
  item.status = finalStatus;
  notifyDraftState(item.sender, {
    draftId: item.draftId,
    repoPath: item.repoPath,
    status: finalStatus,
    startedAt,
    finishedAt,
  });

  item.resolve(result);

  runningDraft = null;
  processDraftQueue();
}

function processDraftQueue(): void {
  if (runningDraft) return;
  while (draftQueue.length > 0) {
    const next = draftQueue.shift()!;
    if (next.controller.signal.aborted || next.status === 'cancelled') {
      next.resolve(ok({ status: 'unavailable', detail: 'Redacción cancelada.' }));
      continue;
    }
    startQueueItem(next).catch(() => undefined);
    return;
  }
}

/**
 * Cargas en curso, por servidor.
 *
 * Sin esta guardia dos pedidos simultáneos —dos ventanas, o un doble clic—
 * cargaban las dos instancias y la primera quedaba huérfana: `loadedByUs` sólo
 * guarda la última, así que nadie la podía descargar después. Es la otra mitad
 * del apilado que Ale vio en LM Studio.
 */
const inFlightLoad = new Set<string>();

/** Para poder abortar una carga, que antes era literalmente incancelable. */
const loadControllers = new Map<string, AbortController>();

let configPathOverride: string | null = null;
export function setCommitAiConfigPathForTesting(p: string | null): void {
  configPathOverride = p;
}

/**
 * Observación de los `gitcron.json` (D3, tarea 3.4). Empieza cuando una pantalla
 * pide la configuración y avisa a las pantallas que la pidieron: no se observa
 * nada que nadie esté mirando.
 */
let configWatcher: GitCronConfigWatcher | null = null;
let configWatcherGlobalPath: string | null = null;
const configSubscribers = new Set<Electron.WebContents>();
let stopDeauthorizeListener: (() => void) | null = null;

function notifyConfigChanged(repoPath: string | null): void {
  // Releer acá y no sólo cuando la pantalla vuelva a pedir: así la «última
  // versión válida» es la última que se guardó bien, aunque nadie mirara.
  try {
    loadGitCronConfig({ globalPath: configWatcherGlobalPath ?? undefined, repoPath });
  } catch {
    // La relectura sólo actualiza la última versión válida; el error lo pide la pantalla.
  }
  for (const sender of configSubscribers) {
    if (sender.isDestroyed()) {
      configSubscribers.delete(sender);
      continue;
    }
    sender.send('gitcron-config:changed', { repoPath });
  }
}

function watchConfigFor(sender: Electron.WebContents, globalPath: string, repoPath: string | null): void {
  configSubscribers.add(sender);
  if (configWatcher && configWatcherGlobalPath !== globalPath) {
    configWatcher.close();
    configWatcher = null;
  }
  if (!configWatcher) {
    configWatcherGlobalPath = globalPath;
    configWatcher = createGitCronConfigWatcher({
      globalPath,
      onChange: notifyConfigChanged,
      onError: (error) => console.warn('[gitcron-config] no se pudo observar:', errMsg(error)),
    });
  }
  if (!stopDeauthorizeListener) {
    // Cerrar la pestaña de un repositorio deja de observar su gitcron.json.
    stopDeauthorizeListener = authorizedRepoStore.onDeauthorize((root) => configWatcher?.unwatchRepo(root));
  }
  configWatcher.watchGlobal();
  if (repoPath) configWatcher.watchRepo(repoPath);
}

/** Sólo para pruebas: qué repositorios se observan. */
export function getWatchedConfigReposForTesting(): string[] {
  return configWatcher?.watchedRepos() ?? [];
}

/** Sólo para pruebas: cerrar la observación y olvidar a quién avisar. */
export function resetCommitAiConfigWatcherForTesting(): void {
  configWatcher?.close();
  configWatcher = null;
  configWatcherGlobalPath = null;
  configSubscribers.clear();
  stopDeauthorizeListener?.();
  stopDeauthorizeListener = null;
}

let codexSpawnOverride: SpawnFunction | null = null;
export function setCodexSpawnForTesting(fn: SpawnFunction | null): void {
  codexSpawnOverride = fn;
}

let codexResolveOverride: ResolveExecutableFunction | null = null;
export function setCodexResolveForTesting(fn: ResolveExecutableFunction | null): void {
  codexResolveOverride = fn;
}

/**
 * Parámetros estándar de la API de Chat Completions de OpenAI.
 * Si el servidor responde 4xx, cualquier parámetro fuera de esta lista se reporta con su procedencia.
 */
export const OPENAI_STANDARD_PARAMS: readonly string[] = [
  'model',
  'messages',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'stream',
  'stream_options',
  'stop',
  'n',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'user',
  'seed',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'reasoning_effort',
  'service_tier',
  'metadata',
  'store',
  'modalities',
  'prediction',
  'audio',
  'web_search_options',
  'verbosity',
] as const;

/**
 * Último pedido efectivo del uso gitcron-commit guardado en memoria (D14).
 * Nunca persiste en disco; nunca contiene secretos, prompt ni diff.
 */
let lastCommitAiRequest: CommitAiLastRequest | null = null;

export function getLastCommitAiRequestForTesting(): CommitAiLastRequest | null {
  return lastCommitAiRequest;
}

export function resetLastCommitAiRequestForTesting(): void {
  lastCommitAiRequest = null;
}
import {
  buildUserPrompt,
  DEFAULT_MAX_TOKENS,
  inputBudgetChars,
  isConventionalSubject,
  SYSTEM_PROMPT,
  truncateDiff,
} from '../ai/commit-message/prompt';
import { withRepoLock } from '../git/repo-queue';
import { errMsg } from './shared';

type Result<T> = { success: boolean; data?: T; error?: string };

const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = <T>(error: unknown): Result<T> => ({ success: false, error: errMsg(error) });

/**
 * La raíz canónica de un repositorio abierto, o `null`. El `gitcron.json` del
 * repositorio sólo se lee de una pestaña que la persona abrió: una ruta suelta
 * del renderer no alcanza (misma regla que los canales de OpenSpec).
 */
function authorizedRepoRoot(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const real = fs.realpathSync(candidate.trim());
    return authorizedRepoStore.isAuthorized(real) ? real : null;
  } catch {
    return null;
  }
}

function toFileStatus(file: GitCronConfigFileStatus): CommitAiConfigFileStatus {
  return {
    path: file.path,
    scope: file.scope,
    exists: file.exists,
    ...(file.error ? { error: { ...file.error } } : {}),
    ...(file.usingLastValid ? { usingLastValid: true } : {}),
  };
}

/** El archivo del repositorio, si de ahí sale el valor con esa clave de procedencia (D2). */
function repoFileFor(resolved: ResolvedUse, key: string): { file?: string } {
  const { repoFile, fromRepo } = resolved.provenance;
  return repoFile && fromRepo?.includes(key) ? { file: repoFile } : {};
}

function toUnavailable(error: unknown): CommitDraftResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 'unavailable', detail: 'Redacción cancelada.' };
  }
  return { status: 'unavailable', detail: message };
}

/**
 * Las tareas que pasaron a hechas en esta tanda.
 *
 * Salen del diff de `tasks.md` contra `HEAD`: las casillas que cambiaron de
 * `[ ]` a `[x]` son exactamente el alcance de este commit. Es un hecho de Git,
 * no una inferencia.
 *
 * No alcanzan para nombrar el commit por sí solas —medido: cada commit cierra
 * entre 7 y 15 tareas y toca todas las secciones— pero como contexto para el
 * modelo valen: dicen en qué se estuvo trabajando.
 */
export function tickedTasksFromDiff(diff: string): string[] {
  return diff
    .split(/\r?\n/)
    .filter((line) => /^\+- \[x\] /.test(line))
    .map((line) => line.slice(1).trim());
}

interface DraftArgs {
  repoPath: string;
  /** Los archivos elegidos en el panel. El commit describe eso, no todo el árbol. */
  paths: string[];
  changeId: string | null;
  intent: string | null;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  /**
   * Con qué marca se rotula lo que se va transmitiendo.
   *
   * La pone quien llama, y no este proceso, porque el renderer la necesita
   * **antes** de que llegue el primer pedazo: el resultado recién vuelve al
   * final, y sin la marca desde el arranque no habría con qué distinguir lo que
   * llega de una redacción que se canceló de lo que llega de la nueva. Sin esto
   * los avisos salen igual, con la marca en `null`.
   */
  draftId?: string;
}

export function registerCommitMessageAiHandlers(): void {
  /** Qué modelos hay, con su estado y su contexto real. Barato y sin generar nada. */
  ipcMain.handle('commit-ai:catalog', async (_e, baseUrl?: string): Promise<Result<LocalModel[]>> => {
    try {
      return ok(await fetchModelCatalog(baseUrl || DEFAULT_LOCAL_BASE_URL));
    } catch (error) {
      return fail(error);
    }
  });

  /**
   * Cargar es la acción con costo, y va siempre después de haberlo declarado.
   *
   * Lo que se declara sale del propio catálogo —`sizeBytes`, medido igual a lo
   * que estimaba el CLI—, así que no hace falta un paso de estimación aparte.
   */
  ipcMain.handle('commit-ai:load', async (
    _e,
    model: string,
    baseUrl?: string,
    contextLength?: number,
    ttlSeconds?: number,
  ): Promise<Result<LoadOutcome>> => {
    const endpoint = baseUrl || DEFAULT_LOCAL_BASE_URL;

    // Una carga a la vez por servidor. Sin esta guardia, dos pedidos simultáneos
    // —dos ventanas, o un doble clic— cargan las dos y la primera queda
    // huérfana: nadie la registra y nadie la puede descargar después.
    if (inFlightLoad.has(endpoint)) {
      return fail(new Error('Ya hay una carga en curso contra ese servidor.'));
    }
    inFlightLoad.add(endpoint);
    const controller = new AbortController();
    loadControllers.set(endpoint, controller);
    try {
      // Pertenencia al catálogo antes de mandar la clave: es más fuerte que un
      // patrón sobre caracteres y no depende de adivinar qué forma tiene un
      // identificador de modelo.
      const catalog = await fetchModelCatalog(endpoint);
      const chosen = catalog.find((entry) => entry.id === model);
      if (!chosen) return fail(new Error('Ese modelo no está en el catálogo del servidor.'));
      const wanted = contextLength ?? PREFERRED_CONTEXT_LENGTH;

      // Ya cargado y con contexto suficiente: no se vuelve a cargar. Pedirlo de
      // nuevo **no reemplaza, apila**: comprobado, la segunda carga devuelve
      // `instance_id: "…:2"` y quedan dos copias del mismo modelo ocupando la
      // placa. Es lo que le pasó a Ale.
      if (chosen.loaded && (chosen.loadedContextLength ?? 0) >= wanted) {
        return ok({
          model: chosen.loadedInstanceId ?? model,
          contextLength: chosen.loadedContextLength,
          loadTimeSeconds: null,
        });
      }

      // Cargado con un contexto que no alcanza. Si esa instancia la cargamos
      // nosotros, se reemplaza; si la levantó la persona a mano, NO se toca: se
      // dice qué pasa y decide ella.
      //
      // La versión anterior la desalojaba siempre, contradiciendo el comentario
      // que estaba tres líneas más abajo diciendo que no lo hacía.
      const nuestra = loadedByUs.get(endpoint);
      if (chosen.loadedInstanceId) {
        if (chosen.loadedInstanceId !== nuestra) {
          return fail(new Error(
            `«${model}» ya está cargado con ${chosen.loadedContextLength ?? '?'} de contexto, que no alcanza, `
            + 'y no lo cargó GitCron. Descargalo desde LM Studio si querés que se cargue con más.',
          ));
        }
        await unloadLocalModel(endpoint, chosen.loadedInstanceId).catch(() => undefined);
        loadedByUs.delete(endpoint);
      }

      const outcome = await loadLocalModel(
        endpoint, model, wanted, ttlSeconds ?? DEFAULT_TTL_SECONDS, controller.signal,
      );

      // Y se libera lo que esta aplicación había cargado antes. Sólo eso:
      // desalojar una instancia que la persona levantó a mano para otra cosa
      // sería peor que el problema.
      const previous = loadedByUs.get(endpoint);
      if (previous && previous !== outcome.model) {
        await unloadLocalModel(endpoint, previous).catch(() => undefined);
      }
      loadedByUs.set(endpoint, outcome.model);
      return ok(outcome);
    } catch (error) {
      return fail(error);
    } finally {
      inFlightLoad.delete(endpoint);
      loadControllers.delete(endpoint);
    }
  });

  /**
   * Los nombres de las máquinas: «Ale-CasaNew» en vez de «4f814c48…».
   *
   * Va en su propio canal y **no** dentro del catálogo, porque son dos costos
   * distintos: el catálogo con sus identificadores sale en 42 ms por WebSocket,
   * y esto invoca un proceso. Mezclarlos haría que abrir el panel pague el
   * proceso, que es exactamente el error de la versión anterior.
   *
   * Se resuelve una sola vez y se guarda en disco: el nombre de una computadora
   * no cambia. Las corridas siguientes lo leen de ahí y no invocan nada.
   */
  ipcMain.handle('commit-ai:device-names', async (): Promise<Result<DeviceNames>> => {
    try {
      const cachePath = join(app.getPath('userData'), 'lm-link-device-names.json');
      const enDisco = await readCachedDeviceNames(cachePath);
      if (enDisco && Object.keys(enDisco).length > 0) return ok(enDisco);
      // Nunca mientras hay una carga: es el momento de más presión de memoria, y
      // era justo cuando la versión retirada lo invocaba.
      if (inFlightLoad.size > 0) return ok({});
      const resueltos = await resolveDeviceNames();
      if (Object.keys(resueltos).length > 0) await writeCachedDeviceNames(cachePath, resueltos);
      return ok(resueltos);
    } catch (error) {
      return fail(error);
    }
  });

  /**
   * Descargar el modelo a mano.
   *
   * Ale lo pidió y tenía razón: GitCron cargaba 7 GB en la placa y no daba
   * ninguna salida. El TTL lo libera solo, pero esperar media hora para
   * recuperar la VRAM no es una respuesta cuando la querés ahora.
   *
   * Descarga la instancia que esté cargada de ese modelo, sea de GitCron o no:
   * acá lo pide la persona explícitamente, que es distinto de que la aplicación
   * desaloje por su cuenta lo que ella había levantado.
   */
  ipcMain.handle('commit-ai:unload', async (
    _e,
    model: string,
    baseUrl?: string,
  ): Promise<Result<{ unloaded: boolean }>> => {
    try {
      const endpoint = baseUrl || DEFAULT_LOCAL_BASE_URL;
      const catalog = await fetchModelCatalog(endpoint);
      const chosen = catalog.find((entry) => entry.id === model);
      if (!chosen?.loadedInstanceId) return ok({ unloaded: false });
      await unloadLocalModel(endpoint, chosen.loadedInstanceId);
      if (loadedByUs.get(endpoint) === chosen.loadedInstanceId) loadedByUs.delete(endpoint);
      return ok({ unloaded: true });
    } catch (error) {
      return fail(error);
    }
  });

  /**
   * Corta lo que haya en vuelo: la redacción o la carga.
   *
   * Las dos, porque el botón que la persona aprieta es el mismo y no tiene por
   * qué saber en qué fase está. Antes sólo miraba la redacción, así que durante
   * los 11 segundos de una carga no cortaba nada mientras decía que sí.
   */
  ipcMain.handle('commit-ai:cancel', (_e, draftId?: string): Result<{ cancelled: boolean }> => {
    if (draftId) {
      if (runningDraft && runningDraft.draftId === draftId) {
        runningDraft.status = 'cancelled';
        runningDraft.controller.abort();
        notifyDraftState(runningDraft.sender, {
          draftId: runningDraft.draftId,
          repoPath: runningDraft.repoPath,
          status: 'cancelled',
        });
        return ok({ cancelled: true });
      }
      const queuedIdx = draftQueue.findIndex((item) => item.draftId === draftId);
      if (queuedIdx !== -1) {
        const [item] = draftQueue.splice(queuedIdx, 1);
        item.status = 'cancelled';
        item.controller.abort();
        notifyDraftState(item.sender, {
          draftId: item.draftId,
          repoPath: item.repoPath,
          status: 'cancelled',
        });
        item.resolve(ok({ status: 'unavailable', detail: 'Redacción cancelada.' }));
        return ok({ cancelled: true });
      }
      return ok({ cancelled: false });
    }

    const had = runningDraft !== null || draftQueue.length > 0 || loadControllers.size > 0;
    if (runningDraft) {
      runningDraft.status = 'cancelled';
      runningDraft.controller.abort();
      notifyDraftState(runningDraft.sender, {
        draftId: runningDraft.draftId,
        repoPath: runningDraft.repoPath,
        status: 'cancelled',
      });
    }
    while (draftQueue.length > 0) {
      const item = draftQueue.shift()!;
      item.status = 'cancelled';
      item.controller.abort();
      notifyDraftState(item.sender, {
        draftId: item.draftId,
        repoPath: item.repoPath,
        status: 'cancelled',
      });
      item.resolve(ok({ status: 'unavailable', detail: 'Redacción cancelada.' }));
    }
    for (const controller of loadControllers.values()) controller.abort();
    loadControllers.clear();
    return ok({ cancelled: had });
  });

  ipcMain.handle('commit-ai:resolved-model', async (_e, rawRepoPath?: unknown): Promise<Result<CommitAiResolvedResult>> => {
    const configPath = configPathOverride ?? getDefaultConfigPath();
    // Sin repositorio, sólo el global (como antes). Con uno, tiene que ser una
    // pestaña abierta: de otro modo no se lee su gitcron.json.
    const repoPath = rawRepoPath === undefined || rawRepoPath === null ? null : authorizedRepoRoot(rawRepoPath);
    if (rawRepoPath !== undefined && rawRepoPath !== null && !repoPath) {
      return fail(new Error('IPC Security Error: Invalid or unauthorized repository path'));
    }
    watchConfigFor(_e.sender, configPath, repoPath);
    const loaded = loadGitCronConfig({ globalPath: configPath, repoPath });
    const configFiles = loaded.files.map(toFileStatus);
    try {
      const resolved = resolveUse('gitcron-commit', { configPath, repoPath, loaded });
      if (!resolved) return ok(null);
      if (!resolved.available) {
        return ok({
          status: 'error',
          error: resolved.unavailableReason ?? 'Proveedor no disponible.',
          sourceFile: resolved.sourceFile,
          configFiles,
        });
      }
      return ok({
        status: 'resolved',
        providerName: resolved.providerName,
        modelId: resolved.modelId,
        kind: resolved.kind,
        destination: resolved.destination,
        sourceFile: resolved.sourceFile,
        ...(resolved.provenance.repoFile ? { repoSourceFile: resolved.provenance.repoFile } : {}),
        available: true,
        configFiles,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof GitCronConfigError) {
        return ok({
          status: 'error',
          error: msg,
          sourceFile: error.parseError.file,
          parseError: { ...error.parseError },
          configFiles,
        });
      }
      return ok({
        status: 'error',
        error: msg,
        sourceFile: configPath,
        configFiles,
      });
    }
  });

  ipcMain.handle('commit-ai:last-request', async (): Promise<Result<CommitAiLastRequest | null>> => {
    return ok(lastCommitAiRequest);
  });

  async function collectDraftPrompt(
    repoPath: string,
    paths: string[],
    changeId: string | null,
    intent: string | null,
    contextLength: number,
  ): Promise<string> {
    const { stat, diff, tasksDiff } = await withRepoLock(repoPath, async () => {
      const git = simpleGit(repoPath, { timeout: { block: 20_000 } });
      const tasksPaths = paths.filter((path) => path.endsWith('tasks.md'));
      return {
        stat: await git.raw(['diff', '--stat', 'HEAD', '--', ...paths]),
        diff: await git.raw(['diff', 'HEAD', '--', ...paths]),
        tasksDiff: tasksPaths.length > 0
          ? await git.raw(['diff', 'HEAD', '--', ...tasksPaths])
          : '',
      };
    });

    const budget = inputBudgetChars(contextLength);
    return buildUserPrompt({
      changeId,
      intent,
      tickedTasks: tickedTasksFromDiff(tasksDiff),
      stat,
      diff: truncateDiff(diff, budget),
    });
  }

  async function runDraftWithPump(
    sender: Electron.WebContents,
    draftId: string | null,
    effectiveModel: string,
    signal: AbortSignal,
    runner: (signal: AbortSignal, pump: { push: (chunks: DraftChunk[]) => void }) => Promise<CommitDraftResult>,
  ): Promise<Result<CommitDraftResult>> {
    const pump = createChunkPump((chunks) => {
      if (sender.isDestroyed()) return;
      sender.send('commit-ai:chunk', { draftId, chunks });
    });

    let result: CommitDraftResult;
    try {
      result = await runner(signal, pump);
    } catch (error) {
      result = toUnavailable(error);
    } finally {
      pump.flush();
    }

    if (result.status === 'drafted' && !isConventionalSubject(result.subject)) {
      return ok({ status: 'malformed', subject: result.subject, model: effectiveModel });
    }
    return ok(result);
  }

  ipcMain.handle('commit-ai:draft', async (_e, args: DraftArgs): Promise<Result<CommitDraftResult>> => {
    try {
      const { repoPath, paths, changeId, intent, model, baseUrl, maxTokens, draftId } = args ?? ({} as DraftArgs);
      if (!repoPath || !Array.isArray(paths) || paths.length === 0) {
        return fail(new Error('No hay archivos elegidos para describir.'));
      }
      const effectiveDraftId = draftId || String(++serverDraftCounter);

      return await new Promise<Result<CommitDraftResult>>((resolve) => {
        const controller = new AbortController();
        const queueItem: QueuedDraftItem = {
          draftId: effectiveDraftId,
          repoPath,
          sender: _e.sender,
          controller,
          run: async (signal) => {
            const resolved = resolveUse('gitcron-commit', {
              configPath: configPathOverride ?? undefined,
              repoPath: authorizedRepoRoot(repoPath),
            });
            if (resolved) {
              if (!resolved.available) {
                return ok({
                  status: 'unavailable',
                  detail: resolved.unavailableReason ?? 'Proveedor no disponible.',
                });
              }

              const effectiveModel = resolved.modelId;
              const user = await collectDraftPrompt(
                repoPath,
                paths,
                changeId ?? null,
                intent ?? null,
                resolved.contextLength ?? MIN_CONTEXT_LENGTH,
              );

              return await runDraftWithPump(_e.sender, effectiveDraftId, effectiveModel, signal, async (sig, pump) => {
                if (resolved.kind === 'cli') {
                  if (resolved.providerId === 'codex') {
                    const codexCommand = ['codex', ...buildCodexDraftArgs(effectiveModel)].join(' ');
                    const codexParams: Record<string, ParameterProvenance> = {};
                    if (resolved.temperature !== undefined) {
                      codexParams.temperature = {
                        value: resolved.temperature,
                        provenance: resolved.provenance.temperature ?? 'agent.gitcron-commit.temperature',
                        ...repoFileFor(resolved, 'temperature'),
                      };
                    }
                    for (const [k, v] of Object.entries(resolved.options ?? {})) {
                      codexParams[k] = {
                        value: v,
                        provenance: resolved.provenance.options[k] ?? `agent.gitcron-commit.options.${k}`,
                        ...repoFileFor(resolved, `options.${k}`),
                      };
                    }

                    lastCommitAiRequest = {
                      kind: 'cli',
                      endpoint: codexCommand,
                      model: {
                        value: effectiveModel,
                        provenance: resolved.provenance.model,
                        ...repoFileFor(resolved, 'model'),
                      },
                      parameters: codexParams,
                      headers: [],
                      timestamp: Date.now(),
                    };

                    const fullPrompt = `${SYSTEM_PROMPT}\n\n${user}`;
                    return await draftCommitWithCodex({
                      model: effectiveModel,
                      prompt: fullPrompt,
                      signal: sig,
                      onChunk: (chunks) => pump.push(chunks),
                      spawnFn: codexSpawnOverride ?? undefined,
                      resolveExecutable: codexResolveOverride ?? undefined,
                    });
                  }
                  return {
                    status: 'unavailable',
                    detail: 'todavía no conectado',
                  };
                }

                // openai-compatible: sin caída a DEFAULT_LOCAL_BASE_URL (D7)
                if (!resolved.baseURL) {
                  return {
                    status: 'unavailable',
                    detail: `el proveedor ${resolved.providerId} no declara options.baseURL`,
                  };
                }

                const chatEndpoint = buildChatCompletionsEndpoint(resolved.baseURL);
                const effectiveMaxTokens = resolved.maxTokens ?? (maxTokens ?? DEFAULT_MAX_TOKENS);

                const streamOpts = {
                  model: effectiveModel,
                  system: SYSTEM_PROMPT,
                  user,
                  temperature: resolved.temperature,
                  maxTokens: effectiveMaxTokens,
                  options: resolved.options,
                  signal: sig,
                  onChunk: (chunks: DraftChunk[]) => pump.push(chunks),
                };

                // Lo que se muestra sale del mismo cuerpo que viaja: si los valores por
                // omisión o el filtrado de `options` cambian en text-client, la vista no
                // puede quedar diciendo otra cosa (D14).
                const sentBody = buildStreamRequestBody(streamOpts);
                const provenanceOf = (key: string): string => {
                  if (key in (resolved.options ?? {})) return resolved.provenance.options[key] ?? `options.${key}`;
                  if (key === 'temperature') return resolved.provenance.temperature ?? 'valor por omisión de GitCron';
                  if (key === 'max_tokens') return resolved.provenance.max_tokens ?? `valor por omisión de GitCron (${DEFAULT_MAX_TOKENS})`;
                  return 'parámetro de GitCron';
                };
                const openAiParams: Record<string, ParameterProvenance> = {};
                for (const [key, value] of Object.entries(sentBody)) {
                  if (key === 'model' || key === 'messages') continue;
                  const originKey = key in (resolved.options ?? {}) ? `options.${key}` : key;
                  openAiParams[key] = { value, provenance: provenanceOf(key), ...repoFileFor(resolved, originKey) };
                }

                const headerList: HeaderProvenance[] = Object.keys(resolved.headers ?? {}).map((name) => ({
                  name,
                  provenance: resolved.provenance.headers[name] ?? `provider.${resolved.providerId}.options.headers.${name}`,
                  ...repoFileFor(resolved, `headers.${name}`),
                }));

                lastCommitAiRequest = {
                  kind: 'openai-compatible',
                  endpoint: chatEndpoint,
                  model: {
                    value: effectiveModel,
                    provenance: resolved.provenance.model,
                    ...repoFileFor(resolved, 'model'),
                  },
                  parameters: openAiParams,
                  headers: headerList,
                  auth: resolved.provenance.auth,
                  timestamp: Date.now(),
                };

                const textConfig: TextClientConfig = {
                  baseUrl: resolved.baseURL,
                  apiKey: resolved.apiKey,
                  headers: resolved.headers,
                  providerLabel: resolved.providerName,
                };

                try {
                  const genResult = await streamText(textConfig, streamOpts);
                  return parseDraftResponse(genResult.rawPayload, effectiveModel);
                } catch (error) {
                  const msg = error instanceof Error ? error.message : String(error);
                  const is4xx = /respondi[oó]\s+4\d\d/i.test(msg) || ((error as any)?.status >= 400 && (error as any)?.status < 500);
                  if (is4xx) {
                    const standardSet = new Set(OPENAI_STANDARD_PARAMS);
                    const nonStandard: Array<{ key: string; provenance: string }> = [];
                    for (const [key] of Object.entries(resolved.options ?? {})) {
                      if (!standardSet.has(key)) {
                        const prov = resolved.provenance.options[key] ?? `options.${key}`;
                        nonStandard.push({ key, provenance: prov });
                      }
                    }
                    if (nonStandard.length > 0) {
                      const nonStandardDesc = nonStandard
                        .map(({ key, provenance }) => `${key} (de ${provenance})`)
                        .join(', ');
                      return {
                        status: 'unavailable',
                        detail: `${msg} Parámetros enviados fuera del estándar de OpenAI: ${nonStandardDesc}.`,
                      };
                    }
                  }
                  return toUnavailable(error);
                }
              });
            }

            // Camino nativo LM Studio
            const endpoint = baseUrl || DEFAULT_LOCAL_BASE_URL;

            const catalog = await fetchModelCatalog(endpoint);
            const chosen = catalog.find((entry) => entry.id === model);
            if (!chosen) return fail(new Error('Ese modelo no está en el catálogo del servidor.'));
            if (!hasEnoughContext(chosen)) {
              return ok({
                status: 'unavailable',
                detail: `«${model}» no está cargado con al menos ${MIN_CONTEXT_LENGTH} de contexto. `
                  + 'El contexto se define al cargar el modelo en LM Studio.',
              });
            }

            const user = await collectDraftPrompt(
              repoPath,
              paths,
              changeId ?? null,
              intent ?? null,
              chosen.loadedContextLength ?? MIN_CONTEXT_LENGTH,
            );

            return await runDraftWithPump(_e.sender, effectiveDraftId, model, signal, async (sig, pump) => {
              return await draftCommitSubject({
                baseUrl: endpoint,
                model,
                system: SYSTEM_PROMPT,
                user,
                maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
                signal: sig,
                onChunk: (chunks) => pump.push(chunks),
              });
            });
          },
          resolve,
          status: 'queued',
        };

        if (!runningDraft) {
          startQueueItem(queueItem).catch(() => undefined);
        } else {
          draftQueue.push(queueItem);
          notifyDraftState(queueItem.sender, {
            draftId: queueItem.draftId,
            repoPath: queueItem.repoPath,
            status: 'queued',
            activeRepoPath: runningDraft.repoPath,
          });
        }
      });
    } catch (error) {
      return fail(error);
    }
  });
}
