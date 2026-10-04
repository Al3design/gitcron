// electron/ai/config/provider-models.ts
//
// Los modelos de un proveedor: los declarados en gitcron.json y los que el servidor
// reporta en el momento (tarea 4.1, requisito «Cada proveedor lista sus modelos»).
//
// El piso es el estándar de OpenAI (D11b): `GET {baseURL}/models`. Si además el
// servidor responde la API nativa de LM Studio (`/api/v1/models`), se suman tipo,
// carga, contexto cargado y contexto máximo, y se aplica el criterio vigente de la
// redacción (sólo `llm` cuando el servidor informa el tipo). Esa capa es opcional:
// un servidor que sólo habla el estándar lista igual, sin estado de carga.

import { parseModelCatalog } from '../commit-message/local-provider';
import type { LocalModel } from '../../../types/commit-message-ai';
import {
  loadGitCronConfig,
  RESERVED_CLI_IDS,
  substituteReferences,
  type GitCronProviderConfig,
  type LoadedGitCronConfig,
  type ReservedCliId,
} from './gitcron-config';
import { updateGitCronConfigValue, type ConfigWriteResult } from './gitcron-config-writer';

export interface ProviderModelEntry {
  id: string;
  /** El nombre declarado en el archivo, o el de LM Studio si no hay. */
  name?: string;
  /** Está en gitcron.json. */
  declared: boolean;
  /** El servidor lo reportó ahora. Un declarado sin confirmar es `false`. */
  reported: boolean;
  limit?: { context?: number; output?: number };
  /** Sólo si el servidor habla también la API de LM Studio. */
  lmstudio?: Pick<LocalModel, 'kind' | 'loaded' | 'loadedContextLength' | 'maxContextLength'>;
}

