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

import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import { simpleGit } from 'simple-git';
import type { CommitAiResolvedModel, CommitAiResolvedResult, CommitDraftResult, DraftChunk, LoadOutcome, LocalModel } from '../../types/commit-message-ai';
import { createChunkPump } from '../ai/commit-message/chunk-pump';
import { draftCommitWithCodex, type SpawnFunction } from '../ai/commit-message/codex-cli';
import { getDefaultConfigPath, resolveUse } from '../ai/config/gitcron-config';
import { streamText, type TextClientConfig } from '../ai/text-client';
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
 * La redacción en vuelo, para poder cortarla de verdad.
 *
 * El botón «Cancelar» de la primera versión sólo descartaba la respuesta: la
 * petición seguía corriendo del otro lado y el modelo seguía ocupado. Un control
 * que dice cancelar y no cancela es peor que no tenerlo, y Ale pidió
 * explícitamente poder frenar el proceso.
 */
let inFlightDraft: AbortController | null = null;

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

let codexSpawnOverride: SpawnFunction | null = null;
export function setCodexSpawnForTesting(fn: SpawnFunction | null): void {
  codexSpawnOverride = fn;
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
  ipcMain.handle('commit-ai:cancel', (): Result<{ cancelled: boolean }> => {
    const had = inFlightDraft !== null || loadControllers.size > 0;
    inFlightDraft?.abort();
    inFlightDraft = null;
    for (const controller of loadControllers.values()) controller.abort();
    loadControllers.clear();
    return ok({ cancelled: had });
  });

  ipcMain.handle('commit-ai:resolved-model', async (): Promise<Result<CommitAiResolvedResult>> => {
    const configPath = configPathOverride ?? getDefaultConfigPath();
    try {
      const resolved = resolveUse('gitcron-commit', configPath);
      if (!resolved) return ok(null);
      if (!resolved.available) {
        return ok({
          status: 'error',
          error: resolved.unavailableReason ?? 'Proveedor no disponible.',
          sourceFile: resolved.sourceFile,
        });
      }
      return ok({
        status: 'resolved',
        providerName: resolved.providerName,
        modelId: resolved.modelId,
        kind: resolved.kind,
        destination: resolved.destination,
        sourceFile: resolved.sourceFile,
        available: true,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return ok({
        status: 'error',
        error: msg,
        sourceFile: configPath,
      });
    }
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
    runner: (signal: AbortSignal, pump: { push: (chunks: DraftChunk[]) => void }) => Promise<CommitDraftResult>,
  ): Promise<Result<CommitDraftResult>> {
    inFlightDraft?.abort();
    const controller = new AbortController();
    inFlightDraft = controller;

    const pump = createChunkPump((chunks) => {
      if (sender.isDestroyed()) return;
      sender.send('commit-ai:chunk', { draftId, chunks });
    });

    let result: CommitDraftResult;
    try {
      result = await runner(controller.signal, pump);
    } catch (error) {
      result = toUnavailable(error);
    } finally {
      pump.flush();
      if (inFlightDraft === controller) inFlightDraft = null;
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

      const resolved = resolveUse('gitcron-commit', configPathOverride ?? undefined);
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

        return await runDraftWithPump(_e.sender, draftId ?? null, effectiveModel, async (signal, pump) => {
          if (resolved.kind === 'cli') {
            if (resolved.providerId === 'codex') {
              const fullPrompt = `${SYSTEM_PROMPT}\n\n${user}`;
              return await draftCommitWithCodex({
                model: effectiveModel,
                prompt: fullPrompt,
                signal,
                onChunk: (chunks) => pump.push(chunks),
                spawnFn: codexSpawnOverride ?? undefined,
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

          const textConfig: TextClientConfig = {
            baseUrl: resolved.baseURL,
            apiKey: resolved.apiKey,
            headers: resolved.headers,
            providerLabel: resolved.providerName,
          };
          const genResult = await streamText(textConfig, {
            model: effectiveModel,
            system: SYSTEM_PROMPT,
            user,
            temperature: resolved.temperature,
            maxTokens: resolved.maxTokens ?? (maxTokens ?? DEFAULT_MAX_TOKENS),
            options: resolved.options,
            signal,
            onChunk: (chunks) => pump.push(chunks),
          });
          return parseDraftResponse(genResult.rawPayload, effectiveModel);
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

      return await runDraftWithPump(_e.sender, draftId ?? null, model, async (signal, pump) => {
        return await draftCommitSubject({
          baseUrl: endpoint,
          model,
          system: SYSTEM_PROMPT,
          user,
          maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
          signal,
          onChunk: (chunks) => pump.push(chunks),
        });
      });
    } catch (error) {
      return fail(error);
    }
  });
}
