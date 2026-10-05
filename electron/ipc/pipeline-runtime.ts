import { ipcMain } from 'electron';
import type { PipelineAgentRole } from '../../types/pipeline';
import { resolveAgentFor } from '../ai/config/resolve-agent-for';
import { fetchOpenCodeModelList, findOpenCodeModel } from '../ai/config/opencode-models';
import { activeConfigPath } from '../ai/use-resolution';
import { PipelineService } from '../pipeline/pipeline-service';
import type { RuntimeSessionHub } from '../pipeline/runtime/runtime-session-hub';
import { errMsg, validRepoPath } from './shared';

/**
 * Canales `pipeline:runtime:*` — sesiones de runtime vivas.
 *
 * Separado de `pipeline.ts` a propósito: aquél lee evidencia escrita en el repo
 * y es de sólo lectura; éste abre procesos. Mezclarlos escondería que hay una
 * superficie con capacidad de ejecución detrás de la misma pestaña.
 *
 * Todo lo que llega del renderer se valida acá: la ruta, la instrucción y el
 * rol se validan acá; el motor y el modelo los resuelve el proceso principal
 * a partir de la configuración del repositorio (tarea 5.1).
 */

const MAX_INSTRUCTION_BYTES = 16_384;

const ROLES: PipelineAgentRole[] = ['scout', 'planner', 'builder', 'auditor', 'fixer', 'orchestrator', 'unknown'];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function registerPipelineRuntimeHandlers(
  hub: RuntimeSessionHub,
  service = new PipelineService(),
): void {
  ipcMain.handle('pipeline:runtime:discover', async (_event, repoPath: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    try {
      const { canonicalPath } = await service.resolveBinding(repoPath);
      return { success: true, data: await hub.discover(canonicalPath) };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('pipeline:runtime:get', async (_event, repoPath: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    try {
      const { canonicalPath } = await service.resolveBinding(repoPath);
      return { success: true, data: hub.get(canonicalPath) };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('pipeline:runtime:history', async (_event, repoPath: unknown, requestedLimit: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    const limit = typeof requestedLimit === 'number' && Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100))
      : 20;
    try {
      const { repoId } = await service.resolveBinding(repoPath);
      return { success: true, data: hub.history(repoId, limit) };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('pipeline:runtime:start', async (_event, payload: unknown) => {
    const input = asRecord(payload);
    const repoPath = input.repoPath;
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };

    const role = typeof input.role === 'string' && ROLES.includes(input.role as PipelineAgentRole)
      ? input.role as PipelineAgentRole
      // Un rol desconocido no se adivina como `builder`: se declara desconocido.
      : 'unknown';

    const instruction = input.instruction;
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      return { success: false, error: 'La instrucción es obligatoria' };
    }
    if (Buffer.byteLength(instruction) > MAX_INSTRUCTION_BYTES) {
      return { success: false, error: 'La instrucción excede el límite permitido' };
    }

    const changeId = typeof input.changeId === 'string' && input.changeId.length > 0
      ? input.changeId
      : null;
    const taskId = typeof input.taskId === 'string' && input.taskId.length > 0 && input.taskId.length <= 256
      ? input.taskId
      : null;

    try {
      const { canonicalPath, repoId } = await service.resolveBinding(repoPath);

      // El mismo gitcron.json global que lee la línea del uso en la pantalla.
      const agentRes = resolveAgentFor({ configPath: activeConfigPath(), repoPath: canonicalPath });
      if (agentRes.status === 'unset') {
        return { success: false, error: 'no_model' };
      }
      if (agentRes.status === 'disabled') {
        return { success: false, error: 'disabled' };
      }

      if (agentRes.runtime === 'agy') {
        return { success: false, error: 'unsupported_runtime_agy' };
      }

      let requestedModel = agentRes.modelId;
      let reasoningEffort: string | null = agentRes.effort ?? null;

      if (agentRes.runtime === 'opencode') {
        const discovery = await hub.discover(canonicalPath);
        const entry = discovery.find((d) => d.runtime === 'opencode');
        if (!entry || !entry.installed) {
          return { success: false, error: 'opencode_not_installed' };
        }
        if (!entry.launchable) {
          return { success: false, error: 'runtime_not_launchable' };
        }

        const listRes = await fetchOpenCodeModelList(canonicalPath);
        if (!listRes.installed) {
          return { success: false, error: 'opencode_not_installed' };
        }
        if (listRes.error) {
          return { success: false, error: 'opencode_list_failed' };
        }
        const knownModel = findOpenCodeModel(listRes.models, agentRes.providerId, agentRes.modelId);
        if (!knownModel) {
          return { success: false, error: 'opencode_unknown_model' };
        }

        const resolvedWithModels = resolveAgentFor({
          configPath: activeConfigPath(),
          repoPath: canonicalPath,
          opencodeModels: listRes.models,
        });
        if (resolvedWithModels.status !== 'resolved') {
          return { success: false, error: 'no_model' };
        }
        if (input.expectedModel !== resolvedWithModels.launchKey) {
          return { success: false, error: 'model_mismatch' };
        }
        const variant = resolvedWithModels.variant;
        requestedModel = variant ? `${agentRes.modelRef}#${variant}` : agentRes.modelRef;
        reasoningEffort = null;
      } else {
        // La pantalla devuelve la clave de lo que mostró; sin ella, o si el archivo cambió
        // desde entonces, no se lanza nada: se lanza sólo lo que la persona confirmó.
        if (input.expectedModel !== agentRes.launchKey) {
          return { success: false, error: 'model_mismatch' };
        }

        const discovery = await hub.discover(canonicalPath);
        const entry = discovery.find((d) => d.runtime === agentRes.runtime);
        if (!entry || !entry.installed) {
          return { success: false, error: 'runtime_not_installed' };
        }
        if (!entry.launchable) {
          return { success: false, error: 'runtime_not_launchable' };
        }
      }

      const result = await hub.start({
        canonicalRepoPath: canonicalPath,
        repoId,
        runtime: agentRes.runtime,
        instruction,
        role,
        requestedModel,
        reasoningEffort,
        changeId,
        taskId,
      });
      return result.ok
        ? { success: true, data: { sessionId: result.sessionId } }
        : { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('pipeline:runtime:stop', async (_event, repoPath: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    try {
      const { canonicalPath } = await service.resolveBinding(repoPath);
      return { success: true, data: await hub.stop(canonicalPath) };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

}
