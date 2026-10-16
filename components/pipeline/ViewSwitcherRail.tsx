import React from 'react';
import { cn } from '@/lib/utils';
import styles from './OpenSpecDashboard.module.css';

export const VIEW_SWITCHER_SLOTS = [1, 2, 3, 4, 5] as const;
export type ViewSwitcherSlotIndex = typeof VIEW_SWITCHER_SLOTS[number];

export type ViewSwitcherItem = {
  id: string;
  label: string;
  count?: number | null;
  badge?: string | null;
  slotIndex: number; // 1 | 2 | 3 | 4
  icon?: React.ReactNode;
  disabled?: boolean;
};

export type ViewSwitcherRailProps = {
  views: ViewSwitcherItem[];
  activeViewId: string;
  onSwitchView: (viewId: string) => void;
  environmentSlot?: React.ReactNode;
  openSpecSlot?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  isFolded?: boolean;
  onTransitionEnd?: (e: React.TransitionEvent<HTMLElement>) => void;
};

/**
 * Intercambiador dinámico de vistas (Modelo Codex dinámico).
 *
 * Principio de funcionamiento (Revisión visual 4.6 / Tarea 4.9, Obs. 36):
 * - El cuerpo central muestra una única vista soberana por vez.
 * - El panel lateral lista todas las demás vistas disponibles que NO se están
 *   mirando en ese instante, organizadas en ranuras estables.
 * - Toma la altura de su contenido (height: auto; align-self: flex-start).
 * - Sus secciones no se pliegan independientemente: los encabezados se presentan
 *   como rótulos estáticos de sección y no como controles desplegables (la
 *   alternancia de visibilidad se delega al control general del panel en la barra superior).
 * - Al pulsar cualquier entrada del riel, pasa al cuerpo central y la vista
 *   que estaba en el cuerpo pasa al riel.
 * - Si sólo hay una vista disponible y no hay señales de entorno ni slot OpenSpec, el riel no
 *   se monta en el DOM (retorna null), cediendo el 100% del ancho al cuerpo.
 */
export function ViewSwitcherRail({
  views,
  activeViewId,
  onSwitchView,
  environmentSlot,
  openSpecSlot,
  ariaLabel = 'Vistas',
  className,
  style,
  isFolded,
  onTransitionEnd,
}: ViewSwitcherRailProps) {
  const availableViews = views.filter((v) => v.id !== activeViewId);

  // Auto-hide: si no hay vistas alternativas, señales de entorno ni slot OpenSpec, el riel no existe.
  if (availableViews.length === 0 && !environmentSlot && !openSpecSlot) {
    return null;
  }

  return (
    <nav
      className={cn(styles.switcherRail, isFolded && styles.switcherRailFolded, className)}
      style={style}
      aria-label={ariaLabel}
      onTransitionEnd={onTransitionEnd}
      data-folded={isFolded ? 'true' : undefined}
      aria-hidden={isFolded ? 'true' : undefined}
      inert={isFolded ? true : undefined}
    >
      {availableViews.length > 0 && (
        <div className={styles.railSection}>
          <div className={styles.railSectionHeader}>
            <span className={styles.railSectionTitle}>{ariaLabel}</span>
            <span className={styles.railItemCount} aria-label={`${availableViews.length}`}>
              <span className={styles.railItemCountValue}>{availableViews.length}</span>
            </span>
          </div>
          <div className={styles.railSlots}>
            {VIEW_SWITCHER_SLOTS.map((slotIdx) => {
              const item = availableViews.find((v) => v.slotIndex === slotIdx);
              return (
                <div
                  key={slotIdx}
                  className={styles.railSlot}
                  data-slot={slotIdx}
                  data-occupied={Boolean(item) ? 'true' : 'false'}
                >
                  {item && (
                    <button
                      type="button"
                      className={styles.railItem}
                      data-slot={slotIdx}
                      data-view-id={item.id}
                      onClick={() => onSwitchView(item.id)}
                      disabled={item.disabled}
                    >
                      {item.icon && <span className={styles.railItemIcon} aria-hidden="true">{item.icon}</span>}
                      <span className={styles.railItemLabel}>{item.label}</span>
                      {item.count !== undefined && item.count !== null && (
                        <span className={styles.railItemCount} aria-label={`${item.count}`}>
                          <span className={styles.railItemCountSep}>·</span>
                          <span className={styles.railItemCountValue}>{item.count}</span>
                        </span>
                      )}
                      {item.badge && <span className={styles.railItemBadge}>{item.badge}</span>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {environmentSlot && (
        <div className={styles.railEnvironment} data-slot="environment">
          {environmentSlot}
        </div>
      )}

      {openSpecSlot && (
        <div className={styles.railSection} data-slot="openspec">
          {openSpecSlot}
        </div>
      )}
    </nav>
  );
}
