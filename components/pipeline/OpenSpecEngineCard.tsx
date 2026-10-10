import React, { useState } from 'react';
import { useT } from '@/hooks/use-translation';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, HelpCircle, Copy, Check, Loader2, Lock, LockOpen, RefreshCw } from 'lucide-react';
import type {
  OpenSpecCliProvenance,
  OpenSpecDivergenceReason,
  OpenSpecEngineStatus,
  OpenSpecInstallResult,
  OpenSpecStoreDiagnostic,
  OpenSpecVersionClass,
} from '../../types/pipeline';
import {
  OPENSPEC_CYCLE_TARGET_VERSION,
  SUPPORTED_OPENSPEC_VERSIONS,
  isInstalledBehindCycle,
} from '@/lib/openspec-version';
import { deriveProfileWorkflowRows } from '@/lib/openspec-profile';
import { Stack, Row, PlainList } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecGlobalInstallConfirm, formatInstallErrorCode } from './OpenSpecGlobalInstallConfirm';
import { isOpenSpecEngineStatusIncomplete, resolveFallbackReasonText } from './pipeline-domain';

const VERSION_CLASS_KEY_MAP: Record<OpenSpecVersionClass, string> = {
  supported: 'pipeline.openspec.engine.versionClass.supported',
  'too-old': 'pipeline.openspec.engine.versionClass.tooOld',
  unknown: 'pipeline.openspec.engine.versionClass.unknown',
};

const REPO_STATE_KEY_MAP: Record<string, string> = {
  initialized: 'pipeline.openspec.engine.repoState.initialized',
  'not-initialized': 'pipeline.openspec.engine.repoState.notInitialized',
  unknown: 'pipeline.openspec.engine.repoState.unknown',
};

export const INTEGRATION_STATE_KEY_MAP: Record<string, string> = {
  'up-to-date': 'pipeline.openspec.engine.integrationState.upToDate',
  outdated: 'pipeline.openspec.engine.integrationState.outdated',
  conflicted: 'pipeline.openspec.engine.integrationState.conflicted',
  custom: 'pipeline.openspec.engine.integrationState.custom',
  unknown: 'pipeline.openspec.engine.integrationState.unknown',
};

const PROVENANCE_KEY_MAP: Record<OpenSpecCliProvenance, string> = {
  global: 'pipeline.openspec.engine.provenance.global',
  local: 'pipeline.openspec.engine.provenance.local',
  managed: 'pipeline.openspec.engine.provenance.managed',
  unknown: 'pipeline.openspec.engine.provenance.unknown',
};

const GENERAL_STATUS_KEY_MAP: Record<'ready' | 'needs-attention' | 'unknown', string> = {
  ready: 'pipeline.openspec.engine.generalStatus.ready',
  'needs-attention': 'pipeline.openspec.engine.generalStatus.needsAttention',
  unknown: 'pipeline.openspec.engine.generalStatus.unknown',
};

const PRESENCE_KEY_MAP: Record<string, string> = {
  present: 'pipeline.openspec.engine.presence.present',
  absent: 'pipeline.openspec.engine.presence.absent',
  divergent: 'pipeline.openspec.engine.presence.divergent',
  blocked: 'pipeline.openspec.engine.presence.blocked',
};


export interface OpenSpecEngineCardProps {
  status: OpenSpecEngineStatus | null;
  isLoading?: boolean;
  compact?: boolean;
  defaultAdvancedOpen?: boolean;
  onOpenToolsTab?: () => void;
  onOpenReview?: () => void;
  isReviewOpen?: boolean;
  hasPackageJson?: boolean;
  openRepoPaths?: string[];
  nodePath?: string;
  npmPath?: string;
  repoPath?: string;
  commandExecuted?: string;
  packageManagerPath?: string;
  packageManagerName?: string | null;
  onInstalled?: (result: OpenSpecInstallResult) => void;
  onRequestUpdate?: () => void;
  /** Se invoca cuando una escritura de perfil (toggle de workflow) termina con éxito, para que el padre re-fetchee el estado. La tarjeta no muta su propio `status`. */
  onChanged?: () => void;
  title?: string;
  section?: 'all' | 'motor' | 'profile';
  uncommittedCount?: number;
}

export { formatInstallErrorCode } from './OpenSpecGlobalInstallConfirm';

function formatAgentList(
  agents: string[],
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (agents.length === 0) return '';
  if (agents.length === 1) return agents[0];
  const lang = t('pipeline.openspec.engine.divergence.lang') || 'es';
  if (lang === 'zh') {
    return agents.slice(0, -1).join('、') + ' 和 ' + agents[agents.length - 1];
  }
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(agents);
  } catch {
    const conj = lang === 'en' ? ' and ' : ' y ';
    return agents.slice(0, -1).join(', ') + conj + agents[agents.length - 1];
  }
}

