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
  AssistMessageUsage,
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
    pinnedAt: null,
    archivedAt: null,
    changeId: null,
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
    usage?: AssistMessageUsage | null;
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
    const usage = args.usage ?? null;
    const promptTokens = usage?.promptTokens ?? null;
    const cachedPromptTokens = usage?.cachedPromptTokens ?? null;
    const completionTokens = usage?.completionTokens ?? null;
    const reasoningTokens = usage?.reasoningTokens ?? null;
    const durationMs = usage?.durationMs ?? null;
    const contextLength = usage?.contextLength ?? null;

    db.prepare(`
      INSERT INTO ${ASSIST_MESSAGE_TABLE} (
        id, conversation_id, seq, role, text, provider_name, model_id, created_at,
        prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, context_length
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      args.conversationId,
      seq,
      args.role,
      sanitizedText,
      providerName,
      modelId,
      now,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      durationMs,
      contextLength,
    );

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
      usage: usage ? { ...usage } : null,
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
  pinned_at: string | null;
  archived_at: string | null;
  change_id: string | null;
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
      c.pinned_at,
      c.archived_at,
      (
        SELECT json_extract(r.selection_json, '$.changeId')
        FROM ${ASSIST_MESSAGE_TABLE} m
        JOIN ${ASSIST_MESSAGE_REFERENCE_TABLE} r ON r.message_id = m.id
        WHERE m.conversation_id = c.id
          AND m.role = 'user'
          AND json_extract(r.selection_json, '$.kind') = 'change'
        ORDER BY m.seq ASC, r.ord ASC
        LIMIT 1
      ) AS change_id,
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
    pinnedAt: row.pinned_at ?? null,
    archivedAt: row.archived_at ?? null,
    changeId: row.change_id ?? null,
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
  prompt_tokens: number | null;
  cached_prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  duration_ms: number | null;
  context_length: number | null;
}

interface RawReferenceRow {
  message_id: string;
  ord: number;
  selection_json: string;
  head_sha: string | null;
  status: 'ok' | 'stale';
}

function parseUsageFromRow(msg: RawMessageRow): AssistMessageUsage | null {
  const values = [
    msg.prompt_tokens,
    msg.cached_prompt_tokens,
    msg.completion_tokens,
    msg.reasoning_tokens,
    msg.duration_ms,
    msg.context_length,
  ];
  if (values.every((v) => v === null)) {
    return null;
  }

  const toNum = (v: number | null) => (v !== null ? Number(v) : null);
  return {
    promptTokens: toNum(msg.prompt_tokens),
    cachedPromptTokens: toNum(msg.cached_prompt_tokens),
    completionTokens: toNum(msg.completion_tokens),
    reasoningTokens: toNum(msg.reasoning_tokens),
    durationMs: toNum(msg.duration_ms),
    contextLength: toNum(msg.context_length),
  };
}

export function getConversation(
  args: { checkoutPath: string; conversationId: string },
  options: AssistDbOptions = {},
): AssistConversationDetail | null {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id, title, view_id, created_at, updated_at, pinned_at, archived_at
    FROM ${ASSIST_CONVERSATION_TABLE}
    WHERE id = ? AND checkout_path = ?
  `).get(args.conversationId, args.checkoutPath) as {
    id: string;
    title: string;
    view_id: string | null;
    created_at: string;
    updated_at: string;
    pinned_at: string | null;
    archived_at: string | null;
  } | undefined;

  if (!conv) {
    return null;
  }

  const rawMessages = db.prepare(`
    SELECT
      id, seq, role, text, provider_name, model_id, created_at,
      prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, context_length
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
    usage: parseUsageFromRow(msg),
  }));

  let changeId: string | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      const changeRef = msg.references.find(r => r.selection.kind === 'change');
      if (changeRef && changeRef.selection.kind === 'change') {
        changeId = changeRef.selection.changeId;
        break;
      }
    }
  }

  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      viewId: conv.view_id,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messageCount: messages.length,
      pinnedAt: conv.pinned_at ?? null,
      archivedAt: conv.archived_at ?? null,
      changeId,
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

export function setConversationPinned(
  args: { checkoutPath: string; conversationId: string; pinned: boolean },
  options: AssistDbOptions = {},
): boolean {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id FROM ${ASSIST_CONVERSATION_TABLE} WHERE id = ? AND checkout_path = ?
  `).get(args.conversationId, args.checkoutPath) as { id?: string } | undefined;

  if (!conv) {
    return false;
  }

  const pinnedAt = args.pinned ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE ${ASSIST_CONVERSATION_TABLE}
    SET pinned_at = ?
    WHERE id = ?
  `).run(pinnedAt, args.conversationId);

  return true;
}

export function setConversationArchived(
  args: { checkoutPath: string; conversationId: string; archived: boolean },
  options: AssistDbOptions = {},
): boolean {
  const db = resolveDatabase(options);

  const conv = db.prepare(`
    SELECT id FROM ${ASSIST_CONVERSATION_TABLE} WHERE id = ? AND checkout_path = ?
  `).get(args.conversationId, args.checkoutPath) as { id?: string } | undefined;

  if (!conv) {
    return false;
  }

  if (args.archived) {
    const archivedAt = new Date().toISOString();
    db.prepare(`
      UPDATE ${ASSIST_CONVERSATION_TABLE}
      SET archived_at = ?, pinned_at = NULL
      WHERE id = ?
    `).run(archivedAt, args.conversationId);
  } else {
    db.prepare(`
      UPDATE ${ASSIST_CONVERSATION_TABLE}
      SET archived_at = NULL
      WHERE id = ?
    `).run(args.conversationId);
  }

  return true;
}
