// electron/assist/assist-send.ts
//
// Envío cancelable de preguntas al modelo de asistencia contextual (retomar 2.3).
// Valida contexto, gestiona presupuesto de historial, resuelve modelo según gitcron-assist
// y persiste pregunta y respuesta asociadas a la conversación canónica del repositorio.

import * as path from 'node:path';
import { authorizedRepoRoot } from '../ipc/authorized-repos';
import { resolveContextReference } from './context-reference';
import { resolveForUse } from '../ai/use-resolution';
import { runTextUse, TextUseError } from '../ai/text-use';
import type { ResolvedModelFor } from '../ai/config/resolve-model-for';
import {
  appendMessage,
  createConversation,
  getConversation,
  sanitizeAssistText,
  type AssistDbOptions,
} from '../db/assist-conversations';
import type {
  AssistMessage,
  AssistMessageReference,
  AssistMessageUsage,
  AssistSendArgs,
  AssistSendResult,
  ContextSelection,
} from '../../types/assist-context';

export interface AssistSendDeps {
  authorizedRoot(repoPath: unknown): string | null;
  resolveContext: typeof resolveContextReference;
  resolveModel(repoPath: string): ResolvedModelFor;
  runText: typeof runTextUse;
  db?: AssistDbOptions;
}

export const defaultAssistSendDeps: AssistSendDeps = {
  authorizedRoot: (repoPath) => authorizedRepoRoot(repoPath),
  resolveContext: resolveContextReference,
  resolveModel: (repoPath) => resolveForUse('gitcron-assist', repoPath),
  runText: runTextUse,
};

/** El tope de caracteres del contexto de conversación que se manda. */
export const ASSIST_HISTORY_CHAR_BUDGET = 12_000;

const activeRequests = new Map<string, { controller: AbortController; conversationId: string }>();

/** Cancela el pedido en curso con ese id. Devuelve si había uno. */
export function cancelAssistMessage(requestId: string): boolean {
  const active = activeRequests.get(requestId);
  if (active) {
    active.controller.abort();
    return true;
  }
  return false;
}

function validateArgs(args: AssistSendArgs): string | null {
  if (!args || typeof args !== 'object') {
    return 'Parámetros inválidos.';
  }
  if (typeof args.requestId !== 'string' || !args.requestId.trim() || args.requestId.trim().length > 100) {
    return 'Identificador de pedido inválido.';
  }
  const trimmed = typeof args.question === 'string' ? args.question.trim() : '';
  if (!trimmed) {
    return 'La pregunta no puede estar vacía.';
  }
  if (trimmed.length > 8000) {
    return 'La pregunta no puede superar los 8000 caracteres.';
  }
  if (args.conversationId !== null && (typeof args.conversationId !== 'string' || !args.conversationId.trim())) {
    return 'Identificador de conversación inválido.';
  }
  return null;
}

function describeSelection(selection: ContextSelection, status: string, reason?: string): string {
  let desc = '';
  switch (selection.kind) {
    case 'none':
      desc = 'Sin elemento seleccionado.';
      break;
    case 'commit':
      desc = `Commit seleccionado: ${selection.sha}`;
      break;
    case 'file':
      desc = `Archivo seleccionado: ${selection.path} (en ${selection.at})`;
      break;
    case 'change':
      desc = `Cambio seleccionado: ${selection.changeId}${selection.taskId ? ` (tarea ${selection.taskId})` : ''}`;
      break;
    case 'temporal-idea':
      desc = `Idea temporal seleccionada: corrida ${selection.runId}, rama ${selection.branchId}`;
      break;
    case 'carto-node':
      desc = `Nodo de cartografía seleccionado: ${selection.nodeId}`;
      break;
  }
  if (status === 'stale' && reason) {
    desc += ` (obsoleta: ${reason})`;
  }
  return desc;
}

function formatHistory(messages: AssistMessage[], budget: number): string {
  const selected: string[] = [];
  let currentChars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line = `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.text}`;
    if (currentChars + line.length + 1 > budget && selected.length > 0) {
      break;
    }
    selected.push(line);
    currentChars += line.length + 1;
  }
  selected.reverse();
  return selected.join('\n');
}

