'use client';

// AiUseLine — qué modelo usa un uso de texto según gitcron.json (tarea 4.3 de
// modelos-en-casa), y si no tiene, «usar lo que tenías» con un botón (decisión de
// Ale del 2026-10-01: nada se escribe solo). Se vuelve a preguntar cuando cambia un
// gitcron.json, igual que la caja de la redacción.

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import type { AiUse, AiUseDestination, AiUseStatus } from '@/types/ai-use';
import { runtimeDisplayName } from '../pipeline/pipeline-domain';
import { AiModelPicker } from './AiModelPicker';
import { Stack, Row } from '@/components/ui';
import styles from './AiUseLine.module.css';

interface Props {
  use: AiUse;
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
  /** Muestra u oculta el botón propio de «Elegir modelo» (en Motores y modelos la fila ya tiene el suyo). */
  showChooseModel?: boolean;
  /** Acciones adicionales en la misma fila de botones (p. ej. «Redactar con IA» en Preparar commit). */
  actions?: React.ReactNode;
}

export function AiUseLine({
  use,
  repoPath = null,
  screenModel = null,
  onStatus,
  refreshKey,
  screenChoice = false,
  sourceFile,
  showChooseModel = true,
  actions,
}: Props) {
  const t = useT();
  const [status, setStatus] = useState<AiUseStatus | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

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
    // El agente de SDD nunca tuvo modelo: no hay «usar lo que tenías» (su oferta es siempre nula).
    if (use === 'gitcron-sdd') return;
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

  const isAgent = use === 'gitcron-sdd';

  if (status.status === 'resolved') {
    const motorName = runtimeDisplayName(status.runtime ?? null) ?? status.runtime ?? '';
    let lineText: string;
    if (isAgent) {
      const agentKey = status.effort ? 'aiUse.resolvedAgentWithEffort' : 'aiUse.resolvedAgent';
      lineText = t(agentKey, {
        model: status.modelId,
        provider: status.providerName,
        motor: motorName,
        destination: destination(status.destination),
        file: sourceFile || status.sourceFile,
        effort: status.effort ?? '',
      });
    } else {
      const lineKey = use === 'gitcron-commit'
        ? 'pipeline.openspec.prepare.aiResolvedLine'
        : 'aiUse.resolved';
      lineText = t(lineKey, {
        model: status.modelId,
        provider: status.providerName,
        destination: destination(status.destination),
        file: sourceFile || status.sourceFile,
      });
    }

    const hasAlternatives = !status.available && status.alternatives && status.alternatives.length > 0;
    const altProviders = hasAlternatives
      ? status.alternatives.map((a) => `«${a.providerName}»`).join(', ')
      : '';
    // El plural va en la clave y no armado acá: «declaran» no se arma igual en cada idioma.
    const altKey = (status.alternatives?.length ?? 0) > 1 ? 'aiUse.alternativesMany' : 'aiUse.alternativesOne';

    return (
      <Stack gap="1">
        <p className={styles.line}>
          {lineText}
          {status.modelSource === 'general' ? t('aiUse.general') : status.isException ? t('aiUse.exception') : ''}
          {' · '}
          {isAgent
            ? t('aiUse.toolsAgent', { executor: status.toolsExecutor ?? motorName })
            : t('aiUse.toolsNone')}
        </p>
        {status.destination === 'external-service' && (
          <p className={styles.externalNotice}>{t('aiUse.externalNotice', { provider: status.providerName })}</p>
        )}
        <Row gap="2" wrap>
          {showChooseModel && (
            <button
              type="button"
              className={styles.chooseModel}
              onClick={() => setShowPicker((v) => !v)}
            >
              {t('aiUse.chooseModel')}
            </button>
          )}
          {status.sourceDir && (
            <button
              type="button"
              className={styles.showInFolder}
              onClick={() => {
                window.api?.shellOpenPath?.(status.sourceDir);
              }}
            >
              {t('aiUse.showInFolder')}
            </button>
          )}
          {actions}
        </Row>
        {showPicker && (
          <AiModelPicker
            use={use}
            repoPath={repoPath}
            onClose={() => setShowPicker(false)}
            onSaved={() => {
              setShowPicker(false);
              setVersion((v) => v + 1);
            }}
          />
        )}
        {!status.available && status.unavailableReason && (
          <p className={styles.problem} role="alert">{status.unavailableReason}</p>
        )}
        {hasAlternatives && (
          <p className={styles.alternativesNote}>
            {t(altKey, { providers: altProviders })}
          </p>
        )}
      </Stack>
    );
  }

  if (status.status === 'disabled') {
    const dir = status.sourceDir;
    return (
      <Stack gap="1">
        <p className={styles.line}>{t('aiUse.disabled')}</p>
        <Row gap="2" wrap>
          {showChooseModel && (
            <button
              type="button"
              className={styles.chooseModel}
              onClick={() => setShowPicker((v) => !v)}
            >
              {t('aiUse.chooseModel')}
            </button>
          )}
          {dir && (
            <button
              type="button"
              className={styles.showInFolder}
              onClick={() => {
                window.api?.shellOpenPath?.(dir);
              }}
            >
              {t('aiUse.showInFolder')}
            </button>
          )}
          {actions}
        </Row>
        {showPicker && (
          <AiModelPicker
            use={use}
            repoPath={repoPath}
            onClose={() => setShowPicker(false)}
            onSaved={() => {
              setShowPicker(false);
              setVersion((v) => v + 1);
            }}
          />
        )}
      </Stack>
    );
  }

  if (status.status === 'error') {
    return <p className={styles.problem} role="alert">{status.error}</p>;
  }

  const withSelector = screenChoice && Boolean(status.canLoad);
  const unsetText = isAgent ? t('aiUse.unsetAgent') : (withSelector ? t('aiUse.unsetScreen') : t('aiUse.unset'));
  return (
    <Stack gap="1">
      <p className={styles.line}>{unsetText}</p>
      <Row gap="2" wrap>
        {!withSelector && showChooseModel && (
          <button
            type="button"
            className={styles.chooseModel}
            onClick={() => setShowPicker((v) => !v)}
          >
            {t('aiUse.chooseModel')}
          </button>
        )}
        {status.offer && (
          <Row gap="2" wrap>
            <button type="button" className={styles.adopt} disabled={adopting} onClick={() => { void adopt(); }}>
              {adopting ? t('aiUse.adopting') : t('aiUse.adopt', { label: status.offer.label })}
            </button>
            <span className={styles.note}>
              {status.offer.addsProvider
                ? t('aiUse.adoptNoteProvider', { file: status.offer.file, provider: status.offer.addsProvider })
                : t('aiUse.adoptNote', { file: status.offer.file })}
            </span>
          </Row>
        )}
        {actions}
      </Row>
      {showPicker && !withSelector && (
        <AiModelPicker
          use={use}
          repoPath={repoPath}
          onClose={() => setShowPicker(false)}
          onSaved={() => {
            setShowPicker(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {!status.offer && !withSelector && !isAgent && (
        <p className={styles.note}>{t('aiUse.unsetHint', { use })}</p>
      )}
      {adoptError && <p className={styles.problem} role="alert">{adoptError}</p>}
    </Stack>
  );
}
