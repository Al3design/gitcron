import { useState, useEffect, useMemo } from 'react';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { readEngineStatus } from '@/lib/engine-status-reader';
import { useT } from '@/hooks/use-translation';
import type {
  OpenSpecEngineStatus,
  OpenSpecRegistryCheck,
  OpenSpecInstallPlan,
} from '@/types/pipeline';

export interface UseEngineStatusOptions {
  repoPath: string;
  propEngineStatus?: OpenSpecEngineStatus | null;
  propEngineLoading?: boolean;
}

export interface UseEngineStatusResult {
  effectiveEngineStatus: OpenSpecEngineStatus | null;
  effectiveEngineLoading: boolean;
  attentionReasons: string[];
  attentionReasonSeparator: string;
  installPlan: OpenSpecInstallPlan | null;
}

export function useEngineStatus({
  repoPath,
  propEngineStatus,
  propEngineLoading,
}: UseEngineStatusOptions): UseEngineStatusResult {
  const t = useT();
  const uiLanguage = useGitStore((state) => state.language);
  const engineChangeToken = usePipelineStore((state) => state.engineChangeToken);

  const [engineSnapshot, setEngineSnapshot] = useState<OpenSpecEngineStatus | null>(null);
  const [latestRegistryCheck, setLatestRegistryCheck] = useState<OpenSpecRegistryCheck | null>(null);
  const [engineLoading, setEngineLoading] = useState<boolean>(true);
  const [installPlan, setInstallPlan] = useState<OpenSpecInstallPlan | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let isMounted = true;
    setEngineSnapshot(null);
    setLatestRegistryCheck(null);
    setInstallPlan(null);
    setEngineLoading(true);

    if (typeof window !== 'undefined' && window.api?.pipelineOpenSpec) {
      readEngineStatus(repoPath, (snapshot) => {
        if (isMounted) {
          setEngineSnapshot(snapshot);
          setEngineLoading(false);
        }
      }).catch(() => {
        if (isMounted) {
          setEngineSnapshot(null);
          setEngineLoading(false);
        }
      });

      const getCheck = window.api.pipelineOpenSpec.checkLatestVersion
        ? window.api.pipelineOpenSpec.checkLatestVersion()
        : Promise.resolve(null);
      const getPlan = window.api.pipelineOpenSpec.getInstallPlan
        ? window.api.pipelineOpenSpec.getInstallPlan(repoPath)
        : Promise.resolve(null);

      getCheck
        .then((check) => {
          if (isMounted && check) {
            setLatestRegistryCheck(check);
          }
        })
        .catch(() => {});

      getPlan
        .then((plan) => {
          if (isMounted && plan) {
            setInstallPlan(plan);
          }
        })
        .catch(() => {});
    } else {
      setEngineLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [repoPath, engineChangeToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const effectiveEngineStatus = useMemo<OpenSpecEngineStatus | null>(() => {
    if (propEngineStatus !== undefined) return propEngineStatus;
    if (!engineSnapshot) return null;
    if (!latestRegistryCheck) return engineSnapshot;
    return {
      ...engineSnapshot,
      latestAvailable: latestRegistryCheck,
    };
  }, [propEngineStatus, engineSnapshot, latestRegistryCheck]);

  const effectiveEngineLoading = propEngineLoading !== undefined ? propEngineLoading : engineLoading;

  const attentionReasonSeparator = uiLanguage === 'en' ? ' and ' : uiLanguage === 'zh' ? '，' : ' y ';
  const attentionReasons = useMemo(() => {
    if (!effectiveEngineStatus) return [];
    return [
      ...(effectiveEngineStatus.integrationState === 'outdated'
        ? [t('pipeline.openspec.engine.attentionReason.outdated')]
        : []),
      ...(effectiveEngineStatus.repoState === 'not-initialized'
        ? [t('pipeline.openspec.engine.attentionReason.notInitialized')]
        : []),
      ...(effectiveEngineStatus.divergence?.isDivergent
        ? [t('pipeline.openspec.engine.attentionReason.divergent')]
        : []),
    ];
  }, [effectiveEngineStatus, t]);

  return {
    effectiveEngineStatus,
    effectiveEngineLoading,
    attentionReasons,
    attentionReasonSeparator,
    installPlan,
  };
}
