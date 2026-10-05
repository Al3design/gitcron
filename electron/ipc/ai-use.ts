// electron/ipc/ai-use.ts
//
// Los usos de texto de GitCron frente a gitcron.json (tarea 4.3 de modelos-en-casa):
// qué modelo usa cada uno y, si no tiene, «usar lo que tenías» (decisión de Ale del
// 2026-10-01: la pantalla lo ofrece con un botón; nada se escribe ni se manda solo).
//
// Ningún canal devuelve claves ni valores de variables: sólo nombres, destino y
// de qué archivo sale cada cosa.

import * as nodeFs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import type { AiUseChooseResult, AiUseModelsResult, AiUseOffer, AiUseStatus } from '../../types/ai-use';
import { getCartoAISettings } from '../ai/carto';
import { GitCronConfigError, loadGitCronConfig } from '../ai/config/gitcron-config';
import type { MigrationSources } from '../ai/config/gitcron-config-migration';
import { updateGitCronConfigValue } from '../ai/config/gitcron-config-writer';
import { adoptLegacyOffer, legacyOfferFor, type LegacyChoiceSources } from '../ai/config/legacy-choice';
import { isAiUse, isTextUse, type AiUse, type TextUse } from '../ai/config/resolve-model-for';
import { detectCanLoad } from '../ai/config/provider-models';
import { fetchOpenCodeModelList } from '../ai/config/opencode-models';
import { resolveAgentFor } from '../ai/config/resolve-agent-for';
import { getToolModelsForUse } from '../ai/config/tool-models';
import { getStoredEnvVar, hasKey } from '../ai/key-store';
import { getLastRequestForUse } from '../ai/text-use';
import { activeConfigPath, loadServerFor, resolveForUse } from '../ai/use-resolution';
import { authorizedRepoRoot } from './authorized-repos';
import { getLastCommitAiRequest, watchGitCronConfigFor } from './commit-message-ai';
import { errMsg } from './shared';
import { readEncryptedStorage } from './storage';

type Result<T> = { success: boolean; data?: T; error?: string };
const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = <T>(error: unknown): Result<T> => ({ success: false, error: errMsg(error) });

/** Lo que GitCron usaba antes de gitcron.json. También lo lee la migración (D10). */
export function readLegacySources(): MigrationSources {
  const provider = readEncryptedStorage()['ai.activeProvider'];
  const carto = getCartoAISettings();
  return {
    hasOpenRouterKey: hasKey('openrouter'),
    hasAnthropicKey: hasKey('claude'),
    temporalProvider: typeof provider === 'string' ? provider : null,
    cartography: { enabled: carto.enabled, mode: carto.mode, model: carto.model },
  };
}

let sourcesOverride: (() => MigrationSources) | null = null;
/** Para pruebas: las fuentes viejas sin tocar el almacenamiento cifrado. */
export function setLegacySourcesForTesting(fn: (() => MigrationSources) | null): void {
  sourcesOverride = fn;
}

function parseArgs(args: unknown): { use: AiUse; repoPath: string | null; screenModel: string | null } {
  const { use, repoPath, screenModel } = (args ?? {}) as { use?: unknown; repoPath?: unknown; screenModel?: unknown };
  if (!isAiUse(use)) throw new Error('Uso de IA desconocido.');
  if (repoPath !== undefined && repoPath !== null && !authorizedRepoRoot(repoPath)) {
    throw new Error('IPC Security Error: Invalid or unauthorized repository path');
  }
  return {
    use,
    repoPath: typeof repoPath === 'string' ? repoPath : null,
    screenModel: typeof screenModel === 'string' && screenModel.trim() ? screenModel.trim() : null,
  };
}

function offerFor(use: TextUse, repoPath: string | null, screenModel: string | null): AiUseOffer | null {
  const loaded = loadGitCronConfig({ globalPath: activeConfigPath(), repoPath: repoPath ? authorizedRepoRoot(repoPath) : null });
  const sources: LegacyChoiceSources = { ...(sourcesOverride ?? readLegacySources)(), screenModel };
  const offer = legacyOfferFor(use, loaded, sources, activeConfigPath());
  if (!offer) return null;
  return { modelRef: offer.modelRef, label: offer.label, addsProvider: offer.addsProvider ? offer.providerId : null, file: offer.file };
}

