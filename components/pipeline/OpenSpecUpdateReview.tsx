'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import type {
  OpenSpecEngineStatus,
  OpenSpecInstallPlan,
  OpenSpecLegacySkillsPlan,
  OpenSpecRemoveLegacySkillsResult,
  OpenSpecRunUpdateResult,
  OpenSpecUpdatePlan,
} from '@/types/pipeline';
import {
  classifyCoexistenceSkills,
  deriveOfficialCommand,
  deriveUpdateBlockReason,
  deriveUpdateMatrixAction,
  getUpdateBlockReasonKey,
} from '@/lib/openspec-update-guide';
import { OpenSpecEngineCard } from './OpenSpecEngineCard';
import { OpenSpecAgentsBlock } from './OpenSpecAgentsBlock';
import { OpenSpecCoexistenceTable } from './OpenSpecCoexistenceTable';
import { OpenSpecToolList } from './OpenSpecReadiness';
import { OpenSpecUpdateRunner } from './OpenSpecUpdateRunner';
import { OpenSpecReleaseNotes } from './OpenSpecReleaseNotes';
import { getOpenSpecEngineUpgrade, resolveFallbackReasonText } from './pipeline-domain';
import type { PipelineSnapshot } from './pipeline-view-state';
import { useOpenSpecInit } from '@/hooks/use-openspec-init';
import { useOpenSpecVersionAnalysis } from '@/hooks/use-openspec-version-analysis';
import { usePipelineStore } from '@/lib/pipeline-store';
import { Stack, Row } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

export interface OpenSpecUpdateReviewProps {
  repoPath: string;
  status: OpenSpecEngineStatus | null;
  updatePlan?: OpenSpecUpdatePlan | null;
  installPlan?: OpenSpecInstallPlan | null;
  snapshot?: PipelineSnapshot | null;
  openRepoPaths?: string[];
  currentBranch?: string | null;
  isClean?: boolean;
  uncommittedCount?: number;
  isLoading?: boolean;
  onBack: () => void;
  onPrepareCommit?: () => void;
  onUpdateCompleted?: (result: OpenSpecRunUpdateResult) => void;
}

