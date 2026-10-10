import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-translation';
import { PipelineNewChangeFlow } from '../PipelineNewChangeFlow';
import type { OpenSpecChangeSummary, PipelineSnapshot } from '../pipeline-view-state';
import type { RuntimeProjection, TaskEvidence } from '@/types/pipeline';
import shared from '../OpenSpecDashboard.module.css';
import styles from './SddStartScreens.module.css';

export type StartView = 'in-progress' | 'archived' | 'new-change';

export interface SddStartScreensProps {
  activeStartView: StartView;
  specifications: NonNullable<PipelineSnapshot['openSpec']>['specifications'];
  globalTaskPercent: number | null;
  activeChanges: OpenSpecChangeSummary[];
  archivedChanges: NonNullable<PipelineSnapshot['openSpec']>['archivedChanges'];
  startChanges: Array<{
    change: OpenSpecChangeSummary;
    progress: { completed: number; total: number; percent: number };
  }>;
  branchChangeId: string | null;
  pinnedChangeIds: string[];
  togglePinChange: (changeId: string) => void;
  handleCardClick: (e: React.MouseEvent, changeId: string) => void;
  handleCardKeyDown: (e: React.KeyboardEvent, changeId: string) => void;
  onDismissFlow: () => void;
  onSwitchStartView: (view: StartView) => void;
  repoPath: string;
  projection: RuntimeProjection | null;
  fixtureActive?: boolean;
  currentBranch: string;
  snapshot: PipelineSnapshot;
  workingTreeClean: boolean;
  onRefresh?: () => void;
  onOpenChange: (changeId: string) => void;
  onSetCenterTab: (tab: 'work' | 'activity' | 'artifacts') => void;
}

