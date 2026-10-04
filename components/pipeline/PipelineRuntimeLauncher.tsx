'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import type { AiUseStatus } from '@/types/ai-use';
import type { RuntimeDiscoveryEntry, RuntimeProjection } from '@/types/pipeline';
import { AiModelPicker } from '../ai/AiModelPicker';
import { AiUseLine } from '../ai/AiUseLine';
import { runtimeDisplayName } from './pipeline-domain';
import { canStartRuntimeSession } from './pipeline-guided-forms';
import { resolveIntentCapability, type PipelineIntent } from './pipeline-intent-capabilities';

export type PipelineRuntimeLauncherProps = {
  repoPath: string;
  projection: RuntimeProjection | null;
  intent?: PipelineIntent;
  initialInstruction?: string;
  changeId?: string | null;
  taskId?: string | null;
  /**
   * Se invoca cuando el estado de descubrimiento cambia. El contenedor lo usa
   * para no pintar su marco mientras el launcher aún carga: un panel con marco
   * cuyo interior está vacío se percibe como un recuadro roto.
   */
  onDiscoveringChange?: (loading: boolean) => void;
  /**
   * `true` cuando hay un fixture de desarrollo en pantalla.
   *
   * Con datos inventados a la vista, arrancar una sesión real produciría una
   * pantalla donde lo observado y lo inventado son indistinguibles. Se bloquea
   * y se dice por qué, en vez de esconderlo: ocultarlo haría parecer que la
   * función no existe.
   */
  blockedByFixture?: boolean;
  /**
   * Etiqueta del CTA final. Por defecto es el genérico `Iniciar`; el flujo
   * guiado lo reemplaza por `Iniciar propuesta` / `Iniciar exploración`, que
   * dicen qué va a pasar en vez de sólo que algo pasará.
   */
  startLabelKey?: string;
  /** Se avisa después de un arranque exitoso, para que el compositor reaccione. */
  onStarted?: (sessionId: string) => void;
};

/**
 * Arranque y corte de una sesión de runtime sobre el repo abierto.
 *
 * Es la única superficie de Pipeline que abre procesos, y por eso muestra sin
 * adornos lo que va a pasar: qué motor, qué modelo, con qué nivel, quién ejecuta
 * las herramientas, con qué versión, y que la instrucción viaja tal cual al CLI.
 *
 * El motor sale del modelo elegido para el uso `gitcron-sdd` en gitcron.json
 * (tarea 5.1): no hay una lista de motores que pueda contradecir esa elección, y
 * qué se lanza lo decide Main. Un motor instalado pero no lanzable aparece con su
 * motivo: `start()` abortaría igual, y un botón que tira es peor que un botón ausente.
 */