export const OpenSpecUpdateReview: React.FC<OpenSpecUpdateReviewProps> = ({
  repoPath,
  status,
  updatePlan,
  installPlan,
  snapshot,
  openRepoPaths,
  currentBranch,
  isClean = true,
  uncommittedCount,
  isLoading = false,
  onBack,
  onPrepareCommit,
  onUpdateCompleted,
}) => {
  const t = useT();
  const updateBlockRef = useRef<HTMLDivElement | null>(null);
  const { runOpenSpecInit, initBusy, initError, initNeedsTool } = useOpenSpecInit(repoPath);
  const openSpecTools = snapshot?.openSpec?.openSpecTools ?? [];
  const openSpecPresent = snapshot?.openSpec?.openSpecPresent ?? (status?.repoState === 'initialized');
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedHostCmd, setCopiedHostCmd] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [lastIntegration, setLastIntegration] = useState<OpenSpecRunUpdateResult | null>(null);

  const [legacyPlanState, setLegacyPlanState] = useState<{ repoPath: string; status: 'loaded' | 'error'; plan?: OpenSpecLegacySkillsPlan } | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removingSkills, setRemovingSkills] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removalResult, setRemovalResult] = useState<{ repoPath: string; result: OpenSpecRemoveLegacySkillsResult } | null>(null);
  const [dismissedRemovalRepo, setDismissedRemovalRepo] = useState<string | null>(null);
  const [showRemovalDetails, setShowRemovalDetails] = useState(false);

  const effectiveRemovalResult = (removalResult && repoPath && removalResult.repoPath === repoPath) ? removalResult.result : null;
  const isRemovalDismissed = dismissedRemovalRepo === repoPath;
  const effectiveStatus = effectiveRemovalResult?.engineStatus ?? status;

  const cli = effectiveStatus?.cli;
  const latest = effectiveStatus?.latestAvailable;
  const installed = effectiveStatus?.installedIntegration;
  const upgrade = getOpenSpecEngineUpgrade(effectiveStatus);
  const {
    analysis,
    loading: notesLoading,
    error: notesError,
    redacting: notesRedacting,
    startedAt: notesStartedAt,
    partialText: notesPartialText,
    cancelRedaction: handleCancelRedactNotes,
    redact: handleRedactNotes,
  } = useOpenSpecVersionAnalysis(
    repoPath,
    upgrade !== null,
  );

  // Derivar operación oficial y comando literal (Punto 1: si hay resultado de retiro, deriva del engineStatus recalculado)
  const action = effectiveRemovalResult
    ? deriveUpdateMatrixAction(effectiveRemovalResult.engineStatus)
    : (updatePlan?.requiredAction ?? deriveUpdateMatrixAction(effectiveStatus));

  const officialCommand = deriveOfficialCommand(action, effectiveStatus);

  const actionKey = action === 'upgrade-init'
    ? 'upgradeInit'
    : action === 'upgrade-update'
    ? 'upgradeUpdate'
    : action;
  const actionLabel = t(`pipeline.openspec.engine.matrix.${actionKey}`);

  // Diagnóstico de convivencia de skills .codex ↔ .agents
  const coexistence = classifyCoexistenceSkills(installed);
  const hasLegacyResidue = coexistence.legacySkills.length > 0;

  useEffect(() => {
    let active = true;
    if (!repoPath || !hasLegacyResidue) {
      return;
    }
    const apiCall = window.api?.pipelineOpenSpec?.getLegacySkillsPlan?.(repoPath);
    if (!apiCall || typeof apiCall.then !== 'function') {
      return;
    }
    apiCall
      .then((plan) => {
        if (active) {
          setLegacyPlanState({ repoPath, status: 'loaded', plan });
        }
      })
      .catch(() => {
        if (active) {
          setLegacyPlanState({ repoPath, status: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [repoPath, hasLegacyResidue]);

  const handleRemoveLegacySkills = async () => {
    if (!repoPath || removingSkills) return;
    const apiCall = window.api?.pipelineOpenSpec?.removeLegacySkills;
    if (!apiCall) return;
    setRemovingSkills(true);
    setRemoveError(null);
    try {
      const result = await apiCall(repoPath);
      setRemovalResult({ repoPath, result });
      setShowRemoveConfirm(false);
      usePipelineStore.getState().notifyEngineChanged();
    } catch (err: any) {
      setRemoveError(err?.message || t('pipeline.openspec.engine.review.removeError'));
      setShowRemoveConfirm(false);
    } finally {
      setRemovingSkills(false);
    }
  };

  const legacyPlanStatus: 'none' | 'loading' | 'loaded' | 'error' = !hasLegacyResidue || !repoPath
    ? 'none'
    : legacyPlanState?.repoPath === repoPath
    ? legacyPlanState.status
    : 'loading';

  const effectiveLegacyPlan = legacyPlanStatus === 'loaded' ? (legacyPlanState?.plan ?? null) : null;

  const removableItems = effectiveLegacyPlan !== null
    ? effectiveLegacyPlan.items.filter((item) => item.removable)
    : [];

  const nonRemovableItems = effectiveLegacyPlan !== null
    ? effectiveLegacyPlan.items.filter((item) => !item.removable)
    : [];

  // Contadores de agentes para el bloque AGENTES
  const agentTools = openSpecTools;
  const configuredCount = installed?.configuredAgentsCount ?? installed?.configuredCount ?? (
    agentTools.length > 0 ? agentTools.filter((t) => t.configured).length : (installed?.tools?.length ?? 0)
  );
  const totalCount = installed?.totalPresentAgentsCount ?? installed?.totalPresentCount ?? (
    agentTools.length > 0 ? agentTools.length : configuredCount
  );

  // Salvaguardas de Git
  const isMainOrMaster = currentBranch === 'main' || currentBranch === 'master';
  const isDirty = isClean === false;

  const handleCopyCommand = async () => {
    if (!officialCommand) return;
    try {
      await navigator.clipboard.writeText(officialCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch {
      // Ignorar fallo de clipboard
    }
  };

  const hostCommand = installPlan?.globalCommand ?? null;

  const handleCopyHostCommand = async () => {
    if (!hostCommand) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(hostCommand);
        setCopiedHostCmd(true);
        setTimeout(() => setCopiedHostCmd(false), 2000);
      }
    } catch {
      // Ignorar fallo de clipboard
    }
  };

  const resolveBlockReasonText = (): string => t(getUpdateBlockReasonKey(effectiveStatus));

  const isRepoInitialized = status?.repoState === 'initialized';
  const engineStep = upgrade
    ? {
        installed: cli?.runtimeVersion ?? null,
        latest: upgrade.latest,
        provenance: cli?.provenance ?? 'unknown',
      }
    : null;
  const integrationStep = action !== 'blocked' && (
    action !== 'none' || (Boolean(upgrade) && isRepoInitialized)
  );
  const isReading = Boolean(isLoading || !status);
  const runnerDisabledReason = isReading
    ? null
    : action === 'blocked'
    ? t('pipeline.openspec.engine.matrix.blockedReason', { reason: resolveBlockReasonText() })
    : null;

  return (
    <section className={styles.reviewView} aria-label={t('pipeline.openspec.engine.review.title')}>
      <header className={styles.reviewHead}>
        <div className={styles.reviewHeadTopRow}>
          <div className={styles.reviewTitleRow}>
            <ShieldCheck size={20} color="var(--color-primary)" aria-hidden="true" />
            <h3>{t('pipeline.openspec.engine.review.title')}</h3>
          </div>
          <button
            type="button"
            className={styles.reviewPrimaryActionBtn}
            onClick={onBack}
          >
            {t('pipeline.openspec.engine.review.close')}
          </button>
        </div>
      </header>

      <div className={styles.reviewBody}>
        {/* RESUMEN DE HECHOS Y ACCIONES AL FRENTE (Decisión 8.22) */}
        <div ref={updateBlockRef} className={styles.reviewUpfrontHeader}>
          <div className={styles.reviewUpfrontSummary}>
            <div className={styles.reviewFactLine}>
              <span className={styles.reviewFactLabel}>{t('pipeline.openspec.engine.summary.engineLabel')}</span>
              <span className={styles.reviewFactValue}>
                {isReading
                  ? t('pipeline.openspec.engine.reading')
                  : !cli?.installed
                  ? t('pipeline.openspec.engine.status.absent')
                  : upgrade !== null
                  ? t('pipeline.openspec.engine.hostUpgrade.offer', { installed: upgrade.installed, latest: upgrade.latest })
                  : t('pipeline.openspec.engine.summary.engineUpToDate', { version: cli?.runtimeVersion ?? '?' })}
              </span>
            </div>
            <div className={styles.reviewFactLine}>
              <span className={styles.reviewFactLabel}>{t('pipeline.openspec.engine.summary.integrationLabel')}</span>
              <span className={styles.reviewFactValue}>
                {isReading ? (
                  <strong style={{ color: 'var(--color-text-secondary)' }}>
                    {t('pipeline.openspec.engine.reading')}
                  </strong>
                ) : (
                  <strong style={{ color: action === 'none' ? 'var(--color-git-add)' : action === 'blocked' ? 'var(--color-error)' : 'var(--color-warning)' }}>
                    {actionLabel}
                  </strong>
                )}
              </span>
            </div>
          </div>

          <div className={styles.reviewUpfrontActions}>
            <OpenSpecUpdateRunner
              repoPath={repoPath}
              engine={engineStep}
              integration={integrationStep}
              isLoading={isReading}
              pendingTools={effectiveStatus?.pendingTools}
              repoInitialized={isRepoInitialized}
              repoState={effectiveStatus?.repoState}
              updatePlan={updatePlan}
              openRepoPaths={openRepoPaths}
              warnings={{
                mainBranch: isMainOrMaster ? (currentBranch ?? 'main') : null,
                dirtyCount: isDirty ? (uncommittedCount ?? 1) : null,
              }}
              disabledReason={runnerDisabledReason}
              onInitialize={() => {
                const configured = effectiveStatus?.toolReport?.tools?.filter((t) => t.configured).map((t) => t.id)
                  ?? installed?.configuredTools
                  ?? [];
                return runOpenSpecInit(configured.length > 0 ? configured : undefined);
              }}
              onConfigurePendingTools={() => {
                const configured = effectiveStatus?.toolReport?.tools?.filter((t) => t.configured).map((t) => t.id)
                  ?? installed?.configuredTools
                  ?? [];
                const pending = effectiveStatus?.pendingTools ?? [];
                const union = Array.from(new Set([...configured, ...pending]));
                return runOpenSpecInit(union);
              }}
              onIntegrationUpdated={(result) => {
                setLastIntegration(result);
                onUpdateCompleted?.(result);
              }}
            />

            {/* Si ya concluyó con éxito, ofrecemos preparar commit */}
            {lastIntegration?.success && onPrepareCommit && (
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onPrepareCommit}
              >
                {t('pipeline.openspec.engine.review.prepareCommit')}
              </button>
            )}
          </div>

          {upgrade && (
            <OpenSpecReleaseNotes
              latest={upgrade.latest}
              analysis={analysis}
              loading={notesLoading}
              error={notesError}
              repoPath={repoPath}
              redacting={notesRedacting}
              startedAt={notesStartedAt}
              partialText={notesPartialText}
              onCancelRedact={handleCancelRedactNotes}
              onRedact={handleRedactNotes}
            />
          )}
        </div>

        {/* COPIAS VIEJAS DE LAS INSTRUCCIONES */}
        {((effectiveRemovalResult !== null && !isRemovalDismissed) || (effectiveRemovalResult === null && hasLegacyResidue)) && (
          <section
            className={styles.reviewSection}
            aria-label={t('pipeline.openspec.engine.review.legacySkillsTitle')}
            style={{
              borderColor: 'color-mix(in srgb, var(--color-git-mod) 40%, transparent)',
              background: 'color-mix(in srgb, var(--color-git-mod) 5%, transparent)',
            }}
          >
            {effectiveRemovalResult !== null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-git-mod)', fontSize: 'var(--font-size-xs)' }}>
                    {t('pipeline.openspec.engine.review.removalSummaryLine', { count: effectiveRemovalResult.removed.length })}
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => setShowRemovalDetails((prev) => !prev)}
                    >
                      {showRemovalDetails
                        ? t('pipeline.openspec.engine.review.hideRemovalList')
                        : t('pipeline.openspec.engine.review.viewRemovalList')}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => setDismissedRemovalRepo(repoPath)}
                    >
                      {t('pipeline.openspec.engine.review.closeRemovalSection')}
                    </button>
                  </div>
                </div>
                {showRemovalDetails && (
                  <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}>
                    {effectiveRemovalResult.removed.length > 0 && (
                      <ul style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
                        {effectiveRemovalResult.removed.map((p) => (
                          <li key={p}><code>{p}</code></li>
                        ))}
                      </ul>
                    )}
                    {effectiveRemovalResult.skipped.length > 0 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <h4 style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', margin: '0 0 var(--space-1)' }}>
                          {t('pipeline.openspec.engine.review.nonRemovableTitle')}
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
                          {effectiveRemovalResult.skipped.map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code> — {item.reason === 'remove-failed'
                                ? t('pipeline.openspec.engine.review.reasonRemoveFailed')
                                : item.reason === 'modified'
                                ? t('pipeline.openspec.engine.review.reasonModified')
                                : t('pipeline.openspec.engine.review.reasonUntracked')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <h3 className={styles.reviewSectionTitle} style={{ color: 'var(--color-git-mod)' }}>
                  {t('pipeline.openspec.engine.review.legacySkillsTitle')}
                </h3>
                <p style={{ margin: '0 0 var(--space-1)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                  {t('pipeline.openspec.engine.review.legacySkillsDesc')}
                </p>

                {effectiveLegacyPlan === null ? (
                  /* Sin plan medido: listá las copias sin botón de retirar (Punto 3) */
                  <div style={{ margin: 'var(--space-2) 0', fontSize: 'var(--font-size-xs)' }}>
                    <ul style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-4)', color: 'var(--color-git-mod)' }}>
                      {coexistence.legacySkills.map((s) => (
                        <li key={s.path}><code>{s.path}</code></li>
                      ))}
                    </ul>
                    {legacyPlanStatus === 'error' ? (
                      <p style={{ margin: 'var(--space-1) 0', color: 'var(--color-warning)' }}>
                        {t('pipeline.openspec.engine.review.legacyPlanCheckFailed')}
                      </p>
                    ) : (
                      <p style={{ margin: 'var(--space-1) 0', color: 'var(--color-text-secondary)' }}>
                        {t('pipeline.openspec.engine.review.legacyPlanChecking')}
                      </p>
                    )}
                  </div>
                ) : showRemoveConfirm ? (
                  <div style={{
                    margin: 'var(--space-2) 0',
                    padding: 'var(--space-2)',
                    border: '1px solid color-mix(in srgb, var(--color-warning) 40%, transparent)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                  }}>
                    <h4 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
                      {t('pipeline.openspec.engine.review.removeConfirmTitle')}
                    </h4>
                    <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>
                      {t('pipeline.openspec.engine.review.removeConfirmPrompt')}
                    </p>
                    <ul style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-git-mod)' }}>
                      {removableItems.map((item) => (
                        <li key={item.path}><code>{item.path}</code></li>
                      ))}
                    </ul>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        type="button"
                        className={styles.primaryAction}
                        disabled={removingSkills}
                        onClick={handleRemoveLegacySkills}
                      >
                        {t('pipeline.openspec.engine.review.removeConfirmBtn')}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        disabled={removingSkills}
                        onClick={() => setShowRemoveConfirm(false)}
                      >
                        {t('pipeline.openspec.engine.review.removeCancelBtn')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {removableItems.length > 0 && (
                      <>
                        <ul style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-git-mod)' }}>
                          {removableItems.map((item) => (
                            <li key={item.path}><code>{item.path}</code></li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className={styles.primaryAction}
                          disabled={removingSkills}
                          onClick={() => setShowRemoveConfirm(true)}
                        >
                          {t('pipeline.openspec.engine.review.removeLegacySkillsBtn')}
                        </button>
                      </>
                    )}
                    {removeError && (
                      <p style={{ margin: 'var(--space-1) 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>
                        {removeError}
                      </p>
                    )}
                    {nonRemovableItems.length > 0 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <h4 style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', margin: 'var(--space-2) 0 var(--space-1)' }}>
                          {t('pipeline.openspec.engine.review.nonRemovableTitle')}
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
                          {nonRemovableItems.map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code> — {item.reason === 'remove-failed'
                                ? t('pipeline.openspec.engine.review.reasonRemoveFailed')
                                : item.reason === 'modified'
                                ? t('pipeline.openspec.engine.review.reasonModified')
                                : t('pipeline.openspec.engine.review.reasonUntracked')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* BLOQUE 2: MOTOR */}
        <OpenSpecEngineCard
          status={effectiveStatus}
          section="motor"
          isLoading={isReading}
          uncommittedCount={uncommittedCount}
          compact={false}
          defaultAdvancedOpen={true}
          isReviewOpen={true}
          repoPath={repoPath}
          openRepoPaths={openRepoPaths}
          commandExecuted={installPlan?.globalCommand ?? undefined}
          packageManagerPath={installPlan?.packageManagerPath ?? undefined}
          packageManagerName={installPlan?.detectedManager ?? undefined}
          nodePath={installPlan?.nodePath ?? undefined}
          hasPackageJson={installPlan?.hasManifest}
          onRequestUpdate={() => updateBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onChanged={() => usePipelineStore.getState().notifyEngineChanged()}
        />

        {/* BLOQUE 3: AGENTES (Se renderiza SIEMPRE, con o sin motor leído) */}
        <OpenSpecAgentsBlock
          configuredCount={configuredCount}
          totalCount={totalCount}
          outputInventory={installed?.outputInventory}
        >
          {effectiveStatus?.toolReport?.source === 'gitcron-fallback' && (
            <Row gap="2" role="status" style={{ margin: 'var(--space-1) 0 var(--space-2)' }}>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                {t('pipeline.openspec.engine.fallbackNotice', {
                  reason: resolveFallbackReasonText(effectiveStatus.toolReport.fallbackReason, t),
                })}
              </span>
            </Row>
          )}
          <OpenSpecToolList
            present={openSpecPresent}
            tools={openSpecTools}
            toolReport={effectiveStatus?.toolReport}
            busy={initBusy}
            error={initError}
            needsTool={initNeedsTool}
            uncommittedCount={uncommittedCount}
            onInitialize={() => {
              const configured = effectiveStatus?.toolReport?.tools?.filter((t) => t.configured).map((t) => t.id)
                ?? installed?.configuredTools
                ?? [];
              return runOpenSpecInit(configured.length > 0 ? configured : undefined);
            }}
            onInitializeWith={(ids) => {
              const configured = effectiveStatus?.toolReport?.tools?.filter((t) => t.configured).map((t) => t.id)
                ?? installed?.configuredTools
                ?? [];
              const union = Array.from(new Set([...configured, ...ids]));
              return runOpenSpecInit(union);
            }}
          />
        </OpenSpecAgentsBlock>

        {/* BLOQUE 4: PERFIL DE WORKFLOWS (Solo disponible cuando el motor fue leído) */}
        {effectiveStatus && (
          <OpenSpecEngineCard
            status={effectiveStatus}
            section="profile"
            isLoading={isReading}
            uncommittedCount={uncommittedCount}
            compact={false}
            isReviewOpen={true}
            repoPath={repoPath}
            openRepoPaths={openRepoPaths}
            onRequestUpdate={() => updateBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            onChanged={() => usePipelineStore.getState().notifyEngineChanged()}
          />
        )}

        {/* BLOQUE 5: DESDE LA TERMINAL (Plegado por omisión) */}
        <section className={styles.reviewBlock} aria-label={t('pipeline.openspec.engine.matrix.commandTitle')}>
          <button
            type="button"
            className={styles.toggleAbsentBtn}
            onClick={() => setShowTerminal((prev) => !prev)}
            aria-expanded={showTerminal}
          >
            <span>{t('pipeline.openspec.engine.summary.terminalToggle')}</span>
            {showTerminal ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          </button>

          {showTerminal && (
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {hostCommand && (
                <div className={styles.reviewCommandBox}>
                  <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                    {t('pipeline.openspec.engine.hostUpgrade.help')}
                  </p>
                  <div className={styles.reviewCommandPre}>
                    <code>{hostCommand}</code>
                    <button
                      type="button"
                      className={styles.reviewCopyBtn}
                      onClick={handleCopyHostCommand}
                      aria-label={copiedHostCmd ? t('pipeline.openspec.engine.hostUpgrade.copied') : t('pipeline.openspec.engine.hostUpgrade.copy')}
                    >
                      {copiedHostCmd ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      <span>{copiedHostCmd ? t('pipeline.openspec.engine.hostUpgrade.copied') : t('pipeline.openspec.engine.hostUpgrade.copy')}</span>
                    </button>
                  </div>
                </div>
              )}

              {officialCommand && (
                <div className={styles.reviewCommandBox}>
                  <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                    {t('pipeline.openspec.engine.matrix.commandHelp')}
                  </p>
                  <div className={styles.reviewCommandPre}>
                    <code>{officialCommand}</code>
                    <button
                      type="button"
                      className={styles.reviewCopyBtn}
                      onClick={handleCopyCommand}
                      aria-label={copiedCommand ? t('pipeline.openspec.engine.matrix.commandCopied') : t('pipeline.openspec.engine.matrix.copyCommand')}
                    >
                      {copiedCommand ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      <span>{copiedCommand ? t('pipeline.openspec.engine.matrix.commandCopied') : t('pipeline.openspec.engine.matrix.copyCommand')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* BLOQUE 6: DETALLE TÉCNICO (Plegado por omisión) */}
        <section className={styles.reviewBlock} aria-label={t('pipeline.openspec.engine.summary.technicalToggle')}>
          <button
            type="button"
            className={styles.toggleAbsentBtn}
            onClick={() => setShowTechnicalDetails((prev) => !prev)}
            aria-expanded={showTechnicalDetails}
          >
            <span>{t('pipeline.openspec.engine.summary.technicalToggle')}</span>
            {showTechnicalDetails ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          </button>

          {showTechnicalDetails && (
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* 1. MATRIZ DECLARADA */}
              <div>
                <h3 className={styles.reviewSectionTitle}>{t('pipeline.openspec.engine.matrix.title')}</h3>
                <Stack gap="1">
                  <span className={styles.reviewFactLabel}>{t('pipeline.openspec.engine.matrix.actionLabel')}:</span>
                  <strong style={{ color: action === 'none' ? 'var(--color-git-add)' : action === 'blocked' ? 'var(--color-error)' : 'var(--color-warning)' }}>
                    {actionLabel}
                  </strong>
                </Stack>

                {action === 'blocked' && (
                  <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>
                    {t('pipeline.openspec.engine.matrix.blockedReason', {
                      reason: resolveBlockReasonText(),
                    })}
                  </p>
                )}
              </div>

              {/* 2. GUÍA NO INTERACTIVA PARA INIT */}
              {(action === 'init' || action === 'upgrade-init' || !status?.repoState || status.repoState === 'not-initialized') && (
                <div>
                  <h3 className={styles.reviewSectionTitle}>{t('pipeline.openspec.engine.guide.title')}</h3>
                  <ul className={styles.reviewGuideList}>
                    <li className={styles.reviewGuideItem}>
                      <code>--tools &lt;lista&gt;</code>: {t('pipeline.openspec.engine.guide.toolsArg').replace(/^--tools <lista>:\s*/, '')}
                    </li>
                    <li className={styles.reviewGuideItem}>
                      <code>--profile core|custom</code>: {t('pipeline.openspec.engine.guide.profileArg').replace(/^--profile core\|custom:\s*/, '')}
                    </li>
                    <li className={styles.reviewGuideItem}>
                      <code>--no-animation</code>: {t('pipeline.openspec.engine.guide.noAnimationArg').replace(/^--no-animation:\s*/, '')}
                    </li>
                    <li className={styles.reviewGuideItem}>
                      <code>--copilot-cloud / --no-copilot-cloud</code>: {t('pipeline.openspec.engine.guide.copilotArg').replace(/^--copilot-cloud \/ --no-copilot-cloud:\s*/, '')}
                    </li>
                  </ul>

                  <div className={styles.reviewWarningAlert}>
                    <AlertTriangle size={15} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 1 }} />
                    <span>{t('pipeline.openspec.engine.guide.forceWarning')}</span>
                  </div>
                </div>
              )}

              {/* 3. DIAGNÓSTICO DE CONVIVENCIA .codex ↔ .agents */}
              <div>
                <h3 className={styles.reviewSectionTitle}>{t('pipeline.openspec.engine.coexistence.title')}</h3>
                <OpenSpecCoexistenceTable coexistence={coexistence} />
              </div>

              {/* 4. ARCHIVOS TOCADOS POR LA ÚLTIMA ACTUALIZACIÓN */}
              {lastIntegration && lastIntegration.filesUpdated && lastIntegration.filesUpdated.length > 0 && (
                <div>
                  <h3 className={styles.reviewSectionTitle}>
                    {t('pipeline.openspec.engine.summary.filesTouched')}
                  </h3>
                  <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)' }}>
                    {lastIntegration.filesUpdated.map((f) => (
                      <li key={f}><code>{f}</code></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
};
