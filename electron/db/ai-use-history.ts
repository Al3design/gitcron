// electron/db/ai-use-history.ts
//
// Historial de usos de IA por repositorio (tarea 4.6 de modelos-en-casa, D19).
// Registra qué escribió cada IA, motor, modelo, máquina, cuándo, duración, tokens,
// el pedido efectivo saneado y lo enviado completo, fuera del repositorio, en la
// base SQLite de datos de GitCron.
//
// Invariantes (D19, D14, D18):
// - Sólo repositorios abiertos (`authorizedRepoRoot`).
// - Nunca claves, valores de cabeceras ni variables en el pedido efectivo.
// - Lo enviado se guarda completo (instrucciones y contenido).
// - Un fallo al guardar no rompe el uso: se avisa por consola sin datos del pedido y el uso sigue.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CommitAiLastRequest, DraftUsage } from '../../types/commit-message-ai';
import { authorizedRepoRoot } from '../ipc/authorized-repos';
import { currentDatabase, getDatabase } from './connection';
import { getDeviceIdentity } from './device';
import { AI_USE_RECORD_TABLE } from './schema';

export type AiUseResultStatus = 'generated' | 'no-answer' | 'malformed' | 'failed' | 'cancelled';

export interface AiUseHistoryItem {
  id: string;
  repoPath: string;
  branch: string | null;
  deviceId: string;
  /** El nombre de la máquina (el de su identidad, D19: «en qué máquina»). */
  deviceLabel: string | null;
  use: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  family: 'openai-compatible' | 'anthropic' | 'cli';
  providerId: string;
  providerName: string;
  modelId: string;
  reasoningEffort: string | null;
  variant: string | null;
  resultStatus: AiUseResultStatus;
  resultText: string | null;
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  commitHash: string | null;
  commitEdited: boolean | null;
  promptSentBytes: number;
  createdAt: string;
}

export interface AiUseHistoryDetail extends AiUseHistoryItem {
  effectiveRequest: CommitAiLastRequest;
  promptSent: string;
}

export interface InsertAiUseRecordArgs {
  repoPath: string;
  use: string;
  startedAt: number | string;
  endedAt: number | string;
  durationMs?: number;
  family: 'openai-compatible' | 'anthropic' | 'cli';
  providerId: string;
  providerName: string;
  modelId: string;
  reasoningEffort?: string | null;
  variant?: string | null;
  effectiveRequest: CommitAiLastRequest;
  promptSent: string;
  resultStatus: AiUseResultStatus;
  resultText?: string | null;
  usage?: DraftUsage | null;
  branch?: string | null;
  deviceId?: string;
  deviceLabel?: string | null;
  commitHash?: string | null;
  commitEdited?: boolean | null;
}

export interface ListAiUseHistoryArgs {
  repoPath: string;
  use?: string;
  resultStatus?: string;
  limit?: number;
  offset?: number;
}

export interface ListAiUseHistoryResult {
  items: AiUseHistoryItem[];
  total: number;
}

export type AiUseHistoryListArgs = ListAiUseHistoryArgs;
export type AiUseHistoryListResult = ListAiUseHistoryResult;

export interface AiUseHistoryOptions {
  db?: DatabaseSync;
  userDataPath?: string;
}

/**
 * La base abierta: la que se pasa, la que GitCron abrió al arrancar (`bootstrapDatabase`
 * en main.ts) o, si no hay ninguna, la de la carpeta de datos.
 */
function resolveDatabase(options: AiUseHistoryOptions = {}): DatabaseSync {
  if (options.db) return options.db;
  const open = currentDatabase();
  if (open && !options.userDataPath) return open;
  return getDatabase(options.userDataPath ?? resolveDefaultUserDataPath());
}

function resolveDefaultUserDataPath(): string {
  // Sin Electron no hay carpeta de datos de GitCron: se dice y no se escribe en
  // otro lado (las pruebas abren su base con `bootstrapDatabase` o pasan `db`).
  const electron = require('electron') as { app?: { getPath(name: 'userData'): string } };
  const userDataPath = electron.app?.getPath('userData');
  if (!userDataPath) throw new Error('No está la carpeta de datos de GitCron (Electron no disponible).');
  return userDataPath;
}

/**
 * Detecta la rama actual leyendo .git/HEAD de forma directa y síncrona.
 * Soporta tanto directorios .git estándar como archivos .git de worktrees.
 */