function StartChangeCard({
  change,
  progress,
  branchChangeId,
  isPinned,
  pendingTasks,
  isExpanded,
  onCardClick,
  onCardKeyDown,
  onTogglePin,
  onToggleExpand,
}: {
  change: OpenSpecChangeSummary;
  progress: { total: number; completed: number; percent: number };
  branchChangeId: string | null;
  isPinned: boolean;
  pendingTasks: TaskEvidence[];
  isExpanded: boolean;
  onCardClick: (e: React.MouseEvent, changeId: string) => void;
  onCardKeyDown: (e: React.KeyboardEvent, changeId: string) => void;
  onTogglePin: (changeId: string) => void;
  onToggleExpand: (changeId: string) => void;
}) {
  const t = useT();
  const tCount = (key: string, count: number, params?: Record<string, string | number>): string =>
    t(count === 1 ? `${key}.one` : key, { count, ...params });

  return (
    <li
      data-branch={change.changeId === branchChangeId || undefined}
      data-pinned={isPinned || undefined}
      tabIndex={0}
      role="button"
      aria-label={`${change.changeId} ${t('pipeline.openspec.start.enter')}`}
      onClick={(e) => onCardClick(e, change.changeId)}
      onKeyDown={(e) => onCardKeyDown(e, change.changeId)}
    >
      <div className={styles.startItemHead}>
        <strong>{change.changeId}</strong>
        {change.changeId === branchChangeId && (
          <em className={styles.branchPill}>{t('pipeline.openspec.start.branchMatch')}</em>
        )}
        <button
          type="button"
          className={cn(shared.iconBtn, styles.startCardPinBtn, isPinned && styles.startCardPinBtnPinned)}
          title={isPinned ? t('pipeline.openspec.start.unpinAction') : t('pipeline.openspec.start.pinAction')}
          aria-label={isPinned ? `${t('pipeline.openspec.start.pinned')}: ${t('pipeline.openspec.start.unpinAction')}` : t('pipeline.openspec.start.pinAction')}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(change.changeId);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          <Star size={13} aria-hidden="true" />
        </button>
      </div>
      <p title={change.intent ?? undefined}>{change.intent ?? t('pipeline.openspec.intentUnknown')}</p>
      <div className={styles.startProgress}>
        <span>
          {progress.total === 0
            ? t('pipeline.openspec.start.noTasks')
            : t('pipeline.openspec.start.tasks', { done: progress.completed, total: progress.total })}
        </span>
        {progress.total > 0 && (
          <span className={styles.startBar} aria-hidden="true">
            <span style={{ width: `${progress.percent}%` }} />
          </span>
        )}
        {pendingTasks.length > 0 && (
          <button
            type="button"
            className={styles.startPendingToggle}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(change.changeId);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          >
            <ChevronDown size={12} />
            {tCount('pipeline.openspec.start.pending', pendingTasks.length)}
          </button>
        )}
      </div>
      {isExpanded && (
        <ul className={styles.startPending}>
          {pendingTasks.map((task) => (
            <li key={task.id}><Circle size={9} /> {task.text}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function InProgressStartScreen({
  specifications,
  globalTaskPercent,
  activeChanges,
  startChanges,
  branchChangeId,
  pinnedChangeIds,
  togglePinChange,
  handleCardClick,
  handleCardKeyDown,
  expandedStart,
  setExpandedStart,
}: {
  specifications: NonNullable<PipelineSnapshot['openSpec']>['specifications'];
  globalTaskPercent: number | null;
  activeChanges: OpenSpecChangeSummary[];
  startChanges: Array<{
    change: OpenSpecChangeSummary;
    progress: { completed: number; total: number; percent: number };
  }>;
  branchChangeId: string | null;
  pinnedChangeIds: string[];
  togglePinChange: (changeId: string) => void;
  handleCardClick: (e: React.MouseEvent, changeId: string) => void;
  handleCardKeyDown: (e: React.KeyboardEvent, changeId: string) => void;
  expandedStart: Record<string, boolean>;
  setExpandedStart: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const t = useT();
  const pendingOf = (change: OpenSpecChangeSummary) => change.tasks.filter((task) => !task.completed);

  const toggleExpandChange = (changeId: string) => {
    setExpandedStart((current) => ({
      ...current,
      [changeId]: !(current[changeId] ?? false),
    }));
  };

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.openspec.start.title')}>
      <header className={shared.startHeader}>
        <div className={shared.startHeaderTitleGroup}>
          <h3>{t('pipeline.openspec.start.title')}</h3>
          <p className={shared.startSpecsBadge}>
            <span>
              {specifications.length === 0
                ? t('pipeline.openspec.start.specsPending')
                : t('pipeline.openspec.start.specificationsCount', { count: specifications.length })}
            </span>
            <span> · </span>
            <span data-testid="start-global-progress">
              {globalTaskPercent !== null
                ? t('pipeline.openspec.start.globalProgress', { percent: globalTaskPercent })
                : t('pipeline.openspec.start.noTasksToMeasure')}
            </span>
          </p>
        </div>
      </header>

      {/* Centro de la pantalla: CAMBIOS EN CURSO */}
      <div className={styles.startMainBlock}>
        <div className={styles.startBlock}>
          <h4>{t('pipeline.openspec.start.inProgress')} <span>{activeChanges.length}</span></h4>
          {activeChanges.length === 0 ? (
            <p className={styles.startNote}>{t('pipeline.openspec.start.noActive')}</p>
          ) : (
            <ul className={styles.startList}>
              {startChanges.map(({ change, progress }) => (
                <StartChangeCard
                  key={change.changeId}
                  change={change}
                  progress={progress}
                  branchChangeId={branchChangeId}
                  isPinned={pinnedChangeIds.includes(change.changeId)}
                  pendingTasks={pendingOf(change)}
                  isExpanded={expandedStart[change.changeId] ?? false}
                  onCardClick={handleCardClick}
                  onCardKeyDown={handleCardKeyDown}
                  onTogglePin={togglePinChange}
                  onToggleExpand={toggleExpandChange}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ArchivedStartScreen({
  archivedChanges,
  handleCardClick,
  handleCardKeyDown,
}: {
  archivedChanges: NonNullable<PipelineSnapshot['openSpec']>['archivedChanges'];
  handleCardClick: (e: React.MouseEvent, changeId: string) => void;
  handleCardKeyDown: (e: React.KeyboardEvent, changeId: string) => void;
}) {
  const t = useT();
  const tCount = (key: string, count: number, params?: Record<string, string | number>): string =>
    t(count === 1 ? `${key}.one` : key, { count, ...params });

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.openspec.start.archived')}>
      <header className={shared.startHeader}>
        <div className={shared.startHeaderTitleGroup}>
          <h3>{t('pipeline.openspec.start.archived')}</h3>
          <p className={shared.startSpecsBadge}>
            {tCount('pipeline.openspec.start.archivedCount', archivedChanges.length)}
          </p>
        </div>
      </header>

      <div className={styles.startMainBlock}>
        <div className={styles.startBlock}>
          <h4>{t('pipeline.openspec.start.closed')} <span>{archivedChanges.length}</span></h4>
          {archivedChanges.length === 0 ? (
            <p className={styles.startNote}>{t('pipeline.openspec.start.neverArchived')}</p>
          ) : (
            <ul className={styles.startList}>
              {archivedChanges.map((change) => (
                <li
                  key={`${change.archivedAt}-${change.changeId}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${change.changeId} ${t('pipeline.openspec.start.enter')}`}
                  onClick={(e) => handleCardClick(e, change.changeId)}
                  onKeyDown={(e) => handleCardKeyDown(e, change.changeId)}
                >
                  <div className={styles.startItemHead}>
                    <div className={styles.startItemTitleWithIcon}>
                      <CheckCircle2 size={13} className={styles.startArchivedIcon} />
                      <strong>{change.changeId}</strong>
                    </div>
                  </div>
                  <p>{change.archivedAt ?? t('pipeline.openspec.dateUnknown')}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function NewChangeStartScreen({
  onDismissFlow,
  onSwitchStartView,
  repoPath,
  projection,
  fixtureActive,
  onSetCenterTab,
  currentBranch,
  snapshot,
  workingTreeClean,
  onRefresh,
  onOpenChange,
}: {
  onDismissFlow: () => void;
  onSwitchStartView: (view: StartView) => void;
  repoPath: string;
  projection: RuntimeProjection | null;
  fixtureActive?: boolean;
  onSetCenterTab: (tab: 'work' | 'activity' | 'artifacts') => void;
  currentBranch: string;
  snapshot: PipelineSnapshot;
  workingTreeClean: boolean;
  onRefresh?: () => void;
  onOpenChange: (changeId: string) => void;
}) {
  const t = useT();

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.newChange.title')}>
      <header className={shared.startHeader}>
        <div className={shared.startHeaderTitleGroup}>
          <h3>{t('pipeline.newChange.title')}</h3>
        </div>
        <button
          type="button"
          className={shared.secondaryAction}
          onClick={() => {
            onDismissFlow();
            onSwitchStartView('in-progress');
          }}
        >
          {t('pipeline.newChange.close')}
        </button>
      </header>

      <div className={styles.startMainBlock}>
        <div className={styles.startNewChangeModal}>
          <PipelineNewChangeFlow
            repoPath={repoPath}
            projection={projection}
            blockedByFixture={fixtureActive}
            onStarted={() => onSetCenterTab('activity')}
            currentBranch={currentBranch}
            divergence={snapshot.branchDivergence}
            workingTreeClean={workingTreeClean}
            onRefresh={onRefresh}
            onOpenChange={onOpenChange}
          />
        </div>
      </div>
    </section>
  );
}

export function SddStartScreens({
  activeStartView,
  specifications,
  globalTaskPercent,
  activeChanges,
  archivedChanges,
  startChanges,
  branchChangeId,
  pinnedChangeIds,
  togglePinChange,
  handleCardClick,
  handleCardKeyDown,
  onDismissFlow,
  onSwitchStartView,
  repoPath,
  projection,
  fixtureActive = false,
  currentBranch,
  snapshot,
  workingTreeClean,
  onRefresh,
  onOpenChange,
  onSetCenterTab,
}: SddStartScreensProps) {
  const [expandedStart, setExpandedStart] = useState<Record<string, boolean>>({});

  if (activeStartView === 'in-progress') {
    return (
      <InProgressStartScreen
        specifications={specifications}
        globalTaskPercent={globalTaskPercent}
        activeChanges={activeChanges}
        startChanges={startChanges}
        branchChangeId={branchChangeId}
        pinnedChangeIds={pinnedChangeIds}
        togglePinChange={togglePinChange}
        handleCardClick={handleCardClick}
        handleCardKeyDown={handleCardKeyDown}
        expandedStart={expandedStart}
        setExpandedStart={setExpandedStart}
      />
    );
  }

  if (activeStartView === 'archived') {
    return (
      <ArchivedStartScreen
        archivedChanges={archivedChanges}
        handleCardClick={handleCardClick}
        handleCardKeyDown={handleCardKeyDown}
      />
    );
  }

  if (activeStartView === 'new-change') {
    return (
      <NewChangeStartScreen
        onDismissFlow={onDismissFlow}
        onSwitchStartView={onSwitchStartView}
        repoPath={repoPath}
        projection={projection}
        fixtureActive={fixtureActive}
        onSetCenterTab={onSetCenterTab}
        currentBranch={currentBranch}
        snapshot={snapshot}
        workingTreeClean={workingTreeClean}
        onRefresh={onRefresh}
        onOpenChange={onOpenChange}
      />
    );
  }

  return null;
}
