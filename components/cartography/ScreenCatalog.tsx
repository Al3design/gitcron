'use client';

// components/cartography/ScreenCatalog.tsx
//
// Catálogo de pantallas del repositorio (decisiones 9 y 12, tareas 1.4, 2.2, 2.9).
// En modo grilla muestra cuadros modernos con captura borde a borde, temas y composición.
// Incluye filtros por tema presente y agrupación por tema («Sin agrupar · Por tema»).
// Al tocar uno se expande a dos columnas (detalle a la izquierda y columna angosta a la derecha).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, LayoutGrid, Monitor, MoreHorizontal, PanelsTopLeft, RefreshCw, ShieldOff } from 'lucide-react';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ContextMenus';
import { useT } from '@/hooks/use-translation';
import { useScreenMap } from '@/hooks/use-screen-map';
import { useScreenCaptures } from '@/hooks/use-screen-captures';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import { useGitStore } from '@/lib/git-store';
import { cn } from '@/lib/utils';
import type { ScreenCapture, ScreenEntry, ScreenMapCoverage, ScreenTag } from '@/types/screen-map';
import { CaptureProgress } from './CaptureProgress';
import { ScreenCard } from './ScreenCard';
import { ScreenDetail } from './ScreenDetail';
import styles from './ScreenCatalog.module.css';

export type CartoCardSize = 'large' | 'medium' | 'small' | 'minimal';
const CARD_SIZE_STORAGE_KEY = 'gitcron:cartoCardSize';
const TAG_FILTER_STORAGE_KEY = 'gitcron:cartoTagFilter';
const GROUP_BY_STORAGE_KEY = 'gitcron:cartoGroupBy';

/** Cuándo fue la última foto y cuántas quedaron viejas; `null` si todavía no hay fotos. */
export interface CaptureSummary {
  latestAt: string;
  stale: number;
}

function summarizeCaptures(captures: Record<string, ScreenCapture> | undefined): CaptureSummary | null {
  const list = Object.values(captures ?? {});
  if (list.length === 0) return null;
  const latestAt = list.reduce((max, c) => (c.capturedAt > max ? c.capturedAt : max), list[0].capturedAt);
  return { latestAt, stale: list.filter((c) => c.stale).length };
}

const ALL_TAGS: ScreenTag[] = [
  'graphics',
  'data',
  'ai',
  'git',
  'settings',
  'content',
  'accounts',
  'payments',
];

function getInitialCardSize(): CartoCardSize {
  try {
    const saved = localStorage.getItem(CARD_SIZE_STORAGE_KEY);
    if (saved === 'large' || saved === 'medium' || saved === 'small' || saved === 'minimal') {
      return saved;
    }
  } catch (err) {
    console.warn('No se pudo leer gitcron:cartoCardSize de localStorage', err);
  }
  return 'medium';
}

function saveCardSize(size: CartoCardSize): void {
  try {
    localStorage.setItem(CARD_SIZE_STORAGE_KEY, size);
  } catch (err) {
    console.warn('No se pudo guardar gitcron:cartoCardSize en localStorage', err);
  }
}

function getInitialTagFilter(): ScreenTag | null {
  try {
    const saved = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
    if (saved && (ALL_TAGS as string[]).includes(saved)) {
      return saved as ScreenTag;
    }
  } catch (err) {
    console.warn('No se pudo leer gitcron:cartoTagFilter de localStorage', err);
  }
  return null;
}