export function detectCurrentBranch(canonicalRepoPath: string): string | null {
  try {
    const gitEntry = path.join(canonicalRepoPath, '.git');
    if (!fs.existsSync(gitEntry)) return null;

    let headPath = path.join(gitEntry, 'HEAD');
    const st = fs.lstatSync(gitEntry);
    if (st.isFile()) {
      // Worktree: .git contiene "gitdir: <path>"
      const content = fs.readFileSync(gitEntry, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/i);
      if (match && match[1]) {
        const resolvedGitDir = path.resolve(canonicalRepoPath, match[1].trim());
        headPath = path.join(resolvedGitDir, 'HEAD');
      }
    }

    if (!fs.existsSync(headPath)) return null;
    const headContent = fs.readFileSync(headPath, 'utf8').trim();
    if (headContent.startsWith('ref: refs/heads/')) {
      return headContent.slice('ref: refs/heads/'.length).trim();
    }
    return headContent.slice(0, 8);
  } catch {
    return null;
  }
}

function toIsoString(val: number | string): string {
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  return new Date(val).toISOString();
}

/**
 * Guarda un registro de uso de IA al terminar.
 * Sólo registra para repositorios abiertos (`authorizedRepoRoot`).
 * Si ocurre un fallo al guardar, avisa por consola sin datos del pedido y el uso sigue.
 */
