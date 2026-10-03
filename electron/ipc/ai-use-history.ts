// electron/ipc/ai-use-history.ts
//
// Canales IPC para consultar y gestionar el historial de usos de IA por repositorio (D19).
// Todos los canales exigen un repositorio abierto y autorizado (`authorizedRepoRoot`).

import { ipcMain } from 'electron';
import {
  clearAiUseHistory,
  getAiUseRecord,
  linkAiUseCommit,
  listAiUseHistory,
  type AiUseHistoryDetail,
  type AiUseHistoryListArgs,
  type AiUseHistoryListResult,
} from '../db/ai-use-history';
import { authorizedRepoRoot } from './authorized-repos';
import { errMsg } from './shared';

type Result<T> = { success: boolean; data?: T; error?: string };
const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = <T>(error: unknown): Result<T> => ({ success: false, error: errMsg(error) });

function assertAuthorizedRepo(repoPath: unknown): string {
  if (typeof repoPath !== 'string' || !repoPath.trim()) {
    throw new Error('IPC Security Error: Invalid or unauthorized repository path');
  }
  const canonical = authorizedRepoRoot(repoPath);
  if (!canonical) {
    throw new Error('IPC Security Error: Invalid or unauthorized repository path');
  }
  return canonical;
}

export function registerAiUseHistoryHandlers(): void {
  ipcMain.handle(
    'ai-use-history:list',
    async (_e, args: AiUseHistoryListArgs): Promise<Result<AiUseHistoryListResult>> => {
      try {
        const canonical = assertAuthorizedRepo(args?.repoPath);
        const result = listAiUseHistory({ ...args, repoPath: canonical });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'ai-use-history:get',
    async (_e, args: { repoPath: string; id: string }): Promise<Result<AiUseHistoryDetail | null>> => {
      try {
        const canonical = assertAuthorizedRepo(args?.repoPath);
        if (!args?.id || typeof args.id !== 'string') {
          throw new Error('Se requiere un identificador de registro.');
        }
        const record = getAiUseRecord(args.id, canonical);
        return ok(record);
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'ai-use-history:clear',
    async (_e, args: { repoPath: string }): Promise<Result<{ cleared: number }>> => {
      try {
        const canonical = assertAuthorizedRepo(args?.repoPath);
        const cleared = clearAiUseHistory(canonical);
        return ok({ cleared });
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'ai-use-history:link-commit',
    async (
      _e,
      args: { repoPath: string; recordId: string; commitHash: string; edited: boolean },
    ): Promise<Result<{ linked: boolean }>> => {
      try {
        const canonical = assertAuthorizedRepo(args?.repoPath);
        if (!args?.recordId || typeof args.recordId !== 'string') {
          throw new Error('Se requiere recordId.');
        }
        if (!args?.commitHash || typeof args.commitHash !== 'string') {
          throw new Error('Se requiere commitHash.');
        }
        const linked = linkAiUseCommit(args.recordId, args.commitHash, Boolean(args.edited), canonical);
        return ok({ linked });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
