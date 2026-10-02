'use client';

import React, { useEffect, useState, useRef } from 'react';
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { summarizeReleaseNotes } from '@/lib/release-notes-summary';
import type { OpenSpecVersionAnalysisResult } from '@/types/pipeline';
import { filterDraftableModels, type LocalModel } from '@/types/commit-message-ai';
import { useRememberedAiModel, rememberAiModel, getRememberedAiModel, getRememberedAiSettings, formatAiDeviceLabel } from '@/lib/ai-model-memory';
import { MarkdownViewer } from './MarkdownViewer';
import { AiElapsed } from './AiElapsed';
import { AiModelControls } from './AiModelControls';
import { AiUseLine } from '../ai/AiUseLine';
import type { AiUseStatus } from '@/types/ai-use';
import styles from './OpenSpecDashboard.module.css';

export interface OpenSpecReleaseNotesProps {
  latest: string;
  analysis: OpenSpecVersionAnalysisResult | null;
  loading: boolean;
  error: string | null;
  repoPath?: string | null;
  redacting?: boolean;
  startedAt?: number | null;
  partialText?: string;
  onRedact?: (model: string) => Promise<void>;
  onCancelRedact?: () => Promise<void> | void;
}

export function OpenSpecReleaseNotes({
  latest,
  analysis,
  loading,
  error,
  repoPath,
  redacting = false,
  startedAt = null,
  partialText,
  onRedact,
  onCancelRedact,
}: OpenSpecReleaseNotesProps) {
  const t = useT();

  const aiModel = useRememberedAiModel(repoPath);
  const [aiModels, setAiModels] = useState<LocalModel[]>([]);
  const [aiDeviceNames, setAiDeviceNames] = useState<Record<string, string>>({});
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localStartedAt, setLocalStartedAt] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Qué modelo usa el análisis según gitcron.json (tarea 4.3). Con modelo, se
  // redacta con ése; sin modelo, el selector de LM Studio sirve para elegir qué
  // escribir en el archivo, y la línea lo ofrece con un botón.
  const [useStatus, setUseStatus] = useState<AiUseStatus | null>(null);
  const resolvedUse = useStatus?.status === 'resolved' ? useStatus : null;
  const reportBoxRef = useRef<HTMLDivElement>(null);

  const [prevRedacting, setPrevRedacting] = useState(redacting);
  if (prevRedacting !== redacting) {
    setPrevRedacting(redacting);
    if (redacting) {
      setIsExpanded(false);
    }
  }

  useEffect(() => {
    if (redacting && reportBoxRef.current) {
      reportBoxRef.current.scrollTop = reportBoxRef.current.scrollHeight;
    }
  }, [redacting, partialText]);

  useEffect(() => {
    if (!isExpanded && reportBoxRef.current && !redacting) {
      reportBoxRef.current.scrollTop = 0;
    }
  }, [isExpanded, redacting]);

  const effectiveStartedAt = startedAt ?? localStartedAt;

  useEffect(() => {
    let alive = true;
    if (typeof window !== 'undefined' && window.api?.commitAi?.catalog) {
      window.api.commitAi
        .catalog()
        .then((result) => {
          if (!alive) return;
          const disponibles = filterDraftableModels(result?.data ?? []);
          setAiModels(disponibles);
          const currentModel = getRememberedAiModel(repoPath);
          if (currentModel && !disponibles.some((m) => m.id === currentModel)) {
            rememberAiModel(repoPath, '');
          }
        })
        .catch(() => {
          if (alive) setAiModels([]);
        });
    }
    if (typeof window !== 'undefined' && window.api?.commitAi?.deviceNames) {
      window.api.commitAi
        .deviceNames()
        .then((result) => {
          if (alive && result?.data) setAiDeviceNames(result.data);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [repoPath]);

  const chosenModel = aiModels.find((m) => m.id === aiModel);
  const isLoaded = Boolean(chosenModel?.loaded);
  const isBusy = Boolean(redacting || loadingModel);

  const handleResolvedDraftClick = async () => {
    if (redacting) {
      await onCancelRedact?.();
      return;
    }
    if (!resolvedUse || isBusy) return;
    setLocalStartedAt(Date.now());
    try {
      await onRedact?.(resolvedUse.modelId);
    } finally {
      setLocalStartedAt(null);
    }
  };

  const handleDraftClick = async () => {
    if (redacting) {
      await onCancelRedact?.();
      return;
    }
    if (!aiModel || isBusy) return;
    setLoadError(null);
    setLocalStartedAt(Date.now());
    if (isLoaded) {
      try {
        await onRedact?.(aiModel);
      } finally {
        setLocalStartedAt(null);
      }
    } else {
      setLoadingModel(true);
      try {
        if (typeof window !== 'undefined' && window.api?.commitAi?.load) {
          const settings = getRememberedAiSettings(repoPath);
          const loadRes = await window.api.commitAi.load(
            aiModel,
            undefined,
            settings.contextLength,
            settings.ttlMinutes * 60,
          );
          if (loadRes && !loadRes.success) {
            setLoadError(loadRes.error || 'Error al cargar el modelo');
            return;
          }
          const catalog = await window.api?.commitAi?.catalog?.();
          if (catalog?.data) {
            setAiModels(filterDraftableModels(catalog.data));
          }
        }
        await onRedact?.(aiModel);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingModel(false);
        setLocalStartedAt(null);
      }
    }
  };

  const handleOpenUrl = (url: string) => {
    if (typeof window !== 'undefined' && window.api?.shellOpenExternal) {
      void window.api.shellOpenExternal(url);
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  };

  const titleText = t('pipeline.openspec.releaseNotes.title', { version: latest });

  let buttonLabel = t('pipeline.openspec.releaseNotes.draftReport');
  if (isBusy) {
    buttonLabel = loadingModel
      ? t('pipeline.openspec.releaseNotes.loadingAndRedactingWith', { model: aiModel })
      : t('pipeline.openspec.releaseNotes.redactingWith', { model: aiModel });
  } else if (!isLoaded && aiModel) {
    buttonLabel = t('pipeline.openspec.releaseNotes.loadAndDraft');
  }

  const buttonTitle = !aiModel ? t('pipeline.openspec.releaseNotes.chooseModelReason') : undefined;

  const reportText = (!redacting && analysis?.redaction?.status === 'generated') ? (analysis.redaction.text || '') : '';
  const reportLines = reportText.split('\n').length;
  const isReportLong = reportLines > 3 || reportText.length > 180;
  const showToggle = !redacting && analysis?.redaction?.status === 'generated' && Boolean(reportText.trim()) && isReportLong;

  return (
    <section className={styles.reviewSection} aria-label={titleText}>
      <h3 className={styles.reviewSectionTitle}>{titleText}</h3>

      {loading && <p>{t('pipeline.openspec.releaseNotes.loading')}</p>}

      {!loading && error && (
        <div role="alert" className={styles.blockedReasonInline}>
          {t('pipeline.openspec.releaseNotes.error', { error })}
        </div>
      )}

      {!loading && analysis && (
        <>
          {analysis.measured.changelog.fetched ? (
            (() => {
              const summaryData = summarizeReleaseNotes(analysis.measured.changelog.rawText);
              return (
                <>
                  {summaryData.summary && <p>{summaryData.summary}</p>}
                  {summaryData.bullets.length > 0 && (
                    <ul className={styles.releaseNotesList}>
                      {summaryData.bullets.map((bullet, idx) => (
                        <li key={`${idx}-${bullet.slice(0, 10)}`}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                  {analysis.measured.changelog.sourceUrl && (
                    <div className={styles.releaseNotesActions}>
                      <button
                        type="button"
                        className={styles.reviewCopyBtn}
                        onClick={() => handleOpenUrl(analysis.measured.changelog.sourceUrl!)}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                        {t('pipeline.openspec.releaseNotes.viewFull')}
                      </button>
                    </div>
                  )}
                  {analysis.measured.changelog.source && (
                    <div className={styles.axisMeta}>
                      {t('pipeline.openspec.releaseNotes.source', {
                        source: analysis.measured.changelog.source,
                      })}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <>
              <div className={styles.blockedReasonInline}>
                {t('pipeline.openspec.releaseNotes.unavailable', {
                  reason: analysis.measured.changelog.error ?? '',
                })}
              </div>
              {analysis.measured.changelog.sourceUrl && (
                <div className={styles.releaseNotesActions}>
                  <button
                    type="button"
                    className={styles.reviewCopyBtn}
                    onClick={() => handleOpenUrl(analysis.measured.changelog.sourceUrl!)}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    {t('pipeline.openspec.releaseNotes.viewFull')}
                  </button>
                </div>
              )}
            </>
          )}

          {analysis.measured.breakingChangesDetected ? (
            <div role="alert" className={styles.blockedReasonInline}>
              {t('pipeline.openspec.releaseNotes.mayAffect', {
                surfaces: analysis.measured.consumedSurfaces
                  .filter((s) => s.verdict === 'breaking' || s.verdict === 'potential-break')
                  .map((s) => s.surface)
                  .join(', '),
              })}
            </div>
          ) : (
            <p>{t('pipeline.openspec.releaseNotes.compatible')}</p>
          )}

          <AiUseLine
            use="gitcron-openspec-analysis"
            repoPath={repoPath}
            screenModel={aiModel || null}
            screenChoice
            onStatus={setUseStatus}
          />

          {resolvedUse ? (
            <div className={styles.releaseNotesActions}>
              <button
                type="button"
                className={styles.reviewCopyBtn}
                disabled={!redacting && (isBusy || !resolvedUse.available)}
                onClick={() => { void handleResolvedDraftClick(); }}
              >
                {redacting
                  ? t('pipeline.openspec.releaseNotes.cancelDraft')
                  : t('pipeline.openspec.releaseNotes.draftReport')}
              </button>
              {redacting && (
                <AiElapsed key={effectiveStartedAt ?? 'drafting'} phase="drafting" startedAt={effectiveStartedAt} />
              )}
            </div>
          ) : (
          <AiModelControls
            repoPath={repoPath}
            models={aiModels}
            deviceNames={aiDeviceNames}
            onModelsChange={setAiModels}
            busy={isBusy}
            phase={redacting ? 'drafting' : loadingModel ? 'loading' : 'idle'}
            startedAt={effectiveStartedAt}
            opKind="draft"
            showLoadButton={false}
            actions={
              <button
                type="button"
                className={styles.reviewCopyBtn}
                disabled={redacting ? false : (!aiModel || isBusy)}
                title={redacting ? undefined : buttonTitle}
                onClick={handleDraftClick}
              >
                {redacting ? t('pipeline.openspec.releaseNotes.cancelDraft') : buttonLabel}
              </button>
            }
            elapsedNode={
              redacting ? (
                <AiElapsed key={effectiveStartedAt ?? 'drafting'} phase="drafting" startedAt={effectiveStartedAt} />
              ) : undefined
            }
          />
          )}

          {loadError && (
            <div role="alert" className={styles.blockedReasonInline}>
              {loadError}
            </div>
          )}

          {redacting && partialText?.trim() ? (
            <div className={styles.releaseNotesReport}>
              <div
                ref={reportBoxRef}
                className={styles.releaseNotesReportBox}
                data-state="streaming"
              >
                <MarkdownViewer content={partialText} />
              </div>
            </div>
          ) : null}

          {!redacting && analysis.redaction.status === 'generated' && analysis.redaction.text?.trim() ? (
            <div className={styles.releaseNotesReport}>
              <div
                ref={reportBoxRef}
                className={styles.releaseNotesReportBox}
                data-state={isExpanded ? 'expanded' : 'collapsed'}
              >
                <MarkdownViewer content={analysis.redaction.text} />
              </div>
              {showToggle && (
                <button
                  type="button"
                  className={styles.releaseNotesToggleBtn}
                  aria-expanded={isExpanded}
                  onClick={() => setIsExpanded((prev) => !prev)}
                >
                  <span>
                    {isExpanded
                      ? t('pipeline.openspec.releaseNotes.showLess')
                      : t('pipeline.openspec.releaseNotes.showMore')}
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={13} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={13} aria-hidden="true" />
                  )}
                </button>
              )}
              <div className={styles.axisMeta}>
                {t('pipeline.openspec.releaseNotes.redactedBy', {
                  provider: analysis.redaction.provider,
                })}
              </div>
            </div>
          ) : null}

          {!redacting && analysis.redaction.status === 'error' && analysis.redaction.error ? (
            <div className={styles.axisMeta} role="alert">
              {analysis.redaction.error}
            </div>
          ) : null}

          {!redacting && analysis.redaction.status === 'offline' ? (
            <div className={styles.axisMeta}>
              {t('pipeline.openspec.releaseNotes.reportUnavailable')}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default OpenSpecReleaseNotes;
