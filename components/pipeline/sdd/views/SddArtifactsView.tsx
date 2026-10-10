import React from 'react';
import { useT } from '@/hooks/use-translation';
import { PipelineDetails, type DetailTab } from '../../PipelineDetails';
import type { OpenSpecChangeSummary, PipelineSnapshot } from '../../pipeline-view-state';
import shared from '../../OpenSpecDashboard.module.css';

export interface SddArtifactsViewProps {
  snapshot: PipelineSnapshot;
  repoPath: string;
  selectedChange: OpenSpecChangeSummary;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}

export function SddArtifactsView({
  snapshot,
  repoPath,
  selectedChange,
  tab,
  onTabChange,
}: SddArtifactsViewProps) {
  const t = useT();

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.switcher.artifacts')}>
      <PipelineDetails
        snapshot={snapshot}
        repoPath={repoPath}
        selectedChange={selectedChange}
        tab={tab}
        onTabChange={onTabChange}
      />
    </section>
  );
}
