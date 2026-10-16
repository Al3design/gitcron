import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase, runMigrations } from '../connection';
import { authorizedRepoStore } from '../../ipc/authorized-repos';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  sanitizeAssistText,
  setConversationArchived,
  setConversationPinned,
} from '../assist-conversations';
import type { AssistMessageReference } from '../../../types/assist-context';

describe('Assist Conversations DB module', () => {
  let db: DatabaseSync;
  let tempBase: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-test-'));
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
    db.close();
    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('la migración 8 crea las tres tablas y correr runMigrations dos veces es idempotente', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('assist_conversation', 'assist_message', 'assist_message_reference')
    `).all() as { name: string }[];
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual(['assist_conversation', 'assist_message', 'assist_message_reference'].sort());

    expect(() => runMigrations(db)).not.toThrow();
  });

  it('crea conversación en A, agrega pregunta y respuesta con referencia y las lee en orden', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Consulta sobre refactor' }, { db });
    expect(conv.id).toBeDefined();
    expect(conv.messageCount).toBe(0);

    const ref: AssistMessageReference = {
      selection: { kind: 'commit', sha: '1234567890abcdef' },
      headSha: '1234567890abcdef',
      status: 'ok',
    };

    const msg1 = appendMessage({
      checkoutPath: repoA,
      conversationId: conv.id,
      role: 'user',
      text: '¿Qué hace este commit?',
      references: [ref],
    }, { db });

    const msg2 = appendMessage({
      checkoutPath: repoA,
      conversationId: conv.id,
      role: 'assistant',
      text: 'Este commit modifica el pipeline.',
      providerName: 'lmstudio',
      modelId: 'qwen-2.5',
    }, { db });

    expect(msg1.seq).toBe(1);
    expect(msg2.seq).toBe(2);

    const detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail).not.toBeNull();
    expect(detail!.conversation.id).toBe(conv.id);
    expect(detail!.conversation.messageCount).toBe(2);
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0].id).toBe(msg1.id);
    expect(detail!.messages[0].seq).toBe(1);
    expect(detail!.messages[0].references).toEqual([ref]);
    expect(detail!.messages[1].id).toBe(msg2.id);
    expect(detail!.messages[1].seq).toBe(2);
    expect(detail!.messages[1].modelId).toBe('qwen-2.5');
    expect(detail!.messages[1].providerName).toBe('lmstudio');
  });

  it('reabrir la base conserva los mensajes en disco', () => {
    const diskDbPath = path.join(tempBase, 'test-disk.db');
    let diskDb = openTemporalAgentDatabase(diskDbPath);

    const conv = createConversation({ checkoutPath: repoA, title: 'Persistencia durable' }, { db: diskDb });
    appendMessage({
      checkoutPath: repoA,
      conversationId: conv.id,
      role: 'user',
      text: 'Mensaje persistido',
    }, { db: diskDb });

    diskDb.close();

    diskDb = openTemporalAgentDatabase(diskDbPath);
    const detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db: diskDb });
    expect(detail).not.toBeNull();
    expect(detail!.conversation.title).toBe('Persistencia durable');
    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0].text).toBe('Mensaje persistido');

    diskDb.close();
  });

  it('sanitizeAssistText quita <think> multilínea y redacta secretos sk-, ghp-, Bearer y token url sin guardarlos', () => {
    const rawText = `
      <think>
        pensamiento privado
        multilínea
      </think>
      Pregunta con sk-12345678901234567890123 y token ghp_abcdefghijklmnopqrstuvwxyz12
      y cabecera Bearer my-secret-token-value-20-chars y url https://x-access-token:secret-token-in-url@github.com
    `;

    const sanitized = sanitizeAssistText(rawText);
    expect(sanitized).not.toContain('pensamiento privado');
    expect(sanitized).not.toContain('<think>');
    expect(sanitized).not.toContain('sk-12345678901234567890123');
    expect(sanitized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz12');
    expect(sanitized).not.toContain('my-secret-token-value-20-chars');
    expect(sanitized).not.toContain('secret-token-in-url');
    expect(sanitized).toContain('[REDACTADO]');

    const conv = createConversation({ checkoutPath: repoA, title: 'Prueba secretos' }, { db });
    const msg = appendMessage({
      checkoutPath: repoA,
      conversationId: conv.id,
      role: 'user',
      text: rawText,
    }, { db });

    const row = db.prepare('SELECT text FROM assist_message WHERE id = ?').get(msg.id) as { text: string };
    expect(row.text).toBe(sanitized);
    expect(row.text).not.toContain('pensamiento privado');
    expect(row.text).not.toContain('sk-12345678901234567890123');
    expect(row.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz12');
    expect(row.text).not.toContain('my-secret-token-value-20-chars');
    expect(row.text).not.toContain('secret-token-in-url');
  });

  it('desde B getConversation devuelve null, listConversations no la incluye y deleteConversation devuelve false', () => {
    const convA = createConversation({ checkoutPath: repoA, title: 'Conversación en A' }, { db });
    appendMessage({
      checkoutPath: repoA,
      conversationId: convA.id,
      role: 'user',
      text: 'Pregunta en repo A',
    }, { db });

    expect(getConversation({ checkoutPath: repoB, conversationId: convA.id }, { db })).toBeNull();

    const listB = listConversations({ checkoutPath: repoB }, { db });
    expect(listB.some(c => c.id === convA.id)).toBe(false);

    const deleted = deleteConversation({ checkoutPath: repoB, conversationId: convA.id }, { db });
    expect(deleted).toBe(false);

    const detailA = getConversation({ checkoutPath: repoA, conversationId: convA.id }, { db });
    expect(detailA).not.toBeNull();
    expect(detailA!.conversation.id).toBe(convA.id);
  });

  it('appendMessage a conversación de A pasando checkoutPath de B tira y no inserta nada', () => {
    const convA = createConversation({ checkoutPath: repoA, title: 'Conversación de A' }, { db });

    expect(() => {
      appendMessage({
        checkoutPath: repoB,
        conversationId: convA.id,
        role: 'user',
        text: 'Intento de anexar desde B',
      }, { db });
    }).toThrow('La conversación no es de este repositorio.');

    const countRow = db.prepare('SELECT COUNT(*) as count FROM assist_message WHERE conversation_id = ?').get(convA.id) as { count: number };
    expect(countRow.count).toBe(0);
  });

  it('borrar una conversación de A borra sus mensajes y referencias y deja intactas otras conversaciones y branch_decision', () => {
    db.prepare(`
      INSERT INTO prediction_run (
        id, repo_path, device_id, provider, context_scope, web_trends, generated_at, created_at
      ) VALUES ('run-1', ?, 'dev-1', 'prov', 'scope', 0, '2026-10-13T00:00:00Z', '2026-10-13T00:00:00Z')
    `).run(repoA);
    db.prepare(`
      INSERT INTO speculative_branch (
        id, run_id, message, rationale, type, confidence
      ) VALUES ('branch-1', 'run-1', 'msg', 'rat', 'type', 0.9)
    `).run();
    db.prepare(`
      INSERT INTO branch_decision (
        id, branch_id, device_id, decision, decided_at
      ) VALUES ('decision-1', 'branch-1', 'dev-1', 'accepted', '2026-10-13T00:00:00Z')
    `).run();

    const convA1 = createConversation({ checkoutPath: repoA, title: 'A1 para borrar' }, { db });
    const convA2 = createConversation({ checkoutPath: repoA, title: 'A2 para conservar' }, { db });
    const convB = createConversation({ checkoutPath: repoB, title: 'B1 para conservar' }, { db });

    const msgA1 = appendMessage({
      checkoutPath: repoA,
      conversationId: convA1.id,
      role: 'user',
      text: 'msg A1',
      references: [{ selection: { kind: 'none' }, headSha: null, status: 'ok' }],
    }, { db });
    appendMessage({
      checkoutPath: repoA,
      conversationId: convA2.id,
      role: 'user',
      text: 'msg A2',
    }, { db });
    appendMessage({
      checkoutPath: repoB,
      conversationId: convB.id,
      role: 'user',
      text: 'msg B',
    }, { db });

    const deleted = deleteConversation({ checkoutPath: repoA, conversationId: convA1.id }, { db });
    expect(deleted).toBe(true);

    expect(getConversation({ checkoutPath: repoA, conversationId: convA1.id }, { db })).toBeNull();
    const msgCheck = db.prepare('SELECT COUNT(*) as count FROM assist_message WHERE id = ?').get(msgA1.id) as { count: number };
    expect(msgCheck.count).toBe(0);
    const refCheck = db.prepare('SELECT COUNT(*) as count FROM assist_message_reference WHERE message_id = ?').get(msgA1.id) as { count: number };
    expect(refCheck.count).toBe(0);

    expect(getConversation({ checkoutPath: repoA, conversationId: convA2.id }, { db })).not.toBeNull();
    expect(getConversation({ checkoutPath: repoB, conversationId: convB.id }, { db })).not.toBeNull();
    const decisionCheck = db.prepare('SELECT COUNT(*) as count FROM branch_decision WHERE id = ?').get('decision-1') as { count: number };
    expect(decisionCheck.count).toBe(1);
  });

  it('un mensaje que queda vacío después de sanear tira Mensaje vacío.', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Test vacío' }, { db });
    expect(() => {
      appendMessage({
        checkoutPath: repoA,
        conversationId: conv.id,
        role: 'user',
        text: '   <think>solo razonamiento privado</think>   ',
      }, { db });
    }).toThrow('Mensaje vacío.');
  });

  it('listConversations ignora un limit u offset que no es número (llegan del renderer)', () => {
    createConversation({ checkoutPath: repoA, title: 'Una' }, { db });
    const bad = { checkoutPath: repoA, limit: 'abc' as unknown as number, offset: Number.NaN };
    expect(listConversations(bad, { db })).toHaveLength(1);
  });

  it('la migración 9 corre dos veces sin fallar (idempotente)', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('una respuesta con usage lo conserva al reabrir la base (archivo temporal)', () => {
    const dbPath = path.join(tempBase, 'test-assist-disk.sqlite');
    let diskDb = openTemporalAgentDatabase(dbPath);
    try {
      const conv = createConversation({ checkoutPath: repoA, title: 'Test usage persistente' }, { db: diskDb });
      appendMessage(
        {
          checkoutPath: repoA,
          conversationId: conv.id,
          role: 'assistant',
          text: 'Respuesta con uso de fichas.',
          usage: {
            promptTokens: 120,
            cachedPromptTokens: 40,
            completionTokens: 80,
            reasoningTokens: 25,
            durationMs: 1500,
            contextLength: 32000,
          },
        },
        { db: diskDb },
      );
    } finally {
      diskDb.close();
    }

    // Reabrir la base desde el archivo temporal
    diskDb = openTemporalAgentDatabase(dbPath);
    try {
      const convs = listConversations({ checkoutPath: repoA }, { db: diskDb });
      expect(convs).toHaveLength(1);
      const detail = getConversation({ checkoutPath: repoA, conversationId: convs[0].id }, { db: diskDb });
      expect(detail).not.toBeNull();
      expect(detail!.messages).toHaveLength(1);
      expect(detail!.messages[0].usage).toEqual({
        promptTokens: 120,
        cachedPromptTokens: 40,
        completionTokens: 80,
        reasoningTokens: 25,
        durationMs: 1500,
        contextLength: 32000,
      });
    } finally {
      diskDb.close();
    }
  });

  it('una respuesta sin usage vuelve usage: null', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Test sin usage' }, { db });
    appendMessage(
      {
        checkoutPath: repoA,
        conversationId: conv.id,
        role: 'assistant',
        text: 'Respuesta clásica sin datos de uso.',
      },
      { db },
    );

    const detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail).not.toBeNull();
    expect(detail!.messages[0].usage).toBeNull();
  });

  it('la migración 10 corre dos veces sin fallar', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('fijar, archivar y desarchivar se conservan al reabrir la base (archivo temporal)', () => {
    const dbPath = path.join(tempBase, 'test-pin-archive-disk.sqlite');
    let diskDb = openTemporalAgentDatabase(dbPath);
    let conv1Id: string;
    let conv2Id: string;
    let conv3Id: string;

    try {
      const conv1 = createConversation({ checkoutPath: repoA, title: 'Conversación fijada' }, { db: diskDb });
      const conv2 = createConversation({ checkoutPath: repoA, title: 'Conversación archivada' }, { db: diskDb });
      const conv3 = createConversation({ checkoutPath: repoA, title: 'Conversación desarchivada' }, { db: diskDb });
      conv1Id = conv1.id;
      conv2Id = conv2.id;
      conv3Id = conv3.id;

      setConversationPinned({ checkoutPath: repoA, conversationId: conv1Id, pinned: true }, { db: diskDb });
      setConversationArchived({ checkoutPath: repoA, conversationId: conv2Id, archived: true }, { db: diskDb });
      setConversationArchived({ checkoutPath: repoA, conversationId: conv3Id, archived: true }, { db: diskDb });
      setConversationArchived({ checkoutPath: repoA, conversationId: conv3Id, archived: false }, { db: diskDb });
    } finally {
      diskDb.close();
    }

    diskDb = openTemporalAgentDatabase(dbPath);
    try {
      const list = listConversations({ checkoutPath: repoA }, { db: diskDb });
      const c1 = list.find((c) => c.id === conv1Id);
      const c2 = list.find((c) => c.id === conv2Id);
      const c3 = list.find((c) => c.id === conv3Id);

      expect(c1).toBeDefined();
      expect(c1!.pinnedAt).not.toBeNull();
      expect(c1!.archivedAt).toBeNull();

      expect(c2).toBeDefined();
      expect(c2!.pinnedAt).toBeNull();
      expect(c2!.archivedAt).not.toBeNull();

      expect(c3).toBeDefined();
      expect(c3!.pinnedAt).toBeNull();
      expect(c3!.archivedAt).toBeNull();

      const d1 = getConversation({ checkoutPath: repoA, conversationId: conv1Id }, { db: diskDb });
      expect(d1!.conversation.pinnedAt).not.toBeNull();
      expect(d1!.conversation.archivedAt).toBeNull();

      const d2 = getConversation({ checkoutPath: repoA, conversationId: conv2Id }, { db: diskDb });
      expect(d2!.conversation.pinnedAt).toBeNull();
      expect(d2!.conversation.archivedAt).not.toBeNull();

      const d3 = getConversation({ checkoutPath: repoA, conversationId: conv3Id }, { db: diskDb });
      expect(d3!.conversation.pinnedAt).toBeNull();
      expect(d3!.conversation.archivedAt).toBeNull();
    } finally {
      diskDb.close();
    }
  });

  it('archivar borra pinned_at', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Fijar luego archivar' }, { db });
    setConversationPinned({ checkoutPath: repoA, conversationId: conv.id, pinned: true }, { db });

    let detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail!.conversation.pinnedAt).not.toBeNull();
    expect(detail!.conversation.archivedAt).toBeNull();

    setConversationArchived({ checkoutPath: repoA, conversationId: conv.id, archived: true }, { db });

    detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail!.conversation.pinnedAt).toBeNull();
    expect(detail!.conversation.archivedAt).not.toBeNull();
  });

  it('fijar o archivar una conversación de otro checkoutPath devuelve false y no la toca', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Conversación en repo A' }, { db });

    const pinOther = setConversationPinned({ checkoutPath: repoB, conversationId: conv.id, pinned: true }, { db });
    expect(pinOther).toBe(false);

    let detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail!.conversation.pinnedAt).toBeNull();

    const archiveOther = setConversationArchived({ checkoutPath: repoB, conversationId: conv.id, archived: true }, { db });
    expect(archiveOther).toBe(false);

    detail = getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db });
    expect(detail!.conversation.archivedAt).toBeNull();
  });

  it('changeId sale de la primera pregunta con destino change (con una pregunta anterior sin destino y una posterior con otro cambio, gana la primera con cambio); sin destino change, null', () => {
    const convNoChange = createConversation({ checkoutPath: repoA, title: 'Sin change' }, { db });
    appendMessage(
      {
        checkoutPath: repoA,
        conversationId: convNoChange.id,
        role: 'user',
        text: 'Pregunta sobre commit',
        references: [{ selection: { kind: 'commit', sha: '1234567' }, headSha: null, status: 'ok' }],
      },
      { db },
    );

    const listNoChange = listConversations({ checkoutPath: repoA }, { db });
    expect(listNoChange.find((c) => c.id === convNoChange.id)!.changeId).toBeNull();
    const detailNoChange = getConversation({ checkoutPath: repoA, conversationId: convNoChange.id }, { db });
    expect(detailNoChange!.conversation.changeId).toBeNull();

    const convMulti = createConversation({ checkoutPath: repoA, title: 'Con cambios múltiples' }, { db });
    // 1. Pregunta anterior sin destino change
    appendMessage(
      {
        checkoutPath: repoA,
        conversationId: convMulti.id,
        role: 'user',
        text: 'Pregunta sin cambio',
        references: [{ selection: { kind: 'none' }, headSha: null, status: 'ok' }],
      },
      { db },
    );
    // 2. Primera pregunta con destino change
    appendMessage(
      {
        checkoutPath: repoA,
        conversationId: convMulti.id,
        role: 'user',
        text: 'Primera pregunta sobre cambio A',
        references: [
          { selection: { kind: 'change', changeId: 'cambio-primero' }, headSha: null, status: 'ok' },
        ],
      },
      { db },
    );
    // 3. Pregunta posterior con otro cambio
    appendMessage(
      {
        checkoutPath: repoA,
        conversationId: convMulti.id,
        role: 'user',
        text: 'Segunda pregunta sobre cambio B',
        references: [
          { selection: { kind: 'change', changeId: 'cambio-segundo' }, headSha: null, status: 'ok' },
        ],
      },
      { db },
    );

    const listMulti = listConversations({ checkoutPath: repoA }, { db });
    expect(listMulti.find((c) => c.id === convMulti.id)!.changeId).toBe('cambio-primero');
    const detailMulti = getConversation({ checkoutPath: repoA, conversationId: convMulti.id }, { db });
    expect(detailMulti!.conversation.changeId).toBe('cambio-primero');
  });

  it('updated_at no cambia al fijar', () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Test no cambia updated_at' }, { db });
    const rowBefore = db.prepare('SELECT updated_at FROM assist_conversation WHERE id = ?').get(conv.id) as { updated_at: string };

    setConversationPinned({ checkoutPath: repoA, conversationId: conv.id, pinned: true }, { db });
    const rowAfterPin = db.prepare('SELECT updated_at FROM assist_conversation WHERE id = ?').get(conv.id) as { updated_at: string };
    expect(rowAfterPin.updated_at).toBe(rowBefore.updated_at);

    setConversationArchived({ checkoutPath: repoA, conversationId: conv.id, archived: true }, { db });
    const rowAfterArchive = db.prepare('SELECT updated_at FROM assist_conversation WHERE id = ?').get(conv.id) as { updated_at: string };
    expect(rowAfterArchive.updated_at).toBe(rowBefore.updated_at);
  });
});