function buildPrompts(
  root: string,
  head: { sha: string; branch: string | null },
  selection: ContextSelection,
  status: string,
  reason: string | undefined,
  previousMessages: AssistMessage[],
  question: string,
): { system: string; user: string } {
  const system =
    'Sos el asistente de GitCron para este repositorio. Respondés en el idioma de la pregunta. No ejecutás nada ni modificás el repositorio (solo explicás y proponés). Si la referencia de contexto está obsoleta, mencionalo explícitamente.';

  const branchLabel = head.branch ?? 'HEAD separado';
  // Sólo el nombre del repo: la ruta del disco de la persona no le sirve al modelo y puede ser un servicio externo.
  const header = `Repositorio: ${path.basename(root)} · Rama: ${branchLabel} · HEAD: ${head.sha}\n${describeSelection(selection, status, reason)}`;
  const historyText = previousMessages.length > 0 ? formatHistory(previousMessages, ASSIST_HISTORY_CHAR_BUDGET) : '';
  const user = [header, historyText, `Pregunta: ${question}`].filter(Boolean).join('\n\n');

  return { system, user };
}

function isConversationBusy(conversationId: string | null): boolean {
  if (conversationId === null) return false;
  for (const active of activeRequests.values()) {
    if (active.conversationId === conversationId) return true;
  }
  return false;
}

function validateInitial(
  args: AssistSendArgs,
  deps: AssistSendDeps,
): { error?: AssistSendResult; root?: string } {
  const validationError = validateArgs(args);
  if (validationError) {
    return {
      error: {
        status: 'failed',
        conversationId: args?.conversationId ?? null,
        reason: 'invalid',
        message: validationError,
        alternatives: [],
      },
    };
  }

  const root = deps.authorizedRoot(args.repoPath);
  if (root === null) {
    return {
      error: {
        status: 'failed',
        conversationId: args.conversationId ?? null,
        reason: 'repo-not-authorized',
        message: 'Repositorio no autorizado.',
        alternatives: [],
      },
    };
  }

  return { root };
}

function resolveTargetConversation(
  root: string,
  args: AssistSendArgs,
  deps: AssistSendDeps,
): { error?: AssistSendResult; conversationId: string; previousMessages: AssistMessage[] } {
  if (args.conversationId === null) {
    const created = createConversation(
      {
        checkoutPath: root,
        title: args.question.trim(),
        viewId: args.viewId ?? null,
      },
      deps.db,
    );
    return { conversationId: created.id, previousMessages: [] };
  }

  const existing = getConversation({ checkoutPath: root, conversationId: args.conversationId }, deps.db);
  if (!existing) {
    return {
      conversationId: args.conversationId,
      previousMessages: [],
      error: {
        status: 'failed',
        conversationId: args.conversationId,
        reason: 'conversation-not-found',
        message: 'La conversación no existe o pertenece a otro repositorio.',
        alternatives: [],
      },
    };
  }

  return { conversationId: existing.conversation.id, previousMessages: existing.messages };
}

function buildReferences(
  context: Extract<Awaited<ReturnType<AssistSendDeps['resolveContext']>>, { status: 'ok' | 'stale' }>,
): AssistMessageReference[] {
  if (context.selection.kind === 'none') return [];
  return [
    {
      selection: context.selection,
      headSha: context.head.sha,
      status: context.status === 'stale' ? 'stale' : 'ok',
    },
  ];
}

function recordAnswer(
  root: string,
  conversationId: string,
  modelConfig: ResolvedModelFor,
  resultText: string,
  modelId: string,
  questionMessage: AssistMessage,
  deps: AssistSendDeps,
  usage?: AssistMessageUsage | null,
): AssistSendResult {
  const currentConv = getConversation({ checkoutPath: root, conversationId }, deps.db);
  if (!currentConv) {
    return { status: 'discarded', conversationId };
  }

  // Una respuesta que queda vacía al sacarle el razonamiento o lo que parecía un secreto no se guarda.
  // Un error al guardar no se esconde: sube y termina en «failed».
  if (!sanitizeAssistText(resultText)) {
    return { status: 'discarded', conversationId };
  }
  const providerName = modelConfig.status === 'resolved' ? modelConfig.resolved.providerName : null;
  const answerMessage = appendMessage(
    {
      checkoutPath: root,
      conversationId,
      role: 'assistant',
      text: resultText,
      providerName,
      modelId,
      usage,
    },
    deps.db,
  );
  return { status: 'answered', conversationId, question: questionMessage, answer: answerMessage };
}

