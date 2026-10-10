import React from 'react';
import { useT } from '@/hooks/use-translation';
import { WhereYouLeftOffCard, type WhereYouLeftOffCardProps } from '../../WhereYouLeftOffCard';
import type { OpenSpecChangeSummary } from '../../pipeline-view-state';
import type { TaskEvidence } from '@/types/pipeline';
import shared from '../../OpenSpecDashboard.module.css';

export interface SddOverviewViewProps {
  repoPath: string;
  selectedChange: OpenSpecChangeSummary;
  nextTask?: TaskEvidence | null;
  latestSession?: WhereYouLeftOffCardProps['latestSession'];
  onNavigateToTask: (taskId: string) => void;
}

export function SddOverviewView({
  repoPath,
  selectedChange,
  nextTask,
  latestSession,
  onNavigateToTask,
}: SddOverviewViewProps) {
  const t = useT();

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.switcher.overview')}>
      <WhereYouLeftOffCard
        repoPath={repoPath}
        selectedChange={selectedChange}
        nextTask={nextTask}
        latestSession={latestSession ?? null}
        onNavigateToTask={onNavigateToTask}
      />
    </section>
  );
}
