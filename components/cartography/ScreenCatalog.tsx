'use client';

// components/cartography/ScreenCatalog.tsx
//
// Catálogo de pantallas del repositorio (decisión 9, tareas 1.4, 2.2).
// En modo grilla muestra cuadros compactos. Al tocar uno, se expande a dos columnas:
// a la izquierda el detalle completo (ScreenDetail) y a la derecha una columna angosta
// con los demás cuadros en formato mínimo. Escape y la X vuelven a la grilla.
// El ícono de IA publica la pantalla en el chat general y abre el panel de asistencia.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Monitor, PanelsTopLeft } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useScreenMap } from '@/hooks/use-screen-map';
import { useScreenCaptures } from '@/hooks/use-screen-captures';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import type { ScreenEntry, ScreenMapCoverage } from '@/types/screen-map';
import { ScreenCard } from './ScreenCard';
import { ScreenDetail } from './ScreenDetail';
import styles from './ScreenCatalog.module.css';

export type CartoCardSize = 'large' | 'medium' | 'small' | 'minimal';
const CARD_SIZE_STORAGE_KEY = 'gitcron:cartoCardSize';

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

  const handleSizeChange = (newSize: CartoCardSize) => {
    setCardSize(newSize);
    saveCardSize(newSize);
  };

  const coverageNotice = useMemo(() => {
    if (!map) return null;
    return resolveCoverageNotice(map.coverage, t);
  }, [map, t]);

  const sortedScreens = useMemo(() => {
    if (!map) return [];
    return sortScreens(map.screens);
  }, [map]);

  const selectedScreen = useMemo(() => {
    if (!selectedScreenId) return null;
    return sortedScreens.find((s) => s.id === selectedScreenId) ?? null;
  }, [selectedScreenId, sortedScreens]);

  // Si la pantalla elegida ya no está en el mapa, `selectedScreen` queda en null y la vista vuelve
  // a la grilla sola (sin un efecto que cambie el estado de golpe).

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

  const otherScreens = sortedScreens.filter((s) => s.id !== selectedScreenId);

  const gridClass = cardSize === 'large'
    ? styles.grid_large
    : cardSize === 'small'
      ? styles.grid_small
      : cardSize === 'minimal'
        ? styles.grid_minimal
        : styles.grid_medium;

  return (
    <div className={styles.container} data-testid="screen-catalog">
      {/* Aviso de cobertura y control de tamaño */}
      {(!selectedScreen || coverageNotice) && (
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
                      {captureProgress && captureProgress.total > 0
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

                  {lastRun?.skipped?.some((s) => s.reason === 'view') && (
                    <span className={styles.captureBannerViewsLater}>
                      {t('cartography.screens.captures.viewsLater')}
                    </span>
                  )}
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

          {!selectedScreen && !isNoUi && sortedScreens.length > 0 && (
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
                  className={`${styles.segmentedBtn} ${cardSize === key ? styles.segmentedBtnActive : ''}`.trim()}
                >
                  <LayoutGrid size={13} aria-hidden="true" />
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
          ) : (
            /* Grilla normal de cuadros compactos */
            <div className={`${styles.grid} ${gridClass}`} data-testid="screen-catalog-grid">
              {sortedScreens.map((screen) => (
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
