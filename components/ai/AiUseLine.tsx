'use client';

// AiUseLine — qué modelo usa un uso de texto según gitcron.json (tarea 4.3 de
// modelos-en-casa), y si no tiene, «usar lo que tenías» con un botón (decisión de
// Ale del 2026-10-01: nada se escribe solo). Se vuelve a preguntar cuando cambia un
// gitcron.json, igual que la caja de la redacción.

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import type { AiTextUse, AiUseDestination, AiUseStatus } from '@/types/ai-use';
import styles from './AiUseLine.module.css';

interface Props {
  use: AiTextUse;
  repoPath?: string | null;
  /** El modelo elegido en el selector de la pantalla, si tiene (redacción y análisis). */
  screenModel?: string | null;
  /** Para que la pantalla sepa si el uso tiene modelo. */
  onStatus?: (status: AiUseStatus | null) => void;
  /** Cambia cuando la pantalla cambió la elección de antes: vuelve a preguntar la oferta. */
  refreshKey?: string;
  /**
   * La pantalla tiene selector de LM Studio: sin modelo en el archivo se redacta con
   * el elegido ahí, por el proveedor «lmstudio» de gitcron.json, y la línea lo dice.
   */
  screenChoice?: boolean;
  /** Nombre o lista de archivos de donde proviene la configuración (si la pantalla ya los resolvió). */
  sourceFile?: string;
}

export function AiUseLine({ use, repoPath = null, screenModel = null, onStatus, refreshKey, screenChoice = false, sourceFile }: Props) {
  const t = useT();
  const [status, setStatus] = useState<AiUseStatus | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);

  // Sube cuando hay que volver a preguntar: cambió un gitcron.json o se escribió.
  const [version, setVersion] = useState(0);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    // Sin el canal no hay nada que mostrar ni a qué escuchar.
    const aiUse = window.api?.aiUse;
    if (!aiUse) return;
    let alive = true;
    aiUse.status({ use, repoPath, screenModel }).then((res) => {
      if (!alive) return;
      const next = res?.success && res.data ? res.data : null;
      setStatus(next);
      onStatusRef.current?.(next);
    }).catch(() => undefined);
    const stop = window.api?.commitAi?.onConfigChanged?.(() => setVersion((v) => v + 1));
    return () => {
      alive = false;
      stop?.();
    };
  }, [use, repoPath, screenModel, version, refreshKey]);

  const destination = (dest: AiUseDestination) => {
    if (dest === 'this-machine') return t('pipeline.openspec.prepare.aiDestThisMachine');
    if (dest === 'own-server') return t('pipeline.openspec.prepare.aiDestOwnServer');
    return t('pipeline.openspec.prepare.aiDestExternal');
  };

  const adopt = async () => {
    setAdopting(true);
    setAdoptError(null);
    try {
      const res = await window.api?.aiUse?.adopt({ use, repoPath, screenModel });
      if (!res?.success) setAdoptError(t('aiUse.adoptFailed', { detail: res?.error ?? '—' }));
      setVersion((v) => v + 1);
    } finally {
      setAdopting(false);
    }
  };

  if (!status) return null;

  if (status.status === 'resolved') {
    const hasAlternatives = !status.available && status.alternatives && status.alternatives.length > 0;
    const altProviders = hasAlternatives
      ? status.alternatives.map((a) => `«${a.providerName}»`).join(', ')
      : '';
    // El plural va en la clave y no armado acá: «declaran» no se arma igual en cada idioma.
    const altKey = (status.alternatives?.length ?? 0) > 1 ? 'aiUse.alternativesMany' : 'aiUse.alternativesOne';

    const lineKey = use === 'gitcron-commit'
      ? 'pipeline.openspec.prepare.aiResolvedLine'
      : 'aiUse.resolved';

    return (
      <div className={styles.block}>
        <p className={styles.line}>
          {t(lineKey, {
            model: status.modelId,
            provider: status.providerName,
            destination: destination(status.destination),
            file: sourceFile || status.sourceFile,
          })}
          {status.modelSource === 'general' ? t('aiUse.general') : status.isException ? t('aiUse.exception') : ''}
          {' · '}
          {t('aiUse.toolsNone')}
        </p>
        {status.destination === 'external-service' && (
          <p className={styles.externalNotice}>{t('aiUse.externalNotice', { provider: status.providerName })}</p>
        )}
        {(() => {
          const dir = status.sourceDir;
          if (!dir) return null;
          return (
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.showInFolder}
                onClick={() => {
                  window.api?.shellOpenPath?.(dir);
                }}
              >
                {t('aiUse.showInFolder')}
              </button>
            </div>
          );
        })()}
        {!status.available && status.unavailableReason && (
          <p className={styles.problem} role="alert">{status.unavailableReason}</p>
        )}
        {hasAlternatives && (
          <p className={styles.alternativesNote}>
            {t(altKey, { providers: altProviders })}
          </p>
        )}
      </div>
    );
  }

  if (status.status === 'disabled') {
    const dir = status.sourceDir;
    return (
      <div className={styles.block}>
        <p className={styles.line}>{t('aiUse.disabled')}</p>
        {dir && (
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.showInFolder}
              onClick={() => {
                window.api?.shellOpenPath?.(dir);
              }}
            >
              {t('aiUse.showInFolder')}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status.status === 'error') {
    return <p className={styles.problem} role="alert">{status.error}</p>;
  }

  const withSelector = screenChoice && Boolean(status.canLoad);
  return (
    <div className={styles.block}>
      <p className={styles.line}>{withSelector ? t('aiUse.unsetScreen') : t('aiUse.unset')}</p>
      {status.offer ? (
        <p className={styles.offer}>
          <button type="button" className={styles.adopt} disabled={adopting} onClick={() => { void adopt(); }}>
            {adopting ? t('aiUse.adopting') : t('aiUse.adopt', { label: status.offer.label })}
          </button>
          <span className={styles.note}>
            {status.offer.addsProvider
              ? t('aiUse.adoptNoteProvider', { file: status.offer.file, provider: status.offer.addsProvider })
              : t('aiUse.adoptNote', { file: status.offer.file })}
          </span>
        </p>
      ) : withSelector ? null : (
        <p className={styles.note}>{t('aiUse.unsetHint', { use })}</p>
      )}
      {adoptError && <p className={styles.problem} role="alert">{adoptError}</p>}
    </div>
  );
}
