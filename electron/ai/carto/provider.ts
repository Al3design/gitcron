// electron/ai/carto/provider.ts
//
// Cartografía — el proveedor de IA. Corre SIEMPRE en el proceso main: acá se arma y
// dispara la petición, nunca en el renderer, así la CSP del renderer permanece
// cerrada.
//
// Desde la tarea 4.3 de modelos-en-casa no hay un proveedor local y otro online
// escritos acá: el modelo sale de `agent.gitcron-cartography` en gitcron.json (o de
// la elección general) y el pedido va por el camino común (`runTextUse`), que habla
// con cualquier servidor del estándar de OpenAI, con Anthropic o con un CLI.
//
// La interfaz es deliberadamente chica: explain, ask y panorama devuelven texto
// plano ({@link CartoAIResponse}), porque acá la salida es prosa para leer.

import type {
  CartoAINodeRef,
  CartoAIContext,
  CartoAIResponse,
  CartoAIPanoramaContext,
} from '../../../types/carto-ai';
import type { ResolvedModelFor } from '../config/resolve-model-for';
import { modelLabel, probeTextUse, requireResolved, runTextUse, type TextUseDeps } from '../text-use';
import { buildAskPrompts, buildExplainPrompts, buildPanoramaPrompts } from './prompts';

/**
 * Ventana generosa: un modelo local puede tardar minutos (CPU/GPU modesta, primer
 * pedido sin calentar). El tope de 30 s que había los cortaba siempre; 5 minutos es
 * un tope contra cuelgues, no una expectativa.
 */
const CARTO_TIMEOUT_MS = 300_000;

export interface CartoAIProvider {
  /** El proveedor de gitcron.json (`lmstudio`, `openrouter`, `codex`…). */
  id: string;
  /** «Proveedor · modelo», lo que se muestra. */
  label: string;
  modelId: string;
  /** Explica un símbolo del grafo, anclado en sus relaciones reales. */
  explain(node: CartoAINodeRef, context: CartoAIContext): Promise<CartoAIResponse>;
  /** Responde una pregunta libre, con el contexto disponible como anclaje. */
  ask(question: string, context: CartoAIContext): Promise<CartoAIResponse>;
  /** Genera orientación top-down para la lente Panorama, anclada en grupos. */
  panorama(context: CartoAIPanoramaContext): Promise<CartoAIResponse>;
  /** Comprueba que se puede usar SIN gastar una generación. Lanza con el motivo. */
  probe(): Promise<void>;
}

/** Empaqueta el texto del modelo en la respuesta serializable de la vista. */
export function toResponse(text: string, provider: string): CartoAIResponse {
  return { text, provider, generatedAt: new Date().toISOString() };
}

/** Lanza si el uso no tiene modelo, está apagado o su proveedor no está disponible. */
export function createCartoProvider(target: ResolvedModelFor, deps: TextUseDeps = {}, repoPath?: string | null): CartoAIProvider {
  const { resolved } = requireResolved(target);
  const tag = `${resolved.providerId}:${resolved.modelId}`;

  async function run(system: string, user: string): Promise<CartoAIResponse> {
    const { text, finishReason } = await runTextUse(target, { system, user, timeoutMs: CARTO_TIMEOUT_MS, repoPath }, deps);
    if (!text) {
      if (finishReason === 'length') throw new Error(`${modelLabel(resolved)}: respuesta cortada (max_tokens muy bajo)`);
      throw new Error(`${modelLabel(resolved)}: respuesta vacía del modelo`);
    }
    return toResponse(text, tag);
  }

  return {
    id: resolved.providerId,
    label: modelLabel(resolved),
    modelId: resolved.modelId,
    explain(node, context) {
      const { system, user } = buildExplainPrompts(node, context);
      return run(system, user);
    },
    ask(question, context) {
      const { system, user } = buildAskPrompts(question, context);
      return run(system, user);
    },
    panorama(context) {
      const { system, user } = buildPanoramaPrompts(context);
      return run(system, user);
    },
    probe: () => probeTextUse(target, deps),
  };
}
