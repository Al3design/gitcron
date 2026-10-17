'use client';

// components/cartography/ScreenCard.tsx
//
// Cuadro compacto de una pantalla individual para el catálogo de Cartografía (decisión 9, tarea 2.2).
// Muestra el lugar de la captura 16:10 con ícono de ruta/vista, el ícono de IA arriba
// a la derecha (32px visibles, 44px de área), nombre, dónde se elige y el conteo de archivos.
// Al tocarlo lo elige para expandir a detalle.

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Monitor, PanelsTopLeft, Sparkles } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { PixelCard } from '@/components/ui/PixelCard';
import type { ScreenCapture, ScreenEntry } from '@/types/screen-map';
import styles from './ScreenCatalog.module.css';

export interface ScreenCardProps {
  screen: ScreenEntry;
  repoPath: string;
  capture?: ScreenCapture;
  onSelect?: (screen: ScreenEntry) => void;
  onExplain?: (screen: ScreenEntry) => void;
  size?: 'large' | 'medium' | 'small' | 'minimal';
}

export function ScreenCard({ screen, capture, onSelect, onExplain, size }: ScreenCardProps) {
  const t = useT();
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const ownCount = screen.files.filter((f) => !f.shared).length;
  const sharedCount = screen.files.filter((f) => f.shared).length;

  const displayName = screen.description?.suggestedName || screen.name;
  const locationSubtitle =
    screen.kind === 'route' ? screen.locator : t('cartography.screens.viewInApp');
  const locationTooltip = `${screen.locator} · ${screen.declaredIn}`;

  const handleAiClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExplain?.(screen);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(screen);
    }
  };

  const isCardActive = isHovered || isFocused;

  return (
    <motion.article
      layoutId={shouldReduceMotion ? undefined : screen.id}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      className={styles.card}
      data-testid={`screen-card-${screen.id}`}
      aria-label={displayName}
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(screen)}
      onKeyDown={handleKeyDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
    >
      {/* El efecto de píxeles cubre el cuadro entero, detrás de la captura y del texto (Ale, carto-05a). */}
      <PixelCard className={styles.cardInner} active={isCardActive} noFocus>
        {/* 1. Lugar de la captura 16:10 + ícono de IA */}
        <div className={styles.cardThumbnail} data-testid="card-thumbnail">
          {capture ? (
            <img src={capture.dataUrl} alt="" className={styles.captureImage} />
          ) : screen.kind === 'route' ? (
            <Monitor size={28} className={styles.thumbnailIcon} aria-hidden="true" />
          ) : (
            <PanelsTopLeft size={28} className={styles.thumbnailIcon} aria-hidden="true" />
          )}

          {capture?.stale && (
            <span className={styles.staleBadge} data-testid="stale-badge">
              {t('cartography.screens.captures.stale')}
            </span>
          )}

          <button
            type="button"
            className={styles.aiIconButton}
            onClick={handleAiClick}
            title={t('cartography.screens.explainAction')}
            aria-label={t('cartography.screens.explainAction')}
            data-testid="explain-screen-button"
          >
            <Sparkles size={14} aria-hidden="true" />
          </button>
        </div>

        {/* 2. Contenido textual */}
        <div className={styles.cardContent}>
          <h3
            className={styles.cardTitle}
            title={screen.description?.suggestedName ? screen.name : undefined}
          >
            {displayName}
          </h3>
          {size !== 'minimal' && (
            <>
              <p className={styles.cardSubtitle} title={locationTooltip}>
                {locationSubtitle}
              </p>
              <p className={styles.cardFiles} data-testid="screen-file-counts">
                {t('cartography.screens.fileCountsShort', { own: ownCount, shared: sharedCount })}
              </p>
            </>
          )}
        </div>
      </PixelCard>
    </motion.article>
  );
}
