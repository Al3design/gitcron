import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { bootstrapDatabase, closeDatabase } from '../db/connection';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { createConversation } from '../db/assist-conversations';
import { registerAssistConversationHandlers } from '../ipc/assist-conversations';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
  AssistSendArgs,
  AssistSendResult,
} from '../../types/assist-context';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  handle: vi.fn((channel: string, handler: Handler) => ipc.handlers.set(channel, handler)),
}));

vi.mock('electron', () => ({ ipcMain: { handle: ipc.handle } }));

describe('Assist Conversations IPC handlers', () => {
  let db: DatabaseSync;
  let tempBase: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    ipc.handlers.clear();
    registerAssistConversationHandlers();

    db = bootstrapDatabase(':memory:');
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-ipc-test-'));
    const rawA = path.join(tempBase, 'repo-alpha');
    const rawB = path.join(tempBase, 'repo-beta');
    fs.mkdirSync(path.join(rawA, '.git'), { recursive: true });
    fs.mkdirSync(path.join(rawB, '.git'), { recursive: true });

    authorizedRepoStore.clear();
    repoA = authorizedRepoStore.authorizeRepo(rawA)!;
    repoB = authorizedRepoStore.authorizeRepo(rawB)!;
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    closeDatabase();
    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('un repoPath no autorizado devuelve success: false en los canales protegidos', async () => {
    const listHandler = ipc.handlers.get('assist-conversation:list');
    const getHandler = ipc.handlers.get('assist-conversation:get');
    const deleteHandler = ipc.handlers.get('assist-conversation:delete');
    const narrateHandler = ipc.handlers.get('assist:narrate-resume');

    expect(listHandler).toBeDefined();
    expect(getHandler).toBeDefined();
    expect(deleteHandler).toBeDefined();
    expect(narrateHandler).toBeDefined();

    const unauthorized = path.join(tempBase, 'repo-ajeno');

    const listRes = (await listHandler!(null, { repoPath: unauthorized })) as { success: boolean; error?: string };
    expect(listRes.success).toBe(false);
    expect(listRes.error).toContain('IPC Security Error');

    const getRes = (await getHandler!(null, { repoPath: unauthorized, conversationId: 'c-1' })) as {
      success: boolean;
      error?: string;
    };
    expect(getRes.success).toBe(false);
    expect(getRes.error).toContain('IPC Security Error');

    const deleteRes = (await deleteHandler!(null, { repoPath: unauthorized, conversationId: 'c-1' })) as {
      success: boolean;
      error?: string;
    };
    expect(deleteRes.success).toBe(false);
    expect(deleteRes.error).toContain('IPC Security Error');

    const narrateRes = (await narrateHandler!(null, {
      repoPath: unauthorized,
      changeId: 'mi-cambio',
      archivedAt: null,
      language: 'es',
    })) as { success: boolean; error?: string };
    expect(narrateRes.success).toBe(false);
    expect(narrateRes.error).toContain('IPC Security Error');
  });

  it('con el repo autorizado list devuelve conversaciones del repo y delete de una ajena devuelve { deleted: false }', async () => {
    const listHandler = ipc.handlers.get('assist-conversation:list');
    const getHandler = ipc.handlers.get('assist-conversation:get');
    const deleteHandler = ipc.handlers.get('assist-conversation:delete');

    const convA = createConversation({ checkoutPath: repoA, title: 'Conversación en A' }, { db });
    const convB = createConversation({ checkoutPath: repoB, title: 'Conversación en B' }, { db });

    const listRes = (await listHandler!(null, { repoPath: repoA })) as {
      success: boolean;
      data: AssistConversationSummary[];
    };
    expect(listRes.success).toBe(true);
    expect(listRes.data).toHaveLength(1);
    expect(listRes.data[0].id).toBe(convA.id);
    expect(listRes.data[0].title).toBe('Conversación en A');

    // Intentar borrar conversación de B usando ruta autorizada de A
    const deleteRes = (await deleteHandler!(null, {
      repoPath: repoA,
      conversationId: convB.id,
    })) as { success: boolean; data: { deleted: boolean } };
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.data).toEqual({ deleted: false });

    // La conversación de B sigue existiendo para repoB
    const getRes = (await getHandler!(null, {
      repoPath: repoB,
      conversationId: convB.id,
    })) as { success: boolean; data: AssistConversationDetail | null };
    expect(getRes.success).toBe(true);
    expect(getRes.data).not.toBeNull();
    expect(getRes.data!.conversation.id).toBe(convB.id);
  });

  it('assist:send con repo no autorizado devuelve success: true y data.status === "failed"', async () => {
    const sendHandler = ipc.handlers.get('assist:send');
    expect(sendHandler).toBeDefined();

    const args: AssistSendArgs = {
      requestId: 'req-unauthorized-1',
      repoPath: path.join(tempBase, 'no-autorizado'),
      conversationId: null,
      question: '¿Qué hace este repo?',
      selection: { kind: 'none' },
      viewId: 'history',
    };

    const res = (await sendHandler!(null, args)) as {
      success: boolean;
      data: AssistSendResult;
    };

    expect(res.success).toBe(true);
    expect(res.data.status).toBe('failed');
    if (res.data.status === 'failed') {
      expect(res.data.reason).toBe('repo-not-authorized');
    }
  });

  it('assist:cancel de un id desconocido devuelve success: true y { cancelled: false }', async () => {
    const cancelHandler = ipc.handlers.get('assist:cancel');
    expect(cancelHandler).toBeDefined();

    const res = (await cancelHandler!(null, { requestId: 'req-desconocido-999' })) as {
      success: boolean;
      data: { cancelled: boolean };
    };

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ cancelled: false });
  });

  it('assist:narrate-resume con repo autorizado invoca el servicio y devuelve Result', async () => {
    const narrateHandler = ipc.handlers.get('assist:narrate-resume');
    expect(narrateHandler).toBeDefined();

    const res = (await narrateHandler!(null, {
      repoPath: repoA,
      changeId: 'cambio-inexistente',
      archivedAt: null,
      language: 'es',
    })) as { success: boolean; data?: { status: string; message: string } };

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    // Como los archivos no existen, devuelve unavailable
    expect(res.data!.status).toBe('unavailable');
  });
});
