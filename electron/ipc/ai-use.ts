// electron/ipc/ai-use.ts
//
// Los usos de texto de GitCron frente a gitcron.json (tarea 4.3 de modelos-en-casa):
// qué modelo usa cada uno y, si no tiene, «usar lo que tenías» (decisión de Ale del
// 2026-10-01: la pantalla lo ofrece con un botón; nada se escribe ni se manda solo).
//
// Ningún canal devuelve claves ni valores de variables: sólo nombres, destino y
// de qué archivo sale cada cosa.

import { ipcMain } from 'electron';
import type { AiUseOffer, AiUseStatus } from '../../types/ai-use';
import { getCartoAISettings } from '../ai/carto';
import { GitCronConfigError, loadGitCronConfig } from '../ai/config/gitcron-config';
import type { MigrationSources } from '../ai/config/gitcron-config-migration';
import { adoptLegacyOffer, legacyOfferFor, type LegacyChoiceSources } from '../ai/config/legacy-choice';
import { isTextUse, type TextUse } from '../ai/config/resolve-model-for';
import { hasKey } from '../ai/key-store';
import { activeConfigPath, resolveForUse } from '../ai/use-resolution';
import { authorizedRepoRoot } from './authorized-repos';
import { watchGitCronConfigFor } from './commit-message-ai';
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

function parseArgs(args: unknown): { use: TextUse; repoPath: string | null; screenModel: string | null } {
  const { use, repoPath, screenModel } = (args ?? {}) as { use?: unknown; repoPath?: unknown; screenModel?: unknown };
  if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
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
        const target = resolveForUse(use, repoPath);
        if (target.status === 'disabled') return ok({ status: 'disabled', use, sourceFile: target.sourceFile ?? null });
        if (target.status === 'unset') return ok({ status: 'unset', use, offer: offerFor(use, repoPath, screenModel) });
        const { resolved, alternatives } = target;
        return ok({
          status: 'resolved',
          use,
          providerId: resolved.providerId,
          providerName: resolved.providerName,
          modelId: resolved.modelId,
          kind: resolved.kind,
          destination: resolved.destination,
          sourceFile: resolved.sourceFile,
          // Acá no entra el selector de la pantalla: sin modelo en el archivo, el uso es «unset».
          modelSource: resolved.modelSource === 'general' ? 'general' : 'agent',
          available: resolved.available,
          unavailableReason: resolved.unavailableReason ?? null,
          alternatives,
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

  /**
   * Escribe la elección de antes en el gitcron.json global, sólo si el uso sigue
   * sin modelo. Lo que se escribe se calcula acá otra vez: el renderer no elige
   * qué ni dónde.
   */
  ipcMain.handle('ai-use:adopt', async (_e, args: unknown): Promise<Result<{ written: boolean; modelRef: string }>> => {
    try {
      const { use, repoPath, screenModel } = parseArgs(args);
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
