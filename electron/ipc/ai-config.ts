// electron/ipc/ai-config.ts
//
// Sección de ajustes «Motores y modelos» (modelos-en-casa 6.1):
// - Configuración integral de proveedores, modelos, parámetros y destino sin abrir gitcron.json.
// - Claves guardadas en el baúl seguro (nunca vuelven al renderer ni se escriben en el archivo).
// - Contexto guardado en gitcron.json como limit.context del modelo.
// - Tiempo de carga (TTL) guardado en la carpeta de datos en archivo JSON por proveedor y modelo.
// - Apertura de gitcron.json en uso validada contra traversal y archivos ajenos.

import * as nodeFs from 'node:fs';
import path from 'node:path';
import { ipcMain, shell } from 'electron';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import {
  getDefaultConfigPath,
  GitCronConfigError,
  loadGitCronConfig,
  RESERVED_CLI_IDS,
  substituteReferences,
  type GitCronConfigFileStatus,
  type GitCronProviderConfig,
  type LoadedGitCronConfig,
  type ReservedCliId,
} from '../ai/config/gitcron-config';
import { validateGitCronConfig } from '../ai/config/gitcron-config-validate';
import { updateGitCronConfigValue, type ConfigWriteResult } from '../ai/config/gitcron-config-writer';
import {
  addModelToConfig,
  detectCanLoad,
  listProviderModels,
  removeModelFromConfig,
  serverOrigin,
} from '../ai/config/provider-models';
import { getToolModelsForUse } from '../ai/config/tool-models';
import { isTextUse, type TextUse } from '../ai/config/resolve-model-for';
import {
  getModelLoadSettings,
  saveModelLoadSettings,
} from '../ai/config/model-load-settings';
import {
  getStoredEnvVar,
  hasStoredEnvVar,
  removeEnvVar,
  setEnvVar,
  validateEnvVarName,
} from '../ai/key-store';
import { activeConfigPath, loadServerFor, setUseConfigPathForTesting } from '../ai/use-resolution';
import { authorizedRepoRoot } from './authorized-repos';
import { errMsg } from './shared';

type Result<T> = { success: boolean; data?: T; error?: string };
const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = <T>(error: unknown): Result<T> => ({ success: false, error: errMsg(error) });

let configPathOverride: string | null = null;

export function setAiConfigPathForTesting(p: string | null): void {
  configPathOverride = p;
  setUseConfigPathForTesting(p);
}

function resolveActiveConfigPath(): string {
  return configPathOverride ?? activeConfigPath() ?? getDefaultConfigPath();
}

const sameFile = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function extractEnvVarNames(value: unknown): string[] {
  const vars: string[] = [];
  const regex = /\{env:([A-Za-z_][A-Za-z0-9_]{0,127})\}/g;
  const scan = (val: unknown) => {
    if (typeof val === 'string') {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(val)) !== null) {
        if (!vars.includes(match[1])) vars.push(match[1]);
      }
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const v of Object.values(val as Record<string, unknown>)) scan(v);
    }
  };
  scan(value);
  return vars;
}

export function usesChoosingProvider(providerId: string, loaded: LoadedGitCronConfig): string[] {
  const affected: string[] = [];
  const prefix = `${providerId}/`;
  if (
    typeof loaded.config?.model === 'string' &&
    (loaded.config.model === providerId || loaded.config.model.startsWith(prefix))
  ) {
    affected.push('general');
  }
  const textUses: TextUse[] = [
    'gitcron-commit',
    'gitcron-cartography',
    'gitcron-openspec-analysis',
    'gitcron-temporal',
  ];
  for (const use of textUses) {
    const agentModel = loaded.config?.agent?.[use]?.model;
    if (
      typeof agentModel === 'string' &&
      (agentModel === providerId || agentModel.startsWith(prefix))
    ) {
      affected.push(use);
    }
  }
  return affected;
}

export function removeAgentOptionClean(filePath: string, use: string, optionKey: string): ConfigWriteResult {
  if (nodeFs.existsSync(filePath)) {
    try {
      const content = nodeFs.readFileSync(filePath, 'utf8');
      const root = parseTree(content);
      const optionsNode = root ? findNodeAtLocation(root, ['agent', use, 'options']) : null;
      if (optionsNode && optionsNode.type === 'object') {
        const props = optionsNode.children ?? [];
        const remaining = props.filter((p) => p.children?.[0]?.value !== optionKey);
        if (remaining.length === 0) {
          return updateGitCronConfigValue({ filePath, segments: ['agent', use, 'options'], value: undefined });
        }
      }
    } catch {
      // continuar con borrado directo
    }
  }
  return updateGitCronConfigValue({ filePath, segments: ['agent', use, 'options', optionKey], value: undefined });
}

