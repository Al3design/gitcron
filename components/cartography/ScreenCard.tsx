'use client';

// components/cartography/ScreenCard.tsx
//
// Cuadro compacto de una pantalla individual para el catálogo de Cartografía (decisión 12, tarea 2.9).
// Muestra la captura de borde a borde 16:10 arriba con el tema principal y el botón de IA,
// título y subtítulo, chips de los demás temas, barra de composición y estadísticas.

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Monitor, PanelsTopLeft, Sparkles } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useImagePalette } from '@/hooks/use-image-palette';
import { PixelCard } from '@/components/ui/PixelCard';
import { cn } from '@/lib/utils';
import type { ScreenCapture, ScreenEntry, ScreenFileRole, ScreenTagEvidence } from '@/types/screen-map';
import styles from './ScreenCatalog.module.css';

export interface ScreenCardProps {
  screen: ScreenEntry;
  repoPath: string;
  capture?: ScreenCapture;
  onSelect?: (screen: ScreenEntry) => void;
  onExplain?: (screen: ScreenEntry) => void;
  size?: 'large' | 'medium' | 'small' | 'minimal';
  /** Se está sacando la foto de esta pantalla: el efecto de píxeles se prende sobre la imagen. */
  capturing?: boolean;
}

function relativeTime(
  iso: string | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (isNaN(time)) return null;
  const diff = Math.max(0, Date.now() - time);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('cartography.screens.ago.now');
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return t('cartography.screens.ago.minutes', { n: mins });
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return t('cartography.screens.ago.hours', { n: hours });
  const months = Math.floor(diff / (30 * 86_400_000));
  if (months < 1) return t('cartography.screens.ago.days', { n: days });
  return t('cartography.screens.ago.months', { n: months });
}

export interface RoleGroupItem {
  role: string;
  count: number;
  labelKey: string;
}

export function getRoleGroupItems(
  byRole: Partial<Record<ScreenFileRole, number>> = {},
): RoleGroupItem[] {
  return [
    { role: 'ui', count: (byRole.screen ?? 0) + (byRole.component ?? 0), labelKey: 'cartography.screens.role.component' },
    { role: 'styles', count: byRole.style ?? 0, labelKey: 'cartography.screens.role.style' },
    { role: 'database', count: byRole.data ?? 0, labelKey: 'cartography.screens.role.data' },
    { role: 'logic', count: byRole.logic ?? 0, labelKey: 'cartography.screens.role.logic' },
    { role: 'config', count: byRole.text ?? 0, labelKey: 'cartography.screens.role.text' },
    { role: 'other', count: byRole.other ?? 0, labelKey: 'cartography.screens.role.other' },
  ].filter((r) => r.count > 0);
}

export function CompositionBar({
  byRole,
  t,
}: {
  byRole?: Partial<Record<ScreenFileRole, number>>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const roleGroups = getRoleGroupItems(byRole);
  const total = roleGroups.reduce((acc, r) => acc + r.count, 0);
  if (total === 0) return null;

  return (
    <div className={styles.compositionBar} data-testid="screen-composition-bar">
      {roleGroups.map((rg) => (
        <div
          key={rg.role}
          className={cn(styles.barSegment, styles[`barSegment_${rg.role}`])}
          style={{ width: `${(rg.count / total) * 100}%` }}
          title={`${t(rg.labelKey)}: ${rg.count}`}
        />
      ))}
    </div>
  );
}

/**
 * Mientras se saca la foto de la pantalla, el efecto de píxeles va encima de la imagen, con
 * cuadraditos más grandes y los colores de la captura anterior; sin captura, los de la IA
 * (Alejandro, carto-05e). Respeta el movimiento reducido, como en el resto de los cuadros.
 */
function CapturingOverlay({ src }: { src?: string }) {
  const palette = useImagePalette(src);
  return (
    <PixelCard
      className={styles.capturingOverlay}
      active
      noFocus
      gap={11}
      pixelSize={8}
      speed={45}
      colors={palette}
      data-testid="card-capturing-overlay"
    />
  );
}

function CardMedia({
  screen,
  capture,
  capturing,
  primaryTagClass,
  primaryTagLabel,
  onExplain,
  t,
}: {
  screen: ScreenEntry;
  capture?: ScreenCapture;
  capturing?: boolean;
  primaryTagClass: string;
  primaryTagLabel: string;
  onExplain?: (screen: ScreenEntry) => void;
  t: (key: string) => string;
}) {
  const handleAiClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExplain?.(screen);
  };

  return (
    <div className={cn(styles.cardMedia, styles.cardThumbnail)} data-testid="card-thumbnail">
      {capture ? (
        <img src={capture.dataUrl} alt="" className={styles.captureImage} />
      ) : screen.kind === 'route' ? (
        <Monitor size={28} className={styles.thumbnailIcon} aria-hidden="true" />
      ) : (
        <PanelsTopLeft size={28} className={styles.thumbnailIcon} aria-hidden="true" />
      )}

      {capturing && <CapturingOverlay src={capture?.dataUrl} />}

      <span className={cn(styles.mediaTag, primaryTagClass)} data-testid="screen-primary-tag">
        <span className={cn(styles.tagDot, primaryTagClass)} />
        <span>{primaryTagLabel}</span>
      </span>

      <div className={styles.mediaActions}>
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

      {capture?.stale && (
        <span className={styles.staleBadge} data-testid="stale-badge">
          {t('cartography.screens.captures.stale')}
        </span>
      )}
    </div>
  );
}