export function recordAiUse(
  args: InsertAiUseRecordArgs,
  options: AiUseHistoryOptions = {},
): string | null {
  try {
    const canonicalRepo = authorizedRepoRoot(args.repoPath);
    if (!canonicalRepo) {
      // Con un repositorio que no es una pestaña abierta, no se registra.
      return null;
    }

    const db = resolveDatabase(options);
    const id = randomUUID();
    const branch = args.branch !== undefined ? args.branch : detectCurrentBranch(canonicalRepo);

    let deviceId = args.deviceId;
    let deviceLabel = args.deviceLabel ?? null;
    if (!deviceId) {
      try {
        const identity = getDeviceIdentity(options.userDataPath ?? resolveDefaultUserDataPath());
        deviceId = identity.deviceId;
        deviceLabel = identity.deviceLabel;
      } catch {
        deviceId = 'unknown-device';
      }
    }

    const startedIso = toIsoString(args.startedAt);
    const endedIso = toIsoString(args.endedAt);
    const startedMs = typeof args.startedAt === 'number' ? args.startedAt : new Date(args.startedAt).getTime();
    const endedMs = typeof args.endedAt === 'number' ? args.endedAt : new Date(args.endedAt).getTime();
    const durationMs = args.durationMs ?? Math.max(0, endedMs - startedMs);

    const promptTokens = args.usage?.promptTokens ?? null;
    const cachedPromptTokens = args.usage?.cachedPromptTokens ?? null;
    const completionTokens = args.usage?.completionTokens ?? null;
    const reasoningTokens = args.usage?.reasoningTokens ?? null;

    const commitEditedInt = args.commitEdited === true ? 1 : args.commitEdited === false ? 0 : null;
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO ${AI_USE_RECORD_TABLE} (
        id, repo_path, branch, device_id, device_label, use, started_at, ended_at, duration_ms,
        family, provider_id, provider_name, model_id, reasoning_effort, variant,
        effective_request_json, prompt_sent, result_status, result_text,
        prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens,
        commit_hash, commit_edited, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      canonicalRepo,
      branch ?? null,
      deviceId,
      deviceLabel,
      args.use,
      startedIso,
      endedIso,
      durationMs,
      args.family,
      args.providerId,
      args.providerName,
      args.modelId,
      args.reasoningEffort ?? null,
      args.variant ?? null,
      JSON.stringify(args.effectiveRequest),
      args.promptSent,
      args.resultStatus,
      args.resultText ?? null,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      args.commitHash ?? null,
      commitEditedInt,
      createdAt,
    );

    return id;
  } catch (error) {
    console.warn(
      '[ai-use-history] No se pudo guardar el registro de uso:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

interface RawHistoryRow {
  id: string;
  repo_path: string;
  branch: string | null;
  device_id: string;
  device_label: string | null;
  use: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  family: string;
  provider_id: string;
  provider_name: string;
  model_id: string;
  reasoning_effort: string | null;
  variant: string | null;
  result_status: string;
  result_text: string | null;
  prompt_tokens: number | null;
  cached_prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  commit_hash: string | null;
  commit_edited: number | null;
  prompt_sent_bytes: number;
  created_at: string;
}

function mapSummaryRow(row: RawHistoryRow): AiUseHistoryItem {
  return {
    id: row.id,
    repoPath: row.repo_path,
    branch: row.branch,
    deviceId: row.device_id,
    deviceLabel: row.device_label ?? null,
    use: row.use,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    family: row.family as 'openai-compatible' | 'anthropic' | 'cli',
    providerId: row.provider_id,
    providerName: row.provider_name,
    modelId: row.model_id,
    reasoningEffort: row.reasoning_effort,
    variant: row.variant,
    resultStatus: row.result_status as AiUseResultStatus,
    resultText: row.result_text,
    promptTokens: row.prompt_tokens,
    cachedPromptTokens: row.cached_prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    commitHash: row.commit_hash,
    commitEdited: row.commit_edited === 1 ? true : row.commit_edited === 0 ? false : null,
    promptSentBytes: Number(row.prompt_sent_bytes || 0),
    createdAt: row.created_at,
  };
}

/**
 * Lista registros de historial de IA para un repositorio, con filtros y paginado.
 * La lista no incluye el texto enviado completo sino su tamaño en bytes.
 */
export function listAiUseHistory(
  args: ListAiUseHistoryArgs,
  options: AiUseHistoryOptions = {},
): ListAiUseHistoryResult {
  const db = resolveDatabase(options);
  const whereClauses: string[] = ['repo_path = ?'];
  const params: (string | number | null)[] = [args.repoPath];

  if (args.use && args.use !== 'all') {
    whereClauses.push('use = ?');
    params.push(args.use);
  }

  if (args.resultStatus && args.resultStatus !== 'all') {
    whereClauses.push('result_status = ?');
    params.push(args.resultStatus);
  }

  const whereSql = whereClauses.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${AI_USE_RECORD_TABLE} WHERE ${whereSql}`).get(...params) as { count?: number };
  const total = Number(countRow?.count ?? 0);

  const limit = Math.max(1, Math.min(100, args.limit ?? 20));
  const offset = Math.max(0, args.offset ?? 0);

  const listParams: (string | number | null)[] = [...params, limit, offset];
  const query = `
    SELECT
      id, repo_path, branch, device_id, device_label, use, started_at, ended_at, duration_ms,
      family, provider_id, provider_name, model_id, reasoning_effort, variant,
      result_status, result_text, prompt_tokens, cached_prompt_tokens,
      completion_tokens, reasoning_tokens, commit_hash, commit_edited,
      LENGTH(CAST(prompt_sent AS BLOB)) as prompt_sent_bytes,
      created_at
    FROM ${AI_USE_RECORD_TABLE}
    WHERE ${whereSql}
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...listParams) as unknown as RawHistoryRow[];
  const items = rows.map(mapSummaryRow);

  return { items, total };
}

interface RawDetailRow extends RawHistoryRow {
  effective_request_json: string;
  prompt_sent: string;
}

/**
 * Obtiene un registro completo por ID, incluyendo el pedido efectivo y lo enviado.
 */
export function getAiUseRecord(
  id: string,
  repoPath?: string,
  options: AiUseHistoryOptions = {},
): AiUseHistoryDetail | null {
  const db = resolveDatabase(options);
  const sql = repoPath
    ? `SELECT *, LENGTH(CAST(prompt_sent AS BLOB)) as prompt_sent_bytes FROM ${AI_USE_RECORD_TABLE} WHERE id = ? AND repo_path = ?`
    : `SELECT *, LENGTH(CAST(prompt_sent AS BLOB)) as prompt_sent_bytes FROM ${AI_USE_RECORD_TABLE} WHERE id = ?`;

  const params = repoPath ? [id, repoPath] : [id];
  const row = db.prepare(sql).get(...params) as unknown as RawDetailRow | undefined;
  if (!row) return null;

  const base = mapSummaryRow(row);
  let effectiveRequest: CommitAiLastRequest;
  try {
    effectiveRequest = JSON.parse(row.effective_request_json);
  } catch {
    effectiveRequest = {
      kind: 'openai-compatible',
      endpoint: '',
      model: { value: row.model_id, provenance: '' },
      parameters: {},
      headers: [],
      timestamp: Date.now(),
    };
  }

  return {
    ...base,
    effectiveRequest,
    promptSent: row.prompt_sent,
  };
}

/**
 * Vacía el historial de un único repositorio.
 * No afecta registros de otros repositorios.
 */
export function clearAiUseHistory(
  repoPath: string,
  options: AiUseHistoryOptions = {},
): number {
  const db = resolveDatabase(options);
  const stmt = db.prepare(`DELETE FROM ${AI_USE_RECORD_TABLE} WHERE repo_path = ?`);
  const result = stmt.run(repoPath) as { changes?: number };
  return Number(result?.changes ?? 0);
}

/**
 * Vincula el hash del commit al registro de redacción y si el mensaje fue editado.
 */
export function linkAiUseCommit(
  recordId: string,
  commitHash: string,
  edited: boolean,
  repoPath?: string,
  options: AiUseHistoryOptions = {},
): boolean {
  const db = resolveDatabase(options);
  const commitEditedInt = edited ? 1 : 0;
  const sql = repoPath
    ? `UPDATE ${AI_USE_RECORD_TABLE} SET commit_hash = ?, commit_edited = ? WHERE id = ? AND repo_path = ?`
    : `UPDATE ${AI_USE_RECORD_TABLE} SET commit_hash = ?, commit_edited = ? WHERE id = ?`;

  const params = repoPath ? [commitHash, commitEditedInt, recordId, repoPath] : [commitHash, commitEditedInt, recordId];
  const result = db.prepare(sql).run(...params) as { changes?: number };
  return Number(result?.changes ?? 0) > 0;
}