/**
 * El proveedor donde va el contexto de un modelo: el que se pasa (la sección lo sabe), el
 * del servidor de carga del uso (`loadServerFor`), o el que declara ese modelo. Sólo un
 * proveedor declarado en el archivo: escribir `limit.context` en uno que no está crearía
 * un bloque a medias, sin dirección.
 */
function loadProviderFor(
  rawProviderId: unknown,
  rawUse: unknown,
  repoPath: string | null,
  modelId: string,
  loaded: LoadedGitCronConfig,
): string | null {
  const declared = loaded.config?.provider ?? {};
  const explicit = typeof rawProviderId === 'string' ? rawProviderId.trim() : '';
  if (explicit) return declared[explicit] ? explicit : null;
  if (isTextUse(rawUse)) {
    const found = loadServerFor(rawUse, repoPath);
    if ('server' in found && declared[found.server.providerId]) return found.server.providerId;
  }
  for (const [pId, pConfig] of Object.entries(declared)) {
    if (pConfig?.models && pConfig.models[modelId]) return pId;
  }
  return null;
}

export function registerAiConfigHandlers(): void {
  // ─── Estado general de la sección Motores y Modelos ───
  ipcMain.handle('ai-config:status', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { repoPath?: unknown };
      const rawRepo = args.repoPath;
      const repoPath = typeof rawRepo === 'string' && rawRepo.trim() ? authorizedRepoRoot(rawRepo) : null;
      const globalPath = resolveActiveConfigPath();

      let loaded: LoadedGitCronConfig;
      let parseError: GitCronConfigError['parseError'] | undefined;
      try {
        loaded = loadGitCronConfig({ globalPath, repoPath });
      } catch (err: any) {
        if (err instanceof GitCronConfigError) {
          parseError = err.parseError;
          loaded = {
            config: null,
            files: [
              {
                path: globalPath,
                scope: 'global',
                exists: nodeFs.existsSync(globalPath),
                error: parseError,
              },
            ],
            originOf: () => undefined,
          };
        } else {
          throw err;
        }
      }

      const files = loaded.files.map((f) => ({
        path: f.path,
        scope: f.scope,
        exists: f.exists,
        error: f.error ? { ...f.error } : undefined,
        usingLastValid: f.usingLastValid,
      }));

      const warnings = loaded.config ? validateGitCronConfig(loaded.config, loaded.originOf) : [];
      const generalModel = typeof loaded.config?.model === 'string' ? loaded.config.model : null;
      const smallModel = typeof loaded.config?.small_model === 'string' ? loaded.config.small_model : null;

      // Proveedores declarados en gitcron.json
      const providers: Array<{
        id: string;
        name: string;
        family: 'openai-compatible' | 'anthropic' | 'cli';
        baseURL?: string;
        available: boolean;
        unavailableReason?: string | null;
        canLoad: boolean;
        isCli: boolean;
        envVars: Array<{
          name: string;
          isApiKey: boolean;
          status: 'system' | 'stored' | 'missing';
        }>;
        declaredModels: string[];
      }> = [];

      const declaredProviders = (loaded.config?.provider ?? {}) as Record<string, GitCronProviderConfig>;
      for (const [pId, p] of Object.entries(declaredProviders)) {
        if (!p || typeof p !== 'object') continue;
        const family: 'openai-compatible' | 'anthropic' | 'cli' =
          p.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
        const rawBaseURL = typeof p.options?.baseURL === 'string' ? p.options.baseURL : undefined;

        // Variables de entorno referenciadas
        const allVars = extractEnvVarNames(p.options ?? {});
        const apiKeyVars = extractEnvVarNames(p.options?.apiKey);

        const envVars = allVars.map((name) => {
          const fromSystem = process.env[name];
          const status: 'system' | 'stored' | 'missing' =
            fromSystem !== undefined && fromSystem !== ''
              ? 'system'
              : hasStoredEnvVar(name)
                ? 'stored'
                : 'missing';
          return {
            name,
            isApiKey: apiKeyVars.includes(name),
            status,
          };
        });

        const missingRequired = envVars.some((v) => v.status === 'missing');
        let available = true;
        let unavailableReason: string | null = null;
        if (!rawBaseURL && family === 'openai-compatible') {
          available = false;
          unavailableReason = `El proveedor «${pId}» no declara options.baseURL`;
        } else if (missingRequired) {
          available = false;
          const missingNames = envVars.filter((v) => v.status === 'missing').map((v) => v.name).join(', ');
          unavailableReason = `Variable faltante: ${missingNames}`;
        }

        let canLoad = false;
        if (rawBaseURL && available) {
          const resolved = substituteReferences(p.options ?? {}, { env: process.env, stored: getStoredEnvVar });
          const baseURL = typeof resolved.value.baseURL === 'string' ? resolved.value.baseURL : rawBaseURL;
          canLoad = await detectCanLoad(baseURL, {
            headers: (resolved.value.headers as Record<string, string>) ?? {},
          }).catch(() => false);
        }

        providers.push({
          id: pId,
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : pId,
          family,
          baseURL: rawBaseURL,
          available,
          unavailableReason,
          canLoad,
          isCli: false,
          envVars,
          declaredModels: Object.keys(p.models ?? {}),
        });
      }

      // Proveedores CLI reservados (Codex, Claude Code, Antigravity)
      let toolModels: any = null;
      try {
        toolModels = await getToolModelsForUse({
          use: 'gitcron-commit',
          repoPath,
          configPath: globalPath,
          loaded,
          stored: getStoredEnvVar,
        });
      } catch {
        // En caso de fallo en CLI, continuar con datos básicos
      }

      for (const cliId of RESERVED_CLI_IDS) {
        const found = toolModels?.providers?.find((p: any) => p.id === cliId);
        const name =
          cliId === 'codex' ? 'Codex' : cliId === 'claude-code' ? 'Claude Code' : 'Antigravity';
        providers.push({
          id: cliId,
          name: found?.name ?? name,
          family: 'cli',
          available: Boolean(found?.available),
          unavailableReason: found?.unavailableReason ?? null,
          canLoad: false,
          isCli: true,
          envVars: [],
          declaredModels: [],
        });
      }

      // Usos de texto
      const textUses: TextUse[] = [
        'gitcron-commit',
        'gitcron-cartography',
        'gitcron-openspec-analysis',
        'gitcron-temporal',
      ];
      const uses = textUses.map((use) => {
        const agentEntry = loaded.config?.agent?.[use];
        const agentModel = typeof agentEntry?.model === 'string' && agentEntry.model.trim() ? agentEntry.model.trim() : null;
        const model = agentModel ?? generalModel;
        const isException = agentModel !== null && Boolean(generalModel);
        const modelSource: 'general' | 'agent' = agentModel !== null ? 'agent' : 'general';

        const temperature = typeof agentEntry?.temperature === 'number' ? agentEntry.temperature : undefined;
        const maxTokens =
          typeof agentEntry?.options?.max_tokens === 'number'
            ? agentEntry.options.max_tokens
            : undefined;

        // Opciones avanzadas (excluyendo max_tokens y reasoning_effort)
        const advancedOptions: Array<{ key: string; value: unknown; warning?: string }> = [];
        if (agentEntry?.options && typeof agentEntry.options === 'object') {
          for (const [k, v] of Object.entries(agentEntry.options)) {
            if (k === 'max_tokens' || k === 'reasoning_effort') continue;
            let warning: string | undefined;
            if (k === 'reasoning_effort' && typeof v === 'string' && !['minimal', 'low', 'medium', 'high'].includes(v)) {
              warning = `El estándar de OpenAI espera: minimal, low, medium, high`;
            }
            advancedOptions.push({ key: k, value: v, warning });
          }
        }

        return {
          use,
          model,
          modelSource,
          isException,
          temperature,
          maxTokens,
          advancedOptions,
        };
      });

      return ok({
        files,
        warnings,
        generalModel,
        smallModel,
        providers,
        uses,
      });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Modelos de un proveedor (declarados y reportados por el servidor) ───
  ipcMain.handle('ai-config:provider-models', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { providerId?: unknown; repoPath?: unknown };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      if (!providerId) throw new Error('Debe especificar un providerId.');

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const globalPath = resolveActiveConfigPath();
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const list = await listProviderModels(providerId, {
        configPath: globalPath,
        repoPath,
        loaded,
        stored: getStoredEnvVar,
        env: process.env,
      });

      // Sumar tiempos de carga guardados por modelo
      const modelsWithTtl = list.models.map((m) => {
        const savedTtl = getModelLoadSettings(providerId, m.id);
        return {
          ...m,
          ttlMinutes: savedTtl?.ttlMinutes ?? 30,
        };
      });

      return ok({
        ...list,
        models: modelsWithTtl,
      });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Agregar proveedor del estándar compatible con OpenAI ───
  ipcMain.handle('ai-config:add-provider', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        id?: unknown;
        name?: unknown;
        baseURL?: unknown;
        apiKey?: unknown;
        repoPath?: unknown;
      };
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        throw new Error('El identificador del proveedor debe contener sólo letras, números, guiones y guiones bajos (1-64 caracteres).');
      }
      if (RESERVED_CLI_IDS.includes(id as ReservedCliId)) {
        throw new Error(`El identificador «${id}» está reservado para una suscripción por CLI.`);
      }

      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : id;
      const baseURL = typeof args.baseURL === 'string' ? args.baseURL.trim() : '';
      if (!baseURL) {
        throw new Error('Debe especificar la dirección del proveedor (options.baseURL).');
      }

      // D2: se escribe en el gitcron.json global; el del repositorio queda para editarlo a mano.
      const globalPath = resolveActiveConfigPath();
      const existing = loadGitCronConfig({ globalPath, repoPath: null });
      if (existing.config?.provider?.[id]) {
        throw new Error(`Ya hay un proveedor «${id}». Elegí otro identificador.`);
      }

      const apiKey = typeof args.apiKey === 'string' && args.apiKey.trim() ? args.apiKey.trim() : undefined;
      let envVarName: string | undefined;

      if (apiKey) {
        // Derivar nombre de variable válido para el baúl
        let clean = id.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (/^[0-9]/.test(clean)) clean = `AI_${clean}`;
        envVarName = `${clean}_API_KEY`;
        validateEnvVarName(envVarName);

        // Guardar la clave en el baúl seguro; NUNCA al archivo
        setEnvVar(envVarName, apiKey);
      }

      const providerBlock: Record<string, unknown> = {
        name,
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL,
          ...(envVarName ? { apiKey: `{env:${envVarName}}` } : {}),
        },
      };

      const res = updateGitCronConfigValue({
        filePath: globalPath,
        segments: ['provider', id],
        value: providerBlock,
      });

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Quitar proveedor ───
  ipcMain.handle('ai-config:remove-provider', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        id?: unknown;
        repoPath?: unknown;
        deleteStoredVar?: unknown;
      };
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('Debe especificar un id de proveedor.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const targetFile = loaded.originOf(['provider', id]) ?? globalPath;
      const provider = loaded.config?.provider?.[id];

      // Si la persona pide borrar la variable guardada en GitCron
      // Sólo las variables que no usa nadie más: dos proveedores pueden compartir clave
      // (el mismo servidor por la red de la casa y por el túnel, por ejemplo).
      if (args.deleteStoredVar && provider?.options) {
        const rest = { ...(loaded.config ?? {}), provider: { ...(loaded.config?.provider ?? {}) } };
        delete (rest.provider as Record<string, unknown>)[id];
        const stillUsed = new Set(extractEnvVarNames(rest));
        for (const v of extractEnvVarNames(provider.options)) {
          if (!stillUsed.has(v) && hasStoredEnvVar(v)) removeEnvVar(v);
        }
      }

      const res = updateGitCronConfigValue({
        filePath: targetFile,
        segments: ['provider', id],
        value: undefined,
      });

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Agregar modelo a gitcron.json ───
  ipcMain.handle('ai-config:add-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        name?: unknown;
        repoPath?: unknown;
      };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
      if (!providerId || !modelId) throw new Error('Debe especificar providerId y modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const res = addModelToConfig({ providerId, modelId, name, loaded });
      if (!res.ok) {
        throw new Error(
          res.reason === 'no-provider'
            ? `El proveedor «${providerId}» no está declarado en el archivo.`
            : res.reason === 'broken'
              ? 'El archivo tiene un error de sintaxis.'
              : 'No se pudo escribir el archivo.',
        );
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Quitar modelo de gitcron.json ───
  ipcMain.handle('ai-config:remove-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        repoPath?: unknown;
      };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!providerId || !modelId) throw new Error('Debe especificar providerId y modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const res = removeModelFromConfig({ providerId, modelId, loaded });
      if (!res.ok) {
        throw new Error(
          res.reason === 'no-provider'
            ? `El proveedor «${providerId}» no está declarado en el archivo.`
            : res.reason === 'broken'
              ? 'El archivo tiene un error de sintaxis.'
              : 'No se pudo escribir el archivo.',
        );
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Contexto y tiempo de carga (TTL) ───
  ipcMain.handle('ai-config:get-model-load-settings', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        use?: unknown;
        repoPath?: unknown;
      };
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!modelId) throw new Error('Debe especificar un modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const providerId = loadProviderFor(args.providerId, args.use, repoPath, modelId, loaded);

      if (!providerId) return ok({ contextLength: 65536, ttlMinutes: 30 });
      const declaredContext = loaded.config?.provider?.[providerId]?.models?.[modelId]?.limit?.context;
      const savedTtl = getModelLoadSettings(providerId, modelId);

      return ok({
        contextLength: typeof declaredContext === 'number' && declaredContext > 0 ? declaredContext : 65536,
        ttlMinutes: savedTtl?.ttlMinutes ?? 30,
      });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:set-model-load-settings', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        use?: unknown;
        repoPath?: unknown;
        contextLength?: unknown;
        ttlMinutes?: unknown;
      };
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!modelId) throw new Error('Debe especificar un modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const providerId = loadProviderFor(args.providerId, args.use, repoPath, modelId, loaded);

      if (!providerId) {
        throw new Error('Este uso no carga modelos en un servidor declarado en gitcron.json.');
      }
      // 1. Contexto -> gitcron.json limit.context del modelo
      if (typeof args.contextLength === 'number' && args.contextLength > 0) {
        const targetFile = loaded.originOf(['provider', providerId]) ?? globalPath;
        const res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['provider', providerId, 'models', modelId, 'limit', 'context'],
          value: Math.round(args.contextLength),
        });
        if (!res.ok) {
          throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
        }
      }

      // 2. Tiempo de carga (TTL) -> archivo JSON en userData (NUNCA en gitcron.json)
      if (typeof args.ttlMinutes === 'number' && args.ttlMinutes > 0) {
        saveModelLoadSettings(providerId, modelId, { ttlMinutes: Math.round(args.ttlMinutes) });
      }

      return ok({ saved: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Elección general ───
  ipcMain.handle('ai-config:set-general-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        model?: unknown;
        effort?: unknown;
        variant?: unknown;
        repoPath?: unknown;
      };
      const model = typeof args.model === 'string' ? args.model.trim() : '';
      if (!model) throw new Error('Debe especificar un modelo.');

      const globalPath = resolveActiveConfigPath();
      const res = updateGitCronConfigValue({
        filePath: globalPath,
        segments: ['model'],
        value: model,
      });
      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Volver a la elección general (borra excepción de uso) ───
  ipcMain.handle('ai-config:clear-use-exception', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { use?: unknown; repoPath?: unknown };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      // Borrar model y variant del agente
      updateGitCronConfigValue({ filePath: targetFile, segments: ['agent', use, 'model'], value: undefined });
      updateGitCronConfigValue({ filePath: targetFile, segments: ['agent', use, 'variant'], value: undefined });
      removeAgentOptionClean(targetFile, use, 'reasoning_effort');

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Modificar / quitar parámetro de uso ───
  ipcMain.handle('ai-config:set-use-param', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        use?: unknown;
        param?: unknown;
        value?: unknown;
        repoPath?: unknown;
      };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
      const param = typeof args.param === 'string' ? args.param.trim() : '';
      if (!param) throw new Error('Debe especificar un nombre de parámetro.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      let res: ConfigWriteResult;
      if (param === 'temperature') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'temperature'],
          value: Number(args.value),
        });
      } else if (param === 'max_tokens') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'options', 'max_tokens'],
          value: Number(args.value),
        });
      } else {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'options', param],
          value: args.value,
        });
      }

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:remove-use-param', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        use?: unknown;
        param?: unknown;
        repoPath?: unknown;
      };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
      const param = typeof args.param === 'string' ? args.param.trim() : '';
      if (!param) throw new Error('Debe especificar un nombre de parámetro.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      let res: ConfigWriteResult;
      if (param === 'temperature') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'temperature'],
          value: undefined,
        });
      } else {
        res = removeAgentOptionClean(targetFile, use, param);
      }

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── «Abrir el archivo» (rechaza cualquier ruta que no sea un gitcron.json en uso) ───
  ipcMain.handle('ai-config:open-file', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      if (!filePath) throw new Error('Ruta de archivo inválida.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un gitcron.json en uso');
      }

      const err = await shell.openPath(matched.path);
      if (err) throw new Error(err);
      return ok({ opened: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── «Mostrar en la carpeta» ───
  ipcMain.handle('ai-config:show-in-folder', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      if (!filePath) throw new Error('Ruta de archivo inválida.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un gitcron.json en uso');
      }

      shell.showItemInFolder(matched.path);
      return ok({ shown: true });
    } catch (error) {
      return fail(error);
    }
  });
}
