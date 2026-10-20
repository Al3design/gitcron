'use client';

// components/cartography/ScreenDetail.tsx
//
// Vista de detalle de una pantalla individual de Cartografía (decisión 9, tarea 2.2).
// Muestra cabecera con nombre, lugar, ícono de IA y botón de cerrar; captura grande;
// qué hace (desde caché o aviso para consultar); y archivos agrupados por rol
// en un control segmentado con scroll independiente.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ExternalLink, GitCompare, Maximize2, Minimize2, Monitor, PanelsTopLeft, Sparkles, X } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { DiffViewer } from '@/components/DiffViewer';
import { cn } from '@/lib/utils';
import type { ScreenCapture, ScreenCaptureRunResult, ScreenDescription, ScreenEntry, ScreenFileLink, ScreenFileRole } from '@/types/screen-map';
import { CompositionBar, getRoleGroupItems } from './ScreenCard';
import styles from './ScreenCatalog.module.css';

export interface ScreenDetailProps {
  screen: ScreenEntry;
  repoPath: string;
  capture?: ScreenCapture;
  lastRun?: ScreenCaptureRunResult | null;
  onClose: () => void;
  onExplain?: (screen: ScreenEntry) => void;
  onAskFile?: (path: string) => void;
}

const ROLE_ORDER: ScreenFileRole[] = [
  'screen',
  'component',
  'style',
  'data',
  'logic',
  'text',
  'other',
];

function groupFilesByRole(files: ScreenFileLink[]): Map<ScreenFileRole, ScreenFileLink[]> {
  const map = new Map<ScreenFileRole, ScreenFileLink[]>();
  for (const file of files) {
    const effectiveRole: ScreenFileRole = file.provenance === 'unknown' ? 'other' : file.role;
    const list = map.get(effectiveRole) ?? [];
    list.push(file);
    map.set(effectiveRole, list);
  }
  for (const [, list] of map.entries()) {
    list.sort((a, b) => {
      if (a.provenance === 'unknown' && b.provenance !== 'unknown') return 1;
      if (a.provenance !== 'unknown' && b.provenance === 'unknown') return -1;
      return a.path.localeCompare(b.path);
    });
  }
  return map;
}

