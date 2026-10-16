'use client';

// components/cartography/ScreenCard.tsx
//
// Cuadro de una pantalla individual para el catálogo de Cartografía (tarea 2.1, 2.6).
// Muestra nombre, dónde se elige, qué hace (con explicación de IA a demanda y citas)
// y qué archivos la forman (propios y compartidos, agrupados por rol).

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { useGitStore } from '@/lib/git-store';
import { cn } from '@/lib/utils';
import type { ScreenDescription, ScreenEntry, ScreenFileLink, ScreenFileRole } from '@/types/screen-map';
import styles from './ScreenCatalog.module.css';

export interface ScreenCardProps {
  screen: ScreenEntry;
  repoPath: string;
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

export function ScreenCard({ screen, repoPath }: ScreenCardProps) {
  const t = useT();
  const rawLang = useGitStore((s) => s.language) ?? 'es';
  const lang: 'es' | 'en' | 'zh' = rawLang === 'zh' ? 'zh' : rawLang === 'en' ? 'en' : 'es';

  const [description, setDescription] = useState<ScreenDescription | null>(screen.description);
  const [loadingAi, setLoadingAi] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);

  // Al montar, consulta si hay explicación en caché sin invocar al modelo (cacheOnly)
  useEffect(() => {
    if (description) return;
    let active = true;

    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoScreens?.describe) return;

    api.cartoScreens
      .describe({ repoPath, screenId: screen.id, language: lang, cacheOnly: true })
      .then((res) => {
        if (!active) return;
        if (res?.success && res.data && res.data.status === 'ok') {
          setDescription(res.data.description);
        }
      })
      .catch((error: unknown) => {
        // Sin la explicación guardada, el cuadro ofrece el botón: no hace falta molestar con un aviso.
        console.warn('[ScreenCard] no se pudo leer la explicación guardada', error);
      });

    return () => {
      active = false;
    };
  }, [repoPath, screen.id, lang, description]);

  const handleExplain = useCallback(async () => {
    if (loadingAi) return;
    setLoadingAi(true);

    try {
      const api = typeof window !== 'undefined' ? window.api : undefined;
      if (!api?.cartoScreens?.describe) {
        throw new Error('API cartoScreens.describe no disponible');
      }

      const res = await api.cartoScreens.describe({
        repoPath,
        screenId: screen.id,
        language: lang,
      });

      if (res?.success && res.data) {
        if (res.data.status === 'ok') {
          setDescription(res.data.description);
        } else {
          useGitStore.getState().setError(res.data.message);
        }
      } else {
        useGitStore
          .getState()
          .setError(res?.error ?? t('cartography.screens.explainFailed'));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      useGitStore.getState().setError(msg);
    } finally {
      setLoadingAi(false);
    }
  }, [loadingAi, repoPath, screen.id, lang, t]);

  // Conteos de archivos
  const ownCount = screen.files.filter((f) => !f.shared).length;
  const sharedCount = screen.files.filter((f) => f.shared).length;

  // Agrupamiento por rol
  const filesByRole = screen.files.reduce((acc, file) => {
    const list = acc.get(file.role) ?? [];
    list.push(file);
    acc.set(file.role, list);
    return acc;
  }, new Map<ScreenFileRole, ScreenFileLink[]>());

  const locationSubtitle =
    screen.kind === 'route' ? screen.locator : t('cartography.screens.viewInApp');
  const locationTooltip = `${screen.locator} · ${screen.declaredIn}`;

  return (
    <article
      className={styles.card}
      data-testid={`screen-card-${screen.id}`}
      aria-label={screen.name}
    >
      {/* 1. Título y dónde se elige */}
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{screen.name}</h3>
        <p className={styles.cardSubtitle} title={locationTooltip}>
          {locationSubtitle}
        </p>
      </header>

      {/* 2. Qué hace */}
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
                    <span
                      key={fPath}
                      className={styles.sourcePill}
                      title={fPath}
                    >
                      {baseName}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className={styles.explainButton}
            onClick={handleExplain}
            disabled={loadingAi}
            data-testid="explain-screen-button"
          >
            {loadingAi ? (
              <span className="ai-thinking-text">
                {t('cartography.screens.explaining')}
              </span>
            ) : (
              <>
                <Sparkles size={14} aria-hidden="true" />
                <span>{t('cartography.screens.explainAction')}</span>
              </>
            )}
          </button>
        )}
      </section>

      {/* 3. Qué archivos la forman */}
      <section className={styles.section} aria-label="Qué archivos la forman">
        <h4 className={styles.sectionLabel}>Qué archivos la forman</h4>
        <p className={styles.fileSummary} data-testid="screen-file-counts">
          {t('cartography.screens.fileCounts', { own: ownCount, shared: sharedCount })}
        </p>

        <button
          type="button"
          className={styles.toggleFilesButton}
          onClick={() => setFilesExpanded((prev) => !prev)}
          aria-expanded={filesExpanded}
          data-testid="toggle-files-button"
        >
          {filesExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>
            {filesExpanded
              ? t('cartography.screens.hideFiles')
              : t('cartography.screens.viewFiles')}
          </span>
        </button>

        {filesExpanded && (
          <div className={styles.fileGroupsList} data-testid="screen-files-details">
            {ROLE_ORDER.map((role) => {
              const filesInRole = filesByRole.get(role);
              if (!filesInRole || filesInRole.length === 0) return null;

              return (
                <div key={role} className={styles.roleGroup} data-testid={`role-group-${role}`}>
                  <span className={styles.roleGroupName}>
                    {t(`cartography.screens.role.${role}`)}
                  </span>
                  <ul className={styles.fileList}>
                    {filesInRole.map((file, idx) => {
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
                      return (
                        <li key={file.path} className={styles.fileItem}>
                          <span className={styles.fileName} title={file.path}>
                            {baseName}
                          </span>
                          {file.shared && (
                            <span
                              className={styles.sharedBadge}
                              data-testid="shared-badge"
                            >
                              {t('cartography.screens.sharedBadge')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </article>
  );
}
