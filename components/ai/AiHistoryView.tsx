'use client';

// components/ai/AiHistoryView.tsx
//
// Vista «Historial de IA» por repositorio (tarea 4.6, D19).
// Muestra qué escribió cada IA, motor, modelo, máquina, cuándo, duración, tokens,
// el resultado, commit vinculado y permite abrir el registro completo con su
// pedido efectivo (D14) y lo enviado completo (plegado por omisión).

import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronRight,
  Filter,
  GitCommit,
  Clock,
  Cpu,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Ban,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { AiSentDetails } from './AiSentDetails';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import type {
  AiUseHistoryDetail,
  AiUseHistoryItem,
  AiUseResultStatus,
} from '@/types/electron';

export interface AiHistoryViewProps {
  repoPath: string | null;
}

const PAGE_SIZE = 20;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins} m ${secs} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

export function AiHistoryView({ repoPath }: AiHistoryViewProps) {
  const t = useT();
  const [items, setItems] = useState<AiUseHistoryItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [selectedUse, setSelectedUse] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordDetails, setRecordDetails] = useState<Record<string, AiUseHistoryDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [showPromptSent, setShowPromptSent] = useState<Record<string, boolean>>({});

  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  const fetchHistory = useCallback(
    async (offset: number, append = false) => {
      if (!repoPath || !window.api?.aiUseHistory?.list) {
        setItems([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      if (!append) {
        setLoading(true);
        setExpandedId(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await window.api.aiUseHistory.list({
          repoPath,
          use: selectedUse || undefined,
          resultStatus: selectedStatus || undefined,
          limit: PAGE_SIZE,
          offset,
        });

        if (res.success && res.data) {
          if (append) {
            setItems((prev) => [...prev, ...res.data!.items]);
          } else {
            setItems(res.data.items);
          }
          setTotal(res.data.total);
        }
      } catch {
        if (!append) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [repoPath, selectedUse, selectedStatus],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchHistory(0, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  const handleToggleExpand = async (item: AiUseHistoryItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(item.id);
    if (!recordDetails[item.id] && repoPath && window.api?.aiUseHistory?.get) {
      setDetailLoading((prev) => ({ ...prev, [item.id]: true }));
      try {
        const res = await window.api.aiUseHistory.get({ repoPath, id: item.id });
        if (res.success && res.data) {
          setRecordDetails((prev) => ({ ...prev, [item.id]: res.data! }));
        }
      } finally {
        setDetailLoading((prev) => ({ ...prev, [item.id]: false }));
      }
    }
  };

  const handleClearHistory = async () => {
    if (!repoPath || !window.api?.aiUseHistory?.clear) return;
    setClearing(true);
    try {
      const res = await window.api.aiUseHistory.clear({ repoPath });
      if (res.success) {
        setShowClearConfirm(false);
        setItems([]);
        setTotal(0);
        setExpandedId(null);
        setRecordDetails({});
      }
    } finally {
      setClearing(false);
    }
  };

  const formatTokens = (item: AiUseHistoryItem): string => {
    if (item.promptTokens === null && item.completionTokens === null) {
      return t('aiHistory.noTokens');
    }
    const parts: string[] = [];
    if (item.promptTokens !== null) {
      const cached = item.cachedPromptTokens ? ` (${item.cachedPromptTokens.toLocaleString()} en caché)` : '';
      parts.push(`${item.promptTokens.toLocaleString()}${cached} entrada`);
    }
    if (item.completionTokens !== null) {
      const reasoning = item.reasoningTokens ? ` (${item.reasoningTokens.toLocaleString()} pensar)` : '';
      parts.push(`${item.completionTokens.toLocaleString()}${reasoning} salida`);
    }
    return parts.join(' · ');
  };

  const renderStatusBadge = (status: AiUseResultStatus) => {
    switch (status) {
      case 'generated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-success/15 text-success">
            <CheckCircle2 size={12} />
            {t('aiHistory.status.generated')}
          </span>
        );
      case 'malformed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning">
            <AlertTriangle size={12} />
            {t('aiHistory.status.malformed')}
          </span>
        );
      case 'no-answer':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-text-muted/15 text-text-muted">
            <Ban size={12} />
            {t('aiHistory.status.no-answer')}
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-text-muted/15 text-text-muted">
            <Ban size={12} />
            {t('aiHistory.status.cancelled')}
          </span>
        );
      case 'failed':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-error/15 text-error">
            <XCircle size={12} />
            {t('aiHistory.status.failed')}
          </span>
        );
    }
  };

  const translateUse = (use: string): string => {
    const key = `aiHistory.use.${use}`;
    const translated = t(key);
    return translated === key ? use : translated;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-primary overflow-hidden" data-testid="ai-history-view">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent-purple/15 text-[var(--color-ai)]">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-text-primary flex items-center gap-2">
              {t('aiHistory.title')}
              <span className="text-xs font-normal text-text-muted">({total})</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter Use */}
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-text-muted" />
            <select
              aria-label={t('aiHistory.filterUseAll')}
              value={selectedUse}
              onChange={(e) => setSelectedUse(e.target.value)}
              className="text-xs bg-bg-secondary border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:border-[var(--color-ai)]"
              data-testid="ai-history-filter-use"
            >
              <option value="">{t('aiHistory.filterUseAll')}</option>
              <option value="gitcron-commit">{t('aiHistory.use.gitcron-commit')}</option>
              <option value="gitcron-cartography">{t('aiHistory.use.gitcron-cartography')}</option>
              <option value="gitcron-openspec-analysis">{t('aiHistory.use.gitcron-openspec-analysis')}</option>
              <option value="gitcron-temporal">{t('aiHistory.use.gitcron-temporal')}</option>
            </select>
          </div>

          {/* Filter Status */}
          <div className="flex items-center gap-1.5">
            <select
              aria-label={t('aiHistory.filterStatusAll')}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs bg-bg-secondary border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:border-[var(--color-ai)]"
              data-testid="ai-history-filter-status"
            >
              <option value="">{t('aiHistory.filterStatusAll')}</option>
              <option value="generated">{t('aiHistory.status.generated')}</option>
              <option value="malformed">{t('aiHistory.status.malformed')}</option>
              <option value="no-answer">{t('aiHistory.status.no-answer')}</option>
              <option value="failed">{t('aiHistory.status.failed')}</option>
              <option value="cancelled">{t('aiHistory.status.cancelled')}</option>
            </select>
          </div>

          {/* Clear button */}
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            disabled={items.length === 0 || clearing}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border bg-bg-secondary text-text-secondary hover:text-error hover:border-error/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            data-testid="ai-history-clear-btn"
          >
            <Trash2 size={13} />
            {t('aiHistory.clear')}
          </button>
        </div>
      </div>

      {/* Main Content List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3" data-testid="ai-history-list">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-muted gap-2 text-sm">
            <Loader2 size={18} className="animate-spin text-[var(--color-ai)]" />
            {t('aiHistory.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted text-sm gap-2">
            <Sparkles size={28} className="text-text-muted/40 mb-1" />
            <p>{t('aiHistory.empty')}</p>
          </div>
        ) : (
          items.map((item) => {
            const isExpanded = expandedId === item.id;
            const detail = recordDetails[item.id];
            const isDetailLoading = detailLoading[item.id];
            const isPromptOpen = showPromptSent[item.id] ?? false;

            return (
              <div
                key={item.id}
                className="rounded-lg border border-border bg-bg-secondary/30 hover:border-border/80 transition-colors overflow-hidden"
                data-testid="ai-history-item"
              >
                {/* Item header row */}
                <button
                  type="button"
                  onClick={() => handleToggleExpand(item)}
                  className="w-full text-left p-4 flex flex-col gap-2 hover:bg-bg-secondary/50 transition-colors cursor-pointer"
                  aria-expanded={isExpanded}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-text-muted">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <span className="font-semibold text-text-primary text-sm truncate">
                        {translateUse(item.use)}
                      </span>
                      <span className="text-xs text-text-muted truncate">
                        ({item.providerName || item.providerId} · {item.modelId}
                        {item.reasoningEffort ? ` · ${item.reasoningEffort}` : ''}
                        {item.variant ? ` #${item.variant}` : ''})
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {renderStatusBadge(item.resultStatus)}
                      <span className="text-xs text-text-muted">{formatDate(item.startedAt)}</span>
                    </div>
                  </div>

                  {/* Metadata line */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary pl-6">
                    <span className="flex items-center gap-1 text-text-muted">
                      <Clock size={12} />
                      {formatDuration(item.durationMs)}
                    </span>
                    <span className="flex items-center gap-1 text-text-muted">
                      <Cpu size={12} />
                      {item.deviceLabel ?? item.deviceId.slice(0, 8)}
                    </span>
                    <span className="text-text-muted">{formatTokens(item)}</span>
                    {item.branch && (
                      <span className="text-text-muted">
                        rama: <code className="font-mono text-text-secondary">{item.branch}</code>
                      </span>
                    )}
                    {item.commitHash && (
                      <span className="inline-flex items-center gap-1 font-mono text-[var(--color-ai)]">
                        <GitCommit size={12} />
                        {item.commitHash.slice(0, 7)}
                        {item.commitEdited && (
                          <span className="text-text-muted font-sans">({t('aiHistory.commitEdited')})</span>
                        )}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-border/60 bg-bg-secondary/20 p-4 pl-10 space-y-4 text-xs">
                    {isDetailLoading ? (
                      <div className="flex items-center gap-2 text-text-muted py-2">
                        <Loader2 size={14} className="animate-spin text-[var(--color-ai)]" />
                        {t('aiHistory.loading')}
                      </div>
                    ) : (
                      <>
                        {/* Output text */}
                        {item.resultText && (
                          <div>
                            <div className="text-text-muted text-xs font-medium mb-1.5">
                              {item.resultStatus === 'failed' || item.resultStatus === 'cancelled'
                                ? t('aiHistory.errorDetail')
                                : t('aiHistory.resultText')}
                            </div>
                            <div
                              className={`p-3 rounded-lg border border-border/40 select-text whitespace-pre-wrap font-mono text-xs max-h-72 overflow-y-auto ${
                                item.resultStatus === 'failed' || item.resultStatus === 'cancelled'
                                  ? 'bg-error/5 text-text-secondary'
                                  : 'bg-bg-secondary/40 text-[var(--color-ai)]'
                              }`}
                            >
                              {item.resultText}
                            </div>
                          </div>
                        )}

                        {/* Effective Request */}
                        {detail?.effectiveRequest && (
                          <div>
                            <AiSentDetails request={detail.effectiveRequest} />
                          </div>
                        )}

                        {/* Lo enviado (completo) */}
                        {detail?.promptSent && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setShowPromptSent((prev) => ({
                                  ...prev,
                                  [item.id]: !isPromptOpen,
                                }))
                              }
                              className="text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 font-medium"
                            >
                              {isPromptOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              {isPromptOpen
                                ? t('aiHistory.hidePromptSent')
                                : t('aiHistory.showPromptSent', { bytes: formatBytes(detail.promptSentBytes) })}
                            </button>

                            {isPromptOpen && (
                              <div className="mt-2">
                                <pre className="font-mono text-xs whitespace-pre-wrap select-text p-3 rounded-lg bg-bg-secondary/60 border border-border/40 max-h-96 overflow-y-auto text-text-primary">
                                  {detail.promptSent}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Load more button */}
        {!loading && items.length < total && (
          <div className="flex justify-center pt-2 pb-4">
            <button
              type="button"
              onClick={() => void fetchHistory(items.length, true)}
              disabled={loadingMore}
              className="px-4 py-1.5 text-xs rounded border border-border bg-bg-secondary text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 flex items-center gap-1.5"
              data-testid="ai-history-load-more"
            >
              {loadingMore && <Loader2 size={12} className="animate-spin text-[var(--color-ai)]" />}
              {t('aiHistory.loadMore')}
            </button>
          </div>
        )}
      </div>

      {/* Clear Confirmation Dialog */}
      <DangerConfirmDialog
        open={showClearConfirm}
        title={t('aiHistory.clearConfirmTitle')}
        message={t('aiHistory.clearConfirmMessage')}
        confirmLabel={t('aiHistory.clearConfirmButton')}
        cancelLabel={t('aiHistory.cancel')}
        disabled={clearing}
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={handleClearHistory}
      />
    </div>
  );
}