function DetailHeader({
  screen,
  displayName,
  locationSubtitle,
  locationTooltip,
  onExplain,
  onClose,
  t,
}: {
  screen: ScreenEntry;
  displayName: string;
  locationSubtitle: string;
  locationTooltip: string;
  onExplain?: (screen: ScreenEntry) => void;
  onClose: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleGroup}>
        <h3 className={styles.cardTitle}>{displayName}</h3>
        <p className={styles.cardSubtitle} title={locationTooltip}>
          {locationSubtitle}
        </p>
        {screen.tags && screen.tags.length > 0 && (
          <div className={styles.detailTagsList} data-testid="detail-tags-list">
            {screen.tags.map((tEvidence) => {
              const tagLabel = t(`cartography.screens.tags.${tEvidence.tag}`);
              const fileNames = tEvidence.files.map((p) => p.split('/').pop() ?? p).join(', ');
              const whyTooltip = t('cartography.screens.tagWhy', { files: fileNames });
              return (
                <span
                  key={tEvidence.tag}
                  className={cn(styles.tagChip, styles[`tag_${tEvidence.tag}`])}
                  title={whyTooltip}
                  data-testid={`detail-tag-${tEvidence.tag}`}
                >
                  <span className={cn(styles.tagDot, styles[`tag_${tEvidence.tag}`])} />
                  <span>{tagLabel}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.detailActions}>
        <button
          type="button"
          className={styles.aiIconButtonVisible}
          onClick={() => onExplain?.(screen)}
          title={t('cartography.screens.explainAction')}
          aria-label={t('cartography.screens.explainAction')}
          data-testid="detail-explain-button"
        >
          <Sparkles size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          title={t('cartography.screens.closeDetail')}
          aria-label={t('cartography.screens.closeDetail')}
          data-testid="detail-close-button"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function DetailCaptureView({
  capture,
  screenKind,
  skippedItem,
  expanded,
  onToggleExpanded,
  t,
}: {
  capture?: ScreenCapture;
  screenKind: 'route' | 'view';
  skippedItem?: { reason: string; detail?: string } | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const zoomLabel = expanded ? t('cartography.screens.captureShrink') : t('cartography.screens.captureExpand');
  return (
    <>
      <div className={styles.detailCapture} data-testid="detail-capture">
        {capture && (
          <button
            type="button"
            className={styles.captureZoomBtn}
            onClick={onToggleExpanded}
            title={zoomLabel}
            aria-label={zoomLabel}
            aria-pressed={expanded}
            data-testid="detail-capture-zoom"
          >
            {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
        )}
        {capture ? (
          <img src={capture.dataUrl} alt="" className={styles.captureImage} />
        ) : screenKind === 'route' ? (
          <Monitor size={36} aria-hidden="true" />
        ) : (
          <PanelsTopLeft size={36} aria-hidden="true" />
        )}
        {capture?.stale && (
          <span className={styles.staleBadge} data-testid="detail-stale-badge">
            {t('cartography.screens.captures.stale')}
          </span>
        )}
      </div>

      {skippedItem && (
        <p className={styles.detailCaptureReason} data-testid="detail-capture-reason">
          {skippedItem.reason === 'recipe-failed'
            ? t('cartography.screens.captures.detailRecipeFailed', { detail: skippedItem.detail ?? '' })
            : t('cartography.screens.captures.detailNoRecipe')}
        </p>
      )}
    </>
  );
}

function DetailDescription({
  description,
  t,
}: {
  description: ScreenDescription | null;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <section className={styles.section} aria-label="Qué hace">
      <h4 className={styles.sectionLabel}>Qué hace</h4>
      {description ? (
        <div className={styles.descriptionBox} data-testid="screen-description">
          <p className={styles.descriptionText}>{description.text}</p>
          {description.source === 'ai' && (
            <div className={styles.aiBadgeRow}>
              <div className={cn('ai-gradient-text', styles.aiBadgeRow)}>
                <Sparkles size={12} aria-hidden="true" />
                <span>{t('cartography.screens.aiSuggested')}</span>
              </div>
            </div>
          )}
          {description.citedFiles && description.citedFiles.length > 0 && (
            <div className={styles.citedSources} data-testid="screen-cited-files">
              <span>Según:</span>
              {description.citedFiles.map((fPath) => {
                const baseName = fPath.split('/').pop() ?? fPath;
                return (
                  <span key={fPath} className={styles.sourcePill} title={fPath}>
                    {baseName}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className={styles.askAiHint} data-testid="screen-ask-ai-hint">
          {t('cartography.screens.askAiHint')}
        </p>
      )}
    </section>
  );
}

function getFileProvenance(
  provenance: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): { label: string | null; hint?: string } {
  if (provenance === 'static') {
    return {
      label: t('cartography.screens.provenance.static'),
      hint: t('cartography.screens.provenance.staticHint'),
    };
  }
  if (provenance === 'inferred') {
    return {
      label: t('cartography.screens.provenance.inferred'),
      hint: t('cartography.screens.provenance.inferredHint'),
    };
  }
  if (provenance === 'manual') {
    return {
      label: t('cartography.screens.provenance.manual'),
      hint: t('cartography.screens.provenance.manualHint'),
    };
  }
  return { label: null };
}

function DetailFileActions({
  filePath,
  repoPath,
  isDiffOpen,
  hasChanges,
  onToggleDiff,
  onAskFile,
  t,
}: {
  filePath: string;
  repoPath: string;
  isDiffOpen: boolean;
  hasChanges: boolean;
  onToggleDiff: (path: string) => void;
  onAskFile?: (path: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const handleOpenFile = async () => {
    try {
      const res = await window.api.shellOpenItem(repoPath, filePath);
      if (!res.success) {
        useGitStore
          .getState()
          .setError(t('cartography.screens.fileOpenFailed', { error: res.error ?? '' }));
      }
    } catch (err) {
      useGitStore
        .getState()
        .setError(
          t('cartography.screens.fileOpenFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }
  };

  const diffTitle = t(
    isDiffOpen ? 'cartography.screens.fileHideDiff' : 'cartography.screens.fileShowDiff',
  );

  return (
    <div className={styles.fileActions}>
      <button
        type="button"
        className={cn(styles.fileActionButton, styles.fileAskButton)}
        onClick={() => onAskFile?.(filePath)}
        title={t('cartography.screens.fileAsk')}
        aria-label={t('cartography.screens.fileAsk')}
        data-testid={`file-ask-${filePath}`}
      >
        <Sparkles size={14} aria-hidden="true" />
      </button>

      {hasChanges && (
        <button
          type="button"
          className={cn(
            styles.fileActionButton,
            isDiffOpen && styles.fileActionButtonActive,
          )}
          onClick={() => onToggleDiff(filePath)}
          title={diffTitle}
          aria-label={diffTitle}
          aria-pressed={isDiffOpen}
          data-testid={`file-diff-${filePath}`}
        >
          <GitCompare size={14} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className={styles.fileActionButton}
        onClick={handleOpenFile}
        title={t('cartography.screens.fileOpen')}
        aria-label={t('cartography.screens.fileOpen')}
        data-testid={`file-open-${filePath}`}
      >
        <ExternalLink size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function DetailFileItem({
  file,
  repoPath,
  isDiffOpen,
  hasChanges,
  onToggleDiff,
  onAskFile,
  t,
}: {
  file: ScreenFileLink;
  repoPath: string;
  isDiffOpen: boolean;
  hasChanges: boolean;
  onToggleDiff: (path: string) => void;
  onAskFile?: (path: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const baseName = file.path.split('/').pop() ?? file.path;
  const lastSlash = file.path.lastIndexOf('/');
  const dirName = lastSlash !== -1 ? file.path.substring(0, lastSlash) : '';
  const { label: provenanceLabel, hint: provenanceHint } = getFileProvenance(file.provenance, t);

  return (
    <li
      className={styles.fileItem}
      aria-current={isDiffOpen ? 'true' : undefined}
    >
      <div className={styles.fileItemLeft}>
        <div className={styles.fileNameRow}>
          <span className={styles.fileName} title={file.path}>
            {baseName}
          </span>
          {dirName && (
            <span className={styles.fileDir} title={dirName}>
              {dirName}
            </span>
          )}
          {file.shared && (
            <span className={styles.sharedBadge} data-testid="shared-badge">
              {t('cartography.screens.sharedBadge')}
            </span>
          )}
        </div>
        {provenanceLabel && (
          <span
            className={styles.fileProvenance}
            title={provenanceHint}
            data-testid={`file-provenance-${file.path}`}
          >
            {provenanceLabel}
          </span>
        )}
      </div>

      <DetailFileActions
        filePath={file.path}
        repoPath={repoPath}
        isDiffOpen={isDiffOpen}
        hasChanges={hasChanges}
        onToggleDiff={onToggleDiff}
        onAskFile={onAskFile}
        t={t}
      />
    </li>
  );
}

function DetailFileList({
  files,
  repoPath,
  diffFor,
  onToggleDiff,
  onAskFile,
  t,
}: {
  files: ScreenFileLink[];
  repoPath: string;
  diffFor: { path: string; diff: string | null; error: string | null } | null;
  onToggleDiff: (path: string) => void;
  onAskFile?: (path: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const modifiedFiles = useGitStore((s) => s.modifiedFiles);

  return (
    <div className={styles.filesScrollContainer} data-testid="screen-detail-files-list">
      <ul className={styles.fileList}>
        {files.map((file, idx) => {
          if (file.provenance === 'unknown') {
            return (
              <li key={`unknown-${idx}`} className={styles.fileItem}>
                <span className={styles.unknownFile}>
                  {t('cartography.screens.unknownFile', {
                    unresolved: file.unresolved ?? file.path,
                  })}
                </span>
              </li>
            );
          }

          const hasChanges = modifiedFiles.some((f) => f.path === file.path);
          const isDiffOpen = diffFor?.path === file.path;

          return (
            <DetailFileItem
              key={file.path}
              file={file}
              repoPath={repoPath}
              isDiffOpen={isDiffOpen}
              hasChanges={hasChanges}
              onToggleDiff={onToggleDiff}
              onAskFile={onAskFile}
              t={t}
            />
          );
        })}
      </ul>
    </div>
  );
}

function DetailDiffView({
  diffFor,
  onClose,
  t,
}: {
  diffFor: { path: string; diff: string | null; error: string | null };
  onClose: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const fileName = diffFor.path.split('/').pop() ?? diffFor.path;
  const isLoading = diffFor.diff === null && diffFor.error === null;

  return (
    <div className={styles.diffContainer} data-testid="screen-detail-diff-container">
      <div className={styles.diffHeader}>
        <h5 className={styles.diffTitle}>
          {t('cartography.screens.fileDiffTitle', { name: fileName })}
        </h5>
        <button
          type="button"
          className={styles.diffCloseBtn}
          onClick={onClose}
          title={t('cartography.screens.closeDetail')}
          aria-label={t('cartography.screens.closeDetail')}
          data-testid="diff-close-button"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {isLoading ? (
        <div className={styles.diffLoading} data-testid="diff-loading">
          {t('cartography.screens.fileDiffLoading')}
        </div>
      ) : diffFor.error ? (
        <div className={styles.diffError} data-testid="diff-error">
          {diffFor.error}
        </div>
      ) : (
        <div className={styles.diffViewerWrapper} data-testid="diff-viewer-wrapper">
          <DiffViewer diff={diffFor.diff ?? ''} filePath={diffFor.path} />
        </div>
      )}
    </div>
  );
}

/** Los cambios de lugar dentro del detalle (agrandar o achicar la captura). */
const DETAIL_LAYOUT_TRANSITION = { duration: 0.3, ease: 'easeOut' } as const;

function DetailFilesSection({
  files,
  repoPath,
  onAskFile,
  shouldReduceMotion,
  t,
}: {
  files: ScreenFileLink[];
  repoPath: string;
  onAskFile?: (path: string) => void;
  shouldReduceMotion?: boolean | null;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const filesByRole = useMemo(() => groupFilesByRole(files), [files]);

  const availableRoles = useMemo(() => {
    return ROLE_ORDER.filter((role) => (filesByRole.get(role)?.length ?? 0) > 0);
  }, [filesByRole]);

  const [activeRole, setActiveRole] = useState<ScreenFileRole>(
    availableRoles[0] ?? 'screen',
  );

  const [diffFor, setDiffFor] = useState<{ path: string; diff: string | null; error: string | null } | null>(null);

  const effectiveRole: ScreenFileRole = availableRoles.includes(activeRole)
    ? activeRole
    : (availableRoles[0] ?? 'screen');

  const currentRoleFiles = filesByRole.get(effectiveRole) ?? [];

  const handleSelectRole = (role: ScreenFileRole) => {
    setActiveRole(role);
    setDiffFor(null);
  };

  const handleToggleDiff = useCallback(
    async (filePath: string) => {
      if (diffFor?.path === filePath) {
        setDiffFor(null);
        return;
      }
      setDiffFor({ path: filePath, diff: null, error: null });
      try {
        const res = await window.api.gitDiff(repoPath, filePath);
        setDiffFor((current) => {
          if (current?.path !== filePath) return current;
          if (res.success) {
            return { path: filePath, diff: res.data ?? '', error: null };
          }
          return {
            path: filePath,
            diff: null,
            error: res.error || t('cartography.screens.fileDiffError'),
          };
        });
      } catch (err) {
        setDiffFor((current) => {
          if (current?.path !== filePath) return current;
          return {
            path: filePath,
            diff: null,
            error: err instanceof Error ? err.message : String(err),
          };
        });
      }
    },
    [diffFor?.path, repoPath, t],
  );

  return (
    <motion.section
      layout={shouldReduceMotion ? false : 'position'}
      transition={DETAIL_LAYOUT_TRANSITION}
      className={styles.detailFilesSection}
      aria-label="Archivos"
    >
      <h4 className={styles.sectionLabel}>Archivos</h4>

      {availableRoles.length > 0 && (
        <div
          className={styles.fileTabs}
          role="tablist"
          data-testid="screen-role-segmented"
        >
          {availableRoles.map((role) => {
            const count = filesByRole.get(role)?.length ?? 0;
            const isActive = effectiveRole === role;
            return (
              <button
                key={role}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSelectRole(role)}
                data-testid={`role-tab-${role}`}
              >
                {t(`cartography.screens.role.${role}`)} ({count})
              </button>
            );
          })}
        </div>
      )}

      <DetailFileList
        files={currentRoleFiles}
        repoPath={repoPath}
        diffFor={diffFor}
        onToggleDiff={handleToggleDiff}
        onAskFile={onAskFile}
        t={t}
      />

      {diffFor && (
        <DetailDiffView
          diffFor={diffFor}
          onClose={() => setDiffFor(null)}
          t={t}
        />
      )}
    </motion.section>
  );
}

export function ScreenDetail({ screen, repoPath, capture, lastRun, onClose, onExplain }: ScreenDetailProps) {
  const onAskFile = (arguments[0] as ScreenDetailProps | undefined)?.onAskFile;
  const t = useT();
  const rawLang = useGitStore((s) => s.language) ?? 'es';
  const lang: 'es' | 'en' | 'zh' = rawLang === 'zh' ? 'zh' : rawLang === 'en' ? 'en' : 'es';
  const shouldReduceMotion = useReducedMotion();

  const skippedItem = useMemo(() => {
    if (capture || screen.kind !== 'view') return null;
    return lastRun?.skipped?.find((s) => s.screenId === screen.id) ?? null;
  }, [capture, screen.kind, screen.id, lastRun]);

  const [cached, setCached] = useState<{ screenId: string; description: ScreenDescription } | null>(null);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const imageExpanded = expandedFor === screen.id;
  const description: ScreenDescription | null =
    screen.description ?? (cached?.screenId === screen.id ? cached.description : null);

  useEffect(() => {
    if (screen.description) return;

    let active = true;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoScreens?.describe) return;

    api.cartoScreens
      .describe({ repoPath, screenId: screen.id, language: lang, cacheOnly: true })
      .then((res) => {
        if (!active) return;
        if (res?.success && res.data && res.data.status === 'ok') {
          setCached({ screenId: screen.id, description: res.data.description });
        }
      })
      .catch((error: unknown) => {
        console.warn('[ScreenDetail] no se pudo leer la explicación guardada', error);
      });

    return () => {
      active = false;
    };
  }, [repoPath, screen.id, screen.description, lang]);

  const displayName = description?.suggestedName || screen.name;
  const locationSubtitle =
    screen.kind === 'route' ? screen.locator : t('cartography.screens.viewInApp');
  const locationTooltip = `${screen.locator} · ${screen.declaredIn}`;

  const roleGroups = getRoleGroupItems(screen.stats?.byRole);
  const totalRoles = roleGroups.reduce((acc, r) => acc + r.count, 0);

  return (
    <motion.div
      layoutId={shouldReduceMotion ? undefined : screen.id}
      initial={shouldReduceMotion ? false : { opacity: 0.5 }}
      animate={{ opacity: 1 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      className={styles.detailColumn}
      data-testid={`screen-detail-${screen.id}`}
    >
      {/* 1. Cabecera */}
      <DetailHeader
        screen={screen}
        displayName={displayName}
        locationSubtitle={locationSubtitle}
        locationTooltip={locationTooltip}
        onExplain={onExplain}
        onClose={onClose}
        t={t}
      />

      <div className={cn(styles.detailBody, imageExpanded && styles.detailBodyExpanded)}>
        <motion.div
          layout={!shouldReduceMotion}
          transition={DETAIL_LAYOUT_TRANSITION}
          className={styles.detailMediaCol}
        >
          {/* 2. Captura 16:10 y motivo si fue omitida */}
          <DetailCaptureView
            capture={capture}
            screenKind={screen.kind}
            skippedItem={skippedItem}
            expanded={imageExpanded}
            onToggleExpanded={() => setExpandedFor(imageExpanded ? null : screen.id)}
            t={t}
          />
        </motion.div>

        <motion.div
          layout={shouldReduceMotion ? false : 'position'}
          transition={DETAIL_LAYOUT_TRANSITION}
          className={styles.detailInfoCol}
        >
          {/* Barra de composición con leyenda */}
          {totalRoles > 0 && (
            <div className={styles.detailComposition} data-testid="detail-composition">
              <CompositionBar byRole={screen.stats?.byRole} t={t} />
              <div className={styles.compositionLegend}>
                {roleGroups.map((rg) => (
                  <span key={rg.role} className={styles.legendItem}>
                    <span className={cn(styles.legendDot, styles[`barSegment_${rg.role}`])} />
                    <span>
                      {t(rg.labelKey)}: {rg.count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 3. Qué hace */}
          <DetailDescription description={description} t={t} />
        </motion.div>
      </div>

      {/* 4. Archivos */}
      <DetailFilesSection
        files={screen.files}
        repoPath={repoPath}
        onAskFile={onAskFile}
        shouldReduceMotion={shouldReduceMotion}
        t={t}
      />
    </motion.div>
  );
}
