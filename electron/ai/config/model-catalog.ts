// electron/ai/config/model-catalog.ts
//
// Catálogo de modelos en el proceso principal (modelos-en-casa 24, Pedido 5 y tanda 24b).
// Responde al instante desde memoria y se actualiza de fondo sin esperas en cascada.
//
// - Se llena al arrancar la app (unos segundos después, sin trabar el arranque),
//   cuando cambia gitcron.json, y cada 10 minutos.
// - La lista de proveedores para un pedido sale siempre del archivo en uso (CLIs + los
//   declarados en el loaded de ese repo/global). El catálogo sólo aporta lo último sabido.
// - Clave de un servidor en el catálogo: providerId + baseURL resuelta (sin secretos).
// - Un proveedor nuevo del archivo que aún no se consultó se muestra al instante con sus
//   modelos declarados «sin confirmar» y se consulta en segundo plano sin esperar.
// - Sólo la primera vez de todas (catálogo completamente vacío) se espera.
// - El evento ai-use:models-updated no lleva datos (aviso de cambio de catálogo).

import type { AiToolModel, AiToolProvider, AiUse, AiUseModelsResult } from '../../../types/ai-use';
import {
  fetchAgyModels,
  fetchCodexModels,
  getClaudeCodeModels,
  getDefaultToolModelsExecutors,
  setOnClearToolModelsCache,
  STANDARD_OPENAI_EFFORT_LEVELS,
} from './tool-models';
import {
  loadGitCronConfig,
  RESERVED_CLI_IDS,
  substituteReferences,
  type GitCronProviderConfig,
  type LoadedGitCronConfig,
} from './gitcron-config';
import { listProviderModels } from './provider-models';
import { resolveAgentFor } from './resolve-agent-for';
import { resolveModelFor } from './resolve-model-for';
import { resolveRuntimeExecutable } from '../../pipeline/runtime-adapters/process-runner';
import type { ResolveExecutableFunction, SpawnFunction } from '../cli-text-client';

export interface ModelCatalogEntry {
  provider: AiToolProvider;
  lastAttempt: number;
  lastSuccess?: number;
  unconfirmed?: boolean;
}

export type CatalogContextProvider = () => {
  configPath?: string;
  stored?: (name: string) => string | undefined;
  resolveExecutable?: ResolveExecutableFunction;
  spawnFn?: SpawnFunction;
};

let contextProvider: CatalogContextProvider | null = null;

export function setModelCatalogContextProvider(provider: CatalogContextProvider | null): void {
  contextProvider = provider;
}

const catalogByCli = new Map<string, ModelCatalogEntry>();
const catalogByServerKey = new Map<string, ModelCatalogEntry>();
let lastCatalogRefreshTime = 0;
let refreshInProgress: Promise<AiToolProvider[]> | null = null;
let recurringTimer: NodeJS.Timeout | null = null;

const subscribers = new Set<() => void>();

export function subscribeToModelCatalog(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function notifyModelCatalogSubscribers(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Ignorar errores de suscriptores
    }
  }
}

/** Limpia el catálogo en memoria y detiene temporizadores. */
export function resetModelCatalog(): void {
  catalogByCli.clear();
  catalogByServerKey.clear();
  lastCatalogRefreshTime = 0;
  refreshInProgress = null;
  if (recurringTimer) {
    clearInterval(recurringTimer);
    recurringTimer = null;
  }
}

setOnClearToolModelsCache(resetModelCatalog);

export function getLastCatalogRefreshTime(): number {
  return lastCatalogRefreshTime;
}

export interface RefreshModelCatalogOptions {
  configPath?: string;
  repoPath?: string | null;
  loaded?: LoadedGitCronConfig;
  stored?: (name: string) => string | undefined;
  resolveExecutable?: ResolveExecutableFunction;
  spawnFn?: SpawnFunction;
}

function resolveProviderBaseUrl(providerConfig: GitCronProviderConfig, stored?: (name: string) => string | undefined): string {
  const resolved = substituteReferences(providerConfig.options ?? {}, { stored });
  return typeof resolved.value.baseURL === 'string' ? resolved.value.baseURL : '';
}

function serverCatalogKey(providerId: string, baseURL: string): string {
  return `${providerId}:${baseURL}`;
}

/**
 * Consulta servidores y CLIs en paralelo y actualiza el catálogo en memoria.
 * Si un servidor no responde, conserva su lista anterior y la marca «sin confirmar».
 */
