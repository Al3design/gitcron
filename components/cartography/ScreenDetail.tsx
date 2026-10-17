'use client';

// components/cartography/ScreenDetail.tsx
//
// Vista de detalle de una pantalla individual de Cartografía (decisión 9, tarea 2.2).
// Muestra cabecera con nombre, lugar, ícono de IA y botón de cerrar; captura grande;
// qué hace (desde caché o aviso para consultar); y archivos agrupados por rol
// en un control segmentado con scroll independiente.

import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Monitor, PanelsTopLeft, Sparkles, X } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { cn } from '@/lib/utils';
import type { ScreenCapture, ScreenDescription, ScreenEntry, ScreenFileLink, ScreenFileRole } from '@/types/screen-map';
import styles from './ScreenCatalog.module.css';

export interface ScreenDetailProps {
  screen: ScreenEntry;
  repoPath: string;
  capture?: ScreenCapture;
  onClose: () => void;
  onExplain?: (screen: ScreenEntry) => void;
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

export function ScreenDetail({ screen, repoPath, capture, onClose, onExplain }: ScreenDetailProps) {
  const t = useT();
  const rawLang = useGitStore((s) => s.language) ?? 'es';
  const lang: 'es' | 'en' | 'zh' = rawLang === 'zh' ? 'zh' : rawLang === 'en' ? 'en' : 'es';
  const shouldReduceMotion = useReducedMotion();

  // La explicación guardada que trajo la consulta, atada a su pantalla: al cambiar de pantalla no
  // se muestra la de la anterior y no hace falta borrarla con un efecto.
  const [cached, setCached] = useState<{ screenId: string; description: ScreenDescription } | null>(null);
  const description: ScreenDescription | null =
    screen.description ?? (cached?.screenId === screen.id ? cached.description : null);

  // Consulta si hay explicación en caché sin invocar al modelo (cacheOnly)
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

  // Agrupamiento por rol: desconocidos al final de 'other'
  const filesByRole = useMemo(() => {
    const map = new Map<ScreenFileRole, ScreenFileLink[]>();
    for (const file of screen.files) {
      const effectiveRole: ScreenFileRole = file.provenance === 'unknown' ? 'other' : file.role;
      const list = map.get(effectiveRole) ?? [];
      list.push(file);
      map.set(effectiveRole, list);
    }
    // Ordenar dentro de cada rol: primero normales, desconocidos al final
    for (const [, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.provenance === 'unknown' && b.provenance !== 'unknown') return 1;
        if (a.provenance !== 'unknown' && b.provenance === 'unknown') return -1;
        return a.path.localeCompare(b.path);
      });
    }
    return map;
  }, [screen.files]);

  const availableRoles = useMemo(() => {
    return ROLE_ORDER.filter((role) => (filesByRole.get(role)?.length ?? 0) > 0);
  }, [filesByRole]);

  const [activeRole, setActiveRole] = useState<ScreenFileRole>(
    availableRoles[0] ?? 'screen'
  );

  // Si el rol elegido no tiene archivos en esta pantalla, se muestra el primero que sí tiene.
  const effectiveRole: ScreenFileRole = availableRoles.includes(activeRole) ? activeRole : (availableRoles[0] ?? 'screen');

  const displayName = description?.suggestedName || screen.name;
  const locationSubtitle =
    screen.kind === 'route' ? screen.locator : t('cartography.screens.viewInApp');
  const locationTooltip = `${screen.locator} · ${screen.declaredIn}`;

  const currentRoleFiles = filesByRole.get(effectiveRole) ?? [];

  return (
    <motion.div
      layoutId={shouldReduceMotion ? undefined : screen.id}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      className={styles.detailColumn}
      data-testid={`screen-detail-${screen.id}`}
    >
      {/* 1. Cabecera */}
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleGroup}>
          <h3
            className={styles.cardTitle}
            title={description?.suggestedName ? screen.name : undefined}
          >
            {displayName}
          </h3>
          <p className={styles.cardSubtitle} title={locationTooltip}>
            {locationSubtitle}
          </p>
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

      {/* 2. Captura grande 16:10 */}
      <div className={styles.detailCapture} data-testid="detail-capture">
        {capture ? (
          <img src={capture.dataUrl} alt="" className={styles.captureImage} />
        ) : screen.kind === 'route' ? (
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

      {/* 3. Qué hace */}
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

      {/* 4. Archivos */}
      <section className={styles.detailFilesSection} aria-label="Archivos">
        <h4 className={styles.sectionLabel}>Archivos</h4>

        {/* Control segmentado por rol */}
        {availableRoles.length > 0 && (
          <div
            className={styles.segmentedControl}
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
                  className={cn(styles.segmentedBtn, isActive && styles.segmentedBtnActive)}
                  onClick={() => setActiveRole(role)}
                  data-testid={`role-tab-${role}`}
                >
                  {t(`cartography.screens.role.${role}`)} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Lista con scroll independiente */}
        <div
          className={styles.filesScrollContainer}
          data-testid="screen-detail-files-list"
        >
          <ul className={styles.fileList}>
            {currentRoleFiles.map((file, idx) => {
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

              const baseName = file.path.split('/').pop() ?? file.path;
              const lastSlash = file.path.lastIndexOf('/');
              const dirName = lastSlash !== -1 ? file.path.substring(0, lastSlash) : '';

              return (
                <li key={file.path} className={styles.fileItem}>
                  <div className={styles.fileItemLeft}>
                    <span className={styles.fileName} title={file.path}>
                      {baseName}
                    </span>
                    {dirName && (
                      <span className={styles.fileDir} title={dirName}>
                        {dirName}
                      </span>
                    )}
                  </div>
                  {file.shared && (
                    <span className={styles.sharedBadge} data-testid="shared-badge">
                      {t('cartography.screens.sharedBadge')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </motion.div>
  );
}
