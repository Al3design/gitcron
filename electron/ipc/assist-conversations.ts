// electron/ipc/assist-conversations.ts
//
// Canales IPC para listar, obtener y borrar conversaciones con el asistente por repositorio (retomar 2.2).
// Exige siempre un repositorio abierto y autorizado (`authorizedRepoRoot`).

import { ipcMain } from 'electron';
import {
  deleteConversation,
  getConversation,
  listConversations,
  setConversationArchived,
  setConversationPinned,
} from '../db/assist-conversations';
import {
  cancelAssistMessage,
  sendAssistMessage,
} from '../assist/assist-send';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
  AssistSendArgs,
  AssistSendResult,
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
    'assist:send',
    async (_e, args: AssistSendArgs): Promise<Result<AssistSendResult>> => {
      try {
        const result = await sendAssistMessage(args);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'assist:cancel',
    async (_e, args: { requestId: string }): Promise<Result<{ cancelled: boolean }>> => {
      try {
        if (!args || typeof args.requestId !== 'string' || !args.requestId.trim()) {
          throw new Error('Se requiere un identificador de pedido no vacío.');
        }
        const cancelled = cancelAssistMessage(args.requestId);
        return ok({ cancelled });
      } catch (error) {
        return fail(error);
      }
    },
  );

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

  ipcMain.handle(
    'assist-conversation:pin',
    async (
      _e,
      args: { repoPath: string; conversationId: string; pinned: boolean },
    ): Promise<Result<{ changed: boolean }>> => {
      try {
        const checkoutPath = assertAuthorizedRepo(args?.repoPath);
        if (typeof args?.conversationId !== 'string' || !args.conversationId.trim()) {
          throw new Error('Se requiere un identificador de conversación no vacío.');
        }
        if (typeof args?.pinned !== 'boolean') {
          throw new Error('Se requiere el estado booleano de fijado.');
        }
        const changed = setConversationPinned({
          checkoutPath,
          conversationId: args.conversationId,
          pinned: args.pinned,
        });
        return ok({ changed });
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    'assist-conversation:archive',
    async (
      _e,
      args: { repoPath: string; conversationId: string; archived: boolean },
    ): Promise<Result<{ changed: boolean }>> => {
      try {
        const checkoutPath = assertAuthorizedRepo(args?.repoPath);
        if (typeof args?.conversationId !== 'string' || !args.conversationId.trim()) {
          throw new Error('Se requiere un identificador de conversación no vacío.');
        }
        if (typeof args?.archived !== 'boolean') {
          throw new Error('Se requiere el estado booleano de archivado.');
        }
        const changed = setConversationArchived({
          checkoutPath,
          conversationId: args.conversationId,
          archived: args.archived,
        });
        return ok({ changed });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
