'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import type {
  OpenSpecCliProvenance,
  OpenSpecEngineStatus,
  OpenSpecInstallPlan,
  OpenSpecInstallResult,
  OpenSpecRunUpdateResult,
  OpenSpecUpdatePlan,
} from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { assessOpenSpecEngineTargetVersion } from './pipeline-domain';
import { OpenSpecGlobalInstallPrompt } from './OpenSpecGlobalInstallConfirm';
import { getUpdateBlockReasonKey } from '@/lib/openspec-update-guide';
import { Row } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

function formatMismatchMessage(
  assessment: ReturnType<typeof assessOpenSpecEngineTargetVersion>,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const provenanceText =
    assessment.provenance === 'local'
      ? t('pipeline.openspec.engine.summary.provenanceLocal')
      : assessment.provenance === 'global'
      ? t('pipeline.openspec.engine.summary.provenanceGlobal')
      : t('pipeline.openspec.engine.summary.provenanceUnknown');
  return t('pipeline.openspec.engine.summary.versionMismatch', {
    requested: assessment.requested ?? '',
    responded: assessment.responded ?? '',
    provenance: provenanceText,
  });
}

export interface OpenSpecUpdateRunnerProps {
  repoPath: string;
  engine: {
    installed: string | null;
    latest: string;
    provenance: OpenSpecCliProvenance;
  } | null;
  integration: boolean;
  repoInitialized?: boolean;
  repoState?: OpenSpecEngineStatus['repoState'] | null;
  updatePlan?: OpenSpecUpdatePlan | null;
  openRepoPaths?: string[];
  warnings?: { mainBranch?: string | null; dirtyCount?: number | null };
  disabledReason?: string | null;
  isLoading?: boolean;
  pendingTools?: string[];
  onInitialize?: () => void;
  onConfigurePendingTools?: () => void;
  onEngineInstalled?: (result: OpenSpecInstallResult) => void;
  onIntegrationUpdated?: (result: OpenSpecRunUpdateResult) => void;
}

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

interface EngineStepState {
  status: StepStatus;
  error?: string | null;
  reasons?: string[];
  installedVersion?: string;
  canRollback?: boolean;
}

interface IntegrationStepState {
  status: StepStatus;
  error?: string | null;
  filesCount?: number;
  stoppedAfterEngine?: boolean;
  stoppedReason?: 'mismatch' | 'broken' | null;
  incomplete?: boolean;
  incompleteReason?: string | null;
  unverified?: boolean;
}