function handleModelError(
  error: unknown,
  conversationId: string,
  controller: AbortController,
): AssistSendResult {
  if (controller.signal.aborted || (error instanceof TextUseError && error.reason === 'cancelled')) {
    return { status: 'cancelled', conversationId };
  }
  if (error instanceof TextUseError) {
    return {
      status: 'failed',
      conversationId,
      reason: error.reason,
      message: error.message,
      alternatives: error.alternatives.map((alt) => ({
        providerId: alt.providerId,
        providerName: alt.providerName,
      })),
    };
  }
  return {
    status: 'failed',
    conversationId,
    reason: 'failed',
    message: error instanceof Error ? error.message : String(error),
    alternatives: [],
  };
}

export async function sendAssistMessage(
  args: AssistSendArgs,
  deps: AssistSendDeps = defaultAssistSendDeps,
): Promise<AssistSendResult> {
  const initial = validateInitial(args, deps);
  if (initial.error) return initial.error;
  const root = initial.root!;

  const context = await deps.resolveContext(args.repoPath, args.selection);
  if (context.status === 'rejected') {
    return {
      status: 'failed',
      conversationId: args.conversationId ?? null,
      reason: 'context-' + context.reason,
      message: 'Contexto rechazado: ' + context.reason,
      alternatives: [],
    };
  }

  if (activeRequests.has(args.requestId)) {
    return {
      status: 'failed',
      conversationId: args.conversationId,
      reason: 'invalid',
      message: 'Ya hay un pedido en curso con ese identificador.',
      alternatives: [],
    };
  }

  if (isConversationBusy(args.conversationId)) {
    return {
      status: 'failed',
      conversationId: args.conversationId,
      reason: 'busy',
      message: 'Hay una consulta en curso para esta conversación.',
      alternatives: [],
    };
  }

  const target = resolveTargetConversation(root, args, deps);
  if (target.error) return target.error;
  const { conversationId, previousMessages } = target;

  const trimmedQuestion = args.question.trim();
  const questionMessage = appendMessage(
    {
      checkoutPath: root,
      conversationId,
      role: 'user',
      text: trimmedQuestion,
      references: buildReferences(context),
    },
    deps.db,
  );

  const staleReason = context.status === 'stale' ? context.reason : undefined;
  const { system, user } = buildPrompts(
    root,
    context.head,
    context.selection,
    context.status,
    staleReason,
    previousMessages,
    trimmedQuestion,
  );

  const controller = new AbortController();
  activeRequests.set(args.requestId, { controller, conversationId });

  try {
    const modelConfig = deps.resolveModel(root);
    const startTime = Date.now();
    const result = await deps.runText(modelConfig, {
      system,
      user,
      signal: controller.signal,
      repoPath: root,
    });
    const durationMs = Date.now() - startTime;

    if (controller.signal.aborted) {
      return { status: 'cancelled', conversationId };
    }

    const contextLength =
      modelConfig.status === 'resolved' ? (modelConfig.resolved.contextLength ?? null) : null;

    const usage: AssistMessageUsage = {
      promptTokens: result.usage?.promptTokens ?? null,
      cachedPromptTokens: result.usage?.cachedPromptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      reasoningTokens: result.usage?.reasoningTokens ?? null,
      durationMs,
      contextLength,
    };

    return recordAnswer(root, conversationId, modelConfig, result.text, result.modelId, questionMessage, deps, usage);
  } catch (error) {
    return handleModelError(error, conversationId, controller);
  } finally {
    activeRequests.delete(args.requestId);
  }
}