export function formatDivergenceReason(
  reason: OpenSpecDivergenceReason | string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!reason) return '';
  if (typeof reason === 'string') return reason;
  if (reason.kind === 'profile-mismatch') {
    return t('pipeline.openspec.engine.divergence.profileMismatch', {
      global: reason.globalProfileClass,
      repo: reason.repoProfileClass,
    });
  }
  if (reason.kind === 'target-workflows-mismatch') {
    const noneText = t('pipeline.openspec.engine.divergence.none');
    const targetWf = reason.targetWorkflows.length > 0
      ? reason.targetWorkflows.join(', ')
      : noneText;
    const globalWf = reason.globalWorkflows.length > 0
      ? reason.globalWorkflows.join(', ')
      : noneText;
    return t('pipeline.openspec.engine.divergence.targetWorkflows', {
      target: reason.label,
      targetCount: reason.targetCount,
      targetWorkflows: targetWf,
      globalCount: reason.globalCount,
      globalWorkflows: globalWf,
    });
  }
  if (reason.kind === 'multiple-target-divergences') {
    const recommendation = t('pipeline.openspec.engine.divergence.recommendation');
    const targetDiffs = reason.targets.map((target) => {
      const missing = target.globalWorkflows
        .filter((w) => !target.targetWorkflows.includes(w))
        .sort();
      const extra = target.targetWorkflows
        .filter((w) => !target.globalWorkflows.includes(w))
        .sort();
      return {
        target,
        missing,
        extra,
      };
    });

    const firstMissingKey = targetDiffs[0]?.missing.join(',') ?? '';
    const allSameMissing =
      targetDiffs.length > 0 &&
      targetDiffs[0].missing.length > 0 &&
      targetDiffs.every((d) => d.missing.join(',') === firstMissingKey);
    const anyHasExtra = targetDiffs.some((d) => d.extra.length > 0);

    // Si a TODOS los agentes les falta lo mismo (y ninguno tiene de más):
    if (allSameMissing && !anyHasExtra) {
      const agents = formatAgentList(
        targetDiffs.map((d) => d.target.label),
        t,
      );
      const missingWfs = targetDiffs[0].missing.join(', ');
      return t('pipeline.openspec.engine.divergence.allMissing', {
        agents,
        missing: missingWfs,
        recommendation,
      });
    }

    // Si a todos les falta lo mismo pero alguno tiene de más:
    if (allSameMissing && anyHasExtra) {
      const agents = formatAgentList(
        targetDiffs.map((d) => d.target.label),
        t,
      );
      const missingWfs = targetDiffs[0].missing.join(', ');
      const mainSentence = t('pipeline.openspec.engine.divergence.allMissing', {
        agents,
        missing: missingWfs,
        recommendation: '',
      }).trimEnd();
      const extraLines = targetDiffs
        .filter((d) => d.extra.length > 0)
        .map((d) =>
          t('pipeline.openspec.engine.divergence.targetExtra', {
            target: d.target.label,
            extra: d.extra.join(', '),
          }),
        );
      return [mainSentence, ...extraLines, recommendation].join('\n');
    }

    // Si NO les falta lo mismo: una línea corta por agente con sólo lo que le falta
    // (y si alguno tiene de más, también, en una línea aparte), y la recomendación UNA vez al final.
    const lines: string[] = [];
    for (const d of targetDiffs) {
      if (d.missing.length > 0) {
        lines.push(
          t('pipeline.openspec.engine.divergence.targetMissing', {
            target: d.target.label,
            missing: d.missing.join(', '),
          }),
        );
      }
      if (d.extra.length > 0) {
        lines.push(
          t('pipeline.openspec.engine.divergence.targetExtra', {
            target: d.target.label,
            extra: d.extra.join(', '),
          }),
        );
      }
    }
    lines.push(recommendation);
    return lines.join('\n');
  }
  return '';
}

function resolveConfigureErrorMessage(
  error: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (error === 'openspec-cli-not-found') {
    return t('pipeline.openspec.engine.configureError.cliNotFound');
  }
  if (error === 'invalid-tool-id' || error === 'invalid_tools') {
    return t('pipeline.openspec.engine.configureError.invalidTool');
  }
  const detail = error && error.trim().length > 0
    ? error
    : t('pipeline.openspec.engine.configureError.unknown');
  return t('pipeline.openspec.engine.configureError.generic', { detail });
}

