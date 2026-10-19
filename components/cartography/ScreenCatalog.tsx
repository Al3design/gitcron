'use client';

// components/cartography/ScreenCatalog.tsx
//
// Catálogo de pantallas del repositorio (decisiones 9 y 12, tareas 1.4, 2.2, 2.9).
// En modo grilla muestra cuadros modernos con captura borde a borde, temas y composición.
// Incluye filtros por tema presente y agrupación por tema («Sin agrupar · Por tema»).
// Al tocar uno se expande a dos columnas (detalle a la izquierda y columna angosta a la derecha).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Monitor, PanelsTopLeft } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useScreenMap } from '@/hooks/use-screen-map';
import { useScreenCaptures } from '@/hooks/use-screen-captures';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import { cn } from '@/lib/utils';
import type { ScreenEntry, ScreenMapCoverage, ScreenTag } from '@/types/screen-map';
import { ScreenCard } from './ScreenCard';
import { ScreenDetail } from './ScreenDetail';
import styles from './ScreenCatalog.module.css';

export type CartoCardSize = 'large' | 'medium' | 'small' | 'minimal';
const CARD_SIZE_STORAGE_KEY = 'gitcron:cartoCardSize';
const TAG_FILTER_STORAGE_KEY = 'gitcron:cartoTagFilter';
const GROUP_BY_STORAGE_KEY = 'gitcron:cartoGroupBy';

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
}

