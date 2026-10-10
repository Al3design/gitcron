import React from 'react';
import { ChevronLeft, Play } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { PipelineRuntimeLauncher } from '../../PipelineRuntimeLauncher';
import { OpenSpecTasksView } from '../../OpenSpecTasksView';
import { resolveTaskLabel, resolveTaskText } from '../../pipeline-next-action';
import type { OpenSpecChangeSummary } from '../../pipeline-view-state';
import type { RuntimeProjection, TaskEvidence } from '@/types/pipeline';
import { useSddTasksView } from './useSddTasksView';
import styles from './SddTasksView.module.css';
import shared from '../../OpenSpecDashboard.module.css';

export interface SddTasksRuntimeState {
  projection?: RuntimeProjection | null;
  runtimeActive?: boolean;
  runningName?: string | null;
  fixtureActive?: boolean;
}

export interface SddTasksViewProps {
  repoPath: string;
  selectedChange: OpenSpecChangeSummary;
  launchTarget?: { taskId?: string | null; instruction?: string } | null;
  runtime?: SddTasksRuntimeState;
  nextTask?: TaskEvidence | null;
  highlightTaskId?: string | null;
  onBackToOverview: () => void;
  onLaunchStarted: () => void;
  onRefresh?: () => void;
  setSuccess?: (msg: string | null) => void;

  // Propiedades opcionales desglosadas por si se pasan individualmente
  projection?: RuntimeProjection | null;
  fixtureActive?: boolean;
  runtimeActive?: boolean;
  runningName?: string | null;
}

export function SddTasksView({
  repoPath,
  selectedChange,
  launchTarget,
  runtime,
  nextTask,
  highlightTaskId,
  onBackToOverview,
  onLaunchStarted,
  onRefresh,
  setSuccess,
  projection: projectionProp,
  fixtureActive: fixtureActiveProp,
  runtimeActive: runtimeActiveProp,
  runningName: runningNameProp,
}: SddTasksViewProps) {
  const t = useT();

  const projection = runtime?.projection ?? projectionProp ?? null;
  const fixtureActive = runtime?.fixtureActive ?? fixtureActiveProp ?? false;
  const runtimeActive = runtime?.runtimeActive ?? runtimeActiveProp ?? false;
  const runningName = runtime?.runningName ?? runningNameProp ?? null;

  const {
    launcherLoading,
    setLauncherLoading,
    changeSession,
    gitDelta,
    lastObservedActivity,
  } = useSddTasksView({
    selectedChange,
    projection,
  });

  if (launchTarget) {
    return (
      <section className={shared.startScreen} aria-label={t('pipeline.openspec.launcher.title')}>
        <div
          className={cn(shared.centerBlock, shared.launcherPanel)}
          data-launcher-loading={launcherLoading || undefined}
        >
          <h4 className={styles.blockHeader}>
            <Play size={13} aria-hidden="true" />
            <span>{t('pipeline.openspec.launcher.title')}</span>
          </h4>
          <PipelineRuntimeLauncher
            key={`${selectedChange.changeId}:${launchTarget.taskId ?? 'archive'}`}
            repoPath={repoPath}
            projection={projection}
            intent="implement-task"
            initialInstruction={launchTarget.instruction}
            changeId={selectedChange.changeId}
            taskId={launchTarget.taskId}
            blockedByFixture={fixtureActive}
            startLabelKey={launchTarget.taskId ? 'pipeline.launcher.startApply' : 'pipeline.launcher.startArchive'}
            onStarted={onLaunchStarted}
            onDiscoveringChange={setLauncherLoading}
          />
        </div>
      </section>
    );
  }

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.switcher.tasks')}>
      <button
        type="button"
        className={styles.backToOverview}
        onClick={onBackToOverview}
      >
        <ChevronLeft size={13} aria-hidden="true" />
        <span>{t('pipeline.switcher.backToOverview')}</span>
      </button>
      <OpenSpecTasksView
        key={selectedChange.changeId}
        repoPath={repoPath}
        selectedChange={selectedChange}
        fixtureActive={fixtureActive}
        runtimeActive={runtimeActive}
        runningName={runningName ?? undefined}
        nextTask={nextTask}
        changeSession={changeSession}
        gitDelta={gitDelta}
        lastObservedActivity={lastObservedActivity}
        onRefresh={onRefresh}
        setSuccess={setSuccess}
        resolveTaskLabel={resolveTaskLabel}
        resolveTaskText={resolveTaskText}
        highlightTaskId={highlightTaskId}
      />
    </section>
  );
}
