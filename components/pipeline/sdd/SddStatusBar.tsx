import React from 'react';
import {
  GitBranch,
  GitCommit,
  GitMerge,
  Check,
  AlertCircle,
  Monitor,
  Package,
  ShieldCheck,
  PanelRight,
} from 'lucide-react';
import { ContentHeader } from '@/components/ContentHeader';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-translation';
import {
  OPENSPEC_CYCLE_TARGET_VERSION,
  isInstalledBehindCycle,
} from '@/lib/openspec-version';
import {
  getOpenSpecEngineUpgrade,
  hasOpenSpecEngineAttention,
} from '../pipeline-domain';
import type { OpenSpecEngineStatus } from '@/types/pipeline';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';
import styles from './SddStatusBar.module.css';

const INTEGRATION_STATE_KEY_MAP: Record<string, string> = {
  'up-to-date': 'pipeline.openspec.engine.integrationState.upToDate',
  outdated: 'pipeline.openspec.engine.integrationState.outdated',
  conflicted: 'pipeline.openspec.engine.integrationState.conflicted',
  custom: 'pipeline.openspec.engine.integrationState.custom',
  unknown: 'pipeline.openspec.engine.integrationState.unknown',
};

export interface SddStatusBarProps {
  currentBranch: string;
  workingTreeClean: boolean;
  modifiedFilesCount: number;
  branchTracking?: Record<string, { ahead: number; behind: number; gone: boolean; upstream: string | null }>;
  effectiveEngineLoading: boolean;
  effectiveEngineStatus: OpenSpecEngineStatus | null;
  attentionReasons: string[];
  attentionReasonSeparator: string;
  selectedChange: OpenSpecChangeSummary | null;
  prepareOpen: boolean;
  repoPath: string;
  setPrepareOpen: (open: boolean, repoPath?: string) => void;
  onEnsureRightOpen?: () => void;
  onEnsureRightClosed?: () => void;
  isSwitcherOpen: boolean;
  setIsSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSwitcherVisible: boolean;
  rightOpen?: boolean;
  onOpenReview: () => void;
}

function BranchTrackingIndicator({
  currentBranch,
  branchTracking,
}: {
  currentBranch: string;
  branchTracking?: Record<string, { ahead: number; behind: number; gone: boolean; upstream: string | null }>;
}) {
  const t = useT();
  const tracking = (currentBranch && branchTracking) ? branchTracking[currentBranch] : undefined;

  if (tracking?.gone) {
    return (
      <div
        role="status"
        title={t('sidebar.branchStatus.gone', { upstream: tracking.upstream ?? '' })}
        className={cn(styles.badge, styles.badgeGone)}
      >
        <AlertCircle size={11} className={styles.icon} />
        <span>{t('sidebar.upstreamGone')}</span>
      </div>
    );
  }
  if (tracking && (tracking.ahead > 0 || tracking.behind > 0)) {
    return (
      <div
        role="status"
        title={t('sidebar.branchStatus.diverged', {
          upstream: tracking.upstream ?? '',
          ahead: tracking.ahead,
          behind: tracking.behind,
        })}
        className={cn(styles.badge, styles.badgeMono, styles.badgeSynced)}
      >
        <GitMerge size={11} className={styles.icon} />
        <span>+{tracking.ahead} -{tracking.behind}</span>
      </div>
    );
  }
  if (tracking) {
    return (
      <div
        role="status"
        title={t('sidebar.branchStatus.synced', { upstream: tracking.upstream ?? '' })}
        className={cn(styles.badge, styles.badgeSynced)}
      >
        <Check size={11} strokeWidth={2.5} className={styles.icon} />
        <span>{t('sidebar.branchStatus.syncedShort')}</span>
      </div>
    );
  }
  return (
    <div
      role="status"
      title={t('sidebar.branchStatus.local')}
      className={cn(styles.badge, styles.badgeLocal)}
    >
      <Monitor size={11} className={styles.icon} />
      <span>{t('sidebar.branchStatus.localShort')}</span>
    </div>
  );
}