export async function refreshModelCatalog(options: RefreshModelCatalogOptions = {}): Promise<AiToolProvider[]> {
  if (refreshInProgress) {
    return refreshInProgress;
  }

  const run = async (): Promise<AiToolProvider[]> => {
    const ctx = contextProvider ? contextProvider() : {};
    const defaultExecutors = getDefaultToolModelsExecutors();
    const configPath = options.configPath ?? ctx.configPath;
    const stored = options.stored ?? ctx.stored;
    const resolveExecutable = (options.resolveExecutable ?? ctx.resolveExecutable ?? defaultExecutors.resolveExecutable) || resolveRuntimeExecutable;
    const spawnFn = (options.spawnFn ?? ctx.spawnFn ?? defaultExecutors.spawnFn) || undefined;

    const loaded = options.loaded ?? loadGitCronConfig({ globalPath: configPath, repoPath: options.repoPath });
    const now = Date.now();

    // 1. CLIs en paralelo
    const codexPromise = fetchCodexModels({
      resolveExecutable,
      spawnFn,
      bypassCache: true,
    });
    const agyPromise = fetchAgyModels({
      resolveExecutable,
      spawnFn,
      bypassCache: true,
    });
    const claudePromise = (async () => {
      let claudeAvailable = true;
      let claudeError: string | undefined;
      const resolve = resolveExecutable;
      try {
        await resolve('claude', process.env);
      } catch (err: any) {
        claudeAvailable = false;
        claudeError = err?.message ?? String(err);
      }
      return { available: claudeAvailable, error: claudeError };
    })();

    // 2. Proveedores declarados en gitcron.json en paralelo
    const configProviders = loaded.config?.provider ?? {};
    const declaredEntries = Object.entries(configProviders).filter(
      ([id, p]) => p && typeof p === 'object' && !RESERVED_CLI_IDS.includes(id as any),
    );

    const providerPromises = declaredEntries.map(async ([providerId, rawProvider]) => {
      const providerConfig = rawProvider as GitCronProviderConfig;
      const kind = providerConfig.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
      const providerName = providerConfig.name || providerId;
      const baseURL = resolveProviderBaseUrl(providerConfig, stored);
      const serverKey = serverCatalogKey(providerId, baseURL);

      // Modelos declarados
      const declaredModels = providerConfig.models ?? {};
      const declaredEntriesList: AiToolModel[] = [];

      for (const [modelId, modelDef] of Object.entries(declaredModels)) {
        const activeVariants: string[] = [];
        if (modelDef?.variants && typeof modelDef.variants === 'object') {
          for (const [vName, vVal] of Object.entries(modelDef.variants)) {
            if ((vVal as any)?.disabled !== true) {
              activeVariants.push(vName);
            }
          }
        }
        declaredEntriesList.push({
          id: modelId,
          name: typeof modelDef?.name === 'string' ? modelDef.name : modelId,
          variants: activeVariants.length > 0 ? activeVariants : undefined,
          supportedLevels:
            kind === 'openai-compatible' && activeVariants.length === 0
              ? [...STANDARD_OPENAI_EFFORT_LEVELS]
              : undefined,
        });
      }

      // Lista reportada por el servidor
      try {
        const listed = await listProviderModels(providerId, {
          configPath,
          repoPath: options.repoPath,
          loaded,
          stored,
        });

        if (listed.status === 'ok') {
          const modelEntries = [...declaredEntriesList];
          for (const m of listed.models) {
            if (!modelEntries.some((existing) => existing.id === m.id)) {
              modelEntries.push({
                id: m.id,
                name: m.name ?? m.id,
                supportedLevels: kind === 'openai-compatible' ? [...STANDARD_OPENAI_EFFORT_LEVELS] : undefined,
              });
            }
          }
          const provider: AiToolProvider = {
            id: providerId,
            name: providerName,
            kind,
            available: true,
            models: modelEntries,
            agentRuntime: 'opencode',
            toolsExecutor: 'OpenCode',
            unconfirmed: false,
            lastChecked: now,
            lastSuccess: now,
          };
          catalogByServerKey.set(serverKey, {
            provider,
            lastAttempt: now,
            lastSuccess: now,
            unconfirmed: false,
          });
          return provider;
        }

        // Servidor inalcanzable o con error: conservar lo anterior sin confirmación (sin inventar textos en español)
        const existing = catalogByServerKey.get(serverKey);
        const models = (existing && existing.provider.models.length > 0)
          ? existing.provider.models.map((m) => ({ ...m, unconfirmed: true }))
          : declaredEntriesList.map((m) => ({ ...m, unconfirmed: true }));

        const provider: AiToolProvider = {
          id: providerId,
          name: providerName,
          kind,
          available: false,
          unavailableReason: listed.detail || undefined,
          models,
          agentRuntime: 'opencode',
          toolsExecutor: 'OpenCode',
          unconfirmed: true,
          lastChecked: now,
          lastSuccess: existing?.lastSuccess,
        };
        catalogByServerKey.set(serverKey, {
          provider,
          lastAttempt: now,
          lastSuccess: existing?.lastSuccess,
          unconfirmed: true,
        });
        return provider;
      } catch (err: any) {
        const existing = catalogByServerKey.get(serverKey);
        const models = (existing && existing.provider.models.length > 0)
          ? existing.provider.models.map((m) => ({ ...m, unconfirmed: true }))
          : declaredEntriesList.map((m) => ({ ...m, unconfirmed: true }));

        const provider: AiToolProvider = {
          id: providerId,
          name: providerName,
          kind,
          available: false,
          unavailableReason: err?.message || undefined,
          models,
          agentRuntime: 'opencode',
          toolsExecutor: 'OpenCode',
          unconfirmed: true,
          lastChecked: now,
          lastSuccess: existing?.lastSuccess,
        };
        catalogByServerKey.set(serverKey, {
          provider,
          lastAttempt: now,
          lastSuccess: existing?.lastSuccess,
          unconfirmed: true,
        });
        return provider;
      }
    });

    const [codexRes, agyRes, claudeRes, declaredProviders] = await Promise.all([
      codexPromise,
      agyPromise,
      claudePromise,
      Promise.all(providerPromises),
    ]);

    // 3. Registrar CLIs en catálogo
    const prevCodex = catalogByCli.get('codex');
    const codexModels = codexRes.ok
      ? codexRes.models
      : (prevCodex?.provider.models ?? []).map((m) => ({ ...m, unconfirmed: true }));
    const codexProvider: AiToolProvider = {
      id: 'codex',
      name: 'Codex',
      kind: 'cli',
      available: codexRes.ok,
      unavailableReason: codexRes.ok ? undefined : (codexRes.error || undefined),
      models: codexModels,
      agentRuntime: 'codex',
      toolsExecutor: 'Codex',
      unconfirmed: !codexRes.ok && codexModels.length > 0,
      lastChecked: now,
      lastSuccess: codexRes.ok ? now : prevCodex?.lastSuccess,
    };
    catalogByCli.set('codex', {
      provider: codexProvider,
      lastAttempt: now,
      lastSuccess: codexRes.ok ? now : prevCodex?.lastSuccess,
      unconfirmed: codexProvider.unconfirmed,
    });

    const prevAgy = catalogByCli.get('antigravity');
    const agyModels = agyRes.ok
      ? agyRes.models
      : (prevAgy?.provider.models ?? []).map((m) => ({ ...m, unconfirmed: true }));
    const agyProvider: AiToolProvider = {
      id: 'antigravity',
      name: 'Antigravity',
      kind: 'cli',
      available: agyRes.ok,
      unavailableReason: agyRes.ok ? undefined : (agyRes.error || undefined),
      models: agyModels,
      agentRuntime: 'agy',
      toolsExecutor: 'Antigravity',
      unconfirmed: !agyRes.ok && agyModels.length > 0,
      lastChecked: now,
      lastSuccess: agyRes.ok ? now : prevAgy?.lastSuccess,
    };
    catalogByCli.set('antigravity', {
      provider: agyProvider,
      lastAttempt: now,
      lastSuccess: agyRes.ok ? now : prevAgy?.lastSuccess,
      unconfirmed: agyProvider.unconfirmed,
    });

    const prevClaude = catalogByCli.get('claude-code');
    const claudeProvider: AiToolProvider = {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'cli',
      available: claudeRes.available,
      unavailableReason: claudeRes.error || undefined,
      models: getClaudeCodeModels(),
      agentRuntime: 'claude',
      toolsExecutor: 'Claude Code',
      unconfirmed: false,
      lastChecked: now,
      lastSuccess: claudeRes.available ? now : prevClaude?.lastSuccess,
    };
    catalogByCli.set('claude-code', {
      provider: claudeProvider,
      lastAttempt: now,
      lastSuccess: claudeRes.available ? now : prevClaude?.lastSuccess,
      unconfirmed: false,
    });

    lastCatalogRefreshTime = now;
    notifyModelCatalogSubscribers();

    return [codexProvider, agyProvider, claudeProvider, ...declaredProviders];
  };

  refreshInProgress = run().finally(() => {
    refreshInProgress = null;
  });

  return refreshInProgress;
}

