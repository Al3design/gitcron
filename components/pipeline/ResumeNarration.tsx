'use client';

// components/pipeline/ResumeNarration.tsx
//
// Explicación opcional del resumen determinista con IA (retomar 3.3).
// Solo el clic de la persona pide la explicación al modelo compartido de gitcron-assist.
// No se consulta en montaje, navegación ni relectura.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RotateCcw, Sparkles } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { cn } from '@/lib/utils';
import type {
  ResumeNarrationArgs,
  ResumeNarrationData,
  ResumeNarrationResult,
  ResumeNarrationSourceId,
} from '@/types/resume-narration';
import styles from './ResumeNarration.module.css';

export interface ResumeNarrationProps {
  args: ResumeNarrationArgs;
  sourceKey: string;
  disabled: boolean;
}

async function fetchResumeNarration(args: ResumeNarrationArgs): Promise<ResumeNarrationResult> {
  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (!api?.assistConversations?.narrateResume) {
    throw new Error('API assistConversations.narrateResume no disponible.');
  }
  const res = await api.assistConversations.narrateResume(args);
  if (!res.success) {
    throw new Error(res.error ?? 'Error desconocido');
  }
  if (!res.data) {
    throw new Error('Sin respuesta del servicio');
  }
  return res.data;
}

function shouldDiscardResponse(
  mounted: boolean,
  activeToken: number | null,
  token: number,
  prevKey: string,
  currentKey: string,
): boolean {
  if (!mounted) return true;
  if (activeToken !== token) return true;
  return prevKey !== currentKey;
}

export function ResumeNarration({
  args,
  sourceKey,
  disabled,
}: ResumeNarrationProps) {
  // Una fuente nueva o pendiente no puede conservar el texto ni el pedido anterior.
  return <ResumeNarrationState key={`${sourceKey}\0${disabled}`} args={args} sourceKey={sourceKey} disabled={disabled} />;
}

function ResumeNarrationState({
  args,
  sourceKey,
  disabled,
}: ResumeNarrationProps) {
  const t = useT();
  const lang = useGitStore((s) => s.language) ?? 'es';

  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [narrationData, setNarrationData] = useState<ResumeNarrationData | null>(null);

  const requestCounterRef = useRef(0);
  const activeRequestTokenRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleRequestNarration = useCallback(async () => {
    if (disabled || loading) return;

    requestCounterRef.current += 1;
    const requestToken = requestCounterRef.current;
    activeRequestTokenRef.current = requestToken;
    const requestKey = sourceKey;

    setLoading(true);
    setNarrationData(null);

    try {
      const result = await fetchResumeNarration(args);
      if (shouldDiscardResponse(mountedRef.current, activeRequestTokenRef.current, requestToken, sourceKey, requestKey)) {
        return;
      }

      if (result.status === 'narrated') {
        setNarrationData(result.data);
        setHidden(false);
      } else {
        useGitStore.getState().setError(result.message);
      }
    } catch (error) {
      if (shouldDiscardResponse(mountedRef.current, activeRequestTokenRef.current, requestToken, sourceKey, requestKey)) {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      useGitStore.getState().setError(t('pipeline.resumeNarration.failed', { message: msg }));
    } finally {
      if (mountedRef.current && activeRequestTokenRef.current === requestToken) {
        setLoading(false);
      }
    }
  }, [args, disabled, loading, sourceKey, t]);

  const handleToggleHide = useCallback(() => {
    setHidden((prev) => !prev);
  }, []);

  const resolveSourceLabel = (
    id: ResumeNarrationSourceId,
    sources: { id: ResumeNarrationSourceId; ref: string }[],
  ): string => {
    const found = sources.find((s) => s.id === id);
    if (found) return found.ref;
    if (id === 'proposal') return t('pipeline.resumeNarration.sourceProposal');
    if (id === 'tasks') return t('pipeline.resumeNarration.sourceTasks');
    return t('pipeline.resumeNarration.sourceHead');
  };

  const formatCreationDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(lang, {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className={styles.container} data-testid="resume-narration">
      {/* 1. Estado inicial o sin explicación cargada */}
      {!narrationData && !loading && (
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.explainButton}
            onClick={handleRequestNarration}
            disabled={disabled}
            data-testid="request-resume-narration"
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>{t('pipeline.resumeNarration.action')}</span>
          </button>
        </div>
      )}

      {/* 2. Estado de carga */}
      {loading && (
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.explainButton}
            disabled
            data-testid="resume-narration-loading"
          >
            <span className={cn('ai-thinking-text', styles.thinkingText)}>
              {t('pipeline.resumeNarration.loading')}
            </span>
          </button>
        </div>
      )}

      {/* 3. Explicación plegada (oculta) pero disponible sin reenvío */}
      {narrationData && !loading && hidden && (
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.explainButton}
            onClick={handleToggleHide}
            data-testid="show-resume-narration"
          >
            <Eye size={14} aria-hidden="true" />
            <span>{t('pipeline.resumeNarration.show')}</span>
          </button>
          <button
            type="button"
            className={styles.subtleButton}
            onClick={handleRequestNarration}
            disabled={disabled}
            data-testid="reexplain-resume-narration"
          >
            <RotateCcw size={12} aria-hidden="true" />
            <span>{t('pipeline.resumeNarration.reexplain')}</span>
          </button>
        </div>
      )}

      {/* 4. Explicación visible */}
      {narrationData && !loading && !hidden && (
        <div
          className={cn('ai-surface', styles.narrationBox)}
          data-testid="resume-narration-content"
        >
          <div className={styles.boxHeader}>
            <div className={cn('ai-gradient-text', styles.badge)}>
              <Sparkles size={13} aria-hidden="true" />
              <span>{t('pipeline.resumeNarration.badge')}</span>
            </div>
            <div className={styles.headerControls}>
              <button
                type="button"
                className={styles.subtleButton}
                onClick={handleToggleHide}
                data-testid="hide-resume-narration"
                title={t('pipeline.resumeNarration.hide')}
              >
                <EyeOff size={12} aria-hidden="true" />
                <span>{t('pipeline.resumeNarration.hide')}</span>
              </button>
              <button
                type="button"
                className={styles.subtleButton}
                onClick={handleRequestNarration}
                disabled={disabled}
                data-testid="reexplain-resume-narration"
                title={t('pipeline.resumeNarration.reexplain')}
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span>{t('pipeline.resumeNarration.reexplain')}</span>
              </button>
            </div>
          </div>

          <div className={styles.paragraphList}>
            {narrationData.paragraphs.map((p, idx) => (
              <div
                key={idx}
                className={styles.paragraphItem}
                data-testid={`narration-paragraph-${idx}`}
              >
                <p className={styles.paragraphText}>{p.text}</p>
                {p.sourceIds.length > 0 && (
                  <div className={styles.paragraphSources}>
                    <span>{t('pipeline.resumeNarration.sources')}</span>
                    {p.sourceIds.map((sid) => (
                      <span
                        key={sid}
                        className={styles.sourcePill}
                        data-testid={`source-${sid}`}
                      >
                        {resolveSourceLabel(sid, narrationData.sources)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className={styles.boxFooter}>
            <div className={styles.metaInfo} data-testid="narration-meta">
              <span>{formatCreationDate(narrationData.createdAt)}</span>
              <span>·</span>
              <span data-testid="narration-model">
                {narrationData.providerName} · {narrationData.modelId}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
