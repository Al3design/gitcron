'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import styles from './OpenSpecDashboard.module.css';

/**
 * Cuánto va, y una señal de vida mientras carga.
 *
 * Ale lo pidió con estas palabras: «me gustaría estar un poco más enterado de lo
 * que está pasando». Medido, una carga tarda 8,8 a 11 segundos y una redacción
 * 25 a 98: sin nada que se mueva, cualquiera de las dos se lee como colgada.
 *
 * Componente propio y con su propio temporizador, por la misma razón que
 * `DraftingThought`: un `setState` por segundo dentro de `OpenSpecDashboard`
 * re-renderizaría el panel entero sesenta veces por minuto. Acá sólo se
 * re-renderiza este nodo.
 *
 * Los segundos se **derivan** de la marca de arranque en vez de sumar uno por
 * tick: un intervalo que se atrasa —y con la máquina cargada se atrasa— iría
 * quedando corto, y el número dejaría de ser el tiempo real.
 *
 * Durante la **carga** el feedback es un cuadro con un barrido que lo recorre y
 * cuyo texto cambia de color donde pasa —movimiento y contraste—. Es
 * indeterminado a propósito: el servidor de modelos **no** expone la fracción de
 * carga por ningún canal accesible sin credencial (change
 * `show-real-load-progress`, probado por dos vías independientes), y fingir un
 * porcentaje sería la misma mentira que ese change corrige. Durante la
 * **redacción** no hay barra: el feedback vivo llega al rail, y acá sólo queda
 * el contador plano.
 */
export function AiElapsed({
  phase,
  startedAt,
  /**
   * Qué operación está corriendo dentro de la fase «loading».
   *
   * Cargar y expulsar comparten fase porque las dos ocupan al servidor y
   * bloquean los mismos controles, pero **no dicen lo mismo**: expulsar mostraba
   * «Cargando el modelo…», que es exactamente lo contrario de lo que estaba
   * pasando. Ale lo vio al expulsar.
   */
  kind = 'load',
  queueRunningRepoName,
}: {
  phase: 'idle' | 'loading' | 'drafting' | 'queued';
  startedAt: number | null;
  kind?: 'load' | 'eject';
  queueRunningRepoName?: string | null;
}) {
  const t = useT();
  /**
   * Los segundos ya contados. Arrancan en cero y los escribe **el intervalo**,
   * nunca el render: `Date.now()` durante el render es impuro y el linter lo
   * rechaza con razón —dos renders seguidos darían números distintos sin que
   * nada hubiera cambiado—.
   *
   * Cada corrida remonta este componente, porque quien lo usa lo distingue por
   * su marca de arranque. Por eso el cero inicial siempre es el correcto.
   */
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (phase === 'idle' || phase === 'queued' || startedAt === null) return;
    // Se calcula contra la marca de arranque y no sumando uno por tick: un
    // intervalo que se atrasa —y con la máquina cargada se atrasa— iría quedando
    // corto, y el número dejaría de ser el tiempo real.
    const timer = window.setInterval(
      () => setSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [phase, startedAt]);

  if (phase === 'queued') {
    return (
      <div className={styles.aiElapsed}>
        <em aria-live="off">
          {t('pipeline.openspec.prepare.aiQueued', { repo: queueRunningRepoName ?? '—' })}
        </em>
      </div>
    );
  }

  if (phase === 'idle' || startedAt === null) return null;

  const text =
    phase === 'loading'
      ? t(kind === 'eject'
        ? 'pipeline.openspec.prepare.aiElapsedEjecting'
        : 'pipeline.openspec.prepare.aiElapsedLoading', { seconds })
      : t('pipeline.openspec.prepare.aiElapsedDrafting', { seconds });

  return (
    <div className={styles.aiElapsed}>
      {phase === 'loading' ? (
        // Barra arriba y texto debajo, en dos renglones.
        //
        // La primera versión pintaba el texto con un gradiente móvil y Ale no lo
        // pudo leer cuando la banda le pasaba por encima: el color del texto y el
        // de la franja se acercaban demasiado. Un contador que no se lee no
        // informa nada. Ahora la franja vive en su propia barra y el texto
        // conserva un color fijo y legible en todo momento.
        //
        // Indeterminado a propósito —está comprobado que el servidor no emite la
        // fracción de carga: se capturó el log de una carga real y sólo hay hitos
        // discretos—, así que NO se declara `aria-valuenow`: un porcentaje
        // colgado le mentiría a un lector de pantalla igual que una barra que lo
        // dibuje. Con `prefers-reduced-motion` la franja se detiene y queda
        // visible en reposo, sin perder que algo está en curso.
        <div
          className={styles.aiLoadBox}
          role="progressbar"
          aria-busy="true"
          aria-label={t(kind === 'eject'
            ? 'pipeline.openspec.prepare.aiElapsedEjecting'
            : 'pipeline.openspec.prepare.aiLoading', { seconds })}
        >
          <span className={styles.aiLoadTrack}><span /></span>
          <span className={styles.aiLoadBoxText}>{text}</span>
        </div>
      ) : (
        // En redacción no hay barra: el vivo llega al rail. Acá sólo el contador.
        <em aria-live="off">
          {phase === 'drafting' ? <span className="ai-thinking-text">{text}</span> : text}
        </em>
      )}
    </div>
  );
}