function getEngineVersionLabel(
  cliInstalled: boolean,
  runtimeVer: string | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!cliInstalled) return t('pipeline.openspec.engine.status.absent');
  if (runtimeVer === null) return t('pipeline.openspec.engine.pill.notDetected');
  return `OpenSpec v${runtimeVer}`;
}

function getEngineStatusTitle({
  isAbsentOrNotDetected,
  versionStr,
  stateStr,
  attentionText,
  cycleNotice,
  upgradeNotice,
  t,
}: {
  isAbsentOrNotDetected: boolean;
  versionStr: string;
  stateStr: string | null;
  attentionText: string | null;
  cycleNotice: string | null;
  upgradeNotice: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}): string {
  if (isAbsentOrNotDetected) {
    return [versionStr, stateStr, attentionText].filter(Boolean).join(' · ');
  }
  return [
    versionStr,
    t('pipeline.openspec.engine.cycleVersion', { version: OPENSPEC_CYCLE_TARGET_VERSION }),
    stateStr,
    cycleNotice,
    upgradeNotice,
    attentionText,
  ]
    .filter(Boolean)
    .join(' · ');
}

function computeEngineAttention(
  effectiveEngineStatus: OpenSpecEngineStatus | null,
  cliInstalled: boolean,
  runtimeVer: string | null,
  upgradeAvailable: boolean,
): boolean {
  if (!cliInstalled || runtimeVer === null) return true;
  if (hasOpenSpecEngineAttention(effectiveEngineStatus)) return true;
  if (isInstalledBehindCycle(runtimeVer)) return true;
  return upgradeAvailable;
}

