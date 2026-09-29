'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, FileCode2, MessageSquareText, Wrench } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { SidebarSection } from '@/components/RepoSidebarParts';
import { DEFAULT_OPEN_RIGHT_PANEL, openSidebarSection, useSidebarSectionState, type SidebarSectionState } from '@/hooks/use-sidebar-section-state';
import type { OpenSpecEngineStatus, OpenSpecRegistryCheck, RuntimeProjection } from '@/types/pipeline';
import { DecisionInbox } from './DecisionInbox';
import { INTEGRATION_STATE_KEY_MAP } from './OpenSpecEngineCard';
import {
  groupActivity,
  hasOpenSpecAttention,
  resolveSessionStatusI18nKey,
  runtimeDisplayName,
  type ActivityChannel,
} from './pipeline-domain';
import type { PipelineSnapshot } from './pipeline-view-state';
import { readEngineStatus } from '@/lib/engine-status-reader';
import styles from './OpenSpecDashboard.module.css';

const ACTIVITY_ICONS: Record<ActivityChannel, React.ComponentType<{ size?: number }>> = {
  narrative: MessageSquareText,
  reasoning: BrainCircuit,
  tool: Wrench,
  file: FileCode2,
  system: CheckCircle2,
};

function formatTime(value: string | null): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatSessionMoment(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatSessionOption(session: RuntimeProjection): string {
  const runtime = runtimeDisplayName(session.runtime) ?? session.runtime;
  const context = [session.changeId, session.taskId].filter(Boolean).join(' · ');
  const date = new Date(session.startedAt);
  const started = Number.isNaN(date.getTime())
    ? session.startedAt
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  return [runtime, context, started].filter(Boolean).join(' · ');
}

export type OpenSpecInspectorProps = {
  snapshot?: PipelineSnapshot | null;
  repoPath?: string | null;
  currentBranch?: string;
  workingTreeClean?: boolean;
  projection?: RuntimeProjection | null;
  runtimeHistory?: RuntimeProjection[];
  onPauseAfterTask?: () => void;
  onRespondDecision?: (decisionId: string, optionId: string, availability?: string) => void;
  controlNotice?: string | null;
  sendingDecisions?: Record<string, boolean>;
  onOpenReview?: () => void;
  isReviewOpen?: boolean;
  sectionState?: SidebarSectionState;
  children?: React.ReactNode;
};

export function OpenSpecInspector({
  snapshot: propSnapshot,
  repoPath: propRepoPath,
  currentBranch = '',
  workingTreeClean = true,
  projection: propProjection,
  runtimeHistory: propRuntimeHistory,
  onPauseAfterTask = () => undefined,
  onRespondDecision = () => undefined,
  controlNotice,
  sendingDecisions,
  onOpenReview: _onOpenReview,
  isReviewOpen: _isReviewOpen = false,
  sectionState: propSectionState,
  children,
}: OpenSpecInspectorProps) {
  const t = useT();
  const storeSnapshot = usePipelineStore((s) => s.snapshot);
  const storeProjection = usePipelineStore((s) => s.projection);
  const storeHistory = usePipelineStore((s) => s.runtimeHistory);
  const storeSelectedId = usePipelineStore((s) => s.selectedChangeId);
  const engineChangeToken = usePipelineStore((s) => s.engineChangeToken);

  const gitStoreRepoPath = useGitStore((s) => s.repoPath);

  const snapshot = propSnapshot ?? storeSnapshot;
  const repoPath = propRepoPath ?? gitStoreRepoPath;
  const projection = propProjection !== undefined ? propProjection : storeProjection;
  const runtimeHistory = propRuntimeHistory !== undefined ? propRuntimeHistory : storeHistory;

  const localSectionState = useSidebarSectionState(repoPath, DEFAULT_OPEN_RIGHT_PANEL);
  const sectionState = propSectionState ?? localSectionState;

  const openSpec = snapshot?.openSpec;
  const openChangeId = storeSelectedId ?? openSpec?.selectedChangeId ?? null;
  const attentionRef = useRef<HTMLElement | null>(null);
  const attentionRequest = usePipelineStore((s) => s.attentionRequest);
  const prevAttentionRequestRef = useRef(attentionRequest);
  const pendingFocusOnAttentionRef = useRef(false);

  useEffect(() => {
    if (attentionRequest > prevAttentionRequestRef.current) {
      prevAttentionRequestRef.current = attentionRequest;
      pendingFocusOnAttentionRef.current = true;
      if (!sectionState.isOpen('details-attention')) {
        sectionState.open('details-attention');
        openSidebarSection(repoPath, 'details-attention');
      }
      if (attentionRef.current) {
        attentionRef.current.focus();
        pendingFocusOnAttentionRef.current = false;
      }
    } else {
      prevAttentionRequestRef.current = attentionRequest;
    }
  }, [attentionRequest, repoPath, sectionState]);

  useEffect(() => {
    if (pendingFocusOnAttentionRef.current && attentionRef.current) {
      attentionRef.current.focus();
      pendingFocusOnAttentionRef.current = false;
    }
  });

  // OpenSpec engine and tools state
  const [engineStatus, setEngineStatus] = useState<OpenSpecEngineStatus | null>(null);
  const [registryCheck, setRegistryCheck] = useState<OpenSpecRegistryCheck | null>(null);

  // Mismo camino de fetch que se reutiliza al re-leer el estado tras una
  // escritura de perfil (onChanged de la tarjeta): no hay un segundo fetch.
  const refetchEngineStatus = useCallback(() => {
    if (!repoPath || typeof window === 'undefined' || !window.api?.pipelineOpenSpec?.getEngineStatus) {
      setEngineStatus(null);
      return;
    }
    let cancelled = false;
    readEngineStatus(repoPath, (status) => {
      if (!cancelled) {
        setEngineStatus(status);
      }
    }).catch(() => {
      if (!cancelled) {
        setEngineStatus(null);
      }
    });
    return () => { cancelled = true; };
  }, [repoPath]);

  useEffect(() => refetchEngineStatus(), [refetchEngineStatus, engineChangeToken]);

  const effectiveEngineStatus = useMemo<OpenSpecEngineStatus | null>(() => {
    if (!engineStatus) return null;
    if (!registryCheck) return engineStatus;
    return {
      ...engineStatus,
      latestAvailable: registryCheck,
    };
  }, [engineStatus, registryCheck]);

  const openSpecTools = snapshot?.openSpec?.openSpecTools ?? [];
  const openSpecPresent = snapshot?.openSpec?.openSpecPresent ?? (engineStatus?.repoState === 'initialized');
  const needsToolsAttention = hasOpenSpecAttention({
    engineStatus: effectiveEngineStatus,
    openSpecTools,
    openSpecPresent,
  });

  const installed = effectiveEngineStatus?.installedIntegration;
  const configuredAgentsCount =
    installed?.configuredAgentsCount ??
    installed?.configuredCount ??
    (installed?.tools?.length ?? 0);
  const integrationKey =
    INTEGRATION_STATE_KEY_MAP[effectiveEngineStatus?.integrationState ?? 'unknown'] ??
    'pipeline.openspec.engine.integrationState.unknown';
  const isEngineInstalled = Boolean(effectiveEngineStatus?.cli?.installed);
  const rawStatusLine = t('pipeline.openspec.config.statusLine', {
    version: effectiveEngineStatus?.cli?.runtimeVersion ?? '?',
    integration: t(integrationKey),
    agents: configuredAgentsCount,
  });
  const statusLine = isEngineInstalled
    ? rawStatusLine
    : rawStatusLine.includes('·')
    ? `${t('pipeline.openspec.engine.status.absent')} · ${rawStatusLine.split('·').slice(1).map((s) => s.trim()).join(' · ')}`
    : rawStatusLine;

  const runtimeSessions = useMemo(() => {
    const combined = [...(runtimeHistory ?? [])];
    if (projection && !combined.some((item) => item.sessionId === projection.sessionId)) {
      combined.unshift(projection);
    }
    return combined.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [projection, runtimeHistory]);

  const filteredSessions = useMemo(() => {
    if (openChangeId === null) return runtimeSessions;
    return runtimeSessions.filter((s) => s.changeId === openChangeId);
  }, [runtimeSessions, openChangeId]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedSessionId && !filteredSessions.some((session) => session.sessionId === selectedSessionId)) {
      setSelectedSessionId(null);
    }
  }, [filteredSessions, selectedSessionId]);

  const effectiveSessionId = useMemo(() => {
    if (selectedSessionId && filteredSessions.some((s) => s.sessionId === selectedSessionId)) {
      return selectedSessionId;
    }
    return filteredSessions[0]?.sessionId ?? null;
  }, [filteredSessions, selectedSessionId]);

  const selectedSession = useMemo(
    () => filteredSessions.find((session) => session.sessionId === effectiveSessionId) ?? filteredSessions[0] ?? null,
    [filteredSessions, effectiveSessionId],
  );

  const visibleActivity = useMemo(() => {
    if (selectedSession) return selectedSession.activity;
    if (openChangeId !== null) return [];
    return snapshot?.activity ?? [];
  }, [selectedSession, openChangeId, snapshot?.activity]);

  const activityGroups = useMemo(() => groupActivity(visibleActivity), [visibleActivity]);

  const runningName = selectedSession ? (runtimeDisplayName(selectedSession.runtime) ?? selectedSession.runtime) : 'Agent';
  const sessionStatusKey = selectedSession
    ? (selectedSession.active ? 'running' : selectedSession.outcome)
    : (filteredSessions[0] ? (filteredSessions[0].active ? 'running' : filteredSessions[0].outcome) : 'idle');
  const totalRequirements = openSpec?.specifications?.reduce((acc, spec) => acc + (typeof spec.requirements === 'number' ? spec.requirements : 0), 0) ?? 0;


  return (
    <aside className={`${styles.activityRail} ${styles.openspecScope}`} aria-label={t('pipeline.openspec.activity.title')}>
      <div className={styles.railSections}>
        <SidebarSection
          title={t('pipeline.openspec.activity.title')}
          count={activityGroups.length}
          icon={<Activity size={13} aria-hidden="true" />}
          isOpen={sectionState.isOpen('details-activity')}
          onToggle={() => sectionState.toggle('details-activity')}
        >
          {openChangeId === null && (
            <p className={styles.railScope}>{t('pipeline.openspec.activity.repoScope')}</p>
          )}
          <section className={styles.liveActivity}>
            <header>
              <span className={styles.sessionIdentity}>
                <strong>{selectedSession || visibleActivity.length > 0 ? runningName : t('pipeline.openspec.activity.noSession')}</strong>
                <span className={styles.liveDot} data-active={selectedSession?.active || undefined} />
                <em>{t(resolveSessionStatusI18nKey(sessionStatusKey))}</em>
                {selectedSession && (
                  <em className={styles.sessionRanAt}>
                    {t('pipeline.openspec.activity.ranAt', { at: formatSessionMoment(selectedSession.startedAt) })}
                  </em>
                )}
              </span>
              {filteredSessions.length > 1 && (
                <select
                  className={styles.sessionSelect}
                  aria-label={t('pipeline.openspec.activity.sessionPicker')}
                  value={effectiveSessionId ?? ''}
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                >
                  {filteredSessions.map((session) => (
                    <option key={session.sessionId} value={session.sessionId}>{formatSessionOption(session)}</option>
                  ))}
                </select>
              )}
            </header>
            {selectedSession && (
              <p className={styles.sessionContext}>
                {[selectedSession.changeId, selectedSession.taskId].filter(Boolean).join(' · ') || t('pipeline.openspec.activity.noChange')}
              </p>
            )}
            {activityGroups.length === 0 ? (
              <p className={styles.railEmpty}>
                {selectedSession
                  ? t('pipeline.activity.empty')
                  : openChangeId !== null
                    ? t('pipeline.openspec.activity.noneForChange')
                    : t('pipeline.activity.noRuntime')}
              </p>
            ) : (
              <ol>
                {activityGroups.slice(-12).map((entry, idx) => {
                  const Icon = ACTIVITY_ICONS[entry.channel];
                  const localized = ['session.started', 'session.completed', 'session.failed', 'session.interrupted'].includes(entry.text);
                  const gitEvidence = /^git\.changed files=(\d+) additions=(\d+|unknown) deletions=(\d+|unknown)$/.exec(entry.text);
                  const validationEvidence = /^openspec\.validation\.(passed|failed|unknown)$/.exec(entry.text);
                  const displayText = gitEvidence
                    ? t('pipeline.openspec.activity.event.gitChanged', {
                      files: gitEvidence[1],
                      additions: gitEvidence[2] === 'unknown' ? '—' : gitEvidence[2],
                      deletions: gitEvidence[3] === 'unknown' ? '—' : gitEvidence[3],
                    })
                    : validationEvidence
                      ? t(`pipeline.openspec.activity.event.validation.${validationEvidence[1]}`)
                      : localized
                        ? t(`pipeline.openspec.activity.event.${entry.text}`)
                        : entry.text;
                  return (
                    <li key={entry.key ?? `${entry.at}-${entry.channel}-${idx}`} data-channel={entry.channel}>
                      <time>{formatTime(entry.at)}</time>
                      <span className={styles.activityIcon}><Icon size={12} /></span>
                      <div><strong>{t(`pipeline.channel.${entry.channel}`)}</strong><p>{displayText}</p></div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </SidebarSection>

        <SidebarSection
          title={t('pipeline.openspec.attention.title')}
          count={snapshot?.decisions?.length}
          icon={<AlertTriangle size={13} aria-hidden="true" />}
          isOpen={sectionState.isOpen('details-attention')}
          onToggle={() => sectionState.toggle('details-attention')}
        >
          <section
            className={styles.attention}
            data-needed={(snapshot?.decisions?.length ?? 0) > 0}
            ref={attentionRef}
            tabIndex={-1}
            aria-label={t('pipeline.openspec.attention.title')}
          >
            <DecisionInbox
              decisions={snapshot?.decisions ?? []}
              onRespondDecision={onRespondDecision}
              controlNotice={controlNotice}
              sendingDecisions={sendingDecisions}
              repoPath={repoPath}
            />
          </section>
        </SidebarSection>

        <SidebarSection
          title={t('pipeline.openspec.rail.tools')}
          extra={needsToolsAttention ? (
            <AlertTriangle
              size={13}
              className={styles.toolsSectionWarning}
              role="img"
              aria-label={t('pipeline.openspec.engine.generalStatus.needsAttention')}
            />
          ) : undefined}
          icon={<Wrench size={13} aria-hidden="true" />}
          isOpen={sectionState.isOpen('details-tools')}
          onToggle={() => sectionState.toggle('details-tools')}
        >
          <div className={styles.toolsRailContent}>
            <p className={styles.toolsStatusLine}>{statusLine}</p>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => usePipelineStore.getState().setReviewOpen(true)}
            >
              {t('pipeline.openspec.config.open')}
            </button>
          </div>
        </SidebarSection>
        {children}
      </div>

      <footer className={styles.railMeta}>
        <span>{totalRequirements} {t('pipeline.openspec.summary.requirements')}</span>
        <span>{openSpec?.reports?.length ?? 0} {t('pipeline.openspec.summary.reports')}</span>
      </footer>
    </aside>
  );
}
