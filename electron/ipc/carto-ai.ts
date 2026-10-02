// electron/ipc/carto-ai.ts
//
// Cartografía — Fase 4. Bridge IPC de la capa de IA. Mismo patrón que el resto:
// cada canal devuelve `{ success, data?, error? }` y nunca expone secretos (las
// keys viven en el vault de main y jamás cruzan este límite).
//
// Invariante central: la IA NUNCA se dispara sola. Estos handlers sólo corren en
// respuesta a una acción explícita del renderer (el usuario apretó "preguntar" o
// "explicar"). Con la IA apagada o el proveedor caído, devuelven un error claro
// y la vista sigue funcionando sin IA.

import { ipcMain } from 'electron';
import type {
  CartoAINodeRef,
  CartoAIContext,
  CartoAISettings,
  CartoAIProbe,
} from '../../types/carto-ai';
import {
  getCartoAISettings,
  setCartoAISettings,
  getCartoProvider,
} from '../ai/carto';
import { explainNode } from '../ai/carto/explain-node';
import { askRepo } from '../ai/carto/ask-repo';
import { panoramaRepo } from '../ai/carto/panorama';
import { errMsg } from './shared';

type Result<T> = { success: boolean; data?: T; error?: string };

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}
function fail<T>(error: unknown): Result<T> {
  return { success: false, error: errMsg(error) };
}

export function registerCartoAiHandlers(): void {
  // ── Preferencias (opt-in, apagado por defecto) ──
  ipcMain.handle('carto:ai-get-settings', () => {
    try {
      return ok(getCartoAISettings());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('carto:ai-set-settings', (_e, patch: Partial<CartoAISettings>) => {
    try {
      return ok(setCartoAISettings(patch ?? {}));
    } catch (error) {
      return fail(error);
    }
  });

  // ── Sondeo de disponibilidad (sin gastar una generación) ──
  // El proveedor sale de gitcron.json (tarea 4.3): se nombra con su modelo.
  ipcMain.handle('carto:ai-probe', async (_e, repoPath?: unknown): Promise<Result<CartoAIProbe>> => {
    const settings = getCartoAISettings();
    if (!settings.enabled) {
      return ok({ available: false, provider: '', detail: 'IA desactivada' });
    }
    try {
      const provider = getCartoProvider(settings, typeof repoPath === 'string' ? repoPath : null);
      await provider.probe();
      return ok({ available: true, provider: provider.label });
    } catch (error) {
      return ok({ available: false, provider: '', detail: errMsg(error) });
    }
  });

  // ── Explicar un nodo del grafo ──
  ipcMain.handle('carto:ai-explain', async (_e, node: CartoAINodeRef, context: CartoAIContext) => {
    try {
      if (!node || !node.name) return { success: false, error: 'Nodo inválido' };
      const provider = getCartoProvider();
      const data = await provider.explain(node, context ?? {});
      return ok(data);
    } catch (error) {
      return fail(error);
    }
  });

  // ── Explicar un nodo del grafo, con contexto mínimo + caché (Fase 5) ──
  // Devuelve SIEMPRE la estructura (ruta, relaciones, impacto), y la explicación
  // de la IA cuando está activa y disponible. No lanza por fallos del modelo: los
  // reporta en `aiError` para que el panel siga mostrando la estructura.
  ipcMain.handle('carto:ai-explain-node', async (_e, repoPath: string, nodeId: string, lang?: string) => {
    try {
      if (!repoPath || !nodeId) return { success: false, error: 'Parámetros inválidos' };
      return ok(await explainNode(repoPath, nodeId, lang));
    } catch (error) {
      return fail(error);
    }
  });

  // ── Pregunta libre (la "ventanita de preguntas") ──
  ipcMain.handle('carto:ai-ask', async (_e, question: string, context: CartoAIContext) => {
    try {
      if (!question || !question.trim()) return { success: false, error: 'Pregunta vacía' };
      const provider = getCartoProvider();
      const data = await provider.ask(question, context ?? {});
      return ok(data);
    } catch (error) {
      return fail(error);
    }
  });

  // ── Pregunta libre scoped al repo, con recuperación estructural (Fase 6) ──
  // Recupera del grafo los nodos que tocan la pregunta (búsqueda por nombre +
  // vecinos), arma un contexto chico y responde citando archivos reales. Devuelve
  // los nodos/archivos usados para mostrarlos clickeables en la vista.
  ipcMain.handle('carto:ai-ask-repo', async (_e, repoPath: string, question: string, lang?: string) => {
    try {
      if (!repoPath) return { success: false, error: 'Repo inválido' };
      if (!question || !question.trim()) return { success: false, error: 'Pregunta vacía' };
      return ok(await askRepo(repoPath, question, lang));
    } catch (error) {
      return fail(error);
    }
  });

  // ── Panorama top-down (Fase 8) ──
  // Genera orientación sólo si la IA está activa; si hay cache para el hash de
  // estructura vigente, devuelve el texto guardado sin re-llamar al proveedor.
  ipcMain.handle(
    'carto:ai-panorama',
    async (_e, repoPath: string, lang?: string, forceRefresh?: boolean) => {
      try {
        if (!repoPath) return { success: false, error: 'Repo inválido' };
        return ok(await panoramaRepo(repoPath, lang, Boolean(forceRefresh)));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
