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
import shared from '../OpenSpecDashboard.module.css';

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
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-error/15 text-error"
      >
        <AlertCircle size={11} className="shrink-0" />
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
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary font-mono"
      >
        <GitMerge size={11} className="shrink-0" />
        <span>+{tracking.ahead} -{tracking.behind}</span>
      </div>
    );
  }
  if (tracking) {
    return (
      <div
        role="status"
        title={t('sidebar.branchStatus.synced', { upstream: tracking.upstream ?? '' })}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary"
      >
        <Check size={11} strokeWidth={2.5} className="shrink-0" />
        <span>{t('sidebar.branchStatus.syncedShort')}</span>
      </div>
    );
  }
  return (
    <div
      role="status"
      title={t('sidebar.branchStatus.local')}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-text-primary/[0.035] text-text-secondary/80"
    >
      <Monitor size={11} className="shrink-0" />
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
        className="relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 font-mono bg-text-primary/[0.035] text-text-secondary/80"
      >
        <Package size={11} className="shrink-0 animate-pulse" />
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
      onClick={onOpenReview}
      className={cn(
        'relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 font-mono',
        engineAttention
          ? 'bg-warning/15 text-warning'
          : 'bg-text-primary/[0.035] text-text-secondary/80',
        'cursor-pointer hover:bg-text-primary/[0.07]',
      )}
    >
      <Package size={11} className="shrink-0" />
      <span>{versionStr}</span>
      {upgrade && (
        <span
          className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-git-mod ring-2 ring-bg-base/70 shadow-[0_0_8px_var(--color-git-mod)]"
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
  let valClass = 'bg-text-primary/[0.035] text-text-secondary/80';
  let valIcon = <ShieldCheck size={11} className="shrink-0" />;

  if (selectedChange) {
    if (valStatus === 'passed') {
      valText = t('pipeline.openspec.validation.passed');
      valClass = 'bg-secondary/10 text-secondary';
      valIcon = <Check size={11} strokeWidth={2.5} className="shrink-0" />;
    } else if (valStatus === 'failed') {
      valText = t('pipeline.openspec.validation.failed');
      valClass = 'bg-error/15 text-error';
      valIcon = <AlertCircle size={11} className="shrink-0" />;
    } else {
      valText = t('pipeline.openspec.validation.unknown');
      valClass = 'bg-text-primary/[0.035] text-text-secondary/80';
      valIcon = <ShieldCheck size={11} className="shrink-0" />;
    }
  }

  return (
    <div
      role="status"
      title={`${t('pipeline.openspec.evidence.validation')}: ${valText}`}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0',
        valClass,
      )}
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
  isSwitcherOpen,
  setIsSwitcherOpen,
  isSwitcherVisible,
  rightOpen,
  onOpenReview,
}: SddStatusBarProps) {
  const t = useT();

  return (
    <ContentHeader className="h-11 border-b border-border-subtle/15 flex items-center justify-between gap-3 normal-case font-normal shrink-0">
      {/* Left: Branch name and repo status indicators */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Branch name */}
        <div className="flex items-center gap-1.5 min-w-0 shrink">
          <GitBranch size={13} className="shrink-0 text-text-secondary/70" />
          <span
            className="font-mono font-semibold text-xs text-text-primary truncate"
            title={currentBranch || '-'}
          >
            {currentBranch || '-'}
          </span>
        </div>

        {/* Indicators */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Working tree state */}
          <div
            role="status"
            title={workingTreeClean ? t('pipeline.openspec.repo.clean') : t('pipeline.openspec.repo.changed')}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0',
              workingTreeClean
                ? 'bg-secondary/10 text-secondary'
                : 'bg-git-mod/15 text-git-mod'
            )}
          >
            {workingTreeClean ? (
              <Check size={11} strokeWidth={2.5} className="shrink-0" />
            ) : (
              <AlertCircle size={11} className="shrink-0" />
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
      <div className="shrink-0 ml-auto flex items-center gap-1.5">
        <div className="bg-bg-base/80 border border-border-subtle/30 rounded-lg flex items-center p-0.5 shadow-sm">
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
              "h-7 px-2.5 py-1 rounded-md transition-all duration-150 flex items-center justify-center gap-1.5",
              prepareOpen
                ? "bg-secondary/15 text-secondary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_25%,transparent)]"
                : "text-text-secondary hover:text-text-primary hover:bg-border-subtle/50"
            )}
          >
            <GitCommit size={13} className="shrink-0" />
            <span className="text-[length:var(--font-size-xs)] leading-none font-semibold">{t('pipeline.openspec.prepare.open')}</span>
          </button>
        </div>

        {/* Alternar resumen fijado (intercambiador de vistas) */}
        <div className="bg-bg-base/80 border border-border-subtle/30 rounded-lg flex items-center p-0.5 shadow-sm">
          <button
            type="button"
            data-testid="pipeline.switcher.toggle"
            data-active={isSwitcherOpen ? 'true' : undefined}
            aria-label={t('pipeline.switcher.toggle')}
            aria-expanded={isSwitcherVisible}
            aria-disabled={rightOpen}
            disabled={rightOpen}
            title={rightOpen ? t('pipeline.switcher.toggleDisabledHelp') : t('pipeline.switcher.toggle')}
            onClick={() => {
              if (!rightOpen) {
                setIsSwitcherOpen((prev) => !prev);
              }
            }}
            className={cn(
              shared.iconBtn,
              isSwitcherOpen && shared.iconBtnActive,
              rightOpen && "opacity-50 cursor-not-allowed"
            )}
          >
            <PanelRight size={13} className="shrink-0" />
          </button>
        </div>
      </div>
    </ContentHeader>
  );
}