function CardTags({
  tags,
  t,
}: {
  tags: ScreenTagEvidence[];
  t: (key: string) => string;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className={styles.cardTags} data-testid="screen-card-tags">
      {tags.slice(0, 3).map((te) => (
        <li key={te.tag} className={cn(styles.tagChip, styles[`tag_${te.tag}`])}>
          <span className={cn(styles.tagDot, styles[`tag_${te.tag}`])} />
          <span>{t(`cartography.screens.tags.${te.tag}`)}</span>
        </li>
      ))}
      {tags.length > 3 && <li className={styles.tagChipMore}>+{tags.length - 3}</li>}
    </ul>
  );
}

export function ScreenCard({ screen, capture, capturing = false, onSelect, onExplain, size = 'medium' }: ScreenCardProps) {
  const t = useT();
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const ownCount = screen.files.filter((f) => !f.shared).length;
  const totalCount = screen.files.length;
  const displayName = screen.description?.suggestedName || screen.name;
  const locationSubtitle = screen.kind === 'route' ? screen.locator : t('cartography.screens.viewInApp');
  const locationTooltip = `${screen.locator} · ${screen.declaredIn}`;

  const primaryTag = screen.primaryTag;
  const primaryTagClass = primaryTag ? styles[`tag_${primaryTag}`] : styles.tag_general;
  const primaryTagLabel = primaryTag
    ? t(`cartography.screens.tags.${primaryTag}`)
    : t('cartography.screens.tags.general');

  const otherTags = (screen.tags ?? []).filter((te) => te.tag !== primaryTag);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(screen);
    }
  };

  const isCardActive = isHovered || isFocused;
  const whenChanged = relativeTime(screen.stats?.lastChangedAt ?? null, t);
  const changedStr = whenChanged ? ` · ${t('cartography.screens.changedAgo', { when: whenChanged })}` : '';
  const statsString = `${t(totalCount === 1 ? 'cartography.screens.statsFile' : 'cartography.screens.statsFiles', { count: totalCount })} · ${t(ownCount === 1 ? 'cartography.screens.statsOwnOne' : 'cartography.screens.statsOwn', { count: ownCount })}${changedStr}`;

  return (
    <motion.article
      layoutId={shouldReduceMotion ? undefined : screen.id}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      className={cn(styles.card, primaryTagClass)}
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
      <PixelCard className={styles.cardInner} active={isCardActive} noFocus>
        <CardMedia
          screen={screen}
          capture={capture}
          capturing={capturing}
          primaryTagClass={primaryTagClass}
          primaryTagLabel={primaryTagLabel}
          onExplain={onExplain}
          t={t}
        />

        <div className={styles.cardBody}>
          <div className={styles.cardContent}>
            <h3
              className={styles.cardTitle}
              title={screen.description?.suggestedName ? screen.name : undefined}
            >
              {displayName}
            </h3>
            {size !== 'minimal' && (
              <p className={styles.cardSubtitle} title={locationTooltip}>
                {locationSubtitle}
              </p>
            )}
          </div>

          {size !== 'minimal' && (
            <>
              <CardTags tags={otherTags} t={t} />
              {size !== 'small' && <CompositionBar byRole={screen.stats?.byRole} t={t} />}
              <p className={styles.cardStats} data-testid="screen-file-counts">
                {statsString}
              </p>
            </>
          )}
        </div>
      </PixelCard>
    </motion.article>
  );
}
