'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  FileCode2,
  GitCommit,
  Milestone,
} from 'lucide-react';
import type { ChangeLastCommit, TaskEvidence } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type { OpenSpecChangeSummary, OpenSpecWorkspaceSnapshot } from './pipeline-view-state';
import { deriveResumeCard } from './resume-card';
import styles from './OpenSpecDashboard.module.css';

export interface WhereYouLeftOffCardProps {
  repoPath?: string | null;
  selectedChange?: OpenSpecChangeSummary | null;
  selectedArchive?: OpenSpecWorkspaceSnapshot['archivedChanges'][number] | null;
  nextTask?: TaskEvidence | null;
  latestSession?: {
    runtime?: string;
    role?: string;
    outcome?: string;
    active?: boolean;
    startedAt?: string;
  } | null;
  uncommittedFiles?: string[] | null;
  recentCommits?: ChangeLastCommit[] | null;
  commitsAfterLastTask?: ChangeLastCommit[] | null;
  defaultExpandedDetail?: boolean;
}

export function WhereYouLeftOffCard({
  repoPath,
  selectedChange,
  selectedArchive,
  latestSession,
  uncommittedFiles: uncommittedFilesProp,
  recentCommits: recentCommitsProp,
  commitsAfterLastTask: commitsAfterLastTaskProp,
  defaultExpandedDetail = false,
}: WhereYouLeftOffCardProps) {
  const t = useT();
  const lang = useGitStore((state) => state.language) ?? 'es';
  const gitFiles = useGitStore((state) => state.modifiedFiles);
  const [detailOpen, setDetailOpen] = useState(defaultExpandedDetail);

  const directCommit = selectedChange?.lastCommit ?? selectedArchive?.lastCommit ?? null;
  const changeId = selectedChange?.changeId ?? selectedArchive?.changeId ?? null;
  const commitKey = `${repoPath ?? ''}\u0000${changeId ?? ''}`;

  const [asyncCommits, setAsyncCommits] = useState<{
    key: string;
    recentCommits: ChangeLastCommit[];
    commitsAfterLastTask: ChangeLastCommit[];
  } | null>(null);

  useEffect(() => {
    if (!changeId || !repoPath) return;

    let vigente = true;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (api?.pipelineGetChangeCommits) {
      api.pipelineGetChangeCommits(repoPath, changeId)
        .then((res) => {
          if (vigente && res?.success && res.data) {
            setAsyncCommits({
              key: commitKey,
              recentCommits: res.data.recentCommits ?? [],
              commitsAfterLastTask: res.data.commitsAfterLastTask ?? [],
            });
          }
        })
        .catch(() => {});
    } else if (api?.pipelineGetChangeLastCommit && !directCommit) {
      api.pipelineGetChangeLastCommit(repoPath, changeId)
        .then((res) => {
          if (vigente && res?.success && res.data) {
            setAsyncCommits({
              key: commitKey,
              recentCommits: [res.data],
              commitsAfterLastTask: [],
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      vigente = false;
    };
  }, [repoPath, changeId, directCommit, commitKey]);

  const commitsData = asyncCommits?.key === commitKey ? asyncCommits : null;
  const effectiveRecentCommits = recentCommitsProp
    ?? commitsData?.recentCommits
    ?? (directCommit ? [directCommit] : []);
  const effectiveCommitsAfterLastTask = commitsAfterLastTaskProp
    ?? commitsData?.commitsAfterLastTask
    ?? [];
  const effectiveUncommittedFiles = uncommittedFilesProp
    ?? (Array.isArray(gitFiles) ? gitFiles.map((f) => f.path) : []);

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
      lastCommit: directCommit,
      recentCommits: effectiveRecentCommits,
      commitsAfterLastTask: effectiveCommitsAfterLastTask,
      uncommittedFiles: effectiveUncommittedFiles,
      latestSession,
      locale: lang,
      t,
    });
  }, [
    changeId,
    selectedChange,
    selectedArchive,
    directCommit,
    effectiveRecentCommits,
    effectiveCommitsAfterLastTask,
    effectiveUncommittedFiles,
    latestSession,
    lang,
    t,
  ]);

  if (!cardData) return null;

  const { objective, whatYouWereDoing, currentWork, remainingWork, archivedNotice, rows } = cardData;

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
        {/* Renglón: Objetivo */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t(rows.objective.labelKey)}</dt>
        <dd
          className={`${styles.whereYouLeftOffRowValue} ${objective.isFallback ? styles.whereYouLeftOffFallbackValue : ''}`}
          data-testid="resume-objective"
        >
          {objective.text}
        </dd>

        {/* Bloque 1: Lo que venías haciendo */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t('pipeline.resumeCard.row.whatYouWereDoing')}</dt>
        <dd className={styles.whereYouLeftOffRowValue} data-testid="resume-what-you-were-doing">
          {whatYouWereDoing.emptyText ? (
            <span className={styles.whereYouLeftOffFallbackValue}>
              {whatYouWereDoing.emptyText}
            </span>
          ) : (
            <div>
              {whatYouWereDoing.completedTasks.length > 0 && (
                <div className={styles.whereYouLeftOffDoneTasksList}>
                  {whatYouWereDoing.completedTasks.map((task) => (
                    <div key={task.id} className={styles.whereYouLeftOffDoneTaskItem}>
                      <Check size={12} className={styles.whereYouLeftOffDoneIcon} aria-hidden="true" />
                      <span>{task.text}</span>
                    </div>
                  ))}
                </div>
              )}
              {whatYouWereDoing.commits.length > 0 && (
                <div className={styles.whereYouLeftOffCommitsList}>
                  {whatYouWereDoing.commits.map((commit) => (
                    <div key={commit.hash} className={styles.whereYouLeftOffCommitItem}>
                      <GitCommit size={12} className={styles.whereYouLeftOffCommitIcon} aria-hidden="true" />
                      <span>{commit.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </dd>

        {/* Bloque 2: En qué estabas */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t('pipeline.resumeCard.row.currentWork')}</dt>
        <dd className={styles.whereYouLeftOffRowValue} data-testid="resume-current-work">
          <div className={styles.whereYouLeftOffNextStepContent}>
            <div className={styles.whereYouLeftOffNextStepHeader}>
              <span
                className={currentWork.currentTask ? styles.whereYouLeftOffNextStepTitle : styles.whereYouLeftOffFallbackValue}
                data-testid="resume-current-task-title"
              >
                {currentWork.statusText}
              </span>
              {currentWork.detail && (
                <button
                  type="button"
                  className={styles.whereYouLeftOffDetailToggleBtn}
                  onClick={() => setDetailOpen((prev) => !prev)}
                  aria-expanded={detailOpen}
                  aria-label={`${t('pipeline.resumeCard.howToCheckToggle')}: ${currentWork.statusText}`}
                >
                  {detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{t('pipeline.resumeCard.howToCheckToggle')}</span>
                </button>
              )}
            </div>

            {detailOpen && currentWork.detail && (
              <div className={styles.whereYouLeftOffNextStepDetail} data-testid="next-step-detail">
                {currentWork.detail.responsible && (
                  <p className={styles.whereYouLeftOffDetailItem}>
                    <strong>{t('pipeline.resumeCard.responsibleLabel')} </strong>
                    <span>{currentWork.detail.responsible}</span>
                  </p>
                )}
                {currentWork.detail.check && (
                  <p className={styles.whereYouLeftOffDetailItem}>
                    <strong>{t('pipeline.resumeCard.checkLabel')} </strong>
                    <span>{currentWork.detail.check}</span>
                  </p>
                )}
              </div>
            )}

            {currentWork.evidence.hasEvidence ? (
              <div className={styles.whereYouLeftOffEvidenceBox} data-testid="resume-evidence">
                {currentWork.evidence.commitsAfterLastTask.map((c) => (
                  <span key={c.hash} className={styles.whereYouLeftOffEvidenceItem}>
                    <GitCommit size={12} className={styles.whereYouLeftOffEvidenceIcon} aria-hidden="true" />
                    <span>{c.text}</span>
                  </span>
                ))}
                {currentWork.evidence.uncommittedFiles.length > 0 && (
                  <span className={styles.whereYouLeftOffEvidenceItem}>
                    <FileCode2 size={12} className={styles.whereYouLeftOffEvidenceIcon} aria-hidden="true" />
                    <span>
                      {currentWork.evidence.uncommittedFiles.length === 1
                        ? t('pipeline.resumeCard.evidenceUncommittedSingle')
                        : t('pipeline.resumeCard.evidenceUncommitted', {
                            count: currentWork.evidence.uncommittedFiles.length,
                          })}
                    </span>
                  </span>
                )}
                {currentWork.evidence.session && (
                  <span className={styles.whereYouLeftOffEvidenceItem}>
                    <Activity size={12} className={styles.whereYouLeftOffEvidenceIcon} aria-hidden="true" />
                    <span>{currentWork.evidence.session.text}</span>
                  </span>
                )}
              </div>
            ) : currentWork.evidence.emptyText ? (
              <div className={styles.whereYouLeftOffEvidenceBox}>
                <span className={styles.whereYouLeftOffFallbackValue}>
                  {currentWork.evidence.emptyText}
                </span>
              </div>
            ) : null}
          </div>
        </dd>

        {/* Bloque 3: Lo que queda */}
        <dt className={styles.whereYouLeftOffRowLabel}>{t('pipeline.resumeCard.row.remainingWork')}</dt>
        <dd className={styles.whereYouLeftOffRowValue} data-testid="resume-remaining-work">
          {remainingWork.emptyText ? (
            <span className={styles.whereYouLeftOffFallbackValue}>
              {remainingWork.emptyText}
            </span>
          ) : remainingWork.sections.length > 0 ? (
            <div className={styles.whereYouLeftOffRemainingList} data-testid="resume-remaining-sections">
              {remainingWork.sections.map((sec) => (
                <span
                  key={sec.sectionName}
                  className={cn(
                    styles.whereYouLeftOffSectionBadge,
                    sec.isCurrent && styles.whereYouLeftOffSectionCurrentBadge,
                  )}
                  data-current={sec.isCurrent || undefined}
                >
                  {sec.label}
                </span>
              ))}
            </div>
          ) : null}
        </dd>

        {/* Elementos ocultos para compatibilidad con pruebas y consumidores anteriores */}
        <dd data-testid="resume-progress" style={{ display: 'none' }}>
          {rows.progress.text}
        </dd>
        <dd data-testid="resume-last-activity" style={{ display: 'none' }}>
          {rows.lastActivity.text}
        </dd>
        <dd data-testid="resume-next-step" style={{ display: 'none' }}>
          {rows.nextStep.text}
        </dd>
      </dl>
    </section>
  );
}
