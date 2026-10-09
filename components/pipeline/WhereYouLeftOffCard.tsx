'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Milestone } from 'lucide-react';
import type { ChangeLastCommit, TaskEvidence } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { useT } from '@/hooks/use-translation';
import type { OpenSpecChangeSummary, OpenSpecWorkspaceSnapshot } from './pipeline-view-state';
import { deriveResumeCard } from './resume-card';
import styles from './OpenSpecDashboard.module.css';

export interface WhereYouLeftOffCardProps {
  repoPath?: string | null;
  selectedChange?: OpenSpecChangeSummary | null;
  selectedArchive?: OpenSpecWorkspaceSnapshot['archivedChanges'][number] | null;
  nextTask?: TaskEvidence | null;
  defaultExpandedDetail?: boolean;
}

export function WhereYouLeftOffCard({
  repoPath,
  selectedChange,
  selectedArchive,
  defaultExpandedDetail = false,
}: WhereYouLeftOffCardProps) {
  const t = useT();
  const lang = useGitStore((state) => state.language) ?? 'es';
  const [detailOpen, setDetailOpen] = useState(defaultExpandedDetail);

  const directCommit = selectedChange?.lastCommit ?? selectedArchive?.lastCommit ?? null;
  const changeId = selectedChange?.changeId ?? selectedArchive?.changeId ?? null;
  // El commit leído es de un repo y un cambio: se guarda con su clave y sólo se
  // usa mientras siga siendo el mismo, y una respuesta que llega tarde no pisa
  // la del cambio nuevo.
  const commitKey = `${repoPath ?? ''}\u0000${changeId ?? ''}`;
  const [asyncCommit, setAsyncCommit] = useState<{ key: string; commit: ChangeLastCommit } | null>(null);

  useEffect(() => {
    if (directCommit || !changeId || !repoPath) return;

    let vigente = true;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (api?.pipelineGetChangeLastCommit) {
      api.pipelineGetChangeLastCommit(repoPath, changeId)
        .then((res) => {
          if (vigente && res?.success && res.data) {
            setAsyncCommit({ key: commitKey, commit: res.data });
          }
        })
        .catch(() => {
          // Sin respuesta queda «Todavía sin commits».
        });
    }
    return () => {
      vigente = false;
    };
  }, [repoPath, changeId, directCommit, commitKey]);

  const lastCommit = directCommit ?? (asyncCommit?.key === commitKey ? asyncCommit.commit : null);

  const cardData = useMemo(() => {
    if (!changeId) return null;

    const isArchived = Boolean(selectedArchive);
    const proposal = selectedChange?.artifacts?.proposal ?? selectedArchive?.artifacts?.proposal ?? null;
    const intent = selectedChange?.intent ?? null;
    const tasks = selectedChange?.tasks ?? [];
    const tasksRaw = selectedChange?.artifacts?.tasks ?? selectedArchive?.artifacts?.tasks ?? null;

    return deriveResumeCard({
      changeId,
      isArchived,
      archivedAt: selectedArchive?.archivedAt,
      archivedOn: selectedArchive?.archivedOn,
      proposal,
      intent,
      tasks,
      tasksRaw,
      lastCommit,
      locale: lang,
      t,
    });
  }, [changeId, selectedChange, selectedArchive, lastCommit, lang, t]);

  if (!cardData) return null;

  const { rows, archivedNotice } = cardData;

  return (
    <section
      className={styles.whereYouLeftOffContainer}
      aria-label={t('pipeline.resumeCard.title')}
      data-testid="where-you-left-off-card"
    >
      <div className={styles.whereYouLeftOffHeader}>
        <div className={styles.whereYouLeftOffTitleGroup}>
          <Milestone size={14} className={styles.whereYouLeftOffTitleIcon} aria-hidden="true" />
          <h4 className={styles.whereYouLeftOffTitle}>{t('pipeline.resumeCard.title')}</h4>
        </div>
        {archivedNotice && (
          <span className={styles.whereYouLeftOffArchivedBadge}>
            {archivedNotice}
          </span>
        )}
      </div>

      <dl className={styles.whereYouLeftOffRowsList}>
        {/* Renglón 1: Objetivo */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t(rows.objective.labelKey)}</dt>
        <dd
          className={`${styles.whereYouLeftOffRowValue} ${rows.objective.isFallback ? styles.whereYouLeftOffFallbackValue : ''}`}
          data-testid="resume-objective"
        >
          {rows.objective.text}
        </dd>

        {/* Renglón 2: Avance */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t(rows.progress.labelKey)}</dt>
        <dd
          className={`${styles.whereYouLeftOffRowValue} ${rows.progress.isFallback ? styles.whereYouLeftOffFallbackValue : ''}`}
          data-testid="resume-progress"
        >
          {rows.progress.text}
        </dd>

        {/* Renglón 3: Última actividad */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t(rows.lastActivity.labelKey)}</dt>
        <dd
          className={`${styles.whereYouLeftOffRowValue} ${rows.lastActivity.isFallback ? styles.whereYouLeftOffFallbackValue : ''}`}
          data-testid="resume-last-activity"
        >
          {rows.lastActivity.text}
        </dd>

        {/* Renglón 4: Siguiente paso */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t(rows.nextStep.labelKey)}</dt>
        <dd className={styles.whereYouLeftOffRowValue} data-testid="resume-next-step">
          <div className={styles.whereYouLeftOffNextStepContent}>
            <div className={styles.whereYouLeftOffNextStepHeader}>
              <span className={rows.nextStep.isFallback ? styles.whereYouLeftOffFallbackValue : styles.whereYouLeftOffNextStepTitle}>
                {rows.nextStep.text}
              </span>
              {rows.nextStep.detail && (
                <button
                  type="button"
                  className={styles.whereYouLeftOffDetailToggleBtn}
                  onClick={() => setDetailOpen((prev) => !prev)}
                  aria-expanded={detailOpen}
                  aria-label={`${t('pipeline.resumeCard.detailToggle')}: ${rows.nextStep.text}`}
                >
                  {detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{t('pipeline.resumeCard.detailToggle')}</span>
                </button>
              )}
            </div>

            {detailOpen && rows.nextStep.detail && (
              <div className={styles.whereYouLeftOffNextStepDetail} data-testid="next-step-detail">
                {rows.nextStep.detail.responsible && (
                  <p className={styles.whereYouLeftOffDetailItem}>
                    <strong>{t('pipeline.resumeCard.responsibleLabel')} </strong>
                    <span>{rows.nextStep.detail.responsible}</span>
                  </p>
                )}
                {rows.nextStep.detail.check && (
                  <p className={styles.whereYouLeftOffDetailItem}>
                    <strong>{t('pipeline.resumeCard.checkLabel')} </strong>
                    <span>{rows.nextStep.detail.check}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </dd>
      </dl>
    </section>
  );
}
