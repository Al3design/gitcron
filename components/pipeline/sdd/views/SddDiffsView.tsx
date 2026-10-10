import React from 'react';
import { useT } from '@/hooks/use-translation';
import { LazyDiffViewer, type LazyDiffViewerProps } from '../../LazyDiffViewer';
import shared from '../../OpenSpecDashboard.module.css';

export interface SddDiffsViewProps {
  diffs: LazyDiffViewerProps['diffs'];
  agentRuntimes?: Record<string, string | null>;
}

export function SddDiffsView({ diffs, agentRuntimes }: SddDiffsViewProps) {
  const t = useT();

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.switcher.diffs')}>
      <div className={shared.centerBlock}>
        <LazyDiffViewer
          diffs={diffs}
          agentRuntimes={agentRuntimes}
        />
      </div>
    </section>
  );
}
