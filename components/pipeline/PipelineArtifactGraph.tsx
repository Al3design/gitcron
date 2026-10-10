'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Check, Circle, Lock, Play, X } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import type {
  OpenSpecArtifactGraphResult,
  OpenSpecArtifactState,
  OpenSpecChangeStatus,
  OpenSpecGraphArtifact,
} from '@/types/pipeline';
import { PipelineRuntimeLauncher } from './PipelineRuntimeLauncher';
import { Row } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

export type DetailTab = 'proposal' | 'design' | 'specs' | 'tasks';

const CANONICAL_ARTIFACTS: DetailTab[] = ['proposal', 'design', 'specs', 'tasks'];

export function shouldShowArtifactGraph(
  status: OpenSpecChangeStatus | null | undefined,
): status is OpenSpecChangeStatus {
  return Boolean(status && status.available && status.artifacts.length > 0);
}

const STATE_LABEL_KEY: Record<string, string> = {
  done: 'pipeline.openspec.graph.state.done',
  ready: 'pipeline.openspec.graph.state.ready',
  blocked: 'pipeline.openspec.graph.state.blocked',
  skipped: 'pipeline.openspec.graph.state.skipped',
  unknown: 'pipeline.openspec.graph.state.unknown',
};

const ARTIFACT_LABEL_KEY: Record<string, string> = {
  proposal: 'pipeline.openspec.graph.artifact.proposal',
  design: 'pipeline.openspec.graph.artifact.design',
  specs: 'pipeline.openspec.graph.artifact.specs',
  tasks: 'pipeline.openspec.graph.artifact.tasks',
};

/**
 * Ordena los artefactos topológicamente por `requires`
 * (un nodo después de los que lo desbloquean; con el mismo nivel, en el orden del motor).
 */
export function sortArtifactsTopologically(artifacts: OpenSpecGraphArtifact[]): OpenSpecGraphArtifact[] {
  const indexMap = new Map<string, number>();
  artifacts.forEach((a, i) => indexMap.set(a.id, i));

  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();

  function getDepth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (visiting.has(id)) return 0; // fallback para dependencias circulares

    visiting.add(id);
    const art = artifacts.find((a) => a.id === id);
    if (!art || !art.requires || art.requires.length === 0) {
      visiting.delete(id);
      depthCache.set(id, 0);
      return 0;
    }

    let maxReqDepth = 0;
    for (const req of art.requires) {
      maxReqDepth = Math.max(maxReqDepth, 1 + getDepth(req));
    }

    visiting.delete(id);
    depthCache.set(id, maxReqDepth);
    return maxReqDepth;
  }

  const depths = new Map<string, number>();
  for (const a of artifacts) {
    depths.set(a.id, getDepth(a.id));
  }

  return [...artifacts].sort((a, b) => {
    const da = depths.get(a.id) ?? 0;
    const db = depths.get(b.id) ?? 0;
    if (da !== db) {
      return da - db;
    }
    return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
  });
}

export interface PipelineArtifactGraphProps {
  repoPath?: string;
  changeId?: string;
  status?: OpenSpecChangeStatus | null;
  initialGraph?: OpenSpecArtifactGraphResult | null;
  activeTab?: DetailTab;
  onSelectTab?: (tab: DetailTab) => void;
  onLaunch?: (instruction: string, changeId: string) => void;
  isArchived?: boolean;
}

