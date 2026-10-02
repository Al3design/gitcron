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
}

export function AiUseLine({ use, repoPath = null, screenModel = null, onStatus, refreshKey, screenChoice = false }: Props) {
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
    return (
      <div className={styles.block}>
        <p className={styles.line}>
          {t('aiUse.resolved', {
            model: status.modelId,
            provider: status.providerName,
            destination: destination(status.destination),
            file: status.sourceFile,
          })}
          {status.modelSource === 'general' ? t('aiUse.general') : ''}
        </p>
        {!status.available && status.unavailableReason && (
          <p className={styles.problem} role="alert">{status.unavailableReason}</p>
        )}
      </div>
    );
  }

  if (status.status === 'disabled') {
    return <p className={styles.line}>{t('aiUse.disabled')}</p>;
  }

  if (status.status === 'error') {
    return <p className={styles.problem} role="alert">{status.error}</p>;
  }

  return (
    <div className={styles.block}>
      <p className={styles.line}>{screenChoice ? t('aiUse.unsetScreen') : t('aiUse.unset')}</p>
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
      ) : screenChoice ? null : (
        <p className={styles.note}>{t('aiUse.unsetHint', { use })}</p>
      )}
      {adoptError && <p className={styles.problem} role="alert">{adoptError}</p>}
    </div>
  );
}
