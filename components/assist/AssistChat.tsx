'use client';

// components/assist/AssistChat.tsx
//
// Componente de chat con la IA de GitCron (tarea 2.4).
// Columna izquierda con las conversaciones del repositorio; columna derecha con la
// conversación activa, visualizador de Markdown, opciones de modelo y acciones del contexto.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '@/hooks/use-translation';
import { assistContributions } from '@/lib/assist/assist-registry';
import { AiUseLine } from '@/components/ai/AiUseLine';
import { MarkdownViewer } from '@/components/pipeline/MarkdownViewer';
import { Row, Text } from '@/components/ui';
import type {
  AssistConversationSummary,
  AssistMessage,
  AssistMessageReference,
  AssistSendArgs,
  AssistSendResult,
  ContextSelection,
} from '@/types/assist-context';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import styles from './AssistChat.module.css';

export interface AssistChatProps {
  /** El repo abierto (`useGitStore((s) => s.repoPath)` lo pasa quien lo monta). */
  repoPath: string | null;
  /** La vista activa; con ella se lee la contribución del registro. */
  viewId?: string;
}

function formatTarget(
  ref: AssistMessageReference,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const sel = ref.selection;
  let target = '';
  switch (sel.kind) {
    case 'commit':
      target = t('assist.target.commit', { sha: sel.sha });
      break;
    case 'file':
      target = t('assist.target.file', { path: sel.path });
      break;
    case 'change':
      if (sel.taskId) {
        target = t('assist.target.task', { taskId: sel.taskId, changeId: sel.changeId });
      } else {
        target = t('assist.target.change', { changeId: sel.changeId });
      }
      break;
    case 'temporal-idea':
      target = t('assist.target.temporal');
      break;
    case 'carto-node':
      target = t('assist.target.carto', { nodeId: sel.nodeId });
      break;
    case 'none':
    default:
      return '';
  }
  let label = t('assist.about', { target });
  if (ref.status === 'stale') {
    label += ` ${t('assist.stale')}`;
  }
  return label;
}

function createOptimisticMessage(
  requestId: string,
  seq: number,
  text: string,
  selection: ContextSelection,
): AssistMessage {
  return {
    id: 'temp-' + requestId,
    seq,
    role: 'user',
    text,
    providerName: null,
    modelId: null,
    createdAt: new Date().toISOString(),
    references:
      selection.kind !== 'none' ? [{ selection, headSha: null, status: 'ok' }] : [],
  };
}

interface PendingRequest {
  repo: string;
  convId: string | null;
  requestId: string;
  message: AssistMessage;
}

interface SendResultHandlers {
  onAnswered: (finalConvId: string) => Promise<void>;
  onCancelled: () => Promise<void>;
  onDiscarded: () => void;
  onFailed: (
    msg: string,
    alternatives?: { providerId: string; providerName: string }[],
  ) => Promise<void>;
}

async function dispatchSendResult(
  resultData: AssistSendResult,
  handlers: SendResultHandlers,
): Promise<void> {
  switch (resultData.status) {
    case 'answered':
      await handlers.onAnswered(resultData.conversationId);
      break;
    case 'cancelled':
      await handlers.onCancelled();
      break;
    case 'discarded':
      handlers.onDiscarded();
      break;
    case 'failed':
      await handlers.onFailed(resultData.message, resultData.alternatives);
      break;
  }
}