export interface ProviderModelList {
  providerId: string;
  /**
   * `ok`: el servidor respondió. `unreachable`: no respondió, y los declarados se
   * muestran sin confirmar. `unavailable`: no se puede ni preguntar (sin dirección,
   * falta una variable). `cli`: los CLI listan sus modelos por su lado (D17).
   */
  status: 'ok' | 'unreachable' | 'unavailable' | 'cli';
  detail?: string;
  /** Si se sumó la capa de LM Studio. */
  lmstudioLayer: boolean;
  models: ProviderModelEntry[];
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Los ids de `GET /models` del estándar (`{ data: [{ id }] }`), sin confiar en la forma. */
export function parseStandardModels(payload: unknown): string[] {
  if (!isObject(payload) || !Array.isArray(payload.data)) return [];
  return payload.data
    .map((entry) => (isObject(entry) && typeof entry.id === 'string' ? entry.id : null))
    .filter((id): id is string => id !== null);
}

/** La raíz del servidor a partir de la dirección compatible (`http://x:1234/v1` → `http://x:1234`). */
export function serverOrigin(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
}

interface CanLoadCacheEntry {
  canLoad: boolean;
  timestamp: number;
}
const canLoadCache = new Map<string, CanLoadCacheEntry>();
const CAN_LOAD_CACHE_TTL_MS = 15_000;
let canLoadFetchOverride: FetchFn | null = null;

export function setCanLoadFetchForTesting(fn: FetchFn | null): void {
  canLoadFetchOverride = fn;
}

export function clearCanLoadCacheForTesting(): void {
  canLoadCache.clear();
}

/**
 * Capacidad de carga (D11, D6): el servidor del proveedor responde la API nativa
 * de LM Studio (`/api/v1/models`). Con una caché corta de 15 s para no golpearlo
 * en cada consulta de estado.
 */
export async function detectCanLoad(
  serverUrl: string,
  options: { fetchFn?: FetchFn; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<boolean> {
  const origin = serverOrigin(serverUrl);
  const cached = canLoadCache.get(origin);
  if (cached && Date.now() - cached.timestamp < CAN_LOAD_CACHE_TTL_MS) {
    return cached.canLoad;
  }
  const fetchFn = options.fetchFn ?? canLoadFetchOverride ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2000;
  let canLoad = false;
  try {
    const res = await fetchFn(`${origin}/api/v1/models`, {
      method: 'GET',
      headers: options.headers ?? {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    canLoad = res.ok;
  } catch {
    canLoad = false;
  }
  canLoadCache.set(origin, { canLoad, timestamp: Date.now() });
  return canLoad;
}

export async function listProviderModels(
  providerId: string,
  options: {
    configPath?: string;
    repoPath?: string | null;
    env?: NodeJS.ProcessEnv;
    stored?: (name: string) => string | undefined;
    loaded?: LoadedGitCronConfig;
    fetchFn?: FetchFn;
    timeoutMs?: number;
  } = {},
): Promise<ProviderModelList> {
  const base: ProviderModelList = { providerId, status: 'unavailable', lmstudioLayer: false, models: [] };
  if (RESERVED_CLI_IDS.includes(providerId as ReservedCliId)) return { ...base, status: 'cli' };

  const loaded = options.loaded ?? loadGitCronConfig({ globalPath: options.configPath, repoPath: options.repoPath });
  const provider = loaded.config?.provider?.[providerId] as GitCronProviderConfig | undefined;
  if (!provider) return { ...base, detail: `Proveedor «${providerId}» no declarado en provider` };

  const declared: ProviderModelEntry[] = Object.entries(provider.models ?? {}).map(([id, model]) => ({
    id,
    ...(typeof model?.name === 'string' ? { name: model.name } : {}),
    declared: true,
    reported: false,
    ...(isObject(model?.limit) ? { limit: model.limit as ProviderModelEntry['limit'] } : {}),
  }));

  const resolved = substituteReferences(provider.options ?? {}, { env: options.env, stored: options.stored });
  const baseURL = typeof resolved.value.baseURL === 'string' ? resolved.value.baseURL : undefined;
  const firstMissing = resolved.missing[0];
  if (!baseURL || firstMissing) {
    const detail = firstMissing
      ? (firstMissing.kind === 'env' ? `Variable de entorno ${firstMissing.name} no definida` : `Archivo ${firstMissing.name} no encontrado`)
      : `el proveedor ${providerId} no declara options.baseURL`;
    return { ...base, detail, models: declared };
  }

  const headers: Record<string, string> = { ...((resolved.value.headers ?? {}) as Record<string, string>) };
  if (typeof resolved.value.apiKey === 'string' && resolved.value.apiKey.trim()) {
    headers.authorization = `Bearer ${resolved.value.apiKey.trim()}`;
  }
  const fetchFn: FetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const get = (url: string) => fetchFn(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });

  let reportedIds: string[];
  try {
    const res = await get(`${baseURL.replace(/\/+$/, '')}/models`);
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    reportedIds = parseStandardModels(await res.json());
  } catch (error) {
    // No respondió: los declarados se muestran, pero sin confirmar.
    return { ...base, status: 'unreachable', detail: error instanceof Error ? error.message : String(error), models: declared };
  }

  // Capa opcional de LM Studio: detectada, nunca requerida.
  let lmstudio: Map<string, LocalModel> | null = null;
  try {
    const res = await get(`${serverOrigin(baseURL)}/api/v1/models`);
    if (res.ok) {
      const catalog = parseModelCatalog(await res.json());
      if (catalog.length > 0) lmstudio = new Map(catalog.map((model) => [model.id, model]));
    }
  } catch {
    // Sin la capa: se sigue con el estándar.
  }

  const byId = new Map(declared.map((entry) => [entry.id, entry]));
  const ids = [...declared.map((entry) => entry.id), ...reportedIds.filter((id) => !byId.has(id))];
  const models: ProviderModelEntry[] = [];
  for (const id of ids) {
    const extra = lmstudio?.get(id);
    // Criterio vigente de la redacción: con el tipo informado, sólo `llm`.
    if (extra && extra.kind && extra.kind !== 'llm') continue;
    const entry: ProviderModelEntry = byId.get(id) ?? { id, declared: false, reported: false };
    entry.reported = reportedIds.includes(id);
    if (extra) {
      if (!entry.name && extra.displayName) entry.name = extra.displayName;
      entry.lmstudio = {
        kind: extra.kind,
        loaded: extra.loaded,
        loadedContextLength: extra.loadedContextLength,
        maxContextLength: extra.maxContextLength,
      };
    }
    models.push(entry);
  }
  return { ...base, status: 'ok', lmstudioLayer: lmstudio !== null, models };
}

/**
 * «Agregar al archivo»: declara un modelo reportado en el mismo archivo que declara
 * su proveedor (el global o el del repositorio), como escritura puntual.
 */
export function addModelToConfig(options: {
  providerId: string;
  modelId: string;
  name?: string;
  loaded: LoadedGitCronConfig;
}): ConfigWriteResult | { ok: false; reason: 'no-provider' } {
  const file = options.loaded.originOf(['provider', options.providerId]);
  if (!file) return { ok: false, reason: 'no-provider' };
  return updateGitCronConfigValue({
    filePath: file,
    segments: ['provider', options.providerId, 'models', options.modelId],
    value: options.name ? { name: options.name } : {},
  });
}

/**
 * «Quitar del archivo»: elimina un modelo declarado en el mismo archivo que declara
 * su proveedor (el global o el del repositorio), como escritura puntual.
 */
export function removeModelFromConfig(options: {
  providerId: string;
  modelId: string;
  loaded: LoadedGitCronConfig;
}): ConfigWriteResult | { ok: false; reason: 'no-provider' } {
  const file = options.loaded.originOf(['provider', options.providerId]);
  if (!file) return { ok: false, reason: 'no-provider' };
  return updateGitCronConfigValue({
    filePath: file,
    segments: ['provider', options.providerId, 'models', options.modelId],
    value: undefined,
  });
}