function saveTagFilter(tag: ScreenTag | null): void {
  try {
    if (tag) {
      localStorage.setItem(TAG_FILTER_STORAGE_KEY, tag);
    } else {
      localStorage.removeItem(TAG_FILTER_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('No se pudo guardar gitcron:cartoTagFilter en localStorage', err);
  }
}

function getInitialGroupBy(): 'none' | 'tag' {
  try {
    const saved = localStorage.getItem(GROUP_BY_STORAGE_KEY);
    if (saved === 'tag' || saved === 'none') {
      return saved;
    }
  } catch (err) {
    console.warn('No se pudo leer gitcron:cartoGroupBy de localStorage', err);
  }
  return 'none';
}

function saveGroupBy(groupBy: 'none' | 'tag'): void {
  try {
    localStorage.setItem(GROUP_BY_STORAGE_KEY, groupBy);
  } catch (err) {
    console.warn('No se pudo guardar gitcron:cartoGroupBy en localStorage', err);
  }
}

const SIZES: { key: CartoCardSize; labelKey: string }[] = [
  { key: 'large', labelKey: 'cartography.screens.sizeLarge' },
  { key: 'medium', labelKey: 'cartography.screens.sizeMedium' },
  { key: 'small', labelKey: 'cartography.screens.sizeSmall' },
  { key: 'minimal', labelKey: 'cartography.screens.sizeMinimal' },
];

export interface ScreenCatalogProps {
  repoPath: string;
  refreshKey: number;
  onSelectScreen?: (screen: ScreenEntry | null) => void;
  onSelectFile?: (file: { path: string } | null) => void;
  /** La última captura va en una pastilla del encabezado de Cartografía (Alejandro, 2026-10-23). */
  onCaptureSummary?: (summary: CaptureSummary | null) => void;
}

function resolveCoverageNotice(
  coverage: ScreenMapCoverage,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (coverage.state === 'complete') {
    return null;
  }

  // Los vínculos que no se pudieron leer se ven en la lista de archivos de su pantalla; no hace
  // falta un aviso general arriba (Alejandro, 2026-10-23).
  if (coverage.state === 'partial') {
    return coverage.errors && coverage.errors.length > 0 ? t('cartography.screens.coverage.indexing') : null;
  }

  if (coverage.state === 'unsupported') {
    if (coverage.reason === 'no-ui') {
      return t('cartography.screens.coverage.noUi');
    }
    return t('cartography.screens.coverage.unknownStack');
  }

  return null;
}

function sortScreens(screens: ScreenEntry[]): ScreenEntry[] {
  return [...screens].sort((a, b) => {
    if (a.kind === 'route' && b.kind !== 'route') return -1;
    if (a.kind !== 'route' && b.kind === 'route') return 1;
    return a.name.localeCompare(b.name);
  });
}

function useCatalogPrefs() {
  const [cardSize, setCardSizeState] = useState<CartoCardSize>(getInitialCardSize);
  const [tagFilter, setTagFilterState] = useState<ScreenTag | null>(getInitialTagFilter);
  const [groupBy, setGroupByState] = useState<'none' | 'tag'>(getInitialGroupBy);

  const handleSizeChange = (newSize: CartoCardSize) => {
    setCardSizeState(newSize);
    saveCardSize(newSize);
  };

  const handleGroupByChange = (newGroupBy: 'none' | 'tag') => {
    setGroupByState(newGroupBy);
    saveGroupBy(newGroupBy);
  };

  const handleTagFilterClick = (clickedTag: ScreenTag | null, effectiveTagFilter: ScreenTag | null) => {
    if (clickedTag === null || clickedTag === effectiveTagFilter) {
      setTagFilterState(null);
      saveTagFilter(null);
    } else {
      setTagFilterState(clickedTag);
      saveTagFilter(clickedTag);
    }
  };

  return {
    cardSize,
    handleSizeChange,
    tagFilter,
    handleTagFilterClick,
    groupBy,
    handleGroupByChange,
  };
}

function CaptureBannerViewsNotice({
  hasRecipes,
  runnerConfig,
  lastRun,
  t,
}: {
  hasRecipes?: boolean;
  runnerConfig?: string;
  lastRun: ReturnType<typeof useScreenCaptures>['lastRun'];
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const skippedViews =
    lastRun?.skipped?.filter(
      (s) => s.reason === 'no-recipe' || s.reason === 'runner-missing' || s.reason === 'recipe-failed',
    ) ?? [];

  if (lastRun && skippedViews.length > 0) {
    const noRecipe = skippedViews.filter((s) => s.reason === 'no-recipe' || s.reason === 'runner-missing').length;
    const failed = skippedViews.filter((s) => s.reason === 'recipe-failed').length;
    return (
      <span className={styles.captureBannerViewsLater} data-testid="capture-views-notice">
        {t('cartography.screens.captures.viewsSkipped', { noRecipe, failed })}
      </span>
    );
  }
  if (hasRecipes && runnerConfig) {
    return (
      <span className={styles.captureBannerViewsLater} data-testid="capture-views-notice">
        {t('cartography.screens.captures.viewsWithRecipes', { config: runnerConfig })}
      </span>
    );
  }
  return (
    <span className={styles.captureBannerViewsLater} data-testid="capture-views-notice">
      {t('cartography.screens.captures.viewsNoRecipes')}
    </span>
  );
}

function CaptureBannerActions({
  captureRunning,
  consentStatus,
  repoPath,
  onDismissConsent,
  onGrantAndRun,
  onRefresh,
  onRevoke,
  onCancel,
  t,
}: {
  captureRunning: boolean;
  consentStatus: string;
  repoPath: string;
  onDismissConsent: (repo: string) => void;
  onGrantAndRun: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
  onCancel: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [captureMenuAt, setCaptureMenuAt] = useState<{ x: number; y: number } | null>(null);

  if (captureRunning) {
    return (
      <div className={styles.captureBannerActions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.captureActionBtn}
          data-testid="capture-stop-button"
        >
          {t('cartography.screens.captures.stop')}
        </button>
      </div>
    );
  }

  if (consentStatus === 'needs-consent') {
    return (
      <div className={styles.captureBannerActions}>
        <button
          type="button"
          onClick={onGrantAndRun}
          className={`${styles.captureActionBtn} ${styles.captureActionBtnPrimary}`}
          data-testid="capture-allow-button"
        >
          {t('cartography.screens.captures.allow')}
        </button>
        <button
          type="button"
          onClick={() => onDismissConsent(repoPath)}
          className={styles.captureActionBtn}
          data-testid="capture-not-now-button"
        >
          {t('cartography.screens.captures.notNow')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.captureBannerActions}>
      <button
        type="button"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCaptureMenuAt({ x: r.right - 220, y: r.bottom + 4 });
        }}
        className={styles.captureActionBtn}
        title={t('cartography.screens.captures.menu')}
        aria-label={t('cartography.screens.captures.menu')}
        aria-haspopup="menu"
        aria-expanded={captureMenuAt !== null}
        data-testid="capture-menu-button"
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {captureMenuAt && (
        <ContextMenu
          x={captureMenuAt.x}
          y={captureMenuAt.y}
          onClose={() => setCaptureMenuAt(null)}
          ariaLabel={t('cartography.screens.captures.menu')}
        >
          <ContextMenuItem
            icon={<RefreshCw size={13} />}
            text={t('cartography.screens.captures.refresh')}
            onClick={() => {
              setCaptureMenuAt(null);
              onRefresh();
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            danger
            icon={<ShieldOff size={13} />}
            text={t('cartography.screens.captures.revoke')}
            onClick={() => {
              setCaptureMenuAt(null);
              onRevoke();
            }}
          />
        </ContextMenu>
      )}
    </div>
  );
}

function CaptureBanner({
  captureState,
  captureRunning,
  hasCaptureItems,
  captureItems,
  lastRun,
  sortedScreensCount,
  repoPath,
  dismissedConsentRepo,
  onDismissConsent,
  onGrantAndRun,
  onRefresh,
  onRevoke,
  onCancel,
  t,
}: {
  captureState: ReturnType<typeof useScreenCaptures>['state'];
  captureRunning: boolean;
  hasCaptureItems: boolean;
  captureItems: ReturnType<typeof useScreenCaptures>['items'];
  lastRun: ReturnType<typeof useScreenCaptures>['lastRun'];
  sortedScreensCount: number;
  repoPath: string;
  dismissedConsentRepo: string | null;
  onDismissConsent: (repo: string) => void;
  onGrantAndRun: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
  onCancel: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (
    !captureState ||
    captureState.consent.status === 'unsupported' ||
    (captureState.consent.status === 'needs-consent' && dismissedConsentRepo === repoPath)
  ) {
    return null;
  }

  return (
    <div className={styles.captureBanner} data-testid="capture-banner">
      <div className={styles.captureBannerContent}>
        {captureRunning ? (
          hasCaptureItems ? null : (
            <span className={styles.captureBannerText} data-testid="capture-running-text">
              {t('cartography.screens.captures.starting')}
            </span>
          )
        ) : captureState.consent.status === 'needs-consent' ? (
          <span className={styles.captureBannerText}>
            {t('cartography.screens.captures.needsConsent', {
              command: captureState.consent.command,
            })}
          </span>
        ) : (
          <span className={styles.captureBannerText}>
            {t('cartography.screens.captures.granted', {
              command: captureState.consent.command,
            })}
          </span>
        )}

        {hasCaptureItems && (
          <CaptureProgress
            items={captureItems}
            running={captureRunning}
            coverage={{ withPicture: Object.keys(captureState.captures).length, total: sortedScreensCount }}
          />
        )}

        {lastRun?.error && (
          <span className={styles.captureBannerError} data-testid="capture-error-text">
            {lastRun.error}
          </span>
        )}

        {!hasCaptureItems && (
          <CaptureBannerViewsNotice
            hasRecipes={captureState.hasRecipes}
            runnerConfig={captureState.runnerConfig}
            lastRun={lastRun}
            t={t}
          />
        )}
      </div>

      <CaptureBannerActions
        captureRunning={captureRunning}
        consentStatus={captureState.consent.status}
        repoPath={repoPath}
        onDismissConsent={onDismissConsent}
        onGrantAndRun={onGrantAndRun}
        onRefresh={onRefresh}
        onRevoke={onRevoke}
        onCancel={onCancel}
        t={t}
      />
    </div>
  );
}
function CatalogControls({
  sortedScreensCount,
  presentTags,
  tagCounts,
  effectiveTagFilter,
  onTagFilterClick,
  selectedScreen,
  groupBy,
  onGroupByChange,
  cardSize,
  onSizeChange,
  t,
}: {
  sortedScreensCount: number;
  presentTags: ScreenTag[];
  tagCounts: Partial<Record<ScreenTag, number>>;
  effectiveTagFilter: ScreenTag | null;
  onTagFilterClick: (tag: ScreenTag | null) => void;
  selectedScreen: ScreenEntry | null;
  groupBy: 'none' | 'tag';
  onGroupByChange: (groupBy: 'none' | 'tag') => void;
  cardSize: CartoCardSize;
  onSizeChange: (size: CartoCardSize) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <>
      <div className={styles.filterRow} role="group" aria-label="Filtro por tema">
        <button
          type="button"
          onClick={() => onTagFilterClick(null)}
          data-testid="screen-tag-filter-all"
          className={cn(
            styles.filterChip,
            effectiveTagFilter === null && styles.filterChipActive,
          )}
        >
          <span>{t('cartography.screens.filterAll')}</span>
          <span>{sortedScreensCount}</span>
        </button>

        {presentTags.map((tag) => {
          const count = tagCounts[tag] ?? 0;
          const isActive = effectiveTagFilter === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onTagFilterClick(tag)}
              data-testid={`screen-tag-filter-${tag}`}
              className={cn(styles.filterChip, isActive && styles.filterChipActive)}
            >
              <span className={cn(styles.tagDot, styles[`tag_${tag}`])} />
              <span>{t(`cartography.screens.tags.${tag}`)}</span>
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {!selectedScreen && (
        <div className={styles.headerControls}>
          <div
            className={styles.segmentedControl}
            role="group"
            aria-label="Agrupado"
            data-testid="screen-group-control"
          >
            <button
              type="button"
              onClick={() => onGroupByChange('none')}
              aria-pressed={groupBy === 'none'}
              data-testid="screen-group-none"
              className={cn(
                styles.segmentedBtn,
                groupBy === 'none' && styles.segmentedBtnActive,
              )}
            >
              <span>{t('cartography.screens.groupNone')}</span>
            </button>
            <button
              type="button"
              onClick={() => onGroupByChange('tag')}
              aria-pressed={groupBy === 'tag'}
              data-testid="screen-group-tag"
              className={cn(
                styles.segmentedBtn,
                groupBy === 'tag' && styles.segmentedBtnActive,
              )}
            >
              <span>{t('cartography.screens.groupByTag')}</span>
            </button>
          </div>

          <div
            className={styles.segmentedControl}
            role="group"
            aria-label={t('cartography.screens.size')}
            data-testid="card-size-control"
          >
            {SIZES.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => onSizeChange(key)}
                aria-pressed={cardSize === key}
                title={t(labelKey)}
                aria-label={t(labelKey)}
                data-testid={`card-size-${key}`}
                className={cn(
                  styles.segmentedBtn,
                  cardSize === key && styles.segmentedBtnActive,
                )}
              >
                <LayoutGrid size={13} aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ScreenSidebar({
  otherScreens,
  captureState,
  shouldReduceMotion,
  onSelectScreen,
  t,
}: {
  otherScreens: ScreenEntry[];
  captureState: ReturnType<typeof useScreenCaptures>['state'];
  shouldReduceMotion: boolean | null;
  onSelectScreen: (screenId: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <aside
      className={styles.sidebarColumn}
      data-testid="screen-catalog-sidebar"
      aria-label="Otras pantallas"
    >
      {otherScreens.map((screen) => {
        const ownCount = screen.files.filter((f) => !f.shared).length;
        const sharedCount = screen.files.filter((f) => f.shared).length;
        const displayName = screen.description?.suggestedName || screen.name;
        const screenCapture = captureState?.captures[screen.id];

        return (
          <motion.div
            key={screen.id}
            layout={shouldReduceMotion ? false : 'position'}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={styles.sidebarCard}
            onClick={() => onSelectScreen(screen.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectScreen(screen.id);
              }
            }}
            data-testid={`sidebar-screen-${screen.id}`}
          >
            <div className={styles.sidebarThumbnail}>
              {screenCapture ? (
                <img src={screenCapture.dataUrl} alt="" className={styles.captureImage} />
              ) : screen.kind === 'route' ? (
                <Monitor size={16} aria-hidden="true" />
              ) : (
                <PanelsTopLeft size={16} aria-hidden="true" />
              )}
            </div>

            <div className={styles.sidebarInfo}>
              <span
                className={styles.sidebarName}
                title={screen.description?.suggestedName ? screen.name : undefined}
              >
                {displayName}
              </span>
              <span className={styles.sidebarCounts}>
                {t('cartography.screens.fileCountsShort', {
                  own: ownCount,
                  shared: sharedCount,
                })}
              </span>
            </div>
          </motion.div>
        );
      })}
    </aside>
  );
}

function ScreenGrid({
  groupBy,
  gridClass,
  tagSections,
  filteredScreens,
  repoPath,
  captureState,
  capturingIds,
  cardSize,
  onSelectScreen,
  onExplain,
}: {
  groupBy: 'none' | 'tag';
  gridClass: string;
  tagSections: { key: string; label: string; screens: ScreenEntry[] }[];
  filteredScreens: ScreenEntry[];
  repoPath: string;
  captureState: ReturnType<typeof useScreenCaptures>['state'];
  capturingIds: Set<string>;
  cardSize: CartoCardSize;
  onSelectScreen: (screenId: string) => void;
  onExplain: (screen: ScreenEntry) => void;
}) {
  if (groupBy === 'tag') {
    return (
      <div className={styles.groupedContainer} data-testid="screen-catalog-grouped">
        {tagSections.map((section) => (
          <section
            key={section.key}
            className={styles.groupSection}
            data-testid={`screen-group-${section.key}`}
          >
            <div className={styles.groupHeader}>
              <span className={cn(styles.tagDot, styles[`tag_${section.key}`])} />
              <h4 className={styles.groupTitle}>
                <span>{section.label}</span>
                <span className={styles.groupCount}>{section.screens.length}</span>
              </h4>
            </div>
            <div className={`${styles.grid} ${gridClass}`}>
              {section.screens.map((screen) => (
                <ScreenCard
                  key={screen.id}
                  screen={screen}
                  repoPath={repoPath}
                  capture={captureState?.captures[screen.id]}
                  capturing={capturingIds.has(screen.id)}
                  size={cardSize}
                  onSelect={() => onSelectScreen(screen.id)}
                  onExplain={onExplain}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={`${styles.grid} ${gridClass}`} data-testid="screen-catalog-grid">
      {filteredScreens.map((screen) => (
        <ScreenCard
          key={screen.id}
          screen={screen}
          repoPath={repoPath}
          capture={captureState?.captures[screen.id]}
          capturing={capturingIds.has(screen.id)}
          size={cardSize}
          onSelect={() => onSelectScreen(screen.id)}
          onExplain={onExplain}
        />
      ))}
    </div>
  );
}

export function ScreenCatalog({ repoPath, refreshKey, onSelectScreen, onSelectFile, onCaptureSummary }: ScreenCatalogProps) {
  const t = useT();
  const shouldReduceMotion = useReducedMotion();
  const { map, loading, error, replace } = useScreenMap(repoPath, refreshKey);
  const {
    state: captureState,
    items: captureItems,
    active: captureActive,
    lastRun,
    grant,
    revoke,
    run,
    cancel,
  } = useScreenCaptures(repoPath, map);

  const {
    cardSize,
    handleSizeChange,
    tagFilter,
    handleTagFilterClick,
    groupBy,
    handleGroupByChange,
  } = useCatalogPrefs();

  const handleManual = useCallback(
    async (
      op:
        | { type: 'link'; screenId: string; path: string; action: 'add' | 'remove' }
        | { type: 'unlink'; screenId: string; path: string }
        | { type: 'describe'; screenId: string; text: string; name?: string }
        | { type: 'undescribe'; screenId: string },
    ) => {
      try {
        const res = await window.api.cartoScreens.manual({ repoPath, op });
        if (res.success && res.data) {
          replace(res.data);
        } else {
          useGitStore
            .getState()
            .setError(res.error || t('cartography.screens.manual.fileBroken', { error: '' }));
        }
      } catch (err) {
        useGitStore
          .getState()
          .setError(err instanceof Error ? err.message : String(err));
      }
    },
    [repoPath, replace, t],
  );

  const refreshCaptures = async () => {
    const result = await run(true);
    if (!result) return;
    const { setSuccess, setError } = useGitStore.getState();
    if (result.error) {
      setError(t('cartography.screens.captures.toastError', { detail: result.error }));
    } else if (result.cancelled) {
      setSuccess(
        t(result.captured === 1 ? 'cartography.screens.captures.toastStoppedOne' : 'cartography.screens.captures.toastStopped', {
          n: result.captured,
        }),
      );
    } else {
      const notCaptured = result.skipped.filter((s) => s.reason !== 'view').length;
      setSuccess(
        notCaptured > 0
          ? t('cartography.screens.captures.toastDoneWithMissing', { n: result.captured, missing: notCaptured })
          : t('cartography.screens.captures.toastDone', { n: result.captured }),
      );
    }
  };

  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const selectScreen = (id: string) => setSelectedScreenId(id);
  const [dismissedConsentRepo, setDismissedConsentRepo] = useState<string | null>(null);

  const capturingIds = useMemo(
    () => new Set(captureItems.filter((item) => item.state === 'running').map((item) => item.screenId)),
    [captureItems],
  );

  const captureSummary = useMemo(() => summarizeCaptures(captureState?.captures), [captureState]);
  useEffect(() => {
    onCaptureSummary?.(captureSummary);
  }, [captureSummary, onCaptureSummary]);

  const coverageNotice = useMemo(() => {
    if (!map) return null;
    return resolveCoverageNotice(map.coverage, t);
  }, [map, t]);

  const sortedScreens = useMemo(() => {
    if (!map) return [];
    return sortScreens(map.screens);
  }, [map]);

  const tagCounts = useMemo(() => {
    const counts: Partial<Record<ScreenTag, number>> = {};
    for (const tag of ALL_TAGS) {
      const count = sortedScreens.filter(
        (s) => s.primaryTag === tag || s.tags?.some((te) => te.tag === tag),
      ).length;
      if (count > 0) {
        counts[tag] = count;
      }
    }
    return counts;
  }, [sortedScreens]);

  const presentTags = useMemo(() => {
    return ALL_TAGS.filter((tag) => (tagCounts[tag] ?? 0) > 0);
  }, [tagCounts]);

  const effectiveTagFilter: ScreenTag | null =
    tagFilter && presentTags.includes(tagFilter) ? tagFilter : null;

  const onTagFilterClick = (tag: ScreenTag | null) => handleTagFilterClick(tag, effectiveTagFilter);

  const filteredScreens = useMemo(() => {
    if (!effectiveTagFilter) return sortedScreens;
    return sortedScreens.filter(
      (s) => s.primaryTag === effectiveTagFilter || s.tags?.some((te) => te.tag === effectiveTagFilter),
    );
  }, [sortedScreens, effectiveTagFilter]);

  const selectedScreen = useMemo(() => {
    if (!selectedScreenId) return null;
    return sortedScreens.find((s) => s.id === selectedScreenId) ?? null;
  }, [selectedScreenId, sortedScreens]);

  useEffect(() => {
    onSelectScreen?.(selectedScreen);
    if (!selectedScreen) {
      onSelectFile?.(null);
    }
  }, [selectedScreen, onSelectScreen, onSelectFile]);

  useEffect(() => {
    if (!selectedScreenId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedScreenId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedScreenId]);

  const handleExplain = useCallback(
    (screen: ScreenEntry) => {
      onSelectScreen?.(screen);
      useAssistDockStore.getState().setOpen(true);
      useAssistDockStore.getState().setActiveTab('chat');
      useAssistDockStore.getState().setPendingPrompt(t('assist.ask.screenExplain'));
    },
    [onSelectScreen, t],
  );

  const handleAskFile = useCallback(
    (path: string) => {
      onSelectFile?.({ path });
    },
    [onSelectFile],
  );

  const tagSections = useMemo(() => {
    if (groupBy !== 'tag') return [];
    const sections: { key: string; label: string; screens: ScreenEntry[] }[] = [];
    const allSectionKeys: (ScreenTag | 'general')[] = [...ALL_TAGS, 'general'];

    for (const key of allSectionKeys) {
      const screensInGroup = filteredScreens.filter((s) => (s.primaryTag ?? 'general') === key);
      if (screensInGroup.length > 0) {
        sections.push({
          key,
          label: key === 'general' ? t('cartography.screens.tags.general') : t(`cartography.screens.tags.${key}`),
          screens: screensInGroup,
        });
      }
    }
    return sections;
  }, [groupBy, filteredScreens, t]);

  if (loading && !map) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState} data-testid="screen-catalog-loading">
          {t('cartography.screens.loading')}
        </div>
      </div>
    );
  }

  if (error && !map) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState} data-testid="screen-catalog-error">
          {error}
        </div>
      </div>
    );
  }

  if (!map) return null;

  const isNoUi = map.coverage.state === 'unsupported' && map.coverage.reason === 'no-ui';
  const captureRunning = Boolean(captureState?.running || captureActive);
  const hasCaptureItems = captureItems.length > 0;
  const otherScreens = filteredScreens.filter((s) => s.id !== selectedScreenId);

  const gridClass =
    cardSize === 'large'
      ? styles.grid_large
      : cardSize === 'small'
        ? styles.grid_small
        : cardSize === 'minimal'
          ? styles.grid_minimal
          : styles.grid_medium;

  return (
    <div className={styles.container} data-testid="screen-catalog">
      <div className={styles.catalogHeader}>
        {selectedScreen && (
          <button
            type="button"
            className={styles.captureActionBtn}
            onClick={() => setSelectedScreenId(null)}
            data-testid="screen-detail-back"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            <span>{t('cartography.screens.backToGrid')}</span>
          </button>
        )}
        {coverageNotice && (
          <div
            className={styles.coverageBanner}
            role="status"
            data-testid="screen-coverage-banner"
          >
            {coverageNotice}
          </div>
        )}

        {!selectedScreen && (
          <CaptureBanner
            captureState={captureState}
            captureRunning={captureRunning}
            hasCaptureItems={hasCaptureItems}
            captureItems={captureItems}
            lastRun={lastRun}
            sortedScreensCount={sortedScreens.length}
            repoPath={repoPath}
            dismissedConsentRepo={dismissedConsentRepo}
            onDismissConsent={setDismissedConsentRepo}
            onGrantAndRun={() => void grant().then(() => run())}
            onRefresh={() => void refreshCaptures()}
            onRevoke={() => void revoke()}
            onCancel={() => void cancel()}
            t={t}
          />
        )}

        {!isNoUi && sortedScreens.length > 0 && (
          <CatalogControls
            sortedScreensCount={sortedScreens.length}
            presentTags={presentTags}
            tagCounts={tagCounts}
            effectiveTagFilter={effectiveTagFilter}
            onTagFilterClick={onTagFilterClick}
            selectedScreen={selectedScreen}
            groupBy={groupBy}
            onGroupByChange={handleGroupByChange}
            cardSize={cardSize}
            onSizeChange={handleSizeChange}
            t={t}
          />
        )}
      </div>

      {!isNoUi && sortedScreens.length > 0 && (
        <LayoutGroup id="screen-catalog">
          {selectedScreen ? (
            <div className={styles.detailLayout} data-testid="screen-catalog-detail-layout">
              <ScreenDetail
                key={selectedScreen.id}
                screen={selectedScreen}
                repoPath={repoPath}
                capture={captureState?.captures[selectedScreen.id]}
                lastRun={lastRun}
                onClose={() => {
                  setSelectedScreenId(null);
                  onSelectFile?.(null);
                }}
                onExplain={handleExplain}
                onAskFile={handleAskFile}
                onManual={handleManual}
                pending={map?.pending?.filter((p) => p.screenId === selectedScreen.id) ?? []}
              />

              <ScreenSidebar
                otherScreens={otherScreens}
                captureState={captureState}
                shouldReduceMotion={shouldReduceMotion}
                onSelectScreen={selectScreen}
                t={t}
              />
            </div>
          ) : (
            <ScreenGrid
              groupBy={groupBy}
              gridClass={gridClass}
              tagSections={tagSections}
              filteredScreens={filteredScreens}
              repoPath={repoPath}
              captureState={captureState}
              capturingIds={capturingIds}
              cardSize={cardSize}
              onSelectScreen={selectScreen}
              onExplain={handleExplain}
            />
          )}
        </LayoutGroup>
      )}

      {!isNoUi && sortedScreens.length === 0 && (
        <div className={styles.emptyState} data-testid="screen-catalog-empty">
          {t('cartography.screens.empty')}
        </div>
      )}
    </div>
  );
}
