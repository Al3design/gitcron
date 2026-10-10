import React from 'react';
import { useT } from '@/hooks/use-translation';
import { ChangeTimestampLabel } from '../ChangeTimestampLabel';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';
import styles from './SddChangeHeader.module.css';

export interface SddChangeHeaderProps {
  changeHeaderRef?: React.RefObject<HTMLElement | null>;
  selectedChange: OpenSpecChangeSummary;
  revalidating?: boolean;
  launchTarget?: { taskId?: string | null; instruction?: string } | null;
  nextActionHelpKey?: string | null;
  nextActionHelpParams?: Record<string, string | number>;
}

export function SddChangeHeader({
  changeHeaderRef,
  selectedChange,
  revalidating = false,
  launchTarget = null,
  nextActionHelpKey,
  nextActionHelpParams,
}: SddChangeHeaderProps) {
  const t = useT();

  return (
    <header
      ref={changeHeaderRef}
      className={styles.changeHeader}
      data-revalidating={revalidating || undefined}
      aria-busy={revalidating || undefined}
    >
      <div className={styles.headerIdentity}>
        <div className={styles.changeTitleGroup}>
          <h3>
            {t('pipeline.openspec.change.active')}: <strong>{selectedChange.changeId}</strong>
            <ChangeTimestampLabel labelKey="pipeline.openspec.stamp.created" stamp={selectedChange.createdAt} />
          </h3>
          {!launchTarget && nextActionHelpKey && (
            <p className={styles.nextStepInline}>{t(nextActionHelpKey, nextActionHelpParams)}</p>
          )}
        </div>
      </div>
    </header>
  );
}
