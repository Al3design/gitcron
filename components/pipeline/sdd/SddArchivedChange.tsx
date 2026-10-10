import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { ChangeTimestampLabel } from '../ChangeTimestampLabel';
import { WhereYouLeftOffCard } from '../WhereYouLeftOffCard';
import { PipelineDetails, type DetailTab } from '../PipelineDetails';
import { PipelineNewChangeFlow, type PipelineNewChangeMode } from '../PipelineNewChangeFlow';
import type { PipelineSnapshot } from '../pipeline-view-state';
import type { RuntimeProjection } from '@/types/pipeline';
import shared from '../OpenSpecDashboard.module.css';
import styles from './SddArchivedChange.module.css';

export interface SddArchivedChangeProps {
  repoPath: string;
  snapshot: PipelineSnapshot;
  selectedArchive: NonNullable<PipelineSnapshot['openSpec']>['archivedChanges'][number];
  runtimeSessions: RuntimeProjection[];
  evidenceTab: DetailTab;
  setEvidenceTab: (tab: DetailTab) => void;
  flowMode: PipelineNewChangeMode | null;
  projection: RuntimeProjection | null;
  fixtureActive?: boolean;
  currentBranch: string;
  workingTreeClean: boolean;
  onRefresh?: () => void;
  onOpenChange: (changeId: string) => void;
  onSetCenterTab: (tab: 'work' | 'activity' | 'artifacts') => void;
}

export function SddArchivedChange({
  repoPath,
  snapshot,
  selectedArchive,
  runtimeSessions,
  evidenceTab,
  setEvidenceTab,
  flowMode,
  projection,
  fixtureActive = false,
  currentBranch,
  workingTreeClean,
  onRefresh,
  onOpenChange,
  onSetCenterTab,
}: SddArchivedChangeProps) {
  const t = useT();

  return (
    <section className={styles.completedSummary}>
      {/* La identidad del cambio queda fija arriba mientras se recorren sus artefactos */}
      <div className={styles.completedHeader}>
        <CheckCircle2 size={38} />
        <p>{t('pipeline.openspec.change.completed')}</p>
        <h3>{selectedArchive.changeId}</h3>
        <div className={shared.completedStamps}>
          <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.created" stamp={selectedArchive.createdAt} />
          <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.archived" stamp={selectedArchive.archivedOn} />
          {!selectedArchive.archivedOn && (
            <span className={shared.changeStamp}>
              <span>{t('pipeline.openspec.stamp.archived')}</span> {selectedArchive.archivedAt ?? t('pipeline.openspec.dateUnknown')}
            </span>
          )}
        </div>
      </div>

      <WhereYouLeftOffCard
        repoPath={repoPath}
        selectedArchive={selectedArchive}
        latestSession={runtimeSessions[0] ?? null}
      />

      <div className={styles.archivedArtifacts} data-pending={!selectedArchive.artifacts || undefined}>
        {!selectedArchive.artifacts ? (
          <p className={shared.archivedPending}>{t('pipeline.revalidating')}</p>
        ) : (
          <PipelineDetails
            snapshot={snapshot}
            repoPath={repoPath}
            isArchived={true}
            selectedChange={{
              changeId: selectedArchive.changeId,
              intent: null,
              tasks: [],
              proposalExists: selectedArchive.artifacts.proposal !== null,
              designExists: selectedArchive.artifacts.design !== null,
              specsCount: selectedArchive.artifacts.specs.length,
              validation: 'unknown',
              artifacts: selectedArchive.artifacts,
            }}
            tab={evidenceTab}
            onTabChange={setEvidenceTab}
          />
        )}
      </div>

      {flowMode && (
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
      )}
    </section>
  );
}