export function PipelineArtifactGraph({
  repoPath,
  changeId,
  status,
  initialGraph,
  activeTab,
  onSelectTab,
  onLaunch,
  isArchived,
}: PipelineArtifactGraphProps) {
  const t = useT();

  const shouldFetch =
    !isArchived &&
    !initialGraph &&
    Boolean(
      repoPath &&
        changeId &&
        typeof window !== 'undefined' &&
        window.api?.pipelineOpenSpec?.getArtifactGraph,
    );
  const [fetchedGraph, setFetchedGraph] = useState<OpenSpecArtifactGraphResult | null>(null);
  const [loading, setLoading] = useState<boolean>(shouldFetch);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [confirmingArtifactId, setConfirmingArtifactId] = useState<string | null>(null);
  const [launchingArtifactId, setLaunchingArtifactId] = useState<string | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  const archivedGraph = useMemo<OpenSpecArtifactGraphResult | null>(() => {
    if (!isArchived) return null;
    return {
      ok: true,
      artifacts: CANONICAL_ARTIFACTS.map((id) => ({
        id,
        status: 'done' as OpenSpecArtifactState,
        requires: id === 'proposal' ? [] : ['proposal'],
      })),
    };
  }, [isArchived]);

  const legacyGraph = useMemo<OpenSpecArtifactGraphResult | null>(() => {
    if (status && status.available && status.artifacts.length > 0) {
      return {
        ok: true,
        artifacts: status.artifacts.map((a) => ({
          id: a.id,
          status: a.state,
          requires: a.requires ?? a.missingDeps ?? [],
          dependencies: a.missingDeps?.map((d) => ({
            id: d,
            done: false,
            path: '',
            description: '',
          })),
        })),
      };
    }
    return null;
  }, [status]);

  const graphResult = initialGraph ?? (isArchived ? archivedGraph : fetchedGraph) ?? legacyGraph;
  const error = isArchived ? null : (initialGraph && !initialGraph.ok ? (initialGraph.error ?? 'error') : fetchError);

  useEffect(() => {
    if (!shouldFetch || !repoPath || !changeId) {
      return;
    }

    let isMounted = true;
    window.api!.pipelineOpenSpec
      .getArtifactGraph({ repoPath, changeId })
      .then((res) => {
        if (!isMounted) return;
        setLoading(false);
        if (res.ok) {
          setFetchedGraph(res);
          setFetchError(null);
        } else {
          setFetchError(res.error ?? 'error');
          setFetchedGraph(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setLoading(false);
        setFetchError(err?.message ?? 'error');
        setFetchedGraph(null);
      });

    return () => {
      isMounted = false;
    };
  }, [shouldFetch, repoPath, changeId]);

  const hasCliState = Boolean(
    (graphResult && graphResult.ok && graphResult.artifacts && graphResult.artifacts.length > 0) ||
      shouldShowArtifactGraph(status),
  );

  const sortedArtifacts = useMemo<OpenSpecGraphArtifact[]>(() => {
    if (graphResult?.artifacts && graphResult.artifacts.length > 0) {
      return sortArtifactsTopologically(graphResult.artifacts);
    }
    if (onSelectTab) {
      return CANONICAL_ARTIFACTS.map((id) => ({
        id,
        status: 'unknown' as OpenSpecArtifactState,
        requires: [],
      }));
    }
    return [];
  }, [graphResult, onSelectTab]);

  const selectedId = useMemo(() => {
    if (onSelectTab) {
      const match = sortedArtifacts.find((a) => a.id === activeTab);
      return match ? match.id : sortedArtifacts[0]?.id;
    }
    const match = sortedArtifacts.find((a) => a.id === internalSelectedId);
    return match ? match.id : sortedArtifacts[0]?.id;
  }, [onSelectTab, activeTab, internalSelectedId, sortedArtifacts]);

  const selectedArtifact = useMemo(() => {
    return sortedArtifacts.find((a) => a.id === selectedId) ?? sortedArtifacts[0];
  }, [sortedArtifacts, selectedId]);

  const handleSelectNode = (artifactId: string) => {
    if (onSelectTab) {
      onSelectTab(artifactId as DetailTab);
    } else {
      setInternalSelectedId(artifactId);
    }
  };

  if (!loading && !error && !hasCliState && !onSelectTab) {
    return null;
  }

  if (loading) {
    return (
      <div className={styles.timelineRoot} aria-busy="true" aria-label={t('pipeline.openspec.graph.loading')}>
        <div className={styles.timelineList}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={styles.timelineSkeletonNode}>
              <div className={styles.timelineSkeletonCircle} />
              {n < 4 && <div className={styles.timelineConnector} />}
            </div>
          ))}
        </div>
        <div className={styles.timelineSkeletonCard}>
          <div className={styles.timelineSkeletonBar} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.timelineRoot} role="alert" aria-label={t('pipeline.openspec.graph.label')}>
        <div className={styles.timelineError}>
          {t('pipeline.openspec.graph.error')}: {error}
        </div>
      </div>
    );
  }

  if (sortedArtifacts.length === 0) {
    return null;
  }

  const handleStartGenerate = (artifact: OpenSpecGraphArtifact) => {
    if (artifact.existingOutputPaths && artifact.existingOutputPaths.length > 0) {
      setConfirmingArtifactId(artifact.id);
    } else {
      setConfirmingArtifactId(null);
      if (onLaunch && artifact.instruction && changeId) {
        onLaunch(artifact.instruction, changeId);
      } else {
        setLaunchingArtifactId(artifact.id);
      }
    }
  };

  const handleConfirmGenerate = (artifact: OpenSpecGraphArtifact) => {
    setConfirmingArtifactId(null);
    if (onLaunch && artifact.instruction && changeId) {
      onLaunch(artifact.instruction, changeId);
    } else {
      setLaunchingArtifactId(artifact.id);
    }
  };

  let missingDeps: string[] = [];
  if (selectedArtifact && selectedArtifact.status === 'blocked') {
    if (selectedArtifact.dependencies && selectedArtifact.dependencies.length > 0) {
      missingDeps = selectedArtifact.dependencies.filter((d) => !d.done).map((d) => d.id);
    }
    if (missingDeps.length === 0 && selectedArtifact.requires && selectedArtifact.requires.length > 0) {
      missingDeps = selectedArtifact.requires;
    }
  }

  const isConfirming = confirmingArtifactId === selectedArtifact?.id;
  const isLaunching = launchingArtifactId === selectedArtifact?.id;

  return (
    <div
      className={styles.timelineRoot}
      role={onSelectTab ? 'tablist' : undefined}
      aria-label={onSelectTab ? t('pipeline.details.title') : (hasCliState ? t('pipeline.openspec.graph.label') : undefined)}
    >
      <ul
        className={`${styles.timelineList} pipeline-artifact-graph`}
        aria-label={hasCliState && !onSelectTab ? t('pipeline.openspec.graph.label') : undefined}
      >
        {sortedArtifacts.map((artifact, index) => {
          const labelKey = ARTIFACT_LABEL_KEY[artifact.id];
          const artifactLabel = labelKey ? t(labelKey) : artifact.id;
          const stateKey = STATE_LABEL_KEY[artifact.status] ?? 'pipeline.openspec.graph.state.unknown';
          const stateText = hasCliState ? t(stateKey) : null;
          const isLast = index === sortedArtifacts.length - 1;
          const isSelected = selectedId === artifact.id;

          return (
            <li
              key={artifact.id}
              className={styles.timelineNode}
              data-state={hasCliState ? artifact.status : undefined}
              data-selected={isSelected ? 'true' : undefined}
            >
              <button
                type="button"
                role="tab"
                id={`tab-${artifact.id}`}
                aria-controls={`panel-${artifact.id}`}
                aria-selected={isSelected}
                data-selected={isSelected ? 'true' : undefined}
                className={styles.timelineNodeBtn}
                onClick={() => handleSelectNode(artifact.id)}
              >
                <div
                  className={styles.timelineCircle}
                  aria-hidden="true"
                >
                  {hasCliState && artifact.status === 'done' ? (
                    <Check size={13} />
                  ) : hasCliState && artifact.status === 'ready' ? (
                    <Play size={11} />
                  ) : hasCliState && artifact.status === 'blocked' ? (
                    <Lock size={12} />
                  ) : (
                    <Circle size={10} />
                  )}
                </div>
                <span className={`${styles.timelineTitle} pipeline-artifact-graph__id`}>
                  {artifactLabel}
                </span>
                {stateText && (
                  <span
                    className={`${styles.timelineState} pipeline-artifact-graph__state`}
                    title={stateText}
                  >
                    {stateText}
                  </span>
                )}
              </button>
              {!isLast && <div className={styles.timelineConnector} aria-hidden="true" />}
            </li>
          );
        })}
      </ul>

      {selectedArtifact && (
        <div className={styles.timelineCard}>
          {typeof selectedArtifact.description === 'string' && selectedArtifact.description.length > 0 && (
            <p className={styles.timelineDesc}>{selectedArtifact.description}</p>
          )}

          {typeof selectedArtifact.outputPath === 'string' && selectedArtifact.outputPath.length > 0 && (
            <p className={styles.timelinePath}>{selectedArtifact.outputPath}</p>
          )}

          {hasCliState && selectedArtifact.status === 'blocked' && missingDeps.length > 0 && (
            <p className={`${styles.timelineDeps} pipeline-artifact-graph__deps`}>
              {t('pipeline.openspec.graph.missingDeps', { deps: missingDeps.join(', ') })}
            </p>
          )}

          {hasCliState && selectedArtifact.status === 'ready' && !isConfirming && !isLaunching && (
            <button
              type="button"
              className={styles.timelineActionBtn}
              onClick={() => handleStartGenerate(selectedArtifact)}
            >
              <Play size={12} aria-hidden="true" />
              <span>{t('pipeline.openspec.graph.generateWithAgent')}</span>
            </button>
          )}

          {isConfirming && (
            <div
              className={styles.timelineConfirmBox}
              onClick={(e) => e.stopPropagation()}
            >
              <p className={styles.timelineConfirmText}>
                {t('pipeline.openspec.graph.confirmOverwrite')}
              </p>
              {selectedArtifact.existingOutputPaths && (
                <ul className={styles.timelineConfirmPaths}>
                  {selectedArtifact.existingOutputPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <Row gap="2">
                <button
                  type="button"
                  className={styles.timelineConfirmBtn}
                  onClick={() => handleConfirmGenerate(selectedArtifact)}
                >
                  {t('pipeline.openspec.graph.confirmAndLaunch')}
                </button>
                <button
                  type="button"
                  className={styles.timelineCancelBtn}
                  onClick={() => setConfirmingArtifactId(null)}
                >
                  {t('common.cancel')}
                </button>
              </Row>
            </div>
          )}

          {isLaunching && (
            <div
              className={styles.timelineLauncher}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.timelineLauncherHeader}>
                <button
                  type="button"
                  className={styles.timelineCancelBtn}
                  onClick={() => setLaunchingArtifactId(null)}
                  aria-label={t('common.cancel')}
                >
                  <X size={14} aria-hidden="true" />
                  <span>{t('common.cancel')}</span>
                </button>
              </div>
              <PipelineRuntimeLauncher
                repoPath={repoPath ?? ''}
                projection={null}
                intent="write-artifact"
                initialInstruction={selectedArtifact.instruction}
                changeId={changeId}
                onStarted={() => setLaunchingArtifactId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