async function processSendResponse(
  res: { success: boolean; data?: AssistSendResult; error?: string } | undefined,
  targetRepo: string,
  targetConvId: string | null,
  currentRepo: string | null,
  currentConvId: string | null,
  handlers: SendResultHandlers,
  refreshList: (repo: string) => Promise<unknown>,
  setNotice: (msg: string) => void,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<void> {
  if (currentRepo !== targetRepo) return;
  if (currentConvId !== targetConvId) {
    await refreshList(targetRepo);
    return;
  }
  if (!res || !res.success || !res.data) {
    setNotice(t('assist.failed', { message: res?.error ?? 'Error desconocido' }));
    return;
  }
  await dispatchSendResult(res.data, handlers);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AssistChat({ repoPath, viewId = 'graph' }: AssistChatProps): React.JSX.Element {
  const t = useT();

  const rememberConversation = useAssistDockStore((s) => s.rememberConversation);

  const [conversations, setConversations] = useState<AssistConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistMessage[]>([]);
  const [question, setQuestion] = useState('');
  // El pedido en curso, con el repo y la conversación de donde salió: sólo ahí se muestra.
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [alternativesNotice, setAlternativesNotice] = useState<string | null>(null);

  // Al cambiar de repo, ni la lista, ni los mensajes, ni los avisos del anterior quedan a la vista
  // (ajuste de estado durante el render, sin un efecto que dispare otro render).
  const [shownRepo, setShownRepo] = useState<string | null>(repoPath);
  if (shownRepo !== repoPath) {
    setShownRepo(repoPath);
    setConversations([]);
    setMessages([]);
    setNotice(null);
    setAlternativesNotice(null);
  }

  const currentRepoPathRef = useRef<string | null>(repoPath);
  const currentConvIdRef = useRef<string | null>(selectedConvId);

  useEffect(() => {
    currentRepoPathRef.current = repoPath;
  }, [repoPath]);

  useEffect(() => {
    currentConvIdRef.current = selectedConvId;
  }, [selectedConvId]);

  const loadConversation = useCallback(
    async (path: string, convId: string) => {
      try {
        const res = await window.api?.assistConversations?.get({
          repoPath: path,
          conversationId: convId,
        });
        if (currentRepoPathRef.current !== path) return;
        if (res?.success && res.data) setMessages(res.data.messages);
        else if (res && !res.success) setNotice(t('assist.failed', { message: res.error ?? '' }));
      } catch (err) {
        if (currentRepoPathRef.current === path) setNotice(t('assist.failed', { message: errorText(err) }));
      }
    },
    [t],
  );

  const refreshList = useCallback(async (path: string) => {
    try {
      const res = await window.api?.assistConversations?.list({ repoPath: path });
      if (currentRepoPathRef.current !== path) return [];
      if (res?.success && res.data) {
        setConversations(res.data);
        return res.data;
      }
      if (res && !res.success) setNotice(t('assist.failed', { message: res.error ?? '' }));
    } catch (err) {
      if (currentRepoPathRef.current === path) setNotice(t('assist.failed', { message: errorText(err) }));
    }
    return [];
  }, [t]);

  // Carga inicial y cambio de repo
  useEffect(() => {
    if (!repoPath) return;

    const api = window.api?.assistConversations;
    if (!api) return;
    let alive = true;
    // Se lee al cambiar de repo, sin suscribirse: elegir una conversación no tiene que recargar la lista.
    const rememberedId = useAssistDockStore.getState().conversationByRepo[repoPath] || null;
    const fail = (message: string) => {
      if (alive) setNotice(t('assist.failed', { message }));
    };
    api.list({ repoPath }).then((res) => {
      if (!alive) return;
      if (!res?.success || !res.data) return fail(res?.error ?? '');
      setConversations(res.data);
      if (!rememberedId || !res.data.some((c) => c.id === rememberedId)) {
        setSelectedConvId(null);
        return;
      }
      setSelectedConvId(rememberedId);
      return api.get({ repoPath, conversationId: rememberedId }).then((getRes) => {
        if (!alive) return;
        if (getRes?.success && getRes.data) setMessages(getRes.data.messages);
        else fail(getRes?.error ?? '');
      });
    }).catch((err: unknown) => fail(errorText(err)));

    return () => {
      alive = false;
    };
  }, [repoPath, t]);

  // Selección de una conversación
  const handleSelectConversation = (convId: string) => {
    if (!repoPath) return;
    setSelectedConvId(convId);
    rememberConversation(repoPath, convId);
    setNotice(null);
    setAlternativesNotice(null);
    loadConversation(repoPath, convId);
  };

  // Nueva conversación
  const handleNewConversation = () => {
    if (!repoPath) return;
    setSelectedConvId(null);
    rememberConversation(repoPath, '');
    setMessages([]);
    setNotice(null);
    setAlternativesNotice(null);
  };

  // Confirmar o descartar borrado
  const handleDeleteConfirm = async (convId: string) => {
    if (!repoPath) return;
    try {
      const res = await window.api?.assistConversations?.delete({
        repoPath,
        conversationId: convId,
      });
      if (res && !res.success) setNotice(t('assist.failed', { message: res.error ?? '' }));
      if (res?.success && res.data?.deleted) {
        if (selectedConvId === convId) {
          setSelectedConvId(null);
          rememberConversation(repoPath, '');
          setMessages([]);
        }
        await refreshList(repoPath);
      }
    } catch (err) {
      setNotice(t('assist.failed', { message: errorText(err) }));
    } finally {
      setDeletingId(null);
    }
  };

  // Cancelar pedido activo
  const handleCancel = async () => {
    if (!pending) return;
    await window.api?.assistConversations?.cancel({ requestId: pending.requestId });
  };

  const createSendResultHandlers = (
    targetRepo: string,
    targetConvId: string | null,
  ): SendResultHandlers => ({
    onAnswered: async (finalConvId) => {
      rememberConversation(targetRepo, finalConvId);
      setSelectedConvId(finalConvId);
      await Promise.all([
        loadConversation(targetRepo, finalConvId),
        refreshList(targetRepo),
      ]);
    },
    onCancelled: async () => {
      setNotice(t('assist.cancelled'));
      if (targetConvId) {
        await loadConversation(targetRepo, targetConvId);
      }
    },
    onDiscarded: () => {
      setNotice(t('assist.discarded'));
    },
    onFailed: async (msg, alternatives) => {
      setNotice(t('assist.failed', { message: msg }));
      if (alternatives && alternatives.length > 0) {
        const provs = alternatives.map((a) => a.providerName).join(', ');
        setAlternativesNotice(t('assist.alternatives', { providers: provs }));
      }
      if (targetConvId) {
        await loadConversation(targetRepo, targetConvId);
      }
    },
  });

  // Enviar pregunta
  const handleSend = async () => {
    const trimmed = question.trim();
    if (!trimmed || pending || !repoPath) return;

    const targetRepo = repoPath;
    const targetConvId = selectedConvId;
    const requestId = crypto.randomUUID();

    const contribution = assistContributions.contributionFor(viewId);
    const selection = contribution.selection;
    const optimisticMsg = createOptimisticMessage(
      requestId,
      messages.length + 1,
      trimmed,
      selection,
    );

    setPending({ repo: targetRepo, convId: targetConvId, requestId, message: optimisticMsg });
    setQuestion('');
    setNotice(null);
    setAlternativesNotice(null);

    const args: AssistSendArgs = {
      repoPath: targetRepo,
      requestId,
      conversationId: targetConvId,
      viewId,
      question: trimmed,
      selection,
    };

    try {
      const res = await window.api?.assistConversations?.send(args);
      await processSendResponse(
        res,
        targetRepo,
        targetConvId,
        currentRepoPathRef.current,
        currentConvIdRef.current,
        createSendResultHandlers(targetRepo, targetConvId),
        refreshList,
        setNotice,
        t,
      );
    } catch (err) {
      if (
        currentRepoPathRef.current === targetRepo &&
        currentConvIdRef.current === targetConvId
      ) {
        setNotice(
          t('assist.failed', {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } finally {
      // Se suelta siempre, esté donde esté la persona; sólo el pedido propio.
      setPending((p) => (p?.requestId === requestId ? null : p));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  if (!repoPath) {
    return (
      <div className={styles.container}>
        <div className={styles.noRepo}>
          <Text variant="secondary-xs">{t('assist.noRepo')}</Text>
        </div>
      </div>
    );
  }

  const contribution = assistContributions.contributionFor(viewId);
  const consultActions = contribution.actions.filter(
    (a) => a.scope === 'consult' && a.available,
  );

  // «Pensando…» y la pregunta provisional sólo en el repo y la conversación de donde salió.
  const isThinking = pending !== null && pending.repo === repoPath && pending.convId === selectedConvId;
  const displayedMessages = isThinking && pending ? [...messages, pending.message] : messages;

  return (
    <div className={styles.container}>
      {/* Columna izquierda: lista de conversaciones */}
      <aside className={styles.sidebar}>
        <button
          type="button"
          className={styles.newButton}
          onClick={handleNewConversation}
        >
          {t('assist.newConversation')}
        </button>

        {conversations.length === 0 ? (
          <div className={styles.emptyList}>{t('assist.empty')}</div>
        ) : (
          <ul className={styles.conversationList}>
            {conversations.map((c) => {
              const isSelected = selectedConvId === c.id;
              const isDeleting = deletingId === c.id;

              return (
                <li
                  key={c.id}
                  className={styles.conversationItem}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className={styles.conversationSelectBtn}
                    onClick={() => handleSelectConversation(c.id)}
                    title={c.title}
                  >
                    <span className={styles.conversationTitle}>{c.title}</span>
                  </button>

                  {isDeleting ? (
                    <div className={styles.confirmBox}>
                      <span className={styles.confirmPrompt}>
                        {t('assist.deleteConfirm')}
                      </span>
                      <button
                        type="button"
                        className={styles.confirmYesBtn}
                        onClick={() => handleDeleteConfirm(c.id)}
                      >
                        {t('assist.deleteYes')}
                      </button>
                      <button
                        type="button"
                        className={styles.confirmNoBtn}
                        onClick={() => setDeletingId(null)}
                      >
                        {t('assist.deleteNo')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => setDeletingId(c.id)}
                      title={t('assist.delete')}
                    >
                      {t('assist.delete')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Columna derecha: conversación activa */}
      <main className={styles.chatArea}>
        <div className={styles.messagesContainer}>
          {displayedMessages.length === 0 ? (
            <div className={styles.emptyConversation}>
              {t('assist.emptyConversation')}
            </div>
          ) : (
            displayedMessages.map((msg) => {
              const isUser = msg.role === 'user';
              const targetDesc =
                isUser && msg.references && msg.references.length > 0
                  ? formatTarget(msg.references[0], t)
                  : '';

              return (
                <div
                  key={msg.id}
                  className={isUser ? styles.userBubble : styles.assistantBubble}
                  data-role={msg.role}
                >
                  <div className={styles.bubbleHeader}>
                    <Text variant="secondary-xs" className={styles.authorName}>
                      {isUser ? t('assist.you') : t('assist.assistant')}
                    </Text>
                    {targetDesc && (
                      <span className={styles.referenceBadge}>{targetDesc}</span>
                    )}
                  </div>

                  {isUser ? (
                    <div>{msg.text}</div>
                  ) : (
                    <>
                      <MarkdownViewer content={msg.text} />
                      {(msg.providerName || msg.modelId) && (
                        <div className={styles.modelBadge}>
                          <Text variant="secondary-xs">
                            {[msg.providerName, msg.modelId].filter(Boolean).join(' · ')}
                          </Text>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}

          {isThinking && (
            <div className={styles.thinkingRow}>
              <Text variant="secondary-xs">{t('assist.thinking')}</Text>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleCancel}
              >
                {t('assist.cancel')}
              </button>
            </div>
          )}

          {notice && (
            <div className={styles.noticeAlert} role="alert">
              <Text variant="secondary-xs">{notice}</Text>
              {alternativesNotice && (
                <Text variant="secondary-xs">{alternativesNotice}</Text>
              )}
            </div>
          )}
        </div>

        {/* Cuadro de texto y envío */}
        <div className={styles.inputSection}>
          <div className={styles.inputRow}>
            <textarea
              className={styles.textarea}
              placeholder={t('assist.placeholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
            />
            <button
              type="button"
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={pending !== null || !question.trim()}
            >
              {t('assist.send')}
            </button>
          </div>

          {/* Opciones y acciones */}
          <div className={styles.optionsSection}>
            <AiUseLine use="gitcron-assist" repoPath={repoPath} />

            {consultActions.length > 0 && (
              <div className={styles.suggestionsSection}>
                <span className={styles.suggestionsHeader}>
                  {t('assist.suggestions')}
                </span>
                <Row gap="2" className={styles.suggestionsRow}>
                  {consultActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={styles.suggestionBtn}
                      onClick={() => setQuestion(t(action.labelKey))}
                    >
                      {t(action.labelKey)}
                    </button>
                  ))}
                </Row>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