export const OpenSpecUpdateRunner: React.FC<OpenSpecUpdateRunnerProps> = ({
  repoPath,
  engine,
  integration,
  repoInitialized,
  repoState,
  updatePlan,
  openRepoPaths,
  warnings,
  disabledReason,
  isLoading,
  pendingTools,
  onInitialize,
  onConfigurePendingTools,
  onEngineInstalled,
  onIntegrationUpdated,
}) => {
  const t = useT();
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [showWarningConfirm, setShowWarningConfirm] = useState(false);
  const [showGlobalConfirm, setShowGlobalConfirm] = useState(false);
  const [fetchedInstallPlan, setFetchedInstallPlan] = useState<OpenSpecInstallPlan | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [ranEngine, setRanEngine] = useState<{
    installed: string | null;
    latest: string;
    provenance: OpenSpecCliProvenance;
  } | null>(null);
  const [ranIntegration, setRanIntegration] = useState(false);

  const effectiveInstallPlan = fetchedInstallPlan;

  useEffect(() => {
    let cancelled = false;
    if (
      engine?.provenance === 'global' &&
      typeof window !== 'undefined' &&
      window.api?.pipelineOpenSpec?.getInstallPlan
    ) {
      window.api.pipelineOpenSpec
        .getInstallPlan({ repoPath, targetVersion: engine.latest })
        .then((plan) => {
          if (!cancelled) {
            setFetchedInstallPlan(plan ?? null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFetchedInstallPlan(null);
          }
        });
    } else {
      setFetchedInstallPlan(null);
    }
    return () => {
      cancelled = true;
    };
  }, [engine?.provenance, engine?.latest, repoPath]);

  const isRepoInitialized = typeof repoInitialized === 'boolean'
    ? repoInitialized
    : repoState
    ? repoState === 'initialized'
    : undefined;

  const plannedIntegration = isRepoInitialized === false
    ? false
    : (engine && isRepoInitialized === true)
    ? true
    : integration;

  const effectiveEngine = engine ?? ranEngine;
  const effectiveIntegration = plannedIntegration || ranIntegration;

  const [engineStep, setEngineStep] = useState<EngineStepState>({
    status: 'pending',
  });
  const [integrationStep, setIntegrationStep] = useState<IntegrationStepState>({
    status: 'pending',
  });

  const hasMainWarning = Boolean(warnings?.mainBranch);
  const hasDirtyWarning = typeof warnings?.dirtyCount === 'number' && warnings.dirtyCount > 0;
  const hasWarnings = plannedIntegration && (hasMainWarning || hasDirtyWarning);

  const isEngineUnavailable = Boolean(
    engine && (engine.provenance === 'managed' || engine.provenance === 'unknown')
  );
  const effectiveDisabledReason = disabledReason || (
    isEngineUnavailable
      ? engine?.provenance === 'managed'
        ? t('pipeline.openspec.engine.summary.stepEngineUnavailableManaged')
        : t('pipeline.openspec.engine.summary.stepEngineUnavailableUnknown')
      : null
  );

  const handleInitialize = async () => {
    if (!onInitialize || isInitializing) return;
    setIsInitializing(true);
    try {
      await Promise.resolve(onInitialize());
    } finally {
      setIsInitializing(false);
    }
  };

  const handleConfigurePending = async () => {
    if (!onConfigurePendingTools || isConfiguring) return;
    setIsConfiguring(true);
    try {
      await Promise.resolve(onConfigurePendingTools());
    } finally {
      setIsConfiguring(false);
    }
  };

  if (isLoading) {
    return (
      <Row gap="2" wrap>
        <button
          type="button"
          className={styles.primaryAction}
          disabled
        >
          {t('pipeline.openspec.engine.reading')}
        </button>
      </Row>
    );
  }

  if (!hasRun && !engine && (isRepoInitialized === false || repoState === 'not-initialized')) {
    return (
      <Row gap="2" wrap>
        <button
          type="button"
          className={styles.primaryAction}
          disabled={Boolean(effectiveDisabledReason) || isRunning || isInitializing}
          onClick={handleInitialize}
        >
          {isInitializing ? (
            <>
              <Loader2 size={13} className={styles.spin} aria-hidden="true" />
              <span>{t('pipeline.openspec.rail.initBusy')}</span>
            </>
          ) : (
            t('pipeline.openspec.rail.init')
          )}
        </button>
        {effectiveDisabledReason && (
          <span className={styles.blockedReasonInline} role="alert">
            {effectiveDisabledReason}
          </span>
        )}
      </Row>
    );
  }

  if (!hasRun && !engine && pendingTools && pendingTools.length > 0) {
    return (
      <Row gap="2" wrap>
        <button
          type="button"
          className={styles.primaryAction}
          disabled={Boolean(effectiveDisabledReason) || isRunning || isConfiguring}
          onClick={handleConfigurePending}
        >
          {isConfiguring ? (
            <>
              <Loader2 size={13} className={styles.spin} aria-hidden="true" />
              <span>{t('pipeline.openspec.rail.initBusy')}</span>
            </>
          ) : (
            t('pipeline.openspec.engine.configureActionEllipsis')
          )}
        </button>
        {effectiveDisabledReason && (
          <span className={styles.blockedReasonInline} role="alert">
            {effectiveDisabledReason}
          </span>
        )}
      </Row>
    );
  }

  // a) Si !hasRun && !engine && !plannedIntegration && !effectiveDisabledReason
  if (!hasRun && !engine && !plannedIntegration && !effectiveDisabledReason) {
    return (
      <Row gap="2" wrap>
        <button
          type="button"
          className={styles.primaryAction}
          disabled
        >
          {t('pipeline.openspec.engine.summary.allUpToDate')}
        </button>
      </Row>
    );
  }

  // Plan line text
  const stepDescriptions: string[] = [];
  if (engine && !isEngineUnavailable) {
    stepDescriptions.push(
      engine.provenance === 'local'
        ? t('pipeline.openspec.engine.summary.stepEngineLocal', { latest: engine.latest })
        : t('pipeline.openspec.engine.summary.stepEngine', { latest: engine.latest })
    );
  }
  if (plannedIntegration && !isEngineUnavailable) {
    stepDescriptions.push(
      t('pipeline.openspec.engine.summary.stepIntegration')
    );
  }
  const planLineText = stepDescriptions.length > 0
    ? t('pipeline.openspec.engine.summary.planLine', { steps: stepDescriptions.join(' · ') })
    : null;

  const executeSequentialUpdate = async () => {
    if (effectiveDisabledReason) return;
    setIsRunning(true);
    setHasRun(true);
    setRanEngine(engine);
    setRanIntegration(plannedIntegration);

    let engineSuccess = true;
    let engineRanAndDone = false;
    let engineResVersion: string | null = null;
    let integrationRanAndDone = false;

    if (engine) {
      setEngineStep({ status: 'running' });
      if (plannedIntegration) {
        setIntegrationStep({ status: 'pending' });
      }

      try {
        const installFn = engine.provenance === 'local'
          ? window.api?.pipelineOpenSpec?.installLocal
          : window.api?.pipelineOpenSpec?.installGlobal;
        if (!installFn) {
          throw new Error(t('pipeline.openspec.engine.install.error.installFailed'));
        }

        const installResult = await installFn({
          repoPath,
          targetVersion: engine.latest,
        });

        if (!installResult.success) {
          setEngineStep({
            status: 'failed',
            error: installResult.error || t('pipeline.openspec.engine.install.error.installFailed'),
            canRollback: false,
          });
          if (plannedIntegration) {
            setIntegrationStep({
              status: 'failed',
              stoppedAfterEngine: true,
              stoppedReason: 'broken',
            });
          }
          setIsRunning(false);
          // notifyEngineChanged() NO
          return;
        }

        onEngineInstalled?.(installResult);
        const assessment = assessOpenSpecEngineTargetVersion(
          installResult.engineStatus,
          engine.latest
        );
        const runtimeVer = installResult.engineStatus?.cli?.runtimeVersion ?? null;
        engineResVersion = runtimeVer ?? engine.latest;

        if (assessment.verdict === 'ok') {
          engineRanAndDone = true;
          setEngineStep({
            status: 'done',
            installedVersion: engineResVersion,
          });
        } else if (assessment.verdict === 'version-mismatch') {
          engineSuccess = false;
          const mismatchMsg = formatMismatchMessage(assessment, t);
          setEngineStep({
            status: 'failed',
            error: mismatchMsg,
            installedVersion: engineResVersion,
            canRollback: engine.installed !== null,
          });
          if (plannedIntegration) {
            setIntegrationStep({
              status: 'failed',
              stoppedAfterEngine: true,
              stoppedReason: 'mismatch',
            });
          }
          setIsRunning(false);
          usePipelineStore.getState().notifyEngineChanged();
          return;
        } else if (assessment.verdict === 'broken') {
          engineSuccess = false;
          const reasons = assessment.reasonKeys.map((k) => t(k));
          setEngineStep({
            status: 'failed',
            reasons,
            installedVersion: engineResVersion,
            canRollback: engine.installed !== null,
          });
          if (plannedIntegration) {
            setIntegrationStep({
              status: 'failed',
              stoppedAfterEngine: true,
              stoppedReason: 'broken',
            });
          }
          setIsRunning(false);
          usePipelineStore.getState().notifyEngineChanged();
          return;
        } else {
          engineSuccess = false;
          setEngineStep({
            status: 'failed',
            error: t('pipeline.openspec.engine.afterInstall.unverified'),
            installedVersion: engineResVersion,
            canRollback: engine.installed !== null,
          });
          if (plannedIntegration) {
            setIntegrationStep({
              status: 'failed',
              stoppedAfterEngine: true,
              stoppedReason: 'broken',
            });
          }
          setIsRunning(false);
          usePipelineStore.getState().notifyEngineChanged();
          return;
        }
      } catch (err: unknown) {
        setEngineStep({
          status: 'failed',
          error: (err as Error)?.message || t('pipeline.openspec.engine.install.error.installFailed'),
          canRollback: false,
        });
        if (plannedIntegration) {
          setIntegrationStep({
            status: 'failed',
            stoppedAfterEngine: true,
            stoppedReason: 'broken',
          });
        }
        setIsRunning(false);
        return;
      }
    }

    if (plannedIntegration && engineSuccess) {
      setIntegrationStep({ status: 'running' });
      try {
        const updateResult = await window.api.pipelineOpenSpec.runUpdate(
          repoPath,
          undefined,
          false
        );
        if (updateResult.success) {
          const hasEngineStatus = Boolean(updateResult.engineStatus);
          const isUpToDate = hasEngineStatus && updateResult.engineStatus!.integrationState === 'up-to-date';
          onIntegrationUpdated?.(updateResult);
          if (isUpToDate) {
            integrationRanAndDone = true;
            setIntegrationStep({
              status: 'done',
              filesCount: updateResult.filesUpdated?.length ?? 0,
            });
          } else {
            integrationRanAndDone = false;
            const incompleteReason = hasEngineStatus
              ? t(getUpdateBlockReasonKey(updateResult.engineStatus))
              : null;
            setIntegrationStep({
              status: 'failed',
              incomplete: true,
              unverified: !hasEngineStatus,
              filesCount: updateResult.filesUpdated?.length ?? 0,
              incompleteReason,
            });
          }
        } else {
          const staleCodes = updateResult.errors?.filter((e) => e.endsWith('-changed')) ?? [];
          const errMsg = staleCodes.length > 0
            ? `${t('pipeline.openspec.engine.summary.planStale')} (${staleCodes.join(', ')})`
            : updateResult.errors && updateResult.errors.length > 0
            ? updateResult.errors.join(' · ')
            : (updateResult.message || t('pipeline.openspec.engine.review.errorGeneric'));
          setIntegrationStep({
            status: 'failed',
            error: errMsg,
          });
        }
      } catch (err: unknown) {
        setIntegrationStep({
          status: 'failed',
          error: (err as Error)?.message || t('pipeline.openspec.engine.review.errorGeneric'),
        });
      }
    }

    setIsRunning(false);

    // Toast global si todos los pasos que corrieron terminaron 'done'
    const allDone =
      (!engine || engineRanAndDone) &&
      (!plannedIntegration || integrationRanAndDone);
    if (allDone && (engineRanAndDone || integrationRanAndDone)) {
      const doneParts: string[] = [];
      if (engine && engineRanAndDone) {
        doneParts.push(
          t('pipeline.openspec.engine.summary.doneEngine', {
            version: engineResVersion ?? engine.latest,
          })
        );
      }
      if (plannedIntegration && integrationRanAndDone) {
        doneParts.push(t('pipeline.openspec.engine.summary.doneIntegration'));
      }
      if (doneParts.length > 0) {
        const summary = doneParts.join(' · ');
        useGitStore.getState().setSuccess(
          t('pipeline.openspec.engine.summary.toastDone', { summary })
        );
      }
    }

    usePipelineStore.getState().notifyEngineChanged();
  };

  const handleStart = () => {
    if (effectiveDisabledReason || isRunning || isRollingBack) return;
    if (hasWarnings && !showWarningConfirm) {
      setShowWarningConfirm(true);
      return;
    }
    if (effectiveEngine?.provenance === 'global' && !showGlobalConfirm) {
      setShowGlobalConfirm(true);
      return;
    }
    void executeSequentialUpdate();
  };

  const handleConfirmWarningsAndRun = () => {
    setShowWarningConfirm(false);
    if (effectiveEngine?.provenance === 'global') {
      setShowGlobalConfirm(true);
      return;
    }
    void executeSequentialUpdate();
  };

  const handleConfirmGlobalAndRun = () => {
    setShowGlobalConfirm(false);
    void executeSequentialUpdate();
  };

  const handleCancelGlobal = () => {
    setShowGlobalConfirm(false);
  };

  const handleRollback = async () => {
    if (!ranEngine?.installed || isRollingBack) return;
    setIsRollingBack(true);
    try {
      const rollbackFn = ranEngine.provenance === 'local'
        ? window.api?.pipelineOpenSpec?.installLocal
        : window.api?.pipelineOpenSpec?.installGlobal;
      if (!rollbackFn) {
        throw new Error(t('pipeline.openspec.engine.install.error.installFailed'));
      }
      const rollbackResult = await rollbackFn({
        repoPath,
        targetVersion: ranEngine.installed,
      });

      if (!rollbackResult.success) {
        setEngineStep((prev) => ({
          ...prev,
          error: rollbackResult.error || t('pipeline.openspec.engine.install.error.installFailed'),
        }));
        return;
      }

      const assessment = assessOpenSpecEngineTargetVersion(
        rollbackResult.engineStatus,
        ranEngine.installed
      );

      if (assessment.verdict === 'ok') {
        const rollbackVer =
          rollbackResult.engineStatus?.cli?.runtimeVersion ?? ranEngine.installed;
        setEngineStep({
          status: 'done',
          installedVersion: rollbackVer,
          canRollback: false,
        });
        usePipelineStore.getState().notifyEngineChanged();
      } else if (assessment.verdict === 'version-mismatch') {
        const mismatchMsg = formatMismatchMessage(assessment, t);
        setEngineStep((prev) => ({
          ...prev,
          error: mismatchMsg,
        }));
      } else if (assessment.verdict === 'broken') {
        const reasons = assessment.reasonKeys.map((k) => t(k));
        setEngineStep((prev) => ({
          ...prev,
          reasons,
          error:
            reasons.length > 0
              ? reasons.join(' · ')
              : t('pipeline.openspec.engine.install.error.installFailed'),
        }));
      } else {
        setEngineStep((prev) => ({
          ...prev,
          error: t('pipeline.openspec.engine.afterInstall.unverified'),
        }));
      }
    } catch (err: unknown) {
      setEngineStep((prev) => ({
        ...prev,
        error: (err as Error)?.message || t('pipeline.openspec.engine.install.error.installFailed'),
      }));
    } finally {
      setIsRollingBack(false);
    }
  };

  const renderStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'running':
        return <Loader2 size={14} className={styles.spin} aria-hidden="true" />;
      case 'done':
        return <CheckCircle2 size={14} aria-hidden="true" />;
      case 'failed':
        return <AlertTriangle size={14} aria-hidden="true" />;
      case 'pending':
      default:
        return <Circle size={14} aria-hidden="true" />;
    }
  };

  const renderBanner = () => {
    if (!hasRun || isRunning) return null;

    const anyFailed =
      (effectiveEngine && engineStep.status === 'failed') ||
      (effectiveIntegration && integrationStep.status === 'failed' && !integrationStep.incomplete);

    if (anyFailed) {
      return (
        <div className={styles.reviewSafetyBanner} role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t('pipeline.openspec.engine.summary.resultFailed')}</span>
        </div>
      );
    }

    const allDone =
      (!effectiveEngine || engineStep.status === 'done') &&
      (!effectiveIntegration || integrationStep.status === 'done');

    if (allDone) {
      const doneParts: string[] = [];
      if (effectiveEngine && engineStep.status === 'done') {
        doneParts.push(
          t('pipeline.openspec.engine.summary.doneEngine', {
            version: engineStep.installedVersion ?? effectiveEngine.latest,
          })
        );
      }
      if (effectiveIntegration && integrationStep.status === 'done') {
        doneParts.push(t('pipeline.openspec.engine.summary.doneIntegration'));
      }
      if (doneParts.length > 0) {
        return (
          <div className={styles.reviewSafetyBanner} role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              {t('pipeline.openspec.engine.summary.resultDone', {
                summary: doneParts.join(' · '),
              })}
            </span>
          </div>
        );
      }
    }

    if (effectiveEngine && engineStep.status === 'done') {
      return (
        <div className={styles.reviewSafetyBanner} role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>
            {t('pipeline.openspec.engine.summary.resultDone', {
              summary: t('pipeline.openspec.engine.summary.doneEngine', {
                version: engineStep.installedVersion ?? effectiveEngine.latest,
              }),
            })}
          </span>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {showWarningConfirm ? (
        <div
          className={styles.reviewWarningConfirmBox}
          role="region"
          aria-label={t('pipeline.openspec.engine.summary.updateAll')}
        >
          {hasMainWarning && (
            <p className={styles.reviewWarningConfirmText}>
              {t('pipeline.openspec.engine.review.confirmMain', {
                branch: warnings?.mainBranch ?? 'main',
              })}
            </p>
          )}
          {hasDirtyWarning && (
            <p className={styles.reviewWarningConfirmText}>
              {t('pipeline.openspec.engine.review.confirmDirty', {
                count: warnings?.dirtyCount ?? 1,
              })}
            </p>
          )}
          <div className={styles.reviewWarningConfirmActions}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={handleConfirmWarningsAndRun}
              disabled={isRunning}
            >
              {t('pipeline.openspec.engine.review.updateAnyway')}
            </button>
            <button
              type="button"
              className={styles.reviewCopyBtn}
              onClick={() => setShowWarningConfirm(false)}
              disabled={isRunning}
            >
              {t('pipeline.openspec.engine.review.cancel')}
            </button>
          </div>
        </div>
      ) : showGlobalConfirm ? (
        <OpenSpecGlobalInstallPrompt
          command={effectiveInstallPlan?.globalCommand}
          nodePath={effectiveInstallPlan?.nodePath}
          packageManagerPath={effectiveInstallPlan?.packageManagerPath}
          packageManagerName={effectiveInstallPlan?.detectedManager}
          openRepoPaths={openRepoPaths}
          disabled={isRunning}
          isInstalling={isRunning}
          onConfirm={handleConfirmGlobalAndRun}
          onCancel={handleCancelGlobal}
        />
      ) : (
        <Row gap="2" wrap>
          <button
            type="button"
            className={styles.primaryAction}
            disabled={Boolean(effectiveDisabledReason) || isRunning || isRollingBack}
            onClick={handleStart}
          >
            {isRunning ? (
              <>
                <Loader2 size={13} className={styles.spin} aria-hidden="true" />
                <span>{t('pipeline.openspec.engine.review.updating')}</span>
              </>
            ) : (
              t('pipeline.openspec.engine.summary.updateAll')
            )}
          </button>
          {effectiveDisabledReason && (
            <span className={styles.blockedReasonInline} role="alert">
              {effectiveDisabledReason}
            </span>
          )}
        </Row>
      )}

      {planLineText && !hasRun && !showWarningConfirm && !showGlobalConfirm && (
        <p className={styles.reviewWarningConfirmText}>
          {planLineText}
        </p>
      )}

      {hasRun && (
        <ol
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {effectiveEngine && (
            <li style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {renderStepIcon(engineStep.status)}
                <span className={styles.reviewFactValue}>
                  {t('pipeline.openspec.engine.summary.rowEngine', {
                    installed: effectiveEngine.installed ?? '?',
                    latest: effectiveEngine.latest,
                  })}
                </span>
              </div>
              {engineStep.status === 'done' && (
                <div
                  role="status"
                  className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackSuccess}`}
                >
                  <CheckCircle2 size={14} aria-hidden="true" />
                  <span>
                    {t('pipeline.openspec.engine.afterInstall.ok', {
                      version: engineStep.installedVersion ?? effectiveEngine.latest,
                    })}
                  </span>
                </div>
              )}
              {engineStep.status === 'failed' && (
                <>
                  {engineStep.reasons && engineStep.reasons.length > 0 ? (
                    <div
                      role="alert"
                      className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                    >
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>
                        {t('pipeline.openspec.engine.afterInstall.broken', {
                          version: engineStep.installedVersion ?? effectiveEngine.latest,
                          reasons: engineStep.reasons.join(' · '),
                        })}
                      </span>
                    </div>
                  ) : (
                    <div
                      role="alert"
                      className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                    >
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>
                        {engineStep.error || t('pipeline.openspec.engine.install.error.installFailed')}
                      </span>
                    </div>
                  )}
                  {engineStep.canRollback && ranEngine?.installed && (
                    <div className={styles.engineInstallConfirmActions}>
                      <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={handleRollback}
                        disabled={isRollingBack}
                      >
                        {isRollingBack ? (
                          <>
                            <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                            <span>
                              {t('pipeline.openspec.engine.afterInstall.rollingBack', {
                                version: ranEngine.installed,
                              })}
                            </span>
                          </>
                        ) : (
                          t('pipeline.openspec.engine.afterInstall.rollback', {
                            version: ranEngine.installed,
                          })
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          )}

          {effectiveIntegration && (
            <li style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {renderStepIcon(integrationStep.status)}
                <span className={styles.reviewFactValue}>
                  {t('pipeline.openspec.engine.summary.stepIntegration')}
                </span>
              </div>
              {integrationStep.status === 'done' && (
                <div
                  role="status"
                  className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackSuccess}`}
                >
                  <CheckCircle2 size={14} aria-hidden="true" />
                  <span>
                    {t('pipeline.openspec.engine.review.completedTitle')} ·{' '}
                    {t('pipeline.openspec.engine.review.filesUpdatedSummary', {
                      count: integrationStep.filesCount ?? 0,
                    })}
                  </span>
                </div>
              )}
              {integrationStep.stoppedAfterEngine && (
                <div
                  role="alert"
                  className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    {integrationStep.stoppedReason === 'mismatch'
                      ? t('pipeline.openspec.engine.summary.stoppedAfterMismatch')
                      : t('pipeline.openspec.engine.summary.stoppedAfterEngine')}
                  </span>
                </div>
              )}
              {integrationStep.incomplete && (
                <div
                  role="status"
                  className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    {integrationStep.unverified
                      ? t('pipeline.openspec.engine.summary.integrationUnverified', {
                          count: integrationStep.filesCount ?? 0,
                        })
                      : t('pipeline.openspec.engine.summary.integrationNotUpToDate', {
                          count: integrationStep.filesCount ?? 0,
                          reason: integrationStep.incompleteReason ?? t('pipeline.openspec.engine.matrix.blockedUnclassified'),
                        })}
                  </span>
                </div>
              )}
              {integrationStep.status === 'failed' && !integrationStep.stoppedAfterEngine && !integrationStep.incomplete && (
                <div
                  role="alert"
                  className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{integrationStep.error}</span>
                </div>
              )}
            </li>
          )}
        </ol>
      )}

      {renderBanner()}
    </div>
  );
};