export const OpenSpecEngineCard: React.FC<OpenSpecEngineCardProps> = ({
  status,
  isLoading = false,
  compact = false,
  defaultAdvancedOpen = false,
  onOpenToolsTab,
  onOpenReview,
  isReviewOpen = false,
  hasPackageJson,
  openRepoPaths,
  nodePath,
  npmPath,
  repoPath,
  commandExecuted: propCommandExecuted,
  packageManagerPath,
  packageManagerName,
  onInstalled,
  onRequestUpdate,
  onChanged,
  title,
  section = 'all',
  uncommittedCount,
}) => {
  const t = useT();
  const [showAdvanced, setShowAdvanced] = useState(Boolean(defaultAdvancedOpen));
  const [copiedGlobal, setCopiedGlobal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installingMode, setInstallingMode] = useState<'local' | 'global' | null>(null);
  const [isConfirmingGlobal, setIsConfirmingGlobal] = useState(false);
  const [installResult, setInstallResult] = useState<OpenSpecInstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<string | null>(null);
  const [profileWriteError, setProfileWriteError] = useState<string | null>(null);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [configuringTool, setConfiguringTool] = useState<string | null>(null);
  const [configureErrors, setConfigureErrors] = useState<Record<string, string>>({});
  const [showPendingToolSelector, setShowPendingToolSelector] = useState(false);
  const [deselectedPendingTools, setDeselectedPendingTools] = useState<string[]>([]);
  const pendingToolsList = status?.pendingTools ?? [];
  const selectedPendingTools = pendingToolsList.filter((id) => !deselectedPendingTools.includes(id));
  const [configureSuccessMsg, setConfigureSuccessMsg] = useState<string | null>(null);
  const [configureGeneralError, setConfigureGeneralError] = useState<string | null>(null);

  const gitStoreRepoPath = useGitStore((s) => s.repoPath);
  const effectiveRepoPath = repoPath ?? gitStoreRepoPath ?? undefined;

  const handleConfigurePendingTools = async (toolIdsToConfigure: string[]) => {
    if (!effectiveRepoPath || configuringTool || toolIdsToConfigure.length === 0) return;
    const api = typeof window !== 'undefined' ? (window as unknown as { api?: typeof window.api }).api : null;
    if (!api?.pipelineInitOpenSpec) return;
    setConfiguringTool(toolIdsToConfigure.join(','));
    setConfigureGeneralError(null);
    setConfigureSuccessMsg(null);
    try {
      const configured = status?.toolReport?.tools?.filter((t) => t.configured).map((t) => t.id)
        ?? status?.installedIntegration?.configuredTools
        ?? [];
      const union = Array.from(new Set([...configured, ...toolIdsToConfigure]));
      const res = await api.pipelineInitOpenSpec(effectiveRepoPath, union);
      if (res?.success) {
        setShowPendingToolSelector(false);
        setDeselectedPendingTools([]);
        const configuredLabels = toolIdsToConfigure
          .map((id) => status?.toolReport?.tools.find((t) => t.id === id)?.label ?? id)
          .join(', ');
        const count = uncommittedCount ?? 0;
        const msg = count === 1
          ? t('pipeline.openspec.engine.configureSuccessResultSingle', { tools: configuredLabels })
          : count > 1
          ? t('pipeline.openspec.engine.configureSuccessResult', { tools: configuredLabels, count })
          : t('pipeline.openspec.engine.configureSuccessResultNoFiles', { tools: configuredLabels });
        setConfigureSuccessMsg(msg);
        usePipelineStore.getState().notifyEngineChanged();
        onChanged?.();
      } else {
        const msg = resolveConfigureErrorMessage(res?.error, t);
        setConfigureGeneralError(msg);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : String(err));
      const msg = resolveConfigureErrorMessage(errMsg, t);
      setConfigureGeneralError(msg);
    } finally {
      setConfiguringTool(null);
    }
  };

  const handleConfigurePendingTool = async (toolId: string) => {
    await handleConfigurePendingTools([toolId]);
  };

  const engineInstalled = status ? status.cli.installed : false;

  // 1. Modo compacto (Insignia para header / summaryBar)
  if (compact) {
    if (isLoading || !status) {
      return (
        <div className={styles.compactEngineBadge} data-state="loading" title={t('pipeline.openspec.engine.reading')}>
          <span className={styles.healthDot} data-state="loading" aria-hidden="true" />
          <span>{t('pipeline.openspec.engine.reading')}</span>
        </div>
      );
    }
    if (!engineInstalled) {
      return (
        <div
          className={styles.compactEngineBadge}
          data-state="absent"
          title={t('pipeline.openspec.engine.status.absent')}
          onClick={onOpenToolsTab}
          style={{ cursor: onOpenToolsTab ? 'pointer' : 'default' }}
        >
          <span className={styles.healthDot} data-state="absent" aria-hidden="true" />
          <span>{t('pipeline.openspec.engine.axis.engine')}: {t('pipeline.openspec.engine.status.absent')}</span>
        </div>
      );
    }
    const versionStr = `v${status.cli.runtimeVersion ?? '?'}`;
    const stateStr = t(INTEGRATION_STATE_KEY_MAP[status.integrationState] ?? 'pipeline.openspec.engine.integrationState.unknown');
    return (
      <div
        className={styles.compactEngineBadge}
        data-state={status.integrationState}
        title={`${versionStr} · ${stateStr}`}
        onClick={onOpenToolsTab}
        style={{ cursor: onOpenToolsTab ? 'pointer' : 'default' }}
      >
        <span className={styles.healthDot} data-state={status.integrationState} aria-hidden="true" />
        <strong>{t('pipeline.openspec.engine.axis.engine')} {versionStr}</strong>
        <em className={styles.compactMeta}>({stateStr})</em>
      </div>
    );
  }

  // Si solo se pide el bloque de perfil y no hay status o está cargando, no hay perfil que mostrar
  if (section === 'profile' && (!status || isLoading)) {
    return null;
  }

  // 2. Estado de Carga / Lectura (6.10: esqueleto con anatomía de motor + AGENTES)
  if (isLoading || !status) {
    return (
      <div
        className={styles.skeletonRoot}
        aria-busy="true"
        aria-label={title ?? t('pipeline.openspec.engine.cardTitle')}
        data-estado="loading"
      >
        <section className={styles.skeletonBlock}>
          <div className={styles.skeletonBlockTitle} />
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonLine} style={{ width: '45%' }} />
            <div className={styles.skeletonLine} style={{ width: '65%' }} />
            <div className={styles.skeletonLine} style={{ width: '35%' }} />
          </div>
        </section>

        <section className={styles.skeletonBlock}>
          <div className={styles.skeletonBlockTitle} style={{ width: '6rem' }} />
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonToolRow}>
              <div className={styles.skeletonToolIcon} />
              <div className={styles.skeletonToolName} />
              <div className={styles.skeletonToolDir} />
              <div className={styles.skeletonToolStatus} />
            </div>
            <div className={styles.skeletonToolRow}>
              <div className={styles.skeletonToolIcon} />
              <div className={styles.skeletonToolName} style={{ width: '7.5rem' }} />
              <div className={styles.skeletonToolDir} style={{ width: '5rem' }} />
              <div className={styles.skeletonToolStatus} />
            </div>
            <div className={styles.skeletonToolRow}>
              <div className={styles.skeletonToolIcon} />
              <div className={styles.skeletonToolName} style={{ width: '5rem' }} />
              <div className={styles.skeletonToolDir} style={{ width: '4rem' }} />
              <div className={styles.skeletonToolStatus} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const cli = status.cli;
  // Si la procedencia no coincide con los cuatro valores del contrato ('global', 'local',
  // 'managed', 'unknown'), se rotula como desconocida: declarar «ausente» ante un valor no
  // reconocido afirmaría falsamente que el motor no está instalado cuando en realidad se
  // descubrió un binario cuya ubicación no se pudo clasificar.
  const provenanceKey = (cli.provenance && PROVENANCE_KEY_MAP[cli.provenance]) ?? 'pipeline.openspec.engine.provenance.unknown';
  const provenanceLabel = t(provenanceKey);

  const latest = status.latestAvailable;
  let latestStatusText = '';
  if (status.freshnessState === 'cli-upgrade-available' && latest?.latestVersion) {
    latestStatusText = t('pipeline.openspec.engine.freshness.cliUpgradeAvailable', {
      version: latest.latestVersion,
    });
  } else if (status.freshnessState === 'cli-up-to-date') {
    latestStatusText = t('pipeline.openspec.engine.freshness.cliUpToDate');
  } else if (status.freshnessState === 'offline' || latest?.status === 'offline') {
    latestStatusText = t('pipeline.openspec.engine.freshness.offline');
  } else if (latest?.latestVersion) {
    const freshnessKey = latest.freshness === 'stale'
      ? 'pipeline.openspec.engine.cacheStatus.cachedStale'
      : latest.fromCache
      ? 'pipeline.openspec.engine.cacheStatus.cached'
      : 'pipeline.openspec.engine.cacheStatus.online';
    latestStatusText = `${t('pipeline.openspec.engine.latestAvailable', { version: latest.latestVersion })} (${t(freshnessKey, { age: latest.cacheAgeSeconds ?? 0 })})`;
  }

  const installed = status.installedIntegration;

  // Determinar estado general: ready | needs-attention | unknown
  const isBehind = isInstalledBehindCycle(cli.runtimeVersion);

  let generalStatus: 'ready' | 'needs-attention' | 'unknown' = 'ready';
  if (status.integrationState === 'unknown' || status.repoState === 'unknown') {
    generalStatus = 'unknown';
  } else if (
    !cli.installed ||
    cli.versionClass === 'too-old' ||
    status.integrationState === 'outdated' ||
    status.integrationState === 'conflicted' ||
    status.repoState === 'not-initialized' ||
    status.divergence?.isDivergent ||
    isBehind
  ) {
    generalStatus = 'needs-attention';
  }

  const generalStatusKey = GENERAL_STATUS_KEY_MAP[generalStatus];

  const versionClassKey = cli.versionClass ? (VERSION_CLASS_KEY_MAP[cli.versionClass] ?? 'pipeline.openspec.engine.versionClass.unknown') : 'pipeline.openspec.engine.versionClass.unknown';
  const versionClassText = t(versionClassKey, {
    min: cli.supportedRange?.min ?? SUPPORTED_OPENSPEC_VERSIONS.min,
  });
  const versionStr = cli.runtimeVersion ? `v${cli.runtimeVersion}` : '';
  const engineText = versionStr ? `${versionStr} · ${versionClassText}` : versionClassText;

  const divergence = status.divergence;

  // Perfil de workflows global (Tanda 7.2b). Las filas salen 100% de los datos
  // que ya llegan por `status.globalConfig`; no se hardcodea ningún nombre.
  // Los toggles solo se ofrecen cuando AMBAS fuentes están leídas ('read'):
  // con una fuente fallida, «deshabilitado» sería una afirmación falsa.
  const globalConfig = status.globalConfig;
  const rawProfile = globalConfig?.rawProfile ?? null;
  const isCustomProfile = rawProfile === 'custom';
  const profileDataReady =
    !!globalConfig &&
    globalConfig.profileState === 'read' &&
    globalConfig.workflowsState === 'read' &&
    globalConfig.resolvedWorkflowsState === 'read';
  const targetConvergences = status.divergence?.targetConvergences ?? null;
  const installedByTarget = targetConvergences
    ? Object.fromEntries(
        Object.entries(targetConvergences).map(([id, c]) => [id, c.installedWorkflows]),
      )
    : (status.installedIntegration?.installedWorkflowsByTarget ?? null);
  const agentLabel = (id: string) => targetConvergences?.[id]?.label ?? id;
  const profileRows = deriveProfileWorkflowRows(
    globalConfig?.configuredWorkflows ?? null,
    globalConfig?.resolvedWorkflows ?? null,
    installedByTarget,
  );
  const profileRowsVisible = profileDataReady && profileRows.length > 0;

  const hasProfileWriteChannel =
    typeof window !== 'undefined' && !!window.api?.pipelineOpenSpec?.setWorkflow;

  let profileBlockedReason: string | null = null;
  if (profileRowsVisible) {
    if (!isCustomProfile) {
      profileBlockedReason = t('pipeline.openspec.engine.profile.notCustomReason', {
        profile: rawProfile ?? '',
      });
    } else if (!hasProfileWriteChannel) {
      profileBlockedReason = t('pipeline.openspec.engine.profile.channelUnavailable');
    } else if (!effectiveRepoPath) {
      profileBlockedReason = t('pipeline.openspec.engine.profile.noRepo');
    }
  }

  const handleToggleProfile = async () => {
    if (isSwitchingProfile || pendingWorkflow !== null) return;
    if (typeof window === 'undefined' || !window.api?.pipelineOpenSpec?.setProfile) return;

    const targetProfile = isCustomProfile ? 'core' : 'custom';

    setIsSwitchingProfile(true);
    setProfileWriteError(null);

    try {
      const result = await window.api.pipelineOpenSpec.setProfile({ profile: targetProfile });
      if (result.ok) {
        usePipelineStore.getState().notifyEngineChanged();
        onChanged?.();
      } else {
        setProfileWriteError(result.error || t('pipeline.openspec.engine.profile.switchError'));
      }
    } catch (err: unknown) {
      setProfileWriteError((err as Error)?.message || t('pipeline.openspec.engine.profile.switchError'));
    } finally {
      setIsSwitchingProfile(false);
    }
  };

  const handleToggleWorkflow = async (workflow: string, enabled: boolean) => {
    if (pendingWorkflow !== null || !effectiveRepoPath) return;
    if (typeof window === 'undefined' || !window.api?.pipelineOpenSpec?.setWorkflow) return;

    setPendingWorkflow(workflow);
    setProfileWriteError(null);

    try {
      const result = await window.api.pipelineOpenSpec.setWorkflow({ workflow, enabled });
      if (result.ok) {
        usePipelineStore.getState().notifyEngineChanged();
        onChanged?.();
      } else {
        setProfileWriteError(result.error || t('pipeline.openspec.engine.profile.error'));
      }
    } catch (err: unknown) {
      setProfileWriteError((err as Error)?.message || t('pipeline.openspec.engine.profile.error'));
    } finally {
      setPendingWorkflow(null);
    }
  };

  const displayCommand = installResult?.commandExecuted || propCommandExecuted || null;
  const resolvedNodePath = installResult?.nodePath ?? nodePath;
  const resolvedPmPath = installResult?.packageManagerPath ?? packageManagerPath ?? npmPath;

  const isLocalBlocked =
    hasPackageJson === false ||
    !effectiveRepoPath ||
    (typeof window !== 'undefined' && !window.api?.pipelineOpenSpec?.installLocal);

  let localBlockedReason: string | null = null;
  if (hasPackageJson === false) {
    localBlockedReason = t('pipeline.openspec.engine.install.localNoManifest');
  } else if (!effectiveRepoPath || (typeof window !== 'undefined' && !window.api?.pipelineOpenSpec?.installLocal)) {
    localBlockedReason = t('pipeline.openspec.engine.install.localUnavailable');
  }

  const handleInstallLocal = async () => {
    if (isInstalling || isLocalBlocked || !effectiveRepoPath) return;
    if (typeof window === 'undefined' || !window.api?.pipelineOpenSpec?.installLocal) return;

    setIsInstalling(true);
    setInstallingMode('local');
    setInstallResult(null);
    setInstallError(null);

    try {
      const result = await window.api.pipelineOpenSpec.installLocal({ repoPath: effectiveRepoPath });
      setInstallResult(result);
      if (result.success) {
        onInstalled?.(result);
      } else {
        const errorMsg =
          formatInstallErrorCode(result.code, t) ||
          result.error ||
          t('pipeline.openspec.engine.install.error.installFailed');
        setInstallError(errorMsg);
      }
    } catch (err: unknown) {
      setInstallError((err as Error)?.message || t('pipeline.openspec.engine.install.error.installFailed'));
    } finally {
      setIsInstalling(false);
      setInstallingMode(null);
    }
  };

  // 1. MOTOR
  const motorBlock = (
    <section className={styles.reviewBlock} aria-label={title ?? t('pipeline.openspec.config.engineBlock')}>
        {/* VISTA PRIMARIA: Información comprensible y accionable */}
        <header className={styles.engineCardHeader}>
          <div className={styles.engineTitleRow}>
            <div className={styles.engineTitleLeft}>
              <h3 className={styles.reviewSectionTitle}>
                {title ?? t('pipeline.openspec.config.engineBlock')}
              </h3>
            <span className={styles.generalStatusBadge} data-status={generalStatus}>
              {generalStatus === 'ready' && <CheckCircle2 size={13} aria-hidden="true" />}
              {generalStatus === 'needs-attention' && <AlertTriangle size={13} aria-hidden="true" />}
              {generalStatus === 'unknown' && <HelpCircle size={13} aria-hidden="true" />}
              {t(generalStatusKey)}
            </span>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={t('pipeline.openspec.engine.reread')}
            title={t('pipeline.openspec.engine.reread')}
            onClick={() => {
              usePipelineStore.getState().notifyEngineChanged();
              onChanged?.();
            }}
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>
      </header>

      {isOpenSpecEngineStatusIncomplete(status) && (
        <p className={styles.blockedReasonInline} role="alert">
          {t('pipeline.openspec.engine.incompleteRead')}
        </p>
      )}

      {/* Acciones upfront que preceden al diagnóstico (Tarea 9.1 & 9.5) */}
      {onOpenReview && !isReviewOpen && (
        <div className={styles.engineActionsRow}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onOpenReview}
          >
            {t('pipeline.openspec.engine.reviewAction')}
          </button>
        </div>
      )}

      {/* Surface de instalación honesta del motor cuando no está instalado (Tareas 9.2, 9.3, 9.5) */}
      {!engineInstalled && (
        <div className={styles.engineInstallSection} aria-label={t('pipeline.openspec.engine.install.globalTitle')}>
          {/* Instalación local: botón con estado de progreso y motivo inline si está bloqueada (9.2 y 9.5) */}
          <Row gap="2" wrap>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={handleInstallLocal}
              disabled={isInstalling || isLocalBlocked}
              title={localBlockedReason || undefined}
            >
              {isInstalling && installingMode === 'local' ? (
                <>
                  <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                  <span>{t('pipeline.openspec.engine.install.installingLocal')}</span>
                </>
              ) : (
                t('pipeline.openspec.engine.install.localTitle')
              )}
            </button>
            {localBlockedReason && (
              <span className={styles.blockedReasonInline} role="alert">
                {localBlockedReason}
              </span>
            )}
          </Row>

          {/* Instalación global y confirmación previa (9.3 y 9.5) */}
          {!isConfirmingGlobal ? (
            <>
              <Row gap="2" wrap>
                <button
                  type="button"
                  className={styles.primaryAction}
                  onClick={() => {
                    setInstallError(null);
                    setIsConfirmingGlobal(true);
                  }}
                  disabled={
                    isInstalling ||
                    (typeof window !== 'undefined' && !window.api?.pipelineOpenSpec?.installGlobal)
                  }
                  title={
                    typeof window !== 'undefined' && !window.api?.pipelineOpenSpec?.installGlobal
                      ? t('pipeline.openspec.engine.install.globalUnavailable')
                      : undefined
                  }
                >
                  {isInstalling && installingMode === 'global' ? (
                    <>
                      <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                      <span>{t('pipeline.openspec.engine.install.installingGlobal')}</span>
                    </>
                  ) : (
                    t('pipeline.openspec.engine.install.globalTitle')
                  )}
                </button>
                {typeof window !== 'undefined' && !window.api?.pipelineOpenSpec?.installGlobal && (
                  <span className={styles.blockedReasonInline} role="alert">
                    {t('pipeline.openspec.engine.install.globalUnavailable')}
                  </span>
                )}
              </Row>

              {/* Comando literal dinámico con botón de copiado (9.3) */}
              {displayCommand ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                  <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)' }}>
                    {displayCommand}
                  </code>
                  <button
                    type="button"
                    className={styles.reviewCopyBtn}
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        void navigator.clipboard.writeText(displayCommand);
                        setCopiedGlobal(true);
                        setTimeout(() => setCopiedGlobal(false), 2000);
                      }
                    }}
                    title={t('pipeline.openspec.archive.copyCommand')}
                  >
                    {copiedGlobal ? (
                      <>
                        <Check size={12} aria-hidden="true" />
                        <span>{t('pipeline.openspec.archive.copiedCommand')}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} aria-hidden="true" />
                        <span>{t('pipeline.openspec.archive.copyCommand')}</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {t('pipeline.openspec.engine.install.commandPendingResolution')}
                </p>
              )}

              <div className={styles.engineInstallDetails}>
                <p style={{ margin: 'var(--space-1) 0 0' }}>
                  {t('pipeline.openspec.engine.hostUpgrade.help')}
                </p>
                {resolvedNodePath && (
                  <p style={{ margin: 'var(--space-1) 0 0' }}>
                    <code>Node: {resolvedNodePath}</code>
                  </p>
                )}
                {resolvedPmPath && (
                  <p style={{ margin: 'var(--space-1) 0 0' }}>
                    <code>{`${packageManagerName ?? 'npm'}: ${resolvedPmPath}`}</code>
                  </p>
                )}
                {openRepoPaths && openRepoPaths.length > 0 && (
                  <p style={{ margin: 'var(--space-1) 0 0' }}>
                    <span>{t('pipeline.openspec.engine.install.affectedRepos', { count: openRepoPaths.length })} </span>
                    <code>{openRepoPaths.join(', ')}</code>
                  </p>
                )}
              </div>
            </>
          ) : (
            <OpenSpecGlobalInstallConfirm
              command={displayCommand}
              nodePath={resolvedNodePath}
              packageManagerPath={resolvedPmPath}
              packageManagerName={packageManagerName}
              openRepoPaths={openRepoPaths}
              repoPath={effectiveRepoPath}
              installedVersion={cli.runtimeVersion}
              isBusy={isInstalling}
              onCancel={() => setIsConfirmingGlobal(false)}
              onInstalled={(result) => {
                setInstallResult(result);
                onInstalled?.(result);
              }}
            />
          )}

        </div>
      )}

      {/* Feedback de resultado de instalación (éxito o error) */}
      {installResult?.success && (
        <div className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackSuccess}`} role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>
            {installResult.mode === 'local'
              ? t('pipeline.openspec.engine.install.successLocal')
              : t('pipeline.openspec.engine.install.successGlobal')}
          </span>
        </div>
      )}

      {installError && (
        <div className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`} role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{installError}</span>
        </div>
      )}

      <div className={styles.primarySummaryBox}>
        <div className={styles.summaryFactRow}>
          <span>{t('pipeline.openspec.engine.axis.engine')}:</span>
          <strong>
            {cli.installed ? engineText : t('pipeline.openspec.engine.status.absent')}
          </strong>
          {latestStatusText && <small className={styles.axisMeta}>· {latestStatusText}</small>}
        </div>

        <div className={styles.summaryFactRow}>
          <span>{t('pipeline.openspec.engine.cycleVersion', { version: OPENSPEC_CYCLE_TARGET_VERSION })}</span>
        </div>

        {isBehind && (
          <div className={styles.summaryFactRow} role="status">
            <span style={{ color: 'var(--color-warning)' }}>
              <AlertTriangle size={13} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 'var(--space-1)' }} />
              {t('pipeline.openspec.engine.versionBehindCycle', {
                installed: cli.runtimeVersion ?? '?',
                cycle: OPENSPEC_CYCLE_TARGET_VERSION,
              })}
            </span>
          </div>
        )}

        <div className={styles.summaryFactRow}>
          <span>{t('pipeline.openspec.engine.axis.repo')}:</span>
          <strong data-state={status.repoState}>
            {t(REPO_STATE_KEY_MAP[status.repoState] ?? 'pipeline.openspec.engine.repoState.unknown')}
          </strong>
        </div>

        <div className={styles.summaryFactRow}>
          <span>{t('pipeline.openspec.engine.axis.integration')}:</span>
          <strong data-state={status.integrationState}>
            {t(INTEGRATION_STATE_KEY_MAP[status.integrationState] ?? 'pipeline.openspec.engine.integrationState.unknown')}
          </strong>
        </div>

        {status.pendingTools && status.pendingTools.length > 0 && (
          <Stack gap="1">
            {(() => {
              const pendingLabels = status.pendingTools
                .map((id) => status.toolReport?.tools.find((t) => t.id === id)?.label ?? id)
                .join(', ');
              return (
                <div className={styles.summaryFactRow}>
                  <span style={{ color: 'var(--color-warning)' }}>
                    {t('pipeline.openspec.engine.pendingToolsDetected', { tools: pendingLabels })}
                  </span>
                  {effectiveRepoPath && (
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      disabled={Boolean(configuringTool)}
                      onClick={() => setShowPendingToolSelector((prev) => !prev)}
                    >
                      {configuringTool ? (
                        <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                      ) : (
                        t('pipeline.openspec.engine.configureActionEllipsis')
                      )}
                    </button>
                  )}
                </div>
              );
            })()}

            {showPendingToolSelector && (
              <fieldset className={styles.pendingToolsSelectorFieldset} disabled={Boolean(configuringTool)}>
                <legend className={styles.pendingToolsSelectorLegend}>
                  {t('pipeline.openspec.engine.configureAction')}
                </legend>
                <ul className={styles.railChooseList}>
                  {status.pendingTools.map((toolId) => {
                    const toolItem = status.toolReport?.tools.find((t) => t.id === toolId);
                    const label = toolItem?.label ?? toolId;
                    const checked = selectedPendingTools.includes(toolId);
                    return (
                      <li key={toolId}>
                        <label className={styles.railChooseOption}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDeselectedPendingTools((prev) => prev.filter((id) => id !== toolId));
                              } else {
                                setDeselectedPendingTools((prev) => [...prev, toolId]);
                              }
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className={styles.pendingToolsSelectorActions}>
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    disabled={Boolean(configuringTool) || selectedPendingTools.length === 0}
                    onClick={() => void handleConfigurePendingTools(selectedPendingTools)}
                  >
                    {configuringTool ? (
                      <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                    ) : (
                      t('pipeline.openspec.engine.configureAction')
                    )}
                  </button>
                </div>
              </fieldset>
            )}

            {configureSuccessMsg && (
              <div className={styles.summaryFactRow} role="status">
                <span style={{ color: 'var(--color-git-add)' }}>{configureSuccessMsg}</span>
              </div>
            )}

            {configureGeneralError && (
              <div className={styles.summaryFactRow} role="alert">
                <span style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>
                  {configureGeneralError}
                </span>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  disabled={Boolean(configuringTool)}
                  onClick={() => void handleConfigurePendingTools(selectedPendingTools.length > 0 ? selectedPendingTools : status.pendingTools!)}
                >
                  {t('pipeline.openspec.engine.configureAction')}
                </button>
              </div>
            )}
          </Stack>
        )}

        {status.toolReport?.source === 'gitcron-fallback' && (
          <div className={styles.summaryFactRow} role="status">
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
              {t('pipeline.openspec.engine.fallbackNotice', {
                reason: resolveFallbackReasonText(status.toolReport.fallbackReason, t),
              })}
            </span>
          </div>
        )}
      </div>

      {/* Botón de Diagnóstico Avanzado */}
      <button
        type="button"
        className={styles.toggleAdvancedBtn}
        onClick={() => setShowAdvanced((prev) => !prev)}
        aria-expanded={showAdvanced}
      >
        <span>
          {showAdvanced
            ? t('pipeline.openspec.engine.hideAdvanced')
            : t('pipeline.openspec.engine.showAdvanced')}
        </span>
        {showAdvanced ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>

      {/* VISTA AVANZADA DESPLEGABLE (Accordion con Scroll Interno Propio) */}
      {showAdvanced && (
        <div className={styles.advancedDiagnosticsContainer}>
          <div className={styles.advancedColumnMain}>
            <div className={styles.engineAxesGrid}>
            {/* Ruta y Procedencia del Ejecutable */}
            <div className={styles.engineAxisItem} tabIndex={0}>
              <span className={styles.axisLabel}>{t('pipeline.openspec.engine.advanced.routeAndProvenance')}</span>
              <strong className={styles.axisValue}>
                <span className={styles.provenanceBadge} data-provenance={cli.provenance}>
                  {provenanceLabel}
                </span>
              </strong>
              {cli.displayPath && (
                <code className={styles.displayPathCode} title={cli.displayPath}>
                  {cli.displayPath}
                </code>
              )}
            </div>

            {/* Evidencia del Repositorio */}
            <div className={styles.engineAxisItem} tabIndex={0}>
              <span className={styles.axisLabel}>{t('pipeline.openspec.engine.advanced.repoEvidence')}</span>
              <strong className={styles.axisValue} data-state={status.repoState}>
                {t(REPO_STATE_KEY_MAP[status.repoState] ?? 'pipeline.openspec.engine.repoState.unknown')}
              </strong>
              {installed?.generatedBy && (
                <small className={styles.axisMeta}>
                  {t('pipeline.openspec.engine.generatedByLabel', { version: installed.generatedBy })}
                </small>
              )}
            </div>
          </div>
        </div>

        <div className={styles.advancedColumnSide}>
          {/* Diagnósticos del Motor CLI (openspec doctor & context) (Grupo 3b) */}
          <div className={styles.cliDiagnosticsSection}>
            {/* 1. openspec doctor --json */}
            <Stack gap="1" data-testid="openspec-doctor-section">
              <h3 className={styles.reviewSectionTitle}>
                {t('pipeline.openspec.engine.advanced.doctorTitle')}
              </h3>
              <p className={styles.inventoryHelp}>
                {t('pipeline.openspec.engine.advanced.doctorHelp')}
              </p>
              <code className={styles.cliCommandProvenance}>openspec doctor --json</code>
              {!status.doctor ? (
                <p className={styles.cliDiagnosticUnavailable}>
                  {t('pipeline.openspec.engine.advanced.cliUnavailable')}
                </p>
              ) : !status.doctor.ok ? (
                <p className={styles.cliDiagnosticUnavailable}>
                  {status.doctor.error || t('pipeline.openspec.engine.advanced.cliUnavailable')}
                </p>
              ) : (
                (() => {
                  const doctorDiagnostics: OpenSpecStoreDiagnostic[] = [
                    ...(status.doctor.data?.status ?? []),
                    ...(status.doctor.data?.root?.status ?? []),
                    ...(status.doctor.data?.store?.status ?? []),
                    ...(status.doctor.data?.references?.flatMap((r) => r.status ?? []) ?? []),
                  ];
                  if (doctorDiagnostics.length === 0) {
                    return (
                      <p className={styles.cliDiagnosticClean}>
                        {t('pipeline.openspec.engine.advanced.cliClean')}
                      </p>
                    );
                  }
                  return (
                    <PlainList gap="1">
                      {doctorDiagnostics.map((diag, idx) => (
                        <li key={`${diag.code}-${idx}`} className={styles.cliDiagnosticItem}>
                          <Row gap="2">
                            <span className={styles.cliSeverityBadge} data-severity={diag.severity}>
                              {diag.severity}
                            </span>
                            <span>{diag.message}</span>
                          </Row>
                          {diag.fix && (
                            <span className={styles.cliDiagnosticFix}>
                              {t('pipeline.openspec.engine.advanced.fixLabel', { fix: diag.fix })}
                            </span>
                          )}
                        </li>
                      ))}
                    </PlainList>
                  );
                })()
              )}
            </Stack>

            {/* 2. openspec context --json */}
            <Stack gap="1" data-testid="openspec-context-section">
              <h3 className={styles.reviewSectionTitle}>
                {t('pipeline.openspec.engine.advanced.contextTitle')}
              </h3>
              <p className={styles.inventoryHelp}>
                {t('pipeline.openspec.engine.advanced.contextHelp')}
              </p>
              <code className={styles.cliCommandProvenance}>openspec context --json</code>
              {!status.contextBrief ? (
                <p className={styles.cliDiagnosticUnavailable}>
                  {t('pipeline.openspec.engine.advanced.cliUnavailable')}
                </p>
              ) : !status.contextBrief.ok ? (
                <p className={styles.cliDiagnosticUnavailable}>
                  {status.contextBrief.error || t('pipeline.openspec.engine.advanced.cliUnavailable')}
                </p>
              ) : (
                (() => {
                  const contextDiagnostics: OpenSpecStoreDiagnostic[] = [
                    ...(status.contextBrief.data?.status ?? []),
                    ...(status.contextBrief.data?.members?.flatMap((m) => m.status ?? []) ?? []),
                  ];
                  if (contextDiagnostics.length === 0) {
                    return (
                      <p className={styles.cliDiagnosticClean}>
                        {t('pipeline.openspec.engine.advanced.cliClean')}
                      </p>
                    );
                  }
                  return (
                    <PlainList gap="1">
                      {contextDiagnostics.map((diag, idx) => (
                         <li key={`${diag.code}-${idx}`} className={styles.cliDiagnosticItem}>
                          <Row gap="2">
                            <span className={styles.cliSeverityBadge} data-severity={diag.severity}>
                              {diag.severity}
                            </span>
                            <span>{diag.message}</span>
                          </Row>
                          {diag.fix && (
                            <span className={styles.cliDiagnosticFix}>
                              {t('pipeline.openspec.engine.advanced.fixLabel', { fix: diag.fix })}
                            </span>
                          )}
                        </li>
                      ))}
                    </PlainList>
                  );
                })()
              )}
            </Stack>
          </div>
        </div>
      </div>
    )}
  </section>
  );

  // 2. PERFIL DE WORKFLOWS
  const profileBlock = (
    <section className={styles.reviewBlock} aria-label={t('pipeline.openspec.config.profileBlock')}>
    <h3 className={styles.reviewSectionTitle}>{t('pipeline.openspec.config.profileBlock')}</h3>
    <div className={styles.summaryFactRow}>
      <span>
        {t('pipeline.openspec.engine.advanced.globalLabel')}: <strong>{divergence?.globalProfileClass ?? 'unknown'}</strong> | {t('pipeline.openspec.engine.advanced.repoLabel')}: <strong>{divergence?.repoProfileClass ?? 'unknown'}</strong>
      </span>
    </div>

    <div className={styles.profileWorkflowSection}>
      <div className={styles.profileWorkflowHeader}>
        <div className={styles.profileWorkflowTitleRow}>
          <span className={styles.inventoryTitle}>{t('pipeline.openspec.engine.profile.title')}</span>
          {profileRowsVisible && (
            <button
              type="button"
              role="button"
              aria-pressed={isCustomProfile}
              className={styles.profileLockBtn}
              data-state={isCustomProfile ? 'custom' : 'preset'}
              disabled={isSwitchingProfile || pendingWorkflow !== null}
              title={
                isCustomProfile
                  ? t('pipeline.openspec.engine.profile.lockOpenTitle')
                  : (profileBlockedReason ?? t('pipeline.openspec.engine.profile.notCustomReason', { profile: rawProfile ?? 'core' }))
              }
              onClick={() => void handleToggleProfile()}
            >
              {isSwitchingProfile ? (
                <Loader2 size={13} className={styles.spin} aria-hidden="true" />
              ) : isCustomProfile ? (
                <LockOpen size={13} aria-hidden="true" />
              ) : (
                <Lock size={13} aria-hidden="true" />
              )}
              <span className={styles.profileLockName}>{rawProfile ?? (isCustomProfile ? 'custom' : 'core')}</span>
            </button>
          )}
        </div>
        {profileBlockedReason && (
          <span className={styles.blockedReasonInline} role="alert">
            {profileBlockedReason}
          </span>
        )}
      </div>
      <p className={styles.inventoryHelp}>
        {t('pipeline.openspec.engine.profile.help')}
      </p>

      {!profileRowsVisible ? (
        <p className={styles.cliDiagnosticUnavailable}>
          {t('pipeline.openspec.engine.profile.noData')}
        </p>
      ) : (
        <ul className={styles.profileWorkflowList}>
          {profileRows.map((row) => (
            <li
              key={row.workflow}
              className={styles.profileWorkflowRow}
              data-state={row.enabled ? 'enabled' : 'disabled'}
            >
              <code className={styles.profileWorkflowName}>{row.workflow}</code>
              <span
                className={styles.profileWorkflowState}
                data-state={row.enabled ? 'enabled' : 'disabled'}
              >
                {t(row.enabled
                  ? 'pipeline.openspec.engine.profile.enabled'
                  : 'pipeline.openspec.engine.profile.disabledByProfile')}
              </span>
              {pendingWorkflow === row.workflow ? (
                <span className={styles.profileSaving} role="status">
                  <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                  {t('pipeline.openspec.engine.profile.saving')}
                </span>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={t(row.enabled
                    ? 'pipeline.openspec.engine.profile.toggleOff'
                    : 'pipeline.openspec.engine.profile.toggleOn', { workflow: row.workflow })}
                  className={styles.profileSwitch}
                  data-state={row.enabled ? 'on' : 'off'}
                  disabled={pendingWorkflow !== null || profileBlockedReason !== null || isSwitchingProfile || !isCustomProfile}
                  title={profileBlockedReason ?? undefined}
                  onClick={() => void handleToggleWorkflow(row.workflow, !row.enabled)}
                >
                  <span className={styles.profileSwitchThumb} aria-hidden="true" />
                </button>
              )}
              {row.missingByIntegration.length > 0 && (
                <div className={styles.profileWorkflowCause} data-cause="integration">
                  <span>
                    {t('pipeline.openspec.engine.profile.missingIntegration', {
                      agents: formatAgentList(row.missingByIntegration.map(agentLabel), t),
                    })}
                  </span>
                  {onRequestUpdate && (
                    <button
                      type="button"
                      className={styles.profileCauseAction}
                      onClick={onRequestUpdate}
                    >
                      {t('pipeline.openspec.engine.summary.updateAll')}
                    </button>
                  )}
                </div>
              )}
              {row.missingByProfile.length > 0 && (
                <div className={styles.profileWorkflowCause} data-cause="profile">
                  <span>
                    {t('pipeline.openspec.engine.profile.missingProfile', {
                      agents: formatAgentList(row.missingByProfile.map(agentLabel), t),
                    })}
                  </span>
                  {isCustomProfile ? (
                    <button
                      type="button"
                      className={styles.profileCauseAction}
                      disabled={pendingWorkflow !== null || profileBlockedReason !== null || isSwitchingProfile || !isCustomProfile}
                      onClick={() => void handleToggleWorkflow(row.workflow, true)}
                    >
                      {t('pipeline.openspec.engine.profile.toggleOn', { workflow: row.workflow })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.profileCauseAction}
                      disabled={isSwitchingProfile}
                      onClick={() => void handleToggleProfile()}
                    >
                      {t('pipeline.openspec.engine.profile.switchToCustom')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {profileWriteError && (
        <div className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`} role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{profileWriteError}</span>
        </div>
      )}
    </div>

    {/* Declaración de divergencia o convergencia */}
    {divergence && (
      <div
        className={styles.divergenceNotice}
        data-status={divergence.isDivergent
          ? 'divergent'
          : divergence.overallStatus === 'convergent' ? 'convergent' : 'unknown'}
      >
        {divergence.isDivergent ? (
          <span className={styles.divergentText}>
            {t('pipeline.openspec.engine.advanced.divergentNotice', {
              reason: formatDivergenceReason(divergence.reason, t),
            })}
          </span>
        ) : divergence.overallStatus === 'convergent' ? (
          <span className={styles.convergentText}>
            {t('pipeline.openspec.engine.advanced.convergentNotice', { profile: divergence.repoProfileClass })}
          </span>
        ) : (
          <span className={styles.axisMeta}>
            {t('pipeline.openspec.engine.advanced.undeterminedNotice')}
          </span>
        )}
      </div>
    )}
  </section>
  );

  if (section === 'motor') {
    return motorBlock;
  }
  if (section === 'profile') {
    return profileBlock;
  }
  return (
    <>
      {motorBlock}
      {profileBlock}
    </>
  );
};