export function registerAiUseHandlers(): void {
  ipcMain.handle('ai-use:status', async (_e, args: unknown): Promise<Result<AiUseStatus>> => {
    try {
      const { use, repoPath, screenModel } = parseArgs(args);
      // Guardar el archivo a mano vuelve a preguntar (D3), como en la redacción.
      if (_e?.sender) watchGitCronConfigFor(_e.sender, repoPath);
      try {
        const repo = repoPath ? authorizedRepoRoot(repoPath) : null;
        const loaded = loadGitCronConfig({ globalPath: activeConfigPath(), repoPath: repo });

        if (use === 'gitcron-sdd') {
          const target = resolveAgentFor({ configPath: activeConfigPath(), repoPath: repo, loaded });
          if (target.status === 'disabled') {
            const sourceFile = target.sourceFile ?? null;
            const sourceDir = target.sourceDir;
            return ok({ status: 'disabled', use, sourceFile, ...(sourceDir ? { sourceDir } : {}) });
          }
          if (target.status === 'unset') {
            return ok({
              status: 'unset',
              use,
              offer: null,
              canLoad: false,
            });
          }
          let opencodeInstalled: boolean | undefined;
          let opencodeListFailed: boolean | undefined;
          let opencodeKnown: boolean | undefined;
          let contextLimit: number | null | undefined;
          let variant: string | undefined = target.variant;
          let launchKey = target.launchKey;

          if (target.runtime === 'opencode') {
            if (repo) {
              const listRes = await fetchOpenCodeModelList(repo);
              opencodeInstalled = listRes.installed;
              if (listRes.error === 'opencode_api_failed') {
                // No contestó o contestó otra cosa: no se sabe si conoce el modelo, y no se dice que no.
                opencodeListFailed = true;
              } else if (listRes.installed) {
                const refreshed = resolveAgentFor({
                  configPath: activeConfigPath(),
                  repoPath: repo,
                  loaded,
                  opencodeModels: listRes.models,
                });
                if (refreshed.status === 'resolved') {
                  opencodeKnown = refreshed.opencodeKnown;
                  contextLimit = refreshed.contextLimit;
                  variant = refreshed.variant;
                  launchKey = refreshed.launchKey;
                }
              } else {
                opencodeKnown = false;
              }
            } else {
              opencodeKnown = false;
            }
          }

          return ok({
            status: 'resolved',
            use,
            modelRef: target.modelRef,
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            kind: target.providerId === 'claude-code' || target.providerId === 'codex' || target.providerId === 'antigravity'
              ? 'cli'
              : 'openai-compatible',
            destination: target.destination,
            sourceFile: target.sourceFile,
            sourceDir: target.sourceDir ?? path.dirname(target.sourceFile),
            modelSource: target.modelSource,
            isException: target.isException,
            available: target.available,
            unavailableReason: target.unavailableReason ?? null,
            alternatives: [],
            canLoad: false,
            runtime: target.runtime,
            toolsExecutor: target.toolsExecutor,
            effort: target.effort,
            variant,
            opencodeKnown,
            opencodeInstalled,
            opencodeListFailed,
            contextLimit,
            launchKey,
          });
        }

        const target = resolveForUse(use as TextUse, repoPath);
        if (target.status === 'disabled') {
          const sourceFile = target.sourceFile ?? null;
          const sourceDir = sourceFile ? path.dirname(sourceFile) : undefined;
          return ok({ status: 'disabled', use, sourceFile, ...(sourceDir ? { sourceDir } : {}) });
        }
        // Capacidad de carga: el servidor del uso (o, sin modelo, el «lmstudio» del
        // archivo) responde la API nativa de LM Studio. Nunca una dirección fija.
        const load = loadServerFor(use, repoPath);
        const canLoad = 'server' in load
          ? await detectCanLoad(load.server.serverUrl, { headers: load.server.headers })
          : false;
        const serverUrl = canLoad && 'server' in load ? load.server.serverUrl : undefined;
        if (target.status === 'unset') {
          return ok({
            status: 'unset',
            use,
            offer: offerFor(use, repoPath, screenModel),
            canLoad,
            ...(serverUrl ? { serverUrl } : {}),
          });
        }
        const { resolved, alternatives } = target;
        const sourceFile = resolved.sourceFile;
        const sourceDir = path.dirname(sourceFile);
        const isException = resolved.modelSource === 'agent'
          && Boolean(loaded.config?.model && typeof loaded.config.model === 'string' && loaded.config.model.trim());
        return ok({
          status: 'resolved',
          use,
          providerId: resolved.providerId,
          providerName: resolved.providerName,
          modelId: resolved.modelId,
          kind: resolved.kind,
          destination: resolved.destination,
          sourceFile,
          sourceDir,
          // Acá no entra el selector de la pantalla: sin modelo en el archivo, el uso es «unset».
          modelSource: resolved.modelSource === 'general' ? 'general' : 'agent',
          isException,
          available: resolved.available,
          unavailableReason: resolved.unavailableReason ?? null,
          alternatives,
          canLoad,
          ...(serverUrl ? { serverUrl } : {}),
        });
      } catch (error) {
        if (error instanceof GitCronConfigError) {
          return ok({ status: 'error', use, error: error.message, parseError: { ...error.parseError } });
        }
        throw error;
      }
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-use:last-request', async (_e, args: unknown): Promise<Result<import('../../types/commit-message-ai').CommitAiLastRequest | null>> => {
    try {
      const { use } = (args ?? {}) as { use?: unknown };
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
      const req = use === 'gitcron-commit'
        ? (getLastRequestForUse(use) ?? getLastCommitAiRequest())
        : getLastRequestForUse(use);
      return ok(req);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-use:models', async (_e, args: unknown): Promise<Result<AiUseModelsResult>> => {
    try {
      const { use, repoPath } = parseArgs(args);
      const res = await getToolModelsForUse({
        use,
        repoPath: repoPath ? authorizedRepoRoot(repoPath) : null,
        configPath: activeConfigPath(),
        stored: getStoredEnvVar,
      });
      return ok(res);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-use:choose', async (_e, args: unknown): Promise<Result<AiUseChooseResult>> => {
    try {
      const { use, repoPath } = parseArgs(args);
      const raw = (args ?? {}) as { model?: unknown; effort?: unknown; variant?: unknown };
      const model = typeof raw.model === 'string' ? raw.model.trim() : '';
      if (!model) throw new Error('Debe especificar un modelo.');

      const slashIdx = model.indexOf('/');
      if (slashIdx === -1) {
        throw new Error('El modelo debe especificarse en formato <proveedor>/<modelo>.');
      }
      const providerId = model.slice(0, slashIdx);
      const modelId = model.slice(slashIdx + 1);

      const effort = typeof raw.effort === 'string' && raw.effort.trim() ? raw.effort.trim() : undefined;
      const variant = typeof raw.variant === 'string' && raw.variant.trim() ? raw.variant.trim() : undefined;

      const toolModels = await getToolModelsForUse({
        use,
        repoPath: repoPath ? authorizedRepoRoot(repoPath) : null,
        configPath: activeConfigPath(),
        stored: getStoredEnvVar,
      });

      const provider = toolModels.providers.find((p) => p.id === providerId);
      if (!provider || !provider.available) {
        throw new Error(`El proveedor «${providerId}» no existe o no está disponible${provider?.unavailableReason ? ` (${provider.unavailableReason})` : ''}.`);
      }

      const modelEntry = provider.models.find((m) => m.id === modelId);
      if (!modelEntry) {
        throw new Error(`El modelo «${modelId}» no está en la lista de ${provider.name}.`);
      }

      if (effort !== undefined) {
        if (!/^[a-z]+$/.test(effort)) {
          throw new Error(`El nivel de razonamiento «${effort}» no es válido.`);
        }
        if (!modelEntry.supportedLevels?.includes(effort)) {
          throw new Error(`El nivel «${effort}» no está admitido para el modelo «${modelId}».`);
        }
      }

      if (variant !== undefined) {
        if (!modelEntry.variants?.includes(variant)) {
          throw new Error(`La variante «${variant}» no está admitida para el modelo «${modelId}».`);
        }
      }

      // Determinar archivo destino (D2)
      const globalPath = activeConfigPath();
      const repo = repoPath ? authorizedRepoRoot(repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath: repo });

      let targetFile = globalPath;
      const repoFile = loaded.files.find((f) => f.scope === 'repo');
      if (repo && repoFile?.exists && repoFile.path) {
        // Se escribe donde está el modelo que vale. Con la entrada del uso en los dos
        // archivos, el objeto `agent.<uso>` figura como del global aunque el repositorio
        // pise su `model`: mirar el objeto escribiría donde no cambia nada.
        if (loaded.originOf(['agent', use, 'model']) === repoFile.path) {
          targetFile = repoFile.path;
        }
      }

      // Escribir modelo puntual
      let res = updateGitCronConfigValue({
        filePath: targetFile,
        segments: ['agent', use, 'model'],
        value: model,
      });
      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      // Escribir o borrar variante
      res = updateGitCronConfigValue({
        filePath: targetFile,
        segments: ['agent', use, 'variant'],
        value: variant || undefined,
      });
      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      // Escribir o borrar nivel de razonamiento
      if (effort) {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'options', 'reasoning_effort'],
          value: effort,
        });
        if (!res.ok) {
          throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
        }
      } else {
        // Quitar reasoning_effort sin dejar options vacío
        try {
          if (nodeFs.existsSync(targetFile)) {
            const content = nodeFs.readFileSync(targetFile, 'utf8');
            const root = parseTree(content);
            const optionsNode = root ? findNodeAtLocation(root, ['agent', use, 'options']) : null;
            if (optionsNode && optionsNode.type === 'object') {
              const props = optionsNode.children ?? [];
              const remainingProps = props.filter((prop) => {
                const keyNode = prop.children?.[0];
                return keyNode?.value !== 'reasoning_effort';
              });
              if (remainingProps.length === 0) {
                res = updateGitCronConfigValue({
                  filePath: targetFile,
                  segments: ['agent', use, 'options'],
                  value: undefined,
                });
              } else {
                res = updateGitCronConfigValue({
                  filePath: targetFile,
                  segments: ['agent', use, 'options', 'reasoning_effort'],
                  value: undefined,
                });
              }
            }
          }
        } catch {
          // Continuar si la lectura falla
        }
      }

      return ok({ written: true, file: targetFile });
    } catch (error) {
      return fail(error);
    }
  });

  /**
   * Escribe la elección de antes en el gitcron.json global, sólo si el uso sigue
   * sin modelo. Lo que se escribe se calcula acá otra vez: el renderer no elige
   * qué ni dónde.
   */
  ipcMain.handle('ai-use:adopt', async (_e, args: unknown): Promise<Result<{ written: boolean; modelRef: string }>> => {
    try {
      const { use, repoPath, screenModel } = parseArgs(args);
      if (!isTextUse(use)) {
        return fail(new Error(`El uso «${use}» no admite adopción de configuración heredada.`));
      }
      const loaded = loadGitCronConfig({ globalPath: activeConfigPath(), repoPath: repoPath ? authorizedRepoRoot(repoPath) : null });
      const sources: LegacyChoiceSources = { ...(sourcesOverride ?? readLegacySources)(), screenModel };
      const offer = legacyOfferFor(use, loaded, sources, activeConfigPath());
      if (!offer) return fail(new Error('Este uso ya tiene modelo en gitcron.json, o no había nada elegido.'));
      const result = adoptLegacyOffer(offer);
      if (!result.ok) {
        return fail(new Error(result.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.'));
      }
      return ok({ written: true, modelRef: offer.modelRef });
    } catch (error) {
      return fail(error);
    }
  });
}
