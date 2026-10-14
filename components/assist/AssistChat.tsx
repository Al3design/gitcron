'use client';

// components/assist/AssistChat.tsx
//
// Componente de chat con la IA de GitCron (tarea 2.4).
// Columna izquierda con las conversaciones del repositorio; columna derecha con la
// conversación activa, visualizador de Markdown, opciones de modelo y acciones del contexto.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { assistContributions } from '@/lib/assist/assist-registry';
import { formatUsageLine, sumUsage } from '@/lib/assist/usage-format';
import { MarkdownViewer } from '@/components/pipeline/MarkdownViewer';
import { TaskConfirmToast } from '@/components/pipeline/TaskConfirmToast';
import { Text } from '@/components/ui';
import { AssistComposer } from './AssistComposer';
import type {
  AssistConversationSummary,
  AssistMessage,
  AssistMessageReference,
  AssistSendArgs,
  AssistSendResult,
  ContextSelection,
} from '@/types/assist-context';
import {
  ASSIST_CHAT_LIST_MAX,
  ASSIST_CHAT_LIST_MIN,
  useAssistDockStore,
} from '@/lib/assist/assist-dock-store';
import styles from './AssistChat.module.css';

export interface AssistChatProps {
  /** El repo abierto (`useGitStore((s) => s.repoPath)` lo pasa quien lo monta). */
  repoPath: string | null;
  /** La vista activa; con ella se lee la contribución del registro. */
  viewId?: string;
}

function formatSelectionTarget(
  sel: ContextSelection,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (sel.kind) {
    case 'commit':
      return t('assist.target.commit', { sha: sel.sha.slice(0, 7) }); // corto, como en el resto de la app
    case 'file':
      return t('assist.target.file', { path: sel.path });
    case 'change':
      if (sel.taskId) {
        return t('assist.target.task', { taskId: sel.taskId, changeId: sel.changeId });
      }
      return t('assist.target.change', { changeId: sel.changeId });
    case 'temporal-idea':
      return t('assist.target.temporal');
    case 'carto-node':
      return t('assist.target.carto', { nodeId: sel.nodeId });
    case 'none':
    default:
      return '';
  }
}

