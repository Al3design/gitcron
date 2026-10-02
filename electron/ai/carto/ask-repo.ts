// electron/ai/carto/ask-repo.ts
//
// Cartografía — Fase 6 (ventanita de preguntas). Orquestador de "preguntar al
// repo": recupera del grafo los nodos que tocan la pregunta (búsqueda por nombre +
// vecinos por relación), arma un contexto CHICO y dispara el proveedor de IA para
// responder en castellano citando archivos reales. Corre SIEMPRE en main.
//
// Invariantes de la fase:
//  · El contexto se RECUPERA, no se vuelca: sólo los nodos relevantes a la pregunta,
//    nunca el repo entero (todo acotado por los topes `RETRIEVE_*` del motor).
//  · Per-repo: la pregunta va contra el índice del `repoPath` activo. Cambiar de
//    solapa cambia el repo, porque el índice es per-repo.
//  · IA opt-in: si está apagada o el proveedor falla, se devuelve un error claro y
//    la vista sigue funcionando.

import type {
  CartoAIContext,
  CartoAskResult,
} from '../../../types/carto-ai';
import type { CartoNode } from '../../../lib/carto-types';
import { graphRetrieve } from '../../carto/graph-engine';
import { getCartoAISettings, getCartoProvider } from './index';
import { buildAskPrompts } from './prompts';

/** Normaliza el código de idioma de la respuesta (default español). */
function normalizeLang(lang?: string): string {
  return lang === 'en' || lang === 'zh' ? lang : 'es';
}

/** Traduce los nodos recuperados al contexto que consume el prompt de la IA. */
function toAskContext(nodes: CartoNode[], relations: string[], lang: string): CartoAIContext {
  return {
    lang,
    retrieved: {
      symbols: nodes.map((n) => ({
        name: n.name,
        kind: n.kind,
        filePath: n.filePath,
        ...(n.signature ? { signature: n.signature } : {}),
      })),
      relations,
    },
  };
}

/** Archivos distintos citados por los nodos recuperados (orden estable). */
function distinctFiles(nodes: CartoNode[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const n of nodes) {
    if (n.filePath && !seen.has(n.filePath)) {
      seen.add(n.filePath);
      files.push(n.filePath);
    }
  }
  return files.sort();
}

/**
 * Responde una pregunta libre scoped al repo activo. Recupera el contexto del grafo,
 * lo manda al proveedor activo y devuelve la respuesta junto con los nodos/archivos
 * que la fundamentan (para citarlos y abrir su detalle). Lanza si el índice no está
 * listo o si la IA está apagada/caída — el IPC lo traduce a un error claro.
 */
export async function askRepo(
  repoPath: string,
  question: string,
  lang?: string,
): Promise<CartoAskResult> {
  const settings = getCartoAISettings();
  if (!settings.enabled) {
    throw new Error('La IA de Cartografía está desactivada. Activala en Ajustes → Cartografía.');
  }

  const retrieval = graphRetrieve(repoPath, question);
  if (!retrieval) {
    throw new Error('El índice del repo todavía no está listo. Esperá a que termine de indexar.');
  }

  const normLang = normalizeLang(lang);
  const context = toAskContext(retrieval.nodes, retrieval.relations, normLang);
  const { system, user } = buildAskPrompts(question, context);
  const promptChars = system.length + user.length;

  const provider = getCartoProvider(settings, repoPath);
  const answer = await provider.ask(question, context);

  return {
    answer,
    usedNodes: retrieval.nodes,
    usedFiles: distinctFiles(retrieval.nodes),
    promptChars,
  };
}
