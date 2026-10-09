import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import type { PipelineState } from '../../types/pipeline';
import { PipelineService } from '../pipeline/pipeline-service';
import { invalidateEngineToolReportCache } from '../pipeline/openspec-engine-tools';
import { defaultChangeCommits, defaultChangeLastCommit } from '../pipeline/repo-evidence-reader';
import { isValidOpenSpecChangeSlug } from '../../lib/openspec-slug';
import { errMsg, validRepoPath } from './shared';

type RefreshResult =
  | { success: true; data: PipelineState }
  | { success: false; error: string };

/** Suscripción viva de un repo: quiénes lo observan y con qué change elegido. */
interface RepoSubscription {
  senders: Set<number>;
  /**
   * Última selección manual informada por el renderer.
   *
   * El watcher no la conoce por su cuenta: refrescaba sin ella y el snapshot
   * emitido revertía a la selección automática por branch, pisando lo que el
   * usuario había elegido. `pipeline:subscribe` ya recibe el valor y el renderer
   * re-suscribe cuando cambia, así que alcanza con recordarlo acá.
   */
  selectedChangeId: string | null;
}

export const FRESH_MS = 15_000;

export function registerPipelineHandlers(
  getMainWindow: () => BrowserWindow | null,
  service = new PipelineService(),
): (repoPath: string) => void {
  const subscriptions = new Map<string, RepoSubscription>();
  /**
   * Lecturas en curso, por repo y selección.
   *
   * Leer evidencia cuesta segundos y el renderer dispara `get-snapshot` y
   * `subscribe` casi a la vez con la misma selección: sin esto, cada uno paga
   * una lectura completa. La clave incluye la selección porque dos selecciones
   * distintas producen snapshots distintos y no pueden compartir resultado.
   */
  const inFlight = new Map<string, Promise<RefreshResult>>();
  /** Repos que recibieron una notificación mientras tenían una lectura en vuelo. */
  const pendingRerun = new Set<string>();
  /** Último resultado exitoso por clave (repo + selección), para responder al instante. */
  const lastResult = new Map<string, { result: RefreshResult; at: number }>();

  const readKey = (repoPath: string, selectedChangeId: string | null) => `${repoPath}\0${selectedChangeId ?? ''}`;

  const removeSubscription = (repoPath: string, senderId: number) => {
    const subscription = subscriptions.get(repoPath);
    subscription?.senders.delete(senderId);
    if (subscription && subscription.senders.size === 0) {
      subscriptions.delete(repoPath);
      pendingRerun.delete(repoPath);
    }
  };

  const refresh = async (repoPath: unknown, selectedChangeId?: unknown): Promise<RefreshResult> => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    // selectedChangeId es opcional: si llega como string se respeta como
    // selección manual; cualquier otro tipo se ignora (fallback a automática).
    const manual = typeof selectedChangeId === 'string' ? selectedChangeId : null;
    const key = readKey(repoPath, manual);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = (async (): Promise<RefreshResult> => {
      try {
        const data = await service.refresh(repoPath, manual);
        const res: RefreshResult = { success: true, data };
        lastResult.set(key, { result: res, at: Date.now() });
        return res;
      } catch (error) {
        return { success: false, error: errMsg(error) };
      }
    })();
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  };

  ipcMain.handle('pipeline:get-snapshot', async (_event, repoPath: unknown, selectedChangeId?: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    const manual = typeof selectedChangeId === 'string' ? selectedChangeId : null;
    const key = readKey(repoPath, manual);
    const cached = lastResult.get(key);
    const now = Date.now();
    if (cached && cached.result.success && (now - cached.at) < FRESH_MS) {
      const cachedData = cached.result.data;
      void refresh(repoPath, manual).then((freshRes) => {
        if (freshRes.success) {
          const prevStr = JSON.stringify(cachedData);
          const freshStr = JSON.stringify(freshRes.data);
          if (prevStr !== freshStr) {
            const subscription = subscriptions.get(repoPath);
            if (subscription && subscription.senders.size > 0) {
              getMainWindow()?.webContents.send('pipeline:snapshot-updated', {
                repoPath,
                snapshot: freshRes.data,
              });
            }
          }
        }
      });
      return cached.result;
    }
    return refresh(repoPath, selectedChangeId);
  });
  ipcMain.handle('pipeline:subscribe', async (event, repoPath: unknown, selectedChangeId?: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    const result = await refresh(repoPath, selectedChangeId);
    if (result.success) {
      const subscription = subscriptions.get(repoPath) ?? { senders: new Set<number>(), selectedChangeId: null };
      subscription.senders.add(event.sender.id);
      subscription.selectedChangeId = typeof selectedChangeId === 'string' ? selectedChangeId : null;
      subscriptions.set(repoPath, subscription);
      event.sender.once('destroyed', () => removeSubscription(repoPath, event.sender.id));
    }
    return result;
  });
  ipcMain.handle('pipeline:unsubscribe', (event, repoPath: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    removeSubscription(repoPath, event.sender.id);
    return { success: true };
  });
  ipcMain.handle('pipeline:prewarm', async (_event, repoPath: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    const result = await refresh(repoPath, null);
    return { success: result.success };
  });
  ipcMain.handle('pipeline:get-change-last-commit', async (_event, repoPath: unknown, changeId: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    if (!isValidOpenSpecChangeSlug(changeId)) return { success: false, error: 'Identificador de cambio inválido' };
    try {
      const commit = await defaultChangeLastCommit(repoPath as string, changeId);
      return { success: true, data: commit };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });
  ipcMain.handle('pipeline:get-change-commits', async (_event, repoPath: unknown, changeId: unknown) => {
    if (!validRepoPath(repoPath)) return { success: false, error: 'Ruta de repositorio inválida o no autorizada' };
    if (!isValidOpenSpecChangeSlug(changeId)) return { success: false, error: 'Identificador de cambio inválido' };
    try {
      const data = await defaultChangeCommits(repoPath as string, changeId as string);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  const refreshAndPush = (repoPath: string): void => {
    invalidateEngineToolReportCache(repoPath);
    const subscription = subscriptions.get(repoPath);
    if (!subscription || subscription.senders.size === 0) return;
    const key = readKey(repoPath, subscription.selectedChangeId);
    // Una notificación que llega durante una lectura en vuelo no puede unirse a
    // ella: esa lectura observó el disco *antes* del cambio que la disparó. Se
    // marca el repo como sucio y se corre exactamente una relectura al final,
    // así N notificaciones producen una relectura y no N lecturas superpuestas.
    if (inFlight.has(key)) {
      pendingRerun.add(repoPath);
      return;
    }
    void refresh(repoPath, subscription.selectedChangeId).then((result) => {
      if (result.success) getMainWindow()?.webContents.send('pipeline:snapshot-updated', { repoPath, snapshot: result.data });
      if (pendingRerun.delete(repoPath)) refreshAndPush(repoPath);
    });
  };

  return refreshAndPush;
}