function formatTarget(
  ref: AssistMessageReference,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const target = formatSelectionTarget(ref.selection, t);
  if (!target) return '';
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
    usage: null,
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
  setError: (msg: string) => void,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<void> {
  if (currentRepo !== targetRepo) return;
  if (currentConvId !== targetConvId) {
    await refreshList(targetRepo);
    return;
  }
  if (!res || !res.success || !res.data) {
    setError(t('assist.failed', { message: res?.error ?? 'Error desconocido' }));
    return;
  }
  await dispatchSendResult(res.data, handlers);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AssistChat({ repoPath, viewId = 'graph' }: AssistChatProps): React.JSX.Element {
  const t = useT();
  const language = useGitStore((s) => s.language);
  const locale = language || 'es';
  const setError = useGitStore((s) => s.setError);
  const setSuccess = useGitStore((s) => s.setSuccess);

  const rememberConversation = useAssistDockStore((s) => s.rememberConversation);
  const chatListOpen = useAssistDockStore((s) => s.chatListOpen);
  const chatListWidth = useAssistDockStore((s) => s.chatListWidth);
  const setChatListOpen = useAssistDockStore((s) => s.setChatListOpen);
  const setChatListWidth = useAssistDockStore((s) => s.setChatListWidth);

  // Arrastrar el borde de la columna cambia su ancho (como los paneles laterales).
  const startListResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatListWidth;
    const onMove = (ev: PointerEvent) => setChatListWidth(startWidth + (ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Con el teclado: flechas de a 16 px.
  const onListResizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setChatListWidth(chatListWidth - 16);
    if (event.key === 'ArrowRight') setChatListWidth(chatListWidth + 16);
  };

  const [conversations, setConversations] = useState<AssistConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistMessage[]>([]);
  const [question, setQuestion] = useState('');
  // El pedido en curso, con el repo y la conversación de donde salió: sólo ahí se muestra.
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [confirmDeleteConv, setConfirmDeleteConv] = useState<AssistConversationSummary | null>(null);
  const [openMenuConvId, setOpenMenuConvId] = useState<string | null>(null);
  const [menuCoords, setMenuCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!openMenuConvId) return;
    const handleClick = () => setOpenMenuConvId(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuConvId(null);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [openMenuConvId]);

  // Al cambiar de repo, ni la lista ni los mensajes del anterior quedan a la vista
  // (ajuste de estado durante el render, sin un efecto que dispare otro render).
  const [shownRepo, setShownRepo] = useState<string | null>(repoPath);
  if (shownRepo !== repoPath) {
    setShownRepo(repoPath);
    setConversations([]);
    setMessages([]);
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
        else if (res && !res.success) setError(t('assist.failed', { message: res.error ?? '' }));
      } catch (err) {
        if (currentRepoPathRef.current === path) setError(t('assist.failed', { message: errorText(err) }));
      }
    },
    [t, setError],
  );

  const refreshList = useCallback(async (path: string) => {
    try {
      const res = await window.api?.assistConversations?.list({ repoPath: path });
      if (currentRepoPathRef.current !== path) return [];
      if (res?.success && res.data) {
        setConversations(res.data);
        return res.data;
      }
      if (res && !res.success) setError(t('assist.failed', { message: res.error ?? '' }));
    } catch (err) {
      if (currentRepoPathRef.current === path) setError(t('assist.failed', { message: errorText(err) }));
    }
    return [];
  }, [t, setError]);

  // Carga inicial y cambio de repo
  useEffect(() => {
    if (!repoPath) return;

    const api = window.api?.assistConversations;
    if (!api) return;
    let alive = true;
    // Se lee al cambiar de repo, sin suscribirse: elegir una conversación no tiene que recargar la lista.
    const rememberedId = useAssistDockStore.getState().conversationByRepo[repoPath] || null;
    const fail = (message: string) => {
      if (alive) setError(t('assist.failed', { message }));
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
  }, [repoPath, t, setError]);

  // Selección de una conversación
  const handleSelectConversation = (convId: string) => {
    if (!repoPath) return;
    setSelectedConvId(convId);
    rememberConversation(repoPath, convId);
    loadConversation(repoPath, convId);
  };

  // Nueva conversación
  const handleNewConversation = () => {
    if (!repoPath) return;
    setSelectedConvId(null);
    rememberConversation(repoPath, '');
    setMessages([]);
  };

  // Confirmar borrado
  const handleDeleteConfirm = async (convId: string) => {
    if (!repoPath) return;
    try {
      const res = await window.api?.assistConversations?.delete({
        repoPath,
        conversationId: convId,
      });
      if (res && !res.success) setError(t('assist.failed', { message: res.error ?? '' }));
      if (res?.success && res.data?.deleted) {
        if (selectedConvId === convId) {
          setSelectedConvId(null);
          rememberConversation(repoPath, '');
          setMessages([]);
        }
        await refreshList(repoPath);
      }
    } catch (err) {
      setError(t('assist.failed', { message: errorText(err) }));
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
      setSuccess(t('assist.cancelled'));
      if (targetConvId) {
        await loadConversation(targetRepo, targetConvId);
      }
    },
    onDiscarded: () => {
      setSuccess(t('assist.discarded'));
    },
    onFailed: async (msg, alternatives) => {
      const msgText = t('assist.failed', { message: msg });
      if (alternatives && alternatives.length > 0) {
        const provs = alternatives.map((a) => a.providerName).join(', ');
        const altText = t('assist.alternatives', { providers: provs });
        setError(`${msgText} ${altText}`);
      } else {
        setError(msgText);
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

    const selection = effectiveSelection;
    const optimisticMsg = createOptimisticMessage(
      requestId,
      messages.length + 1,
      trimmed,
      selection,
    );

    setPending({ repo: targetRepo, convId: targetConvId, requestId, message: optimisticMsg });
    setQuestion('');

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
        setError,
        t,
      );
    } catch (err) {
      if (
        currentRepoPathRef.current === targetRepo &&
        currentConvIdRef.current === targetConvId
      ) {
        setError(
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

  const [, setContributionVersion] = useState(0);

  useEffect(() => {
    return assistContributions.subscribe(() => {
      setContributionVersion((v) => v + 1);
    });
  }, []);

  const contribution = assistContributions.contributionFor(viewId);
  const consultActions = contribution.actions.filter(
    (a) => a.scope === 'consult' && a.available,
  );

  const currentSelection = contribution.selection;
  const currentTargetKey = JSON.stringify(currentSelection);
  const [shownTargetKey, setShownTargetKey] = useState(currentTargetKey);
  const [shownMessageCount, setShownMessageCount] = useState(messages.length);
  const [targetHighlight, setTargetHighlight] = useState(false);
  const [ignoredSelectionKey, setIgnoredSelectionKey] = useState<string | null>(null);

  if (shownTargetKey !== currentTargetKey) {
    setShownTargetKey(currentTargetKey);
    setTargetHighlight(messages.length > 0);
    setIgnoredSelectionKey(null);
  }
  if (shownMessageCount !== messages.length) {
    setShownMessageCount(messages.length);
    setTargetHighlight(false);
  }

  const isIgnored = ignoredSelectionKey !== null && ignoredSelectionKey === currentTargetKey;
  const effectiveSelection: ContextSelection = isIgnored ? { kind: 'none' } : currentSelection;
  const targetLabel =
    effectiveSelection.kind !== 'none'
      ? formatTarget({ selection: effectiveSelection, headSha: null, status: 'ok' }, t)
      : null;

  const menuItems = [
    ...consultActions.map((action) => ({
      id: action.id,
      label: t(action.labelKey),
      onSelect: () => setQuestion(t(action.labelKey)),
    })),
    {
      id: 'new-conversation',
      label: t('assist.newConversation'),
      onSelect: handleNewConversation,
    },
  ];

  if (!repoPath) {
    return (
      <div className={styles.container}>
        <div className={styles.noRepo}>
          <Text variant="secondary-xs">{t('assist.noRepo')}</Text>
        </div>
      </div>
    );
  }

  // «Pensando…» y la pregunta provisional sólo en el repo y la conversación de donde salió.
  const isThinking = pending !== null && pending.repo === repoPath && pending.convId === selectedConvId;
  const displayedMessages = isThinking && pending ? [...messages, pending.message] : messages;

  return (
    <div className={styles.container}>
      {/* Columna izquierda: lista de conversaciones */}
      {chatListOpen && (
        <>
          <aside className={styles.sidebar} style={{ width: chatListWidth }}>
            <div className={styles.sidebarHeader}>
              <button
                type="button"
                className={styles.newButton}
                onClick={handleNewConversation}
              >
                <span>{t('assist.newConversation')}</span>
              </button>
            </div>

            {conversations.length === 0 ? (
              <div className={styles.emptyList}>{t('assist.empty')}</div>
            ) : (
              <ul className={styles.conversationList}>
                {conversations.map((c) => {
                  const isSelected = selectedConvId === c.id;

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

                      <div className={styles.conversationActions}>
                        <button
                          type="button"
                          className={styles.taskActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteConv(c);
                          }}
                          title={t('assist.delete')}
                          aria-label={t('assist.delete')}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={styles.taskActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuCoords({ x: rect.right, y: rect.bottom + 4 });
                            setOpenMenuConvId(openMenuConvId === c.id ? null : c.id);
                          }}
                          title={t('assist.moreActions')}
                          aria-label={t('assist.moreActions')}
                        >
                          <MoreHorizontal size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('assist.listResize')}
            aria-valuemin={ASSIST_CHAT_LIST_MIN}
            aria-valuemax={ASSIST_CHAT_LIST_MAX}
            aria-valuenow={chatListWidth}
            tabIndex={0}
            className={styles.listResizer}
            onPointerDown={startListResize}
            onKeyDown={onListResizeKey}
          />
        </>
      )}

      {/* Menú contextual de tres puntos en fila de conversación */}
      {openMenuConvId && typeof document !== 'undefined' && (() => {
        const targetConv = conversations.find((c) => c.id === openMenuConvId);
        if (!targetConv) return null;
        const rowMenuStyle: React.CSSProperties = {
          top: menuCoords.y,
          left: menuCoords.x,
        };
        return createPortal(
          <div
            className={styles.rowMenuPopover}
            role="menu"
            style={rowMenuStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className={styles.rowMenuItem}
              onClick={() => {
                setOpenMenuConvId(null);
                setConfirmDeleteConv(targetConv);
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
              <span>{t('assist.delete')}</span>
            </button>
          </div>,
          document.body,
        );
      })()}

      {/* Toast de confirmación de borrado */}
      {confirmDeleteConv && (
        <TaskConfirmToast
          title={t('assist.deleteTitle', { title: confirmDeleteConv.title })}
          description={t('assist.deleteHelp')}
          confirmLabel={t('assist.deleteYes')}
          cancelLabel={t('assist.deleteNo')}
          onConfirm={() => {
            const conv = confirmDeleteConv;
            setConfirmDeleteConv(null);
            void handleDeleteConfirm(conv.id);
          }}
          onCancel={() => {
            setConfirmDeleteConv(null);
          }}
        />
      )}

      {/* Columna derecha: conversación activa */}
      <main className={styles.chatArea}>
        <div
          className={`${styles.messagesContainer} ${
            displayedMessages.length === 0 ? styles.messagesContainerEmpty : ''
          }`}
        >
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
                  className={isUser ? styles.userBubble : `${styles.assistantBubble} ai-surface`}
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
                      {(() => {
                        const modelText = [msg.providerName, msg.modelId].filter(Boolean).join(' · ');
                        const usageLine = formatUsageLine(msg.createdAt, msg.usage ?? null, t, locale);
                        const usageDetail =
                          usageLine.parts.length > 0
                            ? usageLine.parts.join(' · ')
                            : t('assist.usage.none');
                        const line = [modelText, usageLine.when, usageDetail].filter(Boolean).join(' · ');
                        return (
                          <div className={styles.usageLine}>
                            <Text variant="secondary-xs">{line}</Text>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              );
            })
          )}

          {isThinking && (
            <div className={styles.thinkingRow}>
              <Text variant="secondary-xs">
                <span className={'ai-thinking-text'}>{t('assist.thinking')}</span>
              </Text>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleCancel}
              >
                {t('assist.cancel')}
              </button>
            </div>
          )}

          {/* Totales de la conversación si hay al menos una respuesta */}
          {displayedMessages.some((m) => m.role === 'assistant') && (() => {
            const assistantUsages = displayedMessages
              .filter((m) => m.role === 'assistant')
              .map((m) => m.usage ?? null);
            const total = sumUsage(assistantUsages);
            const numFmt = new Intl.NumberFormat(locale);
            const totalParts: string[] = [];
            if (total.promptTokens !== null) {
              totalParts.push(t('assist.usage.in', { n: numFmt.format(total.promptTokens) }));
            }
            if (total.completionTokens !== null) {
              totalParts.push(t('assist.usage.out', { n: numFmt.format(total.completionTokens) }));
            }
            if (total.reasoningTokens !== null) {
              totalParts.push(t('assist.usage.reasoning', { n: numFmt.format(total.reasoningTokens) }));
            }
            if (total.durationMs !== null) {
              totalParts.push(t('assist.usage.time', { s: (total.durationMs / 1000).toFixed(1) }));
            }
            const partsString = totalParts.length > 0 ? totalParts.join(' · ') : t('assist.usage.none');
            return (
              <div className={styles.conversationTotal}>
                <Text variant="secondary-xs">{t('assist.usage.total', { parts: partsString })}</Text>
              </div>
            );
          })()}
        </div>

        {/* Sugerencias arriba del cuadro cuando la conversación está vacía */}
        {displayedMessages.length === 0 && consultActions.length > 0 && (
          <div className={styles.suggestionsSection}>
            <span className={styles.suggestionsHeader}>{t('assist.suggestions')}</span>
            <div className={styles.suggestionsRow}>
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
            </div>
          </div>
        )}

        <AssistComposer
          value={question}
          onChange={setQuestion}
          onSend={handleSend}
          thinking={isThinking}
          onStop={handleCancel}
          sendDisabled={pending !== null}
          repoPath={repoPath}
          targetLabel={targetLabel}
          targetChanged={targetHighlight}
          onClearTarget={() => setIgnoredSelectionKey(currentTargetKey)}
          menuItems={menuItems}
        />
      </main>
    </div>
  );
}
