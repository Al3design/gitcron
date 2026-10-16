// electron/ai/config/resolve-model-for.ts
//
// `resolveModelFor(uso)` (tarea 4.3, D6, D7): qué modelo usa cada uso de texto de
// GitCron, con su destino y de dónde sale. Todos los usos pasan por acá; ninguno
// tiene un proveedor fijo.
//
// - La entrada `agent.<uso>` manda; sin `model`, el uso sigue la elección general
//   (`model` del nivel superior). Sin ninguna de las dos, el uso no tiene modelo y
//   la pantalla ofrece escribir lo que la persona tenía elegido (legacy-choice.ts).
// - `disable: true` en la entrada apaga el uso.
// - Si el proveedor no responde, el uso falla con el motivo (D7). Los proveedores que
//   declaran el mismo conjunto de modelos se informan como alternativa: la pantalla
//   los ofrece y nunca se cambia solo.

import {
  determineDestination,
  loadGitCronConfig,
  resolveUse,
  type GitCronConfig,
  type ProviderDestination,
  type ResolvedUse,
  type ResolveUseOptions,
} from './gitcron-config';

/** Los usos de texto de GitCron (D1). `gitcron-sdd` es de agente, no de texto. */
export const TEXT_USES = ['gitcron-commit', 'gitcron-cartography', 'gitcron-openspec-analysis', 'gitcron-temporal', 'gitcron-assist'] as const;
export type TextUse = (typeof TEXT_USES)[number];

export function isTextUse(value: unknown): value is TextUse {
  return typeof value === 'string' && (TEXT_USES as readonly string[]).includes(value);
}

/** Usos de agente de GitCron (D1). */
export const AGENT_USES = ['gitcron-sdd'] as const;
export type AgentUse = (typeof AGENT_USES)[number];

export function isAgentUse(value: unknown): value is AgentUse {
  return typeof value === 'string' && (AGENT_USES as readonly string[]).includes(value);
}

export const AI_USES = [...TEXT_USES, ...AGENT_USES] as const;
export type AiUse = TextUse | AgentUse;

export function isAiUse(value: unknown): value is AiUse {
  return isTextUse(value) || isAgentUse(value);
}

/** Cómo se nombra cada uso en los mensajes. */
export const TEXT_USE_LABEL: Record<TextUse, string> = {
  'gitcron-commit': 'La redacción del commit',
  'gitcron-cartography': 'Cartografía',
  'gitcron-openspec-analysis': 'El análisis de versión de OpenSpec',
  'gitcron-temporal': 'El Agente Temporal',
  'gitcron-assist': 'El asistente',
};

export interface ModelAlternative {
  providerId: string;
  providerName: string;
  destination: ProviderDestination;
}

export type ResolvedModelFor =
  | { status: 'resolved'; use: TextUse; resolved: ResolvedUse; alternatives: ModelAlternative[] }
  | { status: 'disabled'; use: TextUse; sourceFile?: string }
  | { status: 'unset'; use: TextUse };

/**
 * El proveedor del selector de LM Studio de la redacción y del análisis. Es el id
 * que la migración y «usar lo que tenías» escriben; la dirección sale del archivo.
 */
export const SCREEN_PROVIDER_ID = 'lmstudio';

export interface ResolveModelForOptions extends ResolveUseOptions {
  /**
   * El modelo elegido en el selector de la pantalla. Vale sólo si el uso no tiene
   * modelo en gitcron.json, y va por el proveedor `lmstudio` que declare el archivo:
   * no hay dirección fija.
   */
  screenModel?: string | null;
}

/**
 * Otros proveedores que declaran exactamente los mismos ids de modelo que el
 * elegido (D7): el mismo servidor por otra dirección, por ejemplo.
 */
export function sameModelProviders(config: GitCronConfig, providerId: string, modelId: string): ModelAlternative[] {
  const providers = config.provider ?? {};
  const own = Object.keys(providers[providerId]?.models ?? {}).sort();
  if (own.length === 0 || !own.includes(modelId)) return [];
  const sameSet = (ids: string[]) => ids.length === own.length && ids.every((id, i) => id === own[i]);
  return Object.entries(providers)
    .filter(([id, block]) => id !== providerId && sameSet(Object.keys(block?.models ?? {}).sort()))
    .map(([id, block]) => {
      const baseURL = typeof block?.options?.baseURL === 'string' && !block.options.baseURL.includes('{')
        ? block.options.baseURL
        : undefined;
      return {
        providerId: id,
        providerName: block?.name || id,
        destination: baseURL ? determineDestination(baseURL, 'openai-compatible') : 'external-service',
      };
    });
}

/**
 * Lanza `GitCronConfigError` si un archivo está roto y no hay versión anterior,
 * igual que `resolveUse`.
 */
export function resolveModelFor(use: TextUse, options: ResolveModelForOptions = {}): ResolvedModelFor {
  const loaded = options.loaded ?? loadGitCronConfig({ globalPath: options.configPath, repoPath: options.repoPath });
  const entry = loaded.config?.agent?.[use];
  if (entry?.disable === true) {
    return { status: 'disabled', use, sourceFile: loaded.originOf(['agent', use, 'disable']) };
  }
  const { screenModel, ...useOptions } = options;
  const screenModelRef = screenModel?.trim() ? `${SCREEN_PROVIDER_ID}/${screenModel.trim()}` : undefined;
  const resolved = resolveUse(use, { ...useOptions, loaded, screenModelRef });
  if (!resolved) return { status: 'unset', use };
  const alternatives = resolved.kind === 'openai-compatible' && loaded.config
    ? sameModelProviders(loaded.config, resolved.providerId, resolved.modelId)
    : [];
  return { status: 'resolved', use, resolved, alternatives };
}