function resolveCoverageNotice(
  coverage: ScreenMapCoverage,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (coverage.state === 'complete') {
    return null;
  }

  if (coverage.state === 'partial') {
    if (coverage.errors && coverage.errors.length > 0) {
      return t('cartography.screens.coverage.indexing');
    }
    const count = (coverage.unresolved ?? 0) + (coverage.excluded ?? 0);
    return t('cartography.screens.coverage.unresolved', { n: count > 0 ? count : 1 });
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

export function ScreenCatalog({ repoPath, refreshKey, onSelectScreen }: ScreenCatalogProps) {
  const t = useT();
  const { map, loading, error } = useScreenMap(repoPath, refreshKey);
  const {
    state: captureState,
    progress: captureProgress,
    lastRun,
    grant,
    revoke,
    run,
    cancel,
  } = useScreenCaptures(repoPath, map);

  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [dismissedConsentRepo, setDismissedConsentRepo] = useState<string | null>(null);
  const [cardSize, setCardSize] = useState<CartoCardSize>(getInitialCardSize);
  const [tagFilter, setTagFilter] = useState<ScreenTag | null>(getInitialTagFilter);
  const [groupBy, setGroupBy] = useState<'none' | 'tag'>(getInitialGroupBy);

  const handleSizeChange = (newSize: CartoCardSize) => {
    setCardSize(newSize);
    saveCardSize(newSize);
  };

  const handleGroupByChange = (newGroupBy: 'none' | 'tag') => {
    setGroupBy(newGroupBy);
    saveGroupBy(newGroupBy);
  };

  const coverageNotice = useMemo(() => {
    if (!map) return null;
    return resolveCoverageNotice(map.coverage, t);
  }, [map, t]);

  const sortedScreens = useMemo(() => {
    if (!map) return [];
    return sortScreens(map.screens);
  }, [map]);

  // Conteo de pantallas por tema presente (en base a todas las pantallas del mapa)
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

  // Si el tema guardado ya no está presente, se muestra «Todas»
  const effectiveTagFilter: ScreenTag | null =
    tagFilter && presentTags.includes(tagFilter) ? tagFilter : null;

  const handleTagFilterClick = (clickedTag: ScreenTag | null) => {
    if (clickedTag === null || clickedTag === effectiveTagFilter) {
      setTagFilter(null);
      saveTagFilter(null);
    } else {
      setTagFilter(clickedTag);
      saveTagFilter(clickedTag);
    }
  };

  // Pantallas filtradas según el tema elegido
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

  // Notificar al contenedor sobre la pantalla seleccionada
  useEffect(() => {
    onSelectScreen?.(selectedScreen);
  }, [selectedScreen, onSelectScreen]);

  // Cerrar detalle con tecla Escape
  useEffect(() => {
    if (!selectedScreenId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedScreenId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedScreenId]);

  // El ícono de IA abre el chat general con esa pantalla como tema
  const handleExplain = useCallback(
    (screen: ScreenEntry) => {
      onSelectScreen?.(screen);
      useAssistDockStore.getState().setOpen(true);
      useAssistDockStore.getState().setActiveTab('chat');
      useAssistDockStore.getState().setPendingPrompt(t('assist.ask.screenExplain'));
    },
    [onSelectScreen, t],
  );

  // Secciones por tema principal cuando groupBy === 'tag'
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

  if (!map) {
    return null;
  }

  const isNoUi = map.coverage.state === 'unsupported' && map.coverage.reason === 'no-ui';

  // El filtro también se aplica a la columna lateral cuando hay un cuadro abierto
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
      {/* Cabecera con avisos, franja de captura, filtros por tema y controles */}
      <div className={styles.catalogHeader}>
        {coverageNotice && (
          <div
            className={styles.coverageBanner}
            role="status"
            data-testid="screen-coverage-banner"
          >
            {coverageNotice}
          </div>
        )}

        {/* Franja de capturas: solo se ve en la grilla y cuando el stack está soportado */}
        {!selectedScreen &&
          captureState &&
          captureState.consent.status !== 'unsupported' &&
          !(captureState.consent.status === 'needs-consent' && dismissedConsentRepo === repoPath) && (
            <div className={styles.captureBanner} data-testid="capture-banner">
              <div className={styles.captureBannerContent}>
                {captureState.running || captureProgress ? (
                  <span className={styles.captureBannerText} data-testid="capture-running-text">
                    {captureProgress?.phase === 'views'
                      ? t('cartography.screens.captures.runningViews')
                      : captureProgress && captureProgress.total > 0
                        ? t('cartography.screens.captures.running', {
                            done: captureProgress.done,
                            total: captureProgress.total,
                          })
                        : t('cartography.screens.captures.starting')}
                  </span>
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

                {lastRun?.error && (
                  <span className={styles.captureBannerError} data-testid="capture-error-text">
                    {lastRun.error}
                  </span>
                )}

                {(() => {
                  const skippedViews = lastRun?.skipped?.filter(
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
                  if (captureState.hasRecipes && captureState.runnerConfig) {
                    return (
                      <span className={styles.captureBannerViewsLater} data-testid="capture-views-notice">
                        {t('cartography.screens.captures.viewsWithRecipes', { config: captureState.runnerConfig })}
                      </span>
                    );
                  }
                  return (
                    <span className={styles.captureBannerViewsLater} data-testid="capture-views-notice">
                      {t('cartography.screens.captures.viewsNoRecipes')}
                    </span>
                  );
                })()}
              </div>

              <div className={styles.captureBannerActions}>
                {captureState.running || captureProgress ? (
                  <button
                    type="button"
                    onClick={() => void cancel()}
                    className={styles.captureActionBtn}
                    data-testid="capture-stop-button"
                  >
                    {t('cartography.screens.captures.stop')}
                  </button>
                ) : captureState.consent.status === 'needs-consent' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void grant().then(() => run());
                      }}
                      className={`${styles.captureActionBtn} ${styles.captureActionBtnPrimary}`}
                      data-testid="capture-allow-button"
                    >
                      {t('cartography.screens.captures.allow')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissedConsentRepo(repoPath)}
                      className={styles.captureActionBtn}
                      data-testid="capture-not-now-button"
                    >
                      {t('cartography.screens.captures.notNow')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void run()}
                      className={`${styles.captureActionBtn} ${styles.captureActionBtnPrimary}`}
                      data-testid="capture-refresh-button"
                    >
                      {t('cartography.screens.captures.refresh')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void revoke()}
                      className={styles.captureActionBtn}
                      data-testid="capture-revoke-button"
                    >
                      {t('cartography.screens.captures.revoke')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

        {/* Fila de filtros por tema presente y controles de agrupado y tamaño */}
        {!isNoUi && sortedScreens.length > 0 && (
          <>
            <div className={styles.filterRow} role="group" aria-label="Filtro por tema">
              <button
                type="button"
                onClick={() => handleTagFilterClick(null)}
                data-testid="screen-tag-filter-all"
                className={cn(
                  styles.filterChip,
                  effectiveTagFilter === null && styles.filterChipActive,
                )}
              >
                <span>{t('cartography.screens.filterAll')}</span>
                <span>{sortedScreens.length}</span>
              </button>

              {presentTags.map((tag) => {
                const count = tagCounts[tag] ?? 0;
                const isActive = effectiveTagFilter === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleTagFilterClick(tag)}
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
                {/* Control segmentado Sin agrupar · Por tema */}
                <div
                  className={styles.segmentedControl}
                  role="group"
                  aria-label="Agrupado"
                  data-testid="screen-group-control"
                >
                  <button
                    type="button"
                    onClick={() => handleGroupByChange('none')}
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
                    onClick={() => handleGroupByChange('tag')}
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

                {/* Control segmentado de tamaño */}
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
                      onClick={() => handleSizeChange(key)}
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
        )}
      </div>

      {/* Si es repo no-ui, no se dibujan cuadros */}
      {!isNoUi && sortedScreens.length > 0 && (
        <>
          {selectedScreen ? (
            /* Vista expandida: Detalle a la izquierda + Columna angosta a la derecha */
            <div className={styles.detailLayout} data-testid="screen-catalog-detail-layout">
              <ScreenDetail
                screen={selectedScreen}
                repoPath={repoPath}
                capture={captureState?.captures[selectedScreen.id]}
                lastRun={lastRun}
                onClose={() => setSelectedScreenId(null)}
                onExplain={handleExplain}
              />

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
                    <div
                      key={screen.id}
                      className={styles.sidebarCard}
                      onClick={() => setSelectedScreenId(screen.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedScreenId(screen.id);
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
                    </div>
                  );
                })}
              </aside>
            </div>
          ) : groupBy === 'tag' ? (
            /* Grilla agrupada por tema principal */
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
                        size={cardSize}
                        onSelect={() => setSelectedScreenId(screen.id)}
                        onExplain={handleExplain}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            /* Grilla normal de cuadros compactos */
            <div className={`${styles.grid} ${gridClass}`} data-testid="screen-catalog-grid">
              {filteredScreens.map((screen) => (
                <ScreenCard
                  key={screen.id}
                  screen={screen}
                  repoPath={repoPath}
                  capture={captureState?.captures[screen.id]}
                  size={cardSize}
                  onSelect={() => setSelectedScreenId(screen.id)}
                  onExplain={handleExplain}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!isNoUi && sortedScreens.length === 0 && (
        <div className={styles.emptyState} data-testid="screen-catalog-empty">
          {t('cartography.screens.empty')}
        </div>
      )}
    </div>
  );
}
