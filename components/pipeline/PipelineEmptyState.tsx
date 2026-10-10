'use client';

import { useT } from '@/hooks/use-translation';
import { Row } from '@/components/ui';
import type { PipelineViewState } from './pipeline-view-state';
import styles from './OpenSpecDashboard.module.css';

export type PipelineEmptyStateProps = {
  state: Exclude<PipelineViewState, { kind: 'ready' }>;
  onRetry: () => void;
  rightOpen?: boolean;
  rightWidth?: number;
};

/**
 * Estados no-`ready` del workspace.
 *
 * Ninguno de estos es un error de la app salvo `error`: un repositorio sin
 * actividad de OpenSpec o con una versión de snapshot desconocida son
 * situaciones normales, y se explican como tales en vez de mostrarse como falla.
 */
export function PipelineEmptyState({
  state,
  onRetry,
  rightOpen = false,
  rightWidth,
}: PipelineEmptyStateProps) {
  const t = useT();

  if (state.kind === 'loading') {
    return (
      <div
        className={styles.skeletonRoot}
        style={{
          ['--right-panel-width' as string]: typeof rightWidth === 'number' ? `${rightWidth}px` : undefined,
        } as React.CSSProperties}
        aria-busy="true"
        aria-label={t('pipeline.loading')}
        data-estado="loading"
      >
        <header className={styles.skeletonHeader} data-skeleton="header">
          <Row gap="2" wrap>
            <div className={styles.skeletonBranchPill} />
            <div className={styles.skeletonBadge} />
            <div className={styles.skeletonBadge} />
            <div className={styles.skeletonBadge} />
            <div className={styles.skeletonBadge} />
          </Row>
          <div className={styles.skeletonButton} />
        </header>

        <div className={styles.skeletonBody}>
          <main className={styles.skeletonCenter} data-skeleton="center">
            <section className={styles.skeletonBlock}>
              <div className={styles.skeletonBlockTitle} />
              <div className={styles.skeletonCard}>
                <div className={styles.skeletonLine} style={{ width: '90%' }} />
                <div className={styles.skeletonLine} style={{ width: '70%' }} />
                <div className={styles.skeletonLine} style={{ width: '82%' }} />
                <div className={styles.skeletonLine} style={{ width: '55%' }} />
              </div>
            </section>

            <section className={styles.skeletonBlock}>
              <div className={styles.skeletonBlockTitle} />
              <div className={styles.skeletonCard}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={styles.skeletonWorkflowRow}>
                    <div className={styles.skeletonWorkflowLabel} />
                    <div className={styles.skeletonWorkflowPill} />
                    <div className={styles.skeletonWorkflowToggle} />
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.skeletonBlock}>
              <div className={styles.skeletonBlockTitle} />
              <div className={styles.skeletonCard}>
                <div className={styles.skeletonLine} style={{ width: '85%' }} />
                <div className={styles.skeletonLine} style={{ width: '65%' }} />
                <div className={styles.skeletonLine} style={{ width: '75%' }} />
              </div>
            </section>
          </main>

          {!rightOpen && (
            <aside
              className={styles.skeletonRail}
              data-skeleton="rail"
            >
              <div className={styles.skeletonRailSection}>
                <div className={styles.skeletonRailTitle} />
                <div className={styles.skeletonRailRow} />
                <div className={styles.skeletonRailRow} />
                <div className={styles.skeletonRailRow} />
              </div>
              <div className={styles.skeletonRailSection}>
                <div className={styles.skeletonRailTitle} />
                <div className={styles.skeletonRailRow} />
                <div className={styles.skeletonRailRow} />
              </div>
              <div className={styles.skeletonRailSection}>
                <div className={styles.skeletonRailTitle} />
                <div className={styles.skeletonRailRow} />
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="pipeline-empty" data-estado="error" role="alert">
        <h3 className="pipeline-empty__title">{t('pipeline.error.title')}</h3>
        <p className="pipeline-empty__body">{t(state.messageKey)}</p>
        {state.canRetry && (
          <button type="button" className="pipeline-empty__retry" onClick={onRetry}>
            {t('pipeline.error.retry')}
          </button>
        )}
      </div>
    );
  }

  if (state.kind === 'incompatible') {
    return (
      <div className="pipeline-empty" data-estado="incompatible">
        <h3 className="pipeline-empty__title">{t('pipeline.incompatible.title')}</h3>
        <p className="pipeline-empty__body">
          {t('pipeline.incompatible.body', {
            version: state.foundVersion ?? t('pipeline.incompatible.unknownVersion'),
          })}
        </p>
      </div>
    );
  }

  const copy = {
    'no-repo': { title: 'pipeline.noRepo.title', body: 'pipeline.noRepo.body' },
    'no-pipeline': { title: 'pipeline.noPipeline.title', body: 'pipeline.noPipeline.body' },
  }[state.kind];

  return (
    <div className="pipeline-empty" data-estado={state.kind}>
      <h3 className="pipeline-empty__title">{t(copy.title)}</h3>
      <p className="pipeline-empty__body">{t(copy.body)}</p>
    </div>
  );
}
