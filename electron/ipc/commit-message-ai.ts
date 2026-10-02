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
import { draftCommitWithCli, type ResolveExecutableFunction, type SpawnFunction } from '../ai/commit-message/codex-cli';
import { describeCliTextCommand, type CliTextId } from '../ai/cli-text-client';
import { anthropicMessagesEndpoint, buildAnthropicBody, completeAnthropic } from '../ai/anthropic-client';
import { resolveModelFor, type ResolvedModelFor } from '../ai/config/resolve-model-for';
import { requireResolved, withSameModels } from '../ai/text-use';
import { setUseConfigPathForTesting } from '../ai/use-resolution';
import {
  getDefaultConfigPath,
  GitCronConfigError,
  loadGitCronConfig,
  type GitCronConfigFileStatus,
  type ResolvedUse,
} from '../ai/config/gitcron-config';
import { authorizedRepoRoot, authorizedRepoStore } from './authorized-repos';
import { getStoredEnvVar } from '../ai/key-store';
import { createGitCronConfigWatcher, type GitCronConfigWatcher } from '../ai/config/gitcron-config-watcher';
import { validateGitCronConfig } from '../ai/config/gitcron-config-validate';
import { updateGitCronConfigValue } from '../ai/config/gitcron-config-writer';
import { buildChatCompletionsEndpoint, buildStreamRequestBody, streamText, type TextClientConfig } from '../ai/text-client';
import {
  readCachedDeviceNames,
  resolveDeviceNames,
  writeCachedDeviceNames,
  type DeviceNames,
} from '../ai/commit-message/device-names';
import {
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
import { isTextUse, type TextUse } from '../ai/config/resolve-model-for';
import { loadServerFor } from '../ai/use-resolution';
import { setLastRequestForUse } from '../ai/text-use';

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
  setUseConfigPathForTesting(p);
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

/**
 * Que esta pantalla se entere cuando cambie el gitcron.json global o el del
 * repositorio (si es una pestaña abierta). Lo usan los demás usos de texto (4.3).
 */
export function watchGitCronConfigFor(sender: Electron.WebContents, repoPath: string | null): void {
  watchConfigFor(sender, configPathOverride ?? getDefaultConfigPath(), repoPath ? authorizedRepoRoot(repoPath) : null);
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

/** El último pedido de la redacción (D14), sin secretos. */
export function getLastCommitAiRequest(): CommitAiLastRequest | null {
  return lastCommitAiRequest;
}

export const getLastCommitAiRequestForTesting = getLastCommitAiRequest;

export function resetLastCommitAiRequestForTesting(): void {
  lastCommitAiRequest = null;
  setLastRequestForUse('gitcron-commit', null);
}

/**
 * Para qué uso y repositorio se pide el catálogo, la carga o la expulsión. El
 * servidor lo resuelve el proceso principal con gitcron.json (D6, D11): el renderer
 * no manda direcciones. Sin uso, la redacción del commit.
 */
function loadTarget(raw: unknown): { use: TextUse; repoPath: string | null } {
  const { use, repoPath } = (raw && typeof raw === 'object' ? raw : {}) as { use?: unknown; repoPath?: unknown };
  return {
    use: isTextUse(use) ? use : 'gitcron-commit',
    repoPath: typeof repoPath === 'string' ? repoPath : null,
  };
}

function serverForLoad(raw: unknown): { serverUrl?: string; error?: string } {
  const { use, repoPath } = loadTarget(raw);
  const found = loadServerFor(use, repoPath);
  return 'server' in found ? { serverUrl: found.server.serverUrl } : { error: found.error };
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
  ipcMain.handle('commit-ai:catalog', async (_e, target?: unknown): Promise<Result<LocalModel[]>> => {
    try {
      const { serverUrl, error } = serverForLoad(target);
      if (!serverUrl) return fail(new Error(error || 'No se pudo resolver el servidor de LM Studio.'));
      return ok(await fetchModelCatalog(serverUrl));
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
    target?: unknown,
    contextLength?: number,
    ttlSeconds?: number,
  ): Promise<Result<LoadOutcome>> => {
    const { serverUrl, error } = serverForLoad(target);
    if (!serverUrl) return fail(new Error(error || 'No se pudo resolver el servidor de LM Studio.'));
    const endpoint = serverUrl;

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
    target?: unknown,
  ): Promise<Result<{ unloaded: boolean }>> => {
    try {
      const { serverUrl, error } = serverForLoad(target);
      if (!serverUrl) return fail(new Error(error || 'No se pudo resolver el servidor de LM Studio.'));
      const endpoint = serverUrl;
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
    // Advertencias del esquema (3.5): se muestran y no bloquean.
    const configWarnings = loaded.config ? validateGitCronConfig(loaded.config, loaded.originOf) : [];
    try {
      // {env:} se busca en el sistema y después en las variables guardadas en GitCron (D5).
      const target = resolveModelFor('gitcron-commit', { configPath, repoPath, loaded, stored: getStoredEnvVar });
      // Sin modelo, la pantalla muestra el selector y ofrece escribir el elegido.
      if (target.status === 'unset') return ok(null);
      if (target.status === 'disabled') {
        return ok({
          status: 'error',
          error: 'La redacción del commit está desactivada en gitcron.json (agent.gitcron-commit.disable).',
          sourceFile: target.sourceFile ?? configPath,
          configFiles,
        });
      }
      const resolved = target.resolved;
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
        ...(configWarnings.length > 0 ? { configWarnings } : {}),
        ...(resolved.paramWarnings ? { paramWarnings: resolved.paramWarnings } : {}),
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

  /**
   * Corregir en el archivo un valor fuera del estándar, sólo cuando la persona lo
   * acepta (D11b, tarea 4.1b). Únicamente en uno de los gitcron.json en uso —el
   * global o el de una pestaña abierta— y como escritura puntual.
   */
  ipcMain.handle('commit-ai:fix-param', async (_e, args: unknown): Promise<Result<{ written: boolean }>> => {
    try {
      const { repoPath: rawRepoPath, file, segments, value } = (args ?? {}) as {
        repoPath?: unknown;
        file?: unknown;
        segments?: unknown;
        value?: unknown;
      };
      const repoPath = rawRepoPath === undefined || rawRepoPath === null ? null : authorizedRepoRoot(rawRepoPath);
      if (rawRepoPath !== undefined && rawRepoPath !== null && !repoPath) {
        return fail(new Error('IPC Security Error: Invalid or unauthorized repository path'));
      }
      const validSegments = Array.isArray(segments)
        && segments.length > 0 && segments.length <= 12
        && segments.every((segment) => typeof segment === 'string' && segment.length > 0);
      const validValue = ['string', 'number', 'boolean'].includes(typeof value);
      if (!validSegments || !validValue || typeof file !== 'string') {
        return fail(new Error('Corrección inválida.'));
      }
      const configPath = configPathOverride ?? getDefaultConfigPath();
      const loaded = loadGitCronConfig({ globalPath: configPath, repoPath });
      const sameFile = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
      if (!loaded.files.some((f) => f.exists && sameFile(f.path, file))) {
        return fail(new Error('IPC Security Error: el archivo no es un gitcron.json en uso'));
      }
      const result = updateGitCronConfigValue({ filePath: file, segments: segments as string[], value });
      if (!result.ok) return fail(new Error(result.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.'));
      return ok({ written: true });
    } catch (error) {
      return fail(error);
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
      const { repoPath, paths, changeId, intent, model, maxTokens, draftId } = args ?? ({} as DraftArgs);
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
            // La redacción usa lo que dice gitcron.json (4.3): la entrada del uso o la
            // elección general. Sin modelo no hay a quién mandar el diff: no se cae a
            // ningún servidor fijo, y la pantalla ofrece escribir el elegido (D7).
            let target: ResolvedModelFor;
            let resolved: ResolvedUse;
            try {
              target = resolveModelFor('gitcron-commit', {
                configPath: configPathOverride ?? undefined,
                repoPath: authorizedRepoRoot(repoPath),
                stored: getStoredEnvVar,
                // Sin modelo en el archivo, el del selector, por el proveedor
                // «lmstudio» que declare gitcron.json (4.3).
                screenModel: model,
              });
              resolved = requireResolved(target).resolved;
            } catch (error) {
              return ok({ status: 'unavailable', detail: errMsg(error) });
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
              const modelProvenance = {
                value: effectiveModel,
                provenance: resolved.provenance.model,
                ...repoFileFor(resolved, 'model'),
              };

              if (resolved.kind === 'cli') {
                const cli = resolved.providerId as CliTextId;
                const cliParams: Record<string, ParameterProvenance> = {};
                if (resolved.temperature !== undefined) {
                  cliParams.temperature = {
                    value: resolved.temperature,
                    provenance: resolved.provenance.temperature ?? 'agent.gitcron-commit.temperature',
                    ...repoFileFor(resolved, 'temperature'),
                  };
                }
                for (const [k, v] of Object.entries(resolved.options ?? {})) {
                  cliParams[k] = {
                    value: v,
                    provenance: resolved.provenance.options[k] ?? `agent.gitcron-commit.options.${k}`,
                    ...repoFileFor(resolved, `options.${k}`),
                  };
                }

                const effort = typeof resolved.options?.reasoning_effort === 'string'
                  ? resolved.options.reasoning_effort
                  : undefined;
                lastCommitAiRequest = {
                  kind: 'cli',
                  endpoint: describeCliTextCommand(cli, effectiveModel, effort),
                  model: modelProvenance,
                  parameters: cliParams,
                  headers: [],
                  timestamp: Date.now(),
                };
                setLastRequestForUse('gitcron-commit', lastCommitAiRequest);

                return await draftCommitWithCli({
                  cli,
                  model: effectiveModel,
                  effort,
                  prompt: `${SYSTEM_PROMPT}\n\n${user}`,
                  signal: sig,
                  onChunk: (chunks) => pump.push(chunks),
                  spawnFn: codexSpawnOverride ?? undefined,
                  resolveExecutable: codexResolveOverride ?? undefined,
                });
              }

              const effectiveMaxTokens = resolved.maxTokensFromModel
                ? resolved.maxTokens
                : (maxTokens ?? DEFAULT_MAX_TOKENS);

              if (resolved.kind === 'anthropic') {
                const anthropicRequest = {
                  baseURL: resolved.baseURL!,
                  apiKey: resolved.apiKey,
                  headers: resolved.headers,
                  providerLabel: resolved.providerName,
                  model: effectiveModel,
                  system: SYSTEM_PROMPT,
                  user,
                  maxTokens: effectiveMaxTokens ?? DEFAULT_MAX_TOKENS,
                  temperature: resolved.temperature,
                  options: resolved.options,
                  signal: sig,
                };
                const sentBody = buildAnthropicBody(anthropicRequest);
                const anthropicParams: Record<string, ParameterProvenance> = {};
                for (const [key, value] of Object.entries(sentBody)) {
                  if (key === 'model' || key === 'messages' || key === 'system') continue;
                  const fromOptions = key in (resolved.options ?? {});
                  anthropicParams[key] = {
                    value,
                    provenance: fromOptions
                      ? (resolved.provenance.options[key] ?? `options.${key}`)
                      : key === 'temperature'
                        ? (resolved.provenance.temperature ?? 'valor por omisión de GitCron')
                        : (resolved.provenance.max_tokens ?? `valor por omisión de GitCron (${DEFAULT_MAX_TOKENS})`),
                    ...repoFileFor(resolved, fromOptions ? `options.${key}` : key),
                  };
                }
                lastCommitAiRequest = {
                  kind: 'anthropic',
                  endpoint: anthropicMessagesEndpoint(resolved.baseURL!),
                  model: modelProvenance,
                  parameters: anthropicParams,
                  headers: Object.keys(resolved.headers ?? {}).map((name) => ({
                    name,
                    provenance: resolved.provenance.headers[name] ?? `provider.${resolved.providerId}.options.headers.${name}`,
                    ...repoFileFor(resolved, `headers.${name}`),
                  })),
                  auth: resolved.provenance.auth,
                  timestamp: Date.now(),
                };
                setLastRequestForUse('gitcron-commit', lastCommitAiRequest);
                const answer = await completeAnthropic(anthropicRequest);
                pump.push([{ kind: 'content', text: answer.text }]);
                if (answer.usage) pump.push([{ kind: 'done', finishReason: answer.finishReason, usage: answer.usage }]);
                return parseDraftResponse({ choices: [{ message: { content: answer.text } }] }, effectiveModel);
              }

              // Estándar de OpenAI: sin caída a ningún servidor fijo (D7).
              const chatEndpoint = buildChatCompletionsEndpoint(resolved.baseURL!);

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
                model: modelProvenance,
                parameters: openAiParams,
                headers: headerList,
                auth: resolved.provenance.auth,
                timestamp: Date.now(),
              };
              setLastRequestForUse('gitcron-commit', lastCommitAiRequest);

              const textConfig: TextClientConfig = {
                baseUrl: resolved.baseURL!,
                apiKey: resolved.apiKey,
                headers: resolved.headers,
                providerLabel: resolved.providerName,
                friendlyConnError: withSameModels(
                  `${resolved.providerName} no responde en ${resolved.baseURL}.`,
                  target.status === 'resolved' ? target.alternatives : [],
                ),
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