export function PipelineRuntimeLauncher({
  repoPath,
  projection,
  intent = 'explore',
  initialInstruction = '',
  changeId = null,
  taskId = null,
  blockedByFixture = false,
  startLabelKey = 'pipeline.launcher.start',
  onStarted,
  onDiscoveringChange,
}: PipelineRuntimeLauncherProps) {
  const t = useT();
  const [discovery, setDiscovery] = useState<RuntimeDiscoveryEntry[] | null>(null);
  const [aiStatus, setAiStatus] = useState<AiUseStatus | null>(null);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryToken, setDiscoveryToken] = useState(0);
  const [editingInstruction, setEditingInstruction] = useState(false);
  const [writeConfirmed, setWriteConfirmed] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);

  const active = projection?.active === true;
  // Un solo booleano para todos los controles: si hay fixture en pantalla, nada
  // acá puede tocarse, ni siquiera cortar una sesión que ya venía corriendo.
  const locked = blockedByFixture || busy;

  useEffect(() => {
    let cancelled = false;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineRuntime) {
      queueMicrotask(() => {
        if (!cancelled) setDiscovery([]);
      });
      return undefined;
    }

    void api.pipelineRuntime.discover(repoPath).then((result) => {
      if (cancelled) return;
      const entries = result?.success ? result.data ?? [] : [];
      setDiscovery(entries);
    });

    return () => { cancelled = true; };
  }, [repoPath, discoveryToken]);

  // El contenedor pinta un marco apenas el launcher existe. Si el descubrimiento
  // todavía no resolvió, ese marco encierra un espacio vacío: se le avisa para
  // que no lo ofrezca hasta que haya algo que mostrar.
  useEffect(() => {
    onDiscoveringChange?.(discovery === null);
  }, [discovery, onDiscoveringChange]);

  const resolved = aiStatus?.status === 'resolved' ? aiStatus : null;
  const runtime = resolved?.runtime ?? '';
  const launchKey = resolved?.launchKey ?? null;
  const selectedEntry = discovery?.find((entry) => entry.runtime === runtime) ?? null;
  // Antigravity y OpenCode todavía no se lanzan desde acá (tareas 5.2 y 5.3).
  const isUnsupportedEngine = runtime === 'opencode' || runtime === 'agy';
  const runtimeLaunchable = selectedEntry?.launchable === true && !isUnsupportedEngine;
  // La confirmación de escritura nombra motor y modelo: vale sólo para lo que nombraba.
  // Si la elección cambia después de tildarla, hay que volver a confirmar.
  const confirmedForThis = writeConfirmed && confirmedKey === launchKey;

  const intentCapability = useMemo(() => resolveIntentCapability(intent, selectedEntry), [intent, selectedEntry]);
  const modifiesRepo = selectedEntry?.startModifiesRepo === true;
  const canStart =
    launchKey !== null &&
    !isUnsupportedEngine &&
    intentCapability.canLaunch &&
    canStartRuntimeSession({
      blockedByFixture,
      runtimeSelected: runtime,
      runtimeLaunchable,
      instruction,
      sessionActive: active,
      busy,
      modifiesRepo,
      writeConfirmed: confirmedForThis,
    });

  const confirmWriteText = useMemo(() => {
    if (!resolved) return t('pipeline.launcher.confirmWrite');
    const motor = runtimeDisplayName(resolved.runtime ?? null) ?? resolved.runtime ?? '';
    const model = resolved.modelId;
    const executor = resolved.toolsExecutor || motor;
    const effort = resolved.effort;
    return effort
      ? t('pipeline.launcher.confirmWriteAgentWithEffort', { motor, model, effort, executor })
      : t('pipeline.launcher.confirmWriteAgent', { motor, model, executor });
  }, [resolved, t]);

  const handleStart = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!canStart || !launchKey || !api?.pipelineRuntime) return;
    setBusy(true);
    setError(null);
    // Main resuelve otra vez el uso y lanza sólo si coincide con lo que se mostró.
    const result = await api.pipelineRuntime.start({ repoPath, instruction, changeId, taskId, expectedModel: launchKey });
    setBusy(false);
    // El error llega como código estable desde Main. Los conocidos tienen su texto;
    // uno desconocido se muestra crudo en vez de una frase amable que oculte la causa.
    if (!result?.success || !result.data?.sessionId) {
      const err = result?.error ?? 'start_failed';
      setError(err);
      if (err === 'model_mismatch') setAiRefreshKey((k) => k + 1);
    } else {
      onStarted?.(result.data.sessionId);
    }
  }, [canStart, launchKey, repoPath, instruction, changeId, taskId, onStarted]);

  const handleStop = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (blockedByFixture || !api?.pipelineRuntime) return;
    setBusy(true);
    await api.pipelineRuntime.stop(repoPath);
    setBusy(false);
  }, [repoPath, blockedByFixture]);

  if (!discovery) {
    // No se devuelve null: un null dentro de un panel con marco deja un recuadro
    // vacío hasta que el IPC responde. Se dice qué está pasando y se ofrece
    // reintentar, igual que cuando el descubrimiento no encuentra nada lanzable.
    return (
      <section className="pipeline-launcher" aria-busy="true" aria-live="polite">
        <h3 className="pipeline-section__title">{t('pipeline.launcher.title')}</h3>
        <div className="pipeline-launcher__empty">
          <p>{t('pipeline.launcher.discovering')}</p>
        </div>
      </section>
    );
  }

  const errorText = error
    ? (() => {
      const key = `pipeline.launcher.error.${error}`;
      const translated = t(key);
      return translated === key ? error : translated;
    })()
    : null;

  return (
    <section
      className="pipeline-launcher"
      aria-labelledby="pipeline-launcher-title"
      data-blocked={blockedByFixture || undefined}
    >
      <h3 id="pipeline-launcher-title" className="pipeline-section__title">
        {t('pipeline.launcher.title')}
      </h3>

      {/* El bloqueo se comunica por texto y por atributo, no sólo por opacidad:
          el estado no puede depender únicamente de una señal visual. */}
      {blockedByFixture && (
        <p className="pipeline-launcher__blocked-fixture">{t('pipeline.launcher.blockedByFixture')}</p>
      )}

      <div className="pipeline-launcher__form">
        {/* Motor, modelo, nivel, de dónde sale la elección y quién ejecuta las
            herramientas, con el selector para elegir otro modelo de cualquier
            proveedor de gitcron.json o CLI de suscripción. */}
        <AiUseLine
          use="gitcron-sdd"
          repoPath={repoPath}
          onStatus={setAiStatus}
          refreshKey={String(aiRefreshKey)}
        />

        {isUnsupportedEngine && (
          <p className="pipeline-launcher__blocked" role="alert">
            {runtime === 'opencode'
              ? t('pipeline.launcher.unsupportedRuntimeOpenCode')
              : t('pipeline.launcher.unsupportedRuntimeAgy')}
          </p>
        )}

        {resolved && !isUnsupportedEngine && selectedEntry?.launchable && (
          <>
            {/* La disponibilidad del motor se dice antes del CTA, no después de que falle. */}
            <p className="pipeline-launcher__availability" data-launchable={selectedEntry.launchable}>
              {selectedEntry.runtimeVersion
                ? t('pipeline.launcher.availabilityVersion', {
                  runtime: runtimeDisplayName(selectedEntry.runtime) ?? selectedEntry.runtime,
                  version: selectedEntry.runtimeVersion,
                })
                : t('pipeline.launcher.availabilityUnknownVersion', {
                  runtime: runtimeDisplayName(selectedEntry.runtime) ?? selectedEntry.runtime,
                })}
            </p>

            {/* `evidenceStatus` es informativo, no bloqueante: tras retirar el gate
                de versión, un runtime no verificado igual arranca. Se avisa antes
                del CTA para que la persona sepa que el protocolo no se probó contra
                una referencia, no para impedir el arranque. */}
            {selectedEntry.evidenceStatus && selectedEntry.evidenceStatus !== 'verified' && (
              <p className="pipeline-launcher__unverified" data-evidence={selectedEntry.evidenceStatus}>
                {t('pipeline.launcher.unverified')}
              </p>
            )}

            {/* El alcance declarado va antes del CTA. Un runtime que corre con
                herramientas de sólo lectura puede analizar y reportar, pero no
                modificar el repositorio, y eso hay que decirlo antes de gastar
                una corrida, no después. */}
            {/* El campo llega por IPC: si un Main más viejo no lo emite, no se
                inventa un alcance, simplemente no se afirma nada. */}
            {modifiesRepo && (
              <p className="pipeline-launcher__scope" data-availability="writes">
                {t('pipeline.launcher.scope.writes')}
                {(selectedEntry.startConstraints ?? []).length > 0
                  && ` · ${(selectedEntry.startConstraints ?? []).join(' · ')}`}
              </p>
            )}
            {selectedEntry.startAvailability && selectedEntry.startAvailability !== 'available' && (
              <p className="pipeline-launcher__scope" data-availability={selectedEntry.startAvailability}>
                {t(`pipeline.launcher.scope.${selectedEntry.startAvailability}`)}
                {(selectedEntry.startConstraints ?? []).length > 0
                  && ` · ${(selectedEntry.startConstraints ?? []).join(' · ')}`}
              </p>
            )}

            {/* Aviso de capacidad según la intención elegida. Si este motor no puede
                hacerla, la salida es elegir otro modelo, no cambiar de motor por fuera
                de la elección. */}
            {intentCapability.status !== 'available' && (
              <div
                className="pipeline-launcher__intent-notice"
                data-status={intentCapability.status}
                role={intentCapability.status === 'unavailable' ? 'alert' : 'status'}
              >
                <p className="pipeline-launcher__intent-reason">
                  {intentCapability.reasonKey ? t(intentCapability.reasonKey) : intentCapability.reason}
                </p>
                {!intentCapability.canLaunch && (
                  <div className="pipeline-launcher__alternative">
                    <button
                      type="button"
                      className="pipeline-launcher__alternative-button"
                      disabled={active || locked}
                      onClick={() => setShowPicker(true)}
                    >
                      {t('pipeline.launcher.intent.chooseOtherModel')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Un motor instalado que no se puede lanzar dice por qué, y uno que no está
            instalado lo dice también: ocultarlo haría parecer otra cosa. La salida es
            accionable: volver a comprobar después de instalarlo o iniciar sesión. */}
        {resolved && !isUnsupportedEngine && !selectedEntry?.launchable && (
          <div className="pipeline-launcher__empty">
            <p className="pipeline-launcher__blocked" role="alert">
              {selectedEntry
                ? `${runtimeDisplayName(selectedEntry.runtime) ?? selectedEntry.runtime}: ${selectedEntry.diagnostics[0] ?? t('pipeline.launcher.blockedUnknown')}`
                : t('pipeline.launcher.error.runtime_not_installed')}
            </p>
            <button
              type="button"
              className="pipeline-launcher__button"
              data-action="recheck"
              disabled={locked}
              onClick={() => setDiscoveryToken((token) => token + 1)}
            >
              {t('pipeline.launcher.recheck')}
            </button>
          </div>
        )}

        {/* La instrucción ya viene compuesta desde el flujo guiado. Editarla es
            una salida avanzada, no el primer campo que la persona enfrenta. */}
        <div className="pipeline-launcher__field">
          <button
            type="button"
            className="pipeline-launcher__disclosure"
            aria-expanded={editingInstruction}
            onClick={() => setEditingInstruction((value) => !value)}
          >
            {editingInstruction ? t('pipeline.launcher.hideInstruction') : t('pipeline.launcher.showInstruction')}
          </button>
          {editingInstruction ? (
            <textarea
              className="pipeline-launcher__instruction"
              aria-label={t('pipeline.launcher.instruction')}
              value={instruction}
              rows={4}
              disabled={active || locked}
              onChange={(event) => setInstruction(event.target.value)}
            />
          ) : (
            <pre className="pipeline-launcher__instruction-preview">{instruction}</pre>
          )}
        </div>

        {/* Una sesión que edita el repositorio se confirma a mano. El aviso
            dice qué va a pasar y qué queda afuera, no un "¿estás seguro?":
            nombra motor, modelo, nivel y quién ejecuta las herramientas. */}
        {modifiesRepo && !active && resolved && (
          <label className="pipeline-launcher__confirm">
            <input
              type="checkbox"
              checked={confirmedForThis}
              disabled={locked}
              onChange={(event) => {
                setWriteConfirmed(event.target.checked);
                setConfirmedKey(event.target.checked ? launchKey : null);
              }}
            />
            <span>{confirmWriteText}</span>
          </label>
        )}

        <div className="pipeline-launcher__actions">
          {active ? (
            <button type="button" className="pipeline-launcher__button" data-action="stop" disabled={locked} onClick={handleStop}>
              {t('pipeline.launcher.stop')}
            </button>
          ) : (
            <button
              type="button"
              className="pipeline-launcher__button"
              data-action="start"
              disabled={!canStart}
              onClick={handleStart}
            >
              {t(startLabelKey)}
            </button>
          )}
        </div>

        {errorText && <p className="pipeline-launcher__error" role="alert">{errorText}</p>}

        {showPicker && (
          <AiModelPicker
            use="gitcron-sdd"
            repoPath={repoPath}
            onClose={() => setShowPicker(false)}
            onSaved={() => {
              setShowPicker(false);
              setAiRefreshKey((k) => k + 1);
            }}
          />
        )}
      </div>
    </section>
  );
}