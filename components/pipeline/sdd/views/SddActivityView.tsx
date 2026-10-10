import React from 'react';
import { useT } from '@/hooks/use-translation';
import { ActivityFeed, type ActivityFeedProps } from '../../ActivityFeed';
import shared from '../../OpenSpecDashboard.module.css';

export interface SddActivityViewProps {
  entries: ActivityFeedProps['entries'];
  reasoningAvailable: boolean | null;
  runtimeAttached?: boolean;
  agentRuntimes?: Record<string, string | null>;
}

export function SddActivityView({
  entries,
  reasoningAvailable,
  runtimeAttached,
  agentRuntimes,
}: SddActivityViewProps) {
  const t = useT();

  return (
    <section className={shared.startScreen} aria-label={t('pipeline.switcher.activity')}>
      <div className={shared.centerBlock}>
        <ActivityFeed
          entries={entries}
          reasoningAvailable={reasoningAvailable}
          runtimeAttached={runtimeAttached}
          agentRuntimes={agentRuntimes}
        />
      </div>
    </section>
  );
}
