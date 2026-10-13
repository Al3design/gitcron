// electron/ipc/assist-conversations.ts
//
// Canales IPC para listar, obtener y borrar conversaciones con el asistente por repositorio (retomar 2.2).
// Exige siempre un repositorio abierto y autorizado (`authorizedRepoRoot`).

import { ipcMain } from 'electron';
import {
  deleteConversation,
  getConversation,
  listConversations,
} from '../db/assist-conversations';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
} from '../../types/assist-context';
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

export function registerAssistConversationHandlers(): void {
  ipcMain.handle(
    'assist-conversation:list',
    async (
      _e,
      args: { repoPath: string; limit?: number; offset?: number },
    ): Promise<Result<AssistConversationSummary[]>> => {
      try {
        const checkoutPath = assertAuthorizedRepo(args?.repoPath);
        const data = listConversations({
          checkoutPath,
          limit: args?.limit,
          offset: args?.offset,
        });
        return ok(data);
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'assist-conversation:get',
    async (
      _e,
      args: { repoPath: string; conversationId: string },
    ): Promise<Result<AssistConversationDetail | null>> => {
      try {
        const checkoutPath = assertAuthorizedRepo(args?.repoPath);
        if (typeof args?.conversationId !== 'string' || !args.conversationId.trim()) {
          throw new Error('Se requiere un identificador de conversación no vacío.');
        }
        const data = getConversation({
          checkoutPath,
          conversationId: args.conversationId,
        });
        return ok(data);
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'assist-conversation:delete',
    async (
      _e,
      args: { repoPath: string; conversationId: string },
    ): Promise<Result<{ deleted: boolean }>> => {
      try {
        const checkoutPath = assertAuthorizedRepo(args?.repoPath);
        if (typeof args?.conversationId !== 'string' || !args.conversationId.trim()) {
          throw new Error('Se requiere un identificador de conversación no vacío.');
        }
        const deleted = deleteConversation({
          checkoutPath,
          conversationId: args.conversationId,
        });
        return ok({ deleted });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
