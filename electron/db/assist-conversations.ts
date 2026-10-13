// electron/db/assist-conversations.ts
//
// Almacenamiento en SQLite de conversaciones con el asistente por repositorio (retomar 2.1 y 2.2).
// Guarda mensajes, modelos y referencias de contexto por ruta canónica de checkout.
// No almacena secretos ni razonamiento privado.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
  AssistMessage,
  AssistMessageReference,
  AssistMessageRole,
} from '../../types/assist-context';
import { currentDatabase, getDatabase } from './connection';
import {
  ASSIST_CONVERSATION_TABLE,
  ASSIST_MESSAGE_REFERENCE_TABLE,
  ASSIST_MESSAGE_TABLE,
} from './schema';

export interface AssistDbOptions {
  db?: DatabaseSync;
  userDataPath?: string;
}

function resolveDatabase(options: AssistDbOptions = {}): DatabaseSync {
  if (options.db) return options.db;
  const open = currentDatabase();
  if (open && !options.userDataPath) return open;
  return getDatabase(options.userDataPath ?? resolveDefaultUserDataPath());
}

function resolveDefaultUserDataPath(): string {
  const electron = require('electron') as { app?: { getPath(name: 'userData'): string } };
  const userDataPath = electron.app?.getPath('userData');
  if (!userDataPath) throw new Error('No está la carpeta de datos de GitCron (Electron no disponible).');
  return userDataPath;
}

export function sanitizeAssistText(text: string): string {
  if (typeof text !== 'string') return '';

  const sanitized = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTADO]')
    .replace(/(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/g, '[REDACTADO]')
    .replace(/Bearer\s+\S{20,}/gi, '[REDACTADO]')
    .replace(/(x-access-token:)[^@]+@/g, '$1[REDACTADO]@');

  return sanitized.trim();
}

