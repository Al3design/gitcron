'use client';

// components/cartography/ScreenCatalog.tsx
//
// Catálogo de pantallas del repositorio en cuadros (tarea 2.1, 2.6).
// En modo Simple, organiza las pantallas en una grilla responsive ordenada
// (primero rutas, después vistas), con aviso de cobertura en lenguaje llano.

import { useMemo } from 'react';
import { useT } from '@/hooks/use-translation';
import { useScreenMap } from '@/hooks/use-screen-map';
import type { ScreenEntry, ScreenMapCoverage } from '@/types/screen-map';
import { ScreenCard } from './ScreenCard';
import styles from './ScreenCatalog.module.css';

export interface ScreenCatalogProps {
  repoPath: string;
  refreshKey: number;
}

function resolveCoverageNotice(coverage: ScreenMapCoverage, t: (key: string, vars?: Record<string, string | number>) => string): string | null {
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

export function ScreenCatalog({ repoPath, refreshKey }: ScreenCatalogProps) {
  const t = useT();
  const { map, loading, error } = useScreenMap(repoPath, refreshKey);

  const coverageNotice = useMemo(() => {
    if (!map) return null;
    return resolveCoverageNotice(map.coverage, t);
  }, [map, t]);

  const sortedScreens = useMemo(() => {
    if (!map) return [];
    return sortScreens(map.screens);
  }, [map]);

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

  return (
    <div className={styles.container} data-testid="screen-catalog">
      {/* Aviso de cobertura en una línea, si no es complete */}
      {coverageNotice && (
        <div
          className={styles.coverageBanner}
          role="status"
          data-testid="screen-coverage-banner"
        >
          {coverageNotice}
        </div>
      )}

      {/* Si es repo no-ui, no se dibujan cuadros */}
      {!isNoUi && sortedScreens.length > 0 && (
        <div className={styles.grid} data-testid="screen-catalog-grid">
          {sortedScreens.map((screen) => (
            <ScreenCard
              key={screen.id}
              screen={screen}
              repoPath={repoPath}
            />
          ))}
        </div>
      )}

      {!isNoUi && sortedScreens.length === 0 && (
        <div className={styles.emptyState} data-testid="screen-catalog-empty">
          {t('cartography.screens.empty')}
        </div>
      )}
    </div>
  );
}
