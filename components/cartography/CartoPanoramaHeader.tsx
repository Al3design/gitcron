'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Blocks, Loader2, Sparkles } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { buildCartoPanorama } from '@/lib/carto-panorama';
import type { CartoGraph, CartoGraphStatus } from '@/lib/carto-types';
import { cn } from '@/lib/utils';
import { AiUseLine } from '../ai/AiUseLine';
import { AiSentDetails } from '../ai/AiSentDetails';
import styles from './CartoPanoramaHeader.module.css';

type CartoPanoramaHeaderProps = {
  repoPath: string | null;
  status: CartoGraphStatus | null;
  refreshKey: number;
  aiEnabled?: boolean;
};

type GraphFetchState = {
  key: string;
  graph: CartoGraph | null;
  error: string | null;
  loading: boolean;
};

export function CartoPanoramaHeader({ repoPath, status, refreshKey, aiEnabled: propAiEnabled }: CartoPanoramaHeaderProps) {
  const t = useT();
  const [internalAiEnabled, setInternalAiEnabled] = useState(false);

  useEffect(() => {
    if (propAiEnabled !== undefined) return;
    let active = true;
    window.api?.cartoAi?.getSettings?.()
      .then((s) => {
        if (active && s?.success && s.data) setInternalAiEnabled(Boolean(s.data.enabled));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [propAiEnabled]);

  const aiEnabled = propAiEnabled ?? internalAiEnabled;
  const fetchKey = `${repoPath ?? ''}:${refreshKey}:${status?.state ?? ''}`;
  const shouldFetch = Boolean(repoPath && status?.state === 'ready');

  const [state, setState] = useState<GraphFetchState>({
    key: '',
    graph: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!repoPath || status?.state !== 'ready') return;

    let active = true;
    void window.api.cartoGraph
      .snapshot(repoPath)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          setState({ key: fetchKey, graph: res.data, error: null, loading: false });
        } else {
          setState({ key: fetchKey, graph: null, error: res.error ?? t('cartography.graph.error'), loading: false });
        }
      })
      .catch((err) => {
        if (!active) return;
        setState({
          key: fetchKey,
          graph: null,
          error: err instanceof Error ? err.message : t('cartography.graph.error'),
          loading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [fetchKey, repoPath, status?.state, t]);

  const graph = shouldFetch && state.key === fetchKey ? state.graph : null;
  const loading = shouldFetch ? (state.key === fetchKey ? state.loading : true) : false;
  const error = shouldFetch && state.key === fetchKey ? state.error : null;

  const panorama = useMemo(() => (graph ? buildCartoPanorama(graph) : null), [graph]);

  if (!repoPath) return null;

  return (
    <details className={styles.container}>
      <summary className={styles.summary}>
        <span className={cn(styles.summaryLabel, aiEnabled && styles.summaryLabelAi)}>
          <Sparkles size={14} />
          {t('cartography.panorama.summary')}
        </span>
        {panorama ? (
          <span className={styles.summaryStats}>
            {t('cartography.panorama.structure', { hash: panorama.structureHash })}
            {' · '}
            {t('cartography.panorama.deterministicStats', {
              groups: panorama.groups.length,
              edges: panorama.links.length,
            })}
          </span>
        ) : null}
      </summary>
      <section className={cn(styles.section, aiEnabled ? 'ai-surface ai-panel' : styles.sectionDefault)}>
        {aiEnabled && (
          <div className={styles.aiHeader}>
            <AiUseLine use="gitcron-cartography" repoPath={repoPath} />
            <AiSentDetails use="gitcron-cartography" busy={loading} />
          </div>
        )}
        {status?.state === 'engine-unavailable' ? (
          <HeaderHint icon={<AlertTriangle size={16} />} text={t('cartography.graph.engineUnavailable')} />
        ) : status?.state === 'indexing' || status?.state === 'idle' ? (
          <HeaderHint icon={<Loader2 size={16} className={styles.spinner} />} text={t('cartography.graph.indexing')} />
        ) : loading ? (
          <HeaderHint
            icon={<Loader2 size={16} className={cn(styles.spinner, aiEnabled && styles.hintIconAi)} />}
            text={
              aiEnabled ? (
                <span>
                  <span className="ai-thinking-text">{t('cartography.panorama.loading')}</span>
                </span>
              ) : (
                t('cartography.panorama.loading')
              )
            }
          />
        ) : error ? (
          <HeaderHint icon={<AlertTriangle size={16} />} text={error} tone="error" />
        ) : panorama ? (
          <>
            <p className={styles.mapReadyText}>
              {t('cartography.panorama.mapReady')}
            </p>
            <div className={styles.statsRow}>
              <span>{t('cartography.panorama.structure', { hash: panorama.structureHash })}</span>
              <span className={styles.statsBadge}>
                <Blocks size={10} />
                {t('cartography.panorama.deterministicStats', {
                  groups: panorama.groups.length,
                  edges: panorama.links.length,
                })}
              </span>
            </div>
          </>
        ) : (
          <HeaderHint icon={<Blocks size={16} />} text={t('cartography.semantic.empty')} />
        )}
      </section>
    </details>
  );
}

function HeaderHint({
  icon,
  text,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  text: React.ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <div className={cn(styles.hint, tone === 'error' && styles.hintError)}>
      <span className={cn(styles.hintIcon, tone === 'error' && styles.hintIconError)}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