export function createConversation(
  args: { checkoutPath: string; title: string; viewId?: string | null },
  options: AssistDbOptions = {},
): AssistConversationSummary {
  const db = resolveDatabase(options);
  const id = randomUUID();
  const rawSanitized = sanitizeAssistText(args.title ?? '');
  const title = (rawSanitized.length > 0 ? rawSanitized.slice(0, 120) : 'Conversación').trim() || 'Conversación';
  const now = new Date().toISOString();
  const viewId = args.viewId ?? null;

  db.prepare(`
    INSERT INTO ${ASSIST_CONVERSATION_TABLE} (
      id, checkout_path, title, view_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, args.checkoutPath, title, viewId, now, now);

  return {
    id,
    title,
    viewId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

export function appendMessage(
  args: {
    checkoutPath: string;
    conversationId: string;
    role: AssistMessageRole;
    text: string;
    providerName?: string | null;
    modelId?: string | null;
    references?: AssistMessageReference[];
  },
  options: AssistDbOptions = {},
): AssistMessage {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id, checkout_path FROM ${ASSIST_CONVERSATION_TABLE} WHERE id = ?
  `).get(args.conversationId) as { id?: string; checkout_path?: string } | undefined;

  if (!conv || conv.checkout_path !== args.checkoutPath) {
    throw new Error('La conversación no es de este repositorio.');
  }

  const sanitizedText = sanitizeAssistText(args.text);
  if (!sanitizedText) {
    throw new Error('Mensaje vacío.');
  }

  db.exec('BEGIN');
  try {
    const seqRow = db.prepare(`
      SELECT COALESCE(MAX(seq), 0) AS max_seq
      FROM ${ASSIST_MESSAGE_TABLE}
      WHERE conversation_id = ?
    `).get(args.conversationId) as { max_seq?: number } | undefined;

    const seq = Number(seqRow?.max_seq ?? 0) + 1;
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const providerName = args.providerName ?? null;
    const modelId = args.modelId ?? null;

    db.prepare(`
      INSERT INTO ${ASSIST_MESSAGE_TABLE} (
        id, conversation_id, seq, role, text, provider_name, model_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, args.conversationId, seq, args.role, sanitizedText, providerName, modelId, now);

    const insertRefStmt = db.prepare(`
      INSERT INTO ${ASSIST_MESSAGE_REFERENCE_TABLE} (
        message_id, ord, selection_json, head_sha, status
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const references = args.references ?? [];
    for (let ord = 0; ord < references.length; ord++) {
      const ref = references[ord];
      insertRefStmt.run(
        messageId,
        ord,
        JSON.stringify(ref.selection),
        ref.headSha ?? null,
        ref.status,
      );
    }

    db.prepare(`
      UPDATE ${ASSIST_CONVERSATION_TABLE}
      SET updated_at = ?
      WHERE id = ?
    `).run(now, args.conversationId);

    db.exec('COMMIT');

    return {
      id: messageId,
      seq,
      role: args.role,
      text: sanitizedText,
      providerName,
      modelId,
      createdAt: now,
      references: references.map(r => ({ ...r })),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

interface ConversationRow {
  id: string;
  title: string;
  view_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

function wholeNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function listConversations(
  args: { checkoutPath: string; limit?: number; offset?: number },
  options: AssistDbOptions = {},
): AssistConversationSummary[] {
  const db = resolveDatabase(options);
  // Llegan del renderer: un valor que no es un entero cae al de omisión en vez de un NaN para SQLite.
  const limit = Math.min(200, Math.max(1, wholeNumberOr(args.limit, 50)));
  const offset = Math.max(0, wholeNumberOr(args.offset, 0));

  const query = `
    SELECT
      c.id,
      c.title,
      c.view_id,
      c.created_at,
      c.updated_at,
      COUNT(m.id) AS message_count
    FROM ${ASSIST_CONVERSATION_TABLE} c
    LEFT JOIN ${ASSIST_MESSAGE_TABLE} m ON m.conversation_id = c.id
    WHERE c.checkout_path = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(args.checkoutPath, limit, offset) as unknown as ConversationRow[];

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    viewId: row.view_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count ?? 0),
  }));
}

interface RawMessageRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  provider_name: string | null;
  model_id: string | null;
  created_at: string;
}

interface RawReferenceRow {
  message_id: string;
  ord: number;
  selection_json: string;
  head_sha: string | null;
  status: 'ok' | 'stale';
}

export function getConversation(
  args: { checkoutPath: string; conversationId: string },
  options: AssistDbOptions = {},
): AssistConversationDetail | null {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id, title, view_id, created_at, updated_at
    FROM ${ASSIST_CONVERSATION_TABLE}
    WHERE id = ? AND checkout_path = ?
  `).get(args.conversationId, args.checkoutPath) as {
    id: string;
    title: string;
    view_id: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!conv) {
    return null;
  }

  const rawMessages = db.prepare(`
    SELECT id, seq, role, text, provider_name, model_id, created_at
    FROM ${ASSIST_MESSAGE_TABLE}
    WHERE conversation_id = ?
    ORDER BY seq ASC
  `).all(args.conversationId) as unknown as RawMessageRow[];

  const rawRefs = db.prepare(`
    SELECT r.message_id, r.ord, r.selection_json, r.head_sha, r.status
    FROM ${ASSIST_MESSAGE_REFERENCE_TABLE} r
    JOIN ${ASSIST_MESSAGE_TABLE} m ON m.id = r.message_id
    WHERE m.conversation_id = ?
    ORDER BY r.ord ASC
  `).all(args.conversationId) as unknown as RawReferenceRow[];

  const refsByMessage = new Map<string, AssistMessageReference[]>();
  for (const row of rawRefs) {
    let list = refsByMessage.get(row.message_id);
    if (!list) {
      list = [];
      refsByMessage.set(row.message_id, list);
    }
    list.push({
      selection: JSON.parse(row.selection_json),
      headSha: row.head_sha,
      status: row.status,
    });
  }

  const messages: AssistMessage[] = rawMessages.map(msg => ({
    id: msg.id,
    seq: Number(msg.seq),
    role: msg.role,
    text: msg.text,
    providerName: msg.provider_name,
    modelId: msg.model_id,
    createdAt: msg.created_at,
    references: refsByMessage.get(msg.id) ?? [],
  }));

  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      viewId: conv.view_id,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messageCount: messages.length,
    },
    messages,
  };
}

export function deleteConversation(
  args: { checkoutPath: string; conversationId: string },
  options: AssistDbOptions = {},
): boolean {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id FROM ${ASSIST_CONVERSATION_TABLE} WHERE id = ? AND checkout_path = ?
  `).get(args.conversationId, args.checkoutPath) as { id?: string } | undefined;

  if (!conv) {
    return false;
  }

  db.exec('BEGIN');
  try {
    db.prepare(`
      DELETE FROM ${ASSIST_MESSAGE_REFERENCE_TABLE}
      WHERE message_id IN (
        SELECT id FROM ${ASSIST_MESSAGE_TABLE} WHERE conversation_id = ?
      )
    `).run(args.conversationId);

    db.prepare(`
      DELETE FROM ${ASSIST_MESSAGE_TABLE} WHERE conversation_id = ?
    `).run(args.conversationId);

    db.prepare(`
      DELETE FROM ${ASSIST_CONVERSATION_TABLE} WHERE id = ?
    `).run(args.conversationId);

    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
