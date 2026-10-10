import { useState, useMemo } from 'react';
import type { RuntimeProjection } from '@/types/pipeline';
import type { OpenSpecChangeSummary } from '../../pipeline-view-state';

export interface UseSddTasksViewOptions {
  selectedChange?: OpenSpecChangeSummary | null;
  projection?: RuntimeProjection | null;
}

export function useSddTasksView({
  selectedChange,
  projection,
}: UseSddTasksViewOptions) {
  const [launcherLoading, setLauncherLoading] = useState(false);

  const changeSession = useMemo(() => {
    return projection && selectedChange && projection.changeId === selectedChange.changeId
      ? projection
      : null;
  }, [projection, selectedChange]);

  const gitDelta = useMemo(() => {
    const entry = changeSession?.activity.find((item) => item.text?.startsWith('git.changed '));
    const match = entry?.text
      ? /^git\.changed files=(\d+) additions=(\d+|unknown) deletions=(\d+|unknown)$/.exec(entry.text)
      : null;
    return match ? { files: match[1], additions: match[2], deletions: match[3] } : null;
  }, [changeSession]);

  const lastObservedActivity = useMemo(() => {
    return (
      changeSession?.activity
        .filter((item) => item.channel === 'narrative' || item.channel === 'tool')
        .at(-1)?.text ?? null
    );
  }, [changeSession]);

  return {
    launcherLoading,
    setLauncherLoading,
    changeSession,
    gitDelta,
    lastObservedActivity,
  };
}