/**
 * Obtiene modelos para un uso desde el catálogo en memoria.
 * La lista de proveedores se construye estrictamente para el archivo en uso (CLIs + los declarados).
 * Si a un proveedor aún no se le preguntó, muestra sus modelos declarados «sin confirmar» y pide de fondo.
 * Sólo la primera vez de todas (catálogo frío completamente vacío) espera.
 */
export async function getToolModelsForUse(options: {
  use: AiUse;
  repoPath?: string | null;
  configPath?: string;
  loaded?: LoadedGitCronConfig;
  stored?: (name: string) => string | undefined;
  resolveExecutable?: ResolveExecutableFunction;
  spawnFn?: SpawnFunction;
}): Promise<AiUseModelsResult> {
  const ctx = contextProvider ? contextProvider() : {};
  const defaultExecutors = getDefaultToolModelsExecutors();
  const configPath = options.configPath ?? ctx.configPath;
  const stored = options.stored ?? ctx.stored;
  const resolveExecutable = (options.resolveExecutable ?? ctx.resolveExecutable ?? defaultExecutors.resolveExecutable) || resolveRuntimeExecutable;
  const spawnFn = (options.spawnFn ?? ctx.spawnFn ?? defaultExecutors.spawnFn) || undefined;

  const loaded = options.loaded ?? loadGitCronConfig({ globalPath: configPath, repoPath: options.repoPath });
  const now = Date.now();

  const isColdCatalog = catalogByCli.size === 0 && catalogByServerKey.size === 0;
  if (isColdCatalog) {
    // Primera consulta antes de que el arranque haya poblado el catálogo: espera una sola vez
    await refreshModelCatalog({
      configPath,
      repoPath: options.repoPath,
      loaded,
      stored,
      resolveExecutable,
      spawnFn,
    });
  } else if (now - lastCatalogRefreshTime > 60_000) {
    // Si tiene más de 1 minuto de antigüedad, actualizar en segundo plano sin trabar
    void refreshModelCatalog({
      configPath,
      repoPath: options.repoPath,
      loaded,
      stored,
      resolveExecutable,
      spawnFn,
    }).catch(() => undefined);
  }

  // 1. Construir lista de proveedores a partir del archivo en uso para este pedido
  const providers: AiToolProvider[] = [];

  // CLIs reservados
  for (const cliId of ['codex', 'antigravity', 'claude-code'] as const) {
    const cached = catalogByCli.get(cliId);
    if (cached) {
      providers.push(cached.provider);
    } else {
      const fallbackModels = cliId === 'claude-code' ? getClaudeCodeModels() : [];
      providers.push({
        id: cliId,
        name: cliId === 'codex' ? 'Codex' : cliId === 'claude-code' ? 'Claude Code' : 'Antigravity',
        kind: 'cli',
        available: false,
        models: fallbackModels.map((m) => ({ ...m, unconfirmed: true })),
        agentRuntime: cliId === 'codex' ? 'codex' : cliId === 'claude-code' ? 'claude' : 'agy',
        toolsExecutor: cliId === 'codex' ? 'Codex' : cliId === 'claude-code' ? 'Claude Code' : 'Antigravity',
        // Sin `lastChecked`: todavía no se le preguntó (la pantalla no dice «no respondió»).
        unconfirmed: true,
      });
    }
  }

  // Proveedores declarados en este loaded
  const configProviders = loaded.config?.provider ?? {};
  let hasUnqueriedProvider = false;

  for (const [providerId, rawProvider] of Object.entries(configProviders)) {
    if (!rawProvider || typeof rawProvider !== 'object' || RESERVED_CLI_IDS.includes(providerId as any)) {
      continue;
    }
    const providerConfig = rawProvider as GitCronProviderConfig;
    const kind = providerConfig.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
    const providerName = providerConfig.name || providerId;
    const baseURL = resolveProviderBaseUrl(providerConfig, stored);
    const serverKey = serverCatalogKey(providerId, baseURL);

    const cached = catalogByServerKey.get(serverKey);
    if (cached) {
      providers.push({
        ...cached.provider,
        name: providerName,
      });
    } else {
      hasUnqueriedProvider = true;
      const declaredEntriesList: AiToolModel[] = [];
      for (const [modelId, modelDef] of Object.entries(providerConfig.models ?? {})) {
        const activeVariants: string[] = [];
        if (modelDef?.variants && typeof modelDef.variants === 'object') {
          for (const [vName, vVal] of Object.entries(modelDef.variants)) {
            if ((vVal as any)?.disabled !== true) activeVariants.push(vName);
          }
        }
        declaredEntriesList.push({
          id: modelId,
          name: typeof modelDef?.name === 'string' ? modelDef.name : modelId,
          variants: activeVariants.length > 0 ? activeVariants : undefined,
          supportedLevels:
            kind === 'openai-compatible' && activeVariants.length === 0
              ? [...STANDARD_OPENAI_EFFORT_LEVELS]
              : undefined,
          unconfirmed: true,
        });
      }
      providers.push({
        id: providerId,
        name: providerName,
        kind,
        available: false,
        models: declaredEntriesList,
        agentRuntime: 'opencode',
        toolsExecutor: 'OpenCode',
        // Sin `lastChecked`: todavía no se le preguntó (la pantalla no dice «no respondió»).
        unconfirmed: true,
      });
    }
  }

  // Si había algún proveedor declarado no consultado, disparar refresco de fondo
  if (hasUnqueriedProvider && !isColdCatalog) {
    void refreshModelCatalog({
      configPath,
      repoPath: options.repoPath,
      loaded,
      stored,
      resolveExecutable,
      spawnFn,
    }).catch(() => undefined);
  }

  // Elección actual del uso
  let current: AiUseModelsResult['current'] = null;
  try {
    if (options.use === 'gitcron-sdd') {
      const agentRes = resolveAgentFor({
        configPath,
        repoPath: options.repoPath,
        loaded,
        stored,
      });
      if (agentRes.status === 'resolved') {
        current = {
          providerId: agentRes.providerId,
          modelId: agentRes.modelId,
          fullModelRef: agentRes.modelRef,
          effort: agentRes.effort,
          sourceFile: agentRes.sourceFile,
          scope: loaded.files.find((f) => f.scope === 'repo')?.path === agentRes.sourceFile ? 'repo' : 'global',
        };
      }
    } else {
      const resolvedTarget = resolveModelFor(options.use, {
        configPath,
        repoPath: options.repoPath,
        loaded,
        stored,
      });
      if (resolvedTarget.status === 'resolved') {
        const { resolved } = resolvedTarget;
        current = {
          providerId: resolved.providerId,
          modelId: resolved.modelId,
          fullModelRef: `${resolved.providerId}/${resolved.modelId}`,
          effort:
            typeof resolved.options?.reasoning_effort === 'string'
              ? resolved.options.reasoning_effort
              : undefined,
          variant: resolved.variant,
          sourceFile: resolved.sourceFile,
          scope: resolved.provenance.repoFile ? 'repo' : 'global',
        };
      }
    }
  } catch {
    // Si no se puede resolver la elección actual, sigue con null
  }

  return {
    use: options.use,
    providers,
    current,
  };
}

/**
 * Inicializa el catálogo de fondo con un proveedor de contexto dinámico:
 * - Unos segundos después del arranque
 * - Cada 10 minutos
 */
export function initModelCatalogLifecycle(provider?: CatalogContextProvider): void {
  if (provider) {
    contextProvider = provider;
  }
  if (recurringTimer) return;

  const getCtx = () => (contextProvider ? contextProvider() : {});

  // Unos segundos después (2,5 s) para no trabar el arranque de la app
  const initialDelay = setTimeout(() => {
    void refreshModelCatalog(getCtx()).catch(() => undefined);
  }, 2500);
  initialDelay.unref?.();

  // Cada 10 minutos
  recurringTimer = setInterval(() => {
    void refreshModelCatalog(getCtx()).catch(() => undefined);
  }, 10 * 60 * 1000);
  recurringTimer.unref?.();
}
