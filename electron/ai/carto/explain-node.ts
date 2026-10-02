// electron/ai/carto/explain-node.ts
//
// Cartografía — Fase 5. Orquestador de "explicar un nodo": arma el contexto mínimo
// desde el grafo, consulta la CACHÉ por contenido y, sólo si hace falta, dispara el
// proveedor de IA y guarda el resultado. Corre SIEMPRE en main.
//
// Invariantes de la fase:
//  · El contexto se arma SOLO con datos reales y recortados (código del nodo +
//    callers/callees/impacto del grafo). Nunca el repo entero.
//  · La estructura se devuelve SIEMPRE (aunque la IA esté apagada o falle): el panel
//    puede mostrar ruta + relaciones + impacto sin modelo.
//  · La IA es opt-in y se cachea: si el nodo no cambió (mismo `contentHash`), se
//    reusa la explicación guardada y NO se re-llama al modelo.

import type {
  CartoAIContext,
  CartoExplainNodeResult,
  CartoNodeContext,
} from '../../../types/carto-ai';
import { graphNodeContext } from '../../carto/graph-engine';
import { getCartoExplanation, upsertCartoExplanation } from '../../db/carto-cache';
import { getCartoAISettings, getCartoProvider } from './index';
import { buildExplainPrompts } from './prompts';

/** Normaliza el código de idioma para la clave de caché (default español). */
function normalizeLang(lang?: string): string {
  return lang === 'en' || lang === 'zh' ? lang : 'es';
}

/** Traduce el contexto del nodo a la forma que consume el prompt de la IA. */
function toAIContext(ctx: CartoNodeContext, lang: string): CartoAIContext {
  return {
    lang,
    filePath: ctx.node.filePath,
    source: ctx.source || undefined,
    callers: ctx.callers.map((r) => `${r.name} — ${r.filePath}`),
    callees: ctx.callees.map((r) => `${r.name} — ${r.filePath}`),
    impact: {
      fileCount: ctx.impact.impactedFiles.length,
      symbolCount: ctx.impact.total,
      sampleFiles: ctx.impact.impactedFiles.slice(0, 15),
    },
  };
}

/** Tamaño (caracteres) del contexto que se enviaría al modelo, para el reporte. */
function measurePrompt(ctx: CartoNodeContext, lang: string): number {
  const { system, user } = buildExplainPrompts(ctx.node, toAIContext(ctx, lang));
  return system.length + user.length;
}

/**
 * Explica un nodo del grafo. Devuelve SIEMPRE el contexto estructural; la
 * explicación de la IA sólo cuando está activa y disponible (de caché o generada).
 * Lanza únicamente si el nodo no está en el grafo o el índice no está listo —
 * cualquier fallo del modelo se reporta en `aiError` sin tirar la estructura.
 */
export async function explainNode(
  repoPath: string,
  nodeId: string,
  lang?: string,
): Promise<CartoExplainNodeResult> {
  const context = await graphNodeContext(repoPath, nodeId);
  if (!context) {
    throw new Error('El nodo no está en el grafo, o el índice todavía no está listo.');
  }

  const normLang = normalizeLang(lang);
  const promptChars = measurePrompt(context, normLang);

  const settings = getCartoAISettings();
  if (!settings.enabled) {
    // IA apagada: el panel muestra sólo la estructura.
    return { context, explanation: null, cached: false, promptChars };
  }

  // ── Caché por contenido: si el nodo no cambió, no re-llamamos al modelo ──
  const key = {
    repoPath,
    nodePath: context.nodePath,
    contentHash: context.contentHash,
    lang: normLang,
  };
  const hit = getCartoExplanation(key);
  if (hit) {
    return {
      context,
      explanation: { text: hit.explanation, provider: hit.provider, generatedAt: hit.generatedAt },
      cached: true,
      promptChars,
    };
  }

  // ── Generación: dispara el proveedor activo y persiste el resultado ──
  try {
    const provider = getCartoProvider(settings, repoPath);
    const data = await provider.explain(context.node, toAIContext(context, normLang));
    upsertCartoExplanation({
      ...key,
      provider: data.provider,
      model: provider.modelId,
      explanation: data.text,
      generatedAt: data.generatedAt,
    });
    return { context, explanation: data, cached: false, promptChars };
  } catch (error) {
    const aiError = error instanceof Error ? error.message : String(error);
    return { context, explanation: null, cached: false, aiError, promptChars };
  }
}