function computeEngineIndicatorModel({
  effectiveEngineStatus,
  attentionReasons,
  attentionReasonSeparator,
  t,
}: {
  effectiveEngineStatus: OpenSpecEngineStatus;
  attentionReasons: string[];
  attentionReasonSeparator: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const cliInstalled = Boolean(effectiveEngineStatus.cli?.installed);
  const runtimeVer = effectiveEngineStatus.cli?.runtimeVersion ?? null;
  const isBehind = isInstalledBehindCycle(runtimeVer);
  const versionStr = getEngineVersionLabel(cliInstalled, runtimeVer, t);
  const stateKey = effectiveEngineStatus.integrationState
    ? (INTEGRATION_STATE_KEY_MAP[effectiveEngineStatus.integrationState] ?? 'pipeline.openspec.engine.integrationState.unknown')
    : null;
  const stateStr = stateKey ? t(stateKey) : null;
  const upgrade = getOpenSpecEngineUpgrade(effectiveEngineStatus);
  const engineAttention = computeEngineAttention(effectiveEngineStatus, cliInstalled, runtimeVer, upgrade !== null);
  const cycleNotice = isBehind
    ? t('pipeline.openspec.engine.versionBehindCycle', { installed: runtimeVer ?? '?', cycle: OPENSPEC_CYCLE_TARGET_VERSION })
    : null;
  const attentionText = engineAttention && attentionReasons.length > 0 ? attentionReasons.join(attentionReasonSeparator) : null;
  const upgradeNotice = upgrade ? t('pipeline.openspec.engine.pill.upgradeAvailable', { latest: upgrade.latest }) : null;
  const engineTitle = getEngineStatusTitle({
    isAbsentOrNotDetected: !cliInstalled || runtimeVer === null,
    versionStr,
    stateStr,
    attentionText,
    cycleNotice,
    upgradeNotice,
    t,
  });

  return {
    versionStr,
    engineAttention,
    engineTitle,
    upgrade,
  };
}

function EngineVersionIndicator({
  effectiveEngineLoading,
  effectiveEngineStatus,
  attentionReasons,
  attentionReasonSeparator,
  onOpenReview,
}: {
  effectiveEngineLoading: boolean;
  effectiveEngineStatus: OpenSpecEngineStatus | null;
  attentionReasons: string[];
  attentionReasonSeparator: string;
  onOpenReview: () => void;
}) {
  const t = useT();

  if (effectiveEngineLoading || !effectiveEngineStatus) {
    return (
      <div
        role="status"
        title={t('pipeline.openspec.engine.reading')}
        className={cn(styles.badge, styles.badgeMono, styles.badgeMuted)}
      >
        <Package size={11} className={cn(styles.icon, styles.badgePulse)} />
        <span>{t('pipeline.openspec.engine.reading')}</span>
      </div>
    );
  }

  const { versionStr, engineAttention, engineTitle, upgrade } = computeEngineIndicatorModel({
    effectiveEngineStatus,
    attentionReasons,
    attentionReasonSeparator,
    t,
  });

  return (
    <div
      role="status"
      title={engineTitle}
      data-attention={engineAttention ? 'true' : undefined}
      onClick={onOpenReview}
      className={cn(
        styles.badge,
        styles.badgeMono,
        styles.badgeInteractive,
        engineAttention ? styles.badgeWarning : styles.badgeMuted,
      )}
    >
      <Package size={11} className={styles.icon} />
      <span>{versionStr}</span>
      {upgrade && (
        <span
          className={styles.upgradeDot}
          aria-label={t('pipeline.openspec.engine.pill.upgradeAvailable', { latest: upgrade.latest })}
          data-upgrade="available"
        />
      )}
    </div>
  );
}

function ValidationIndicator({
  selectedChange,
}: {
  selectedChange: OpenSpecChangeSummary | null;
}) {
  const t = useT();
  const valStatus = selectedChange?.validation;
  let valText = t('pipeline.openspec.notApplicable');
  let valClass = styles.badgeMuted;
  let valIcon = <ShieldCheck size={11} className={styles.icon} />;

  if (selectedChange) {
    if (valStatus === 'passed') {
      valText = t('pipeline.openspec.validation.passed');
      valClass = styles.badgeClean;
      valIcon = <Check size={11} strokeWidth={2.5} className={styles.icon} />;
    } else if (valStatus === 'failed') {
      valText = t('pipeline.openspec.validation.failed');
      valClass = styles.badgeError;
      valIcon = <AlertCircle size={11} className={styles.icon} />;
    } else {
      valText = t('pipeline.openspec.validation.unknown');
      valClass = styles.badgeMuted;
      valIcon = <ShieldCheck size={11} className={styles.icon} />;
    }
  }

  return (
    <div
      role="status"
      title={`${t('pipeline.openspec.evidence.validation')}: ${valText}`}
      className={cn(styles.badge, valClass)}
    >
      {valIcon}
      <span>{valText}</span>
    </div>
  );
}

export function SddStatusBar({
  currentBranch,
  workingTreeClean,
  modifiedFilesCount,
  branchTracking,
  effectiveEngineLoading,
  effectiveEngineStatus,
  attentionReasons,
  attentionReasonSeparator,
  selectedChange,
  prepareOpen,
  repoPath,
  setPrepareOpen,
  onEnsureRightOpen,
  onEnsureRightClosed,
  isSwitcherOpen,
  setIsSwitcherOpen,
  isSwitcherVisible,
  rightOpen,
  onOpenReview,
}: SddStatusBarProps) {
  const t = useT();

  const isToggleDisabled = Boolean(rightOpen && !onEnsureRightClosed);
  // Con «Preparar commit» abierta no hay riel en pantalla aunque la preferencia diga que sí.
  const navVisible = isSwitcherVisible && !prepareOpen;
  const toggleLabel = navVisible
    ? t('pipeline.switcher.hideNav')
    : t('pipeline.switcher.showNav');
  const toggleTitle = navVisible
    ? t('pipeline.switcher.hideNav')
    : rightOpen
      ? (onEnsureRightClosed
          ? t('pipeline.switcher.showNavClosesInspector')
          : t('pipeline.switcher.toggleDisabledHelp'))
      : t('pipeline.switcher.showNav');

  // «Preparar commit» no tiene riel: mostrar la navegación desde ahí también cierra esa vista,
  // si no el botón diría que la navegación está a la vista sin que aparezca nada.
  const handleToggleClick = () => {
    if (rightOpen || prepareOpen) {
      if (rightOpen) {
        if (!onEnsureRightClosed) return;
        onEnsureRightClosed();
      }
      if (prepareOpen) setPrepareOpen(false, repoPath);
      setIsSwitcherOpen(true);
    } else {
      setIsSwitcherOpen((prev) => !prev);
    }
  };

  return (
    <ContentHeader className={cn('h-11', styles.statusBar)}>
      {/* Left: Branch name and repo status indicators */}
      <div className={styles.leftGroup}>
        {/* Branch name */}
        <div className={styles.branchWrapper}>
          <GitBranch size={13} className={styles.branchIcon} />
          <span
            className={styles.branchName}
            title={currentBranch || '-'}
          >
            {currentBranch || '-'}
          </span>
        </div>

        {/* Indicators */}
        <div className={styles.indicatorsGroup}>
          {/* Working tree state */}
          <div
            role="status"
            title={workingTreeClean ? t('pipeline.openspec.repo.clean') : t('pipeline.openspec.repo.changed')}
            className={cn(
              styles.badge,
              workingTreeClean ? styles.badgeClean : styles.badgeModified,
            )}
          >
            {workingTreeClean ? (
              <Check size={11} strokeWidth={2.5} className={styles.icon} />
            ) : (
              <AlertCircle size={11} className={styles.icon} />
            )}
            <span>
              {workingTreeClean
                ? t('sidebar.workingTreeClean')
                : `${modifiedFilesCount} ${t('sidebar.workingTreeModified')}`}
            </span>
          </div>

          {/* Tracking status */}
          <BranchTrackingIndicator currentBranch={currentBranch} branchTracking={branchTracking} />

          {/* OpenSpec Engine version */}
          <EngineVersionIndicator
            effectiveEngineLoading={effectiveEngineLoading}
            effectiveEngineStatus={effectiveEngineStatus}
            attentionReasons={attentionReasons}
            attentionReasonSeparator={attentionReasonSeparator}
            onOpenReview={onOpenReview}
          />

          {/* OpenSpec Validation status */}
          <ValidationIndicator selectedChange={selectedChange} />
        </div>
      </div>

      {/* Right: Acciones de encabezado */}
      <div className={styles.rightGroup}>
        <div className={styles.pillWrapper}>
          <button
            type="button"
            data-clean={workingTreeClean}
            aria-expanded={prepareOpen}
            title={t('pipeline.openspec.prepare.open')}
            onClick={() => {
              const next = !prepareOpen;
              setPrepareOpen(next, repoPath);
              if (next && onEnsureRightOpen) {
                onEnsureRightOpen();
              }
            }}
            className={cn(
              styles.prepareBtn,
              prepareOpen && styles.prepareBtnActive,
            )}
          >
            <GitCommit size={13} className={styles.icon} />
            <span className={styles.prepareBtnLabel}>{t('pipeline.openspec.prepare.open')}</span>
          </button>
        </div>

        {/* Alternar resumen fijado (intercambiador de vistas) */}
        <div className={styles.pillWrapper}>
          <button
            type="button"
            data-testid="pipeline.switcher.toggle"
            data-active={isSwitcherOpen ? 'true' : undefined}
            aria-label={toggleLabel}
            aria-expanded={navVisible}
            aria-disabled={isToggleDisabled}
            disabled={isToggleDisabled}
            title={toggleTitle}
            onClick={handleToggleClick}
            className={cn(
              styles.toggleBtn,
              isSwitcherOpen && styles.toggleBtnActive,
              isToggleDisabled && styles.toggleBtnDisabled,
            )}
          >
            <PanelRight size={13} className={styles.icon} />
          </button>
        </div>
      </div>
    </ContentHeader>
  );
}
