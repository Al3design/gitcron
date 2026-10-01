'use client';

// components/pipeline/CommitDraftLog.tsx
//
// Lo que el modelo va pensando, a la vista mientras lo piensa.
//
// Ale pidió «estar un poco más enterado de lo que está pasando» y el rail
// derecho no mostraba nada durante los 25 a 98 segundos de una redacción. Lo que
// llena esa espera existe: medido, **278 de los 308 cuadros son razonamiento**.
//
// Está en su propio componente y lee de un store externo por un motivo medido,
// no por estilo: llegan ~8 avisos por segundo, y con el estado en el panel eso
// serían ocho re-renderizados por segundo del árbol entero durante un minuto. Es
// el mismo error que ya costó caro con el temporizador de la espera (tarea
// 4.18). Suscribiéndose acá, lo único que se vuelve a dibujar es esto.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy } from 'lucide-react';
import { getDraftLogSnapshot, subscribeDraftLog, REASONING_LIMIT, type DraftLog } from '@/lib/commit-draft-log';
import { adviceKeyForStreamError } from '@/lib/stream-error-advice';
import { useGitStore } from '@/lib/git-store';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { DraftingThought } from './DraftingThought';
import styles from './OpenSpecDashboard.module.css';

/**
 * Formato de duración de una redacción:
 * - Menos de un minuto: «14 s»
 * - Desde un minuto: «1 min 38 s»
 */
type Translate = (key: string, params?: Record<string, string | number>) => string;

// Las unidades pasan por i18n: en chino son 秒 y 分, no «s» y «min».
function formatDraftDuration(startedAt: number, finishedAt: number, t: Translate): string {
  const elapsedSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (elapsedSeconds < 60) {
    return t('pipeline.openspec.prepare.aiLogSeconds', { seconds: elapsedSeconds });
  }
  return t('pipeline.openspec.prepare.aiLogMinutesSeconds', {
    minutes: Math.floor(elapsedSeconds / 60),
    seconds: elapsedSeconds % 60,
  });
}

/**
 * Línea de tiempo y tokens:
 * Aparece cuando la redacción terminó y dice, en este orden, sólo lo que se sepa:
 * «Tardó 14 s» · «20.847 de entrada (8.960 en caché)» · «7 de salida, 0 en pensar».
 * Si el motor no informó ningún token: «Tardó 14 s · sin conteo de tokens».
 * Si tampoco hay tiempo (una redacción vieja, de antes de esta tanda), no se muestra nada.
 */
function formatDraftTimingAndTokens(log: DraftLog, t: Translate, language: string): string | null {
  if (log.streaming || log.startedAt === null || log.finishedAt === null) {
    return null;
  }

  const durationStr = formatDraftDuration(log.startedAt, log.finishedAt, t);
  const timePart = t('pipeline.openspec.prepare.aiLogElapsed', { time: durationStr });

  const numFmt = new Intl.NumberFormat(language);
  const fmt = (n: number) => numFmt.format(n);

  const usage = log.usage;
  const hasAnyTokens =
    usage !== null &&
    (usage.promptTokens !== null ||
      usage.completionTokens !== null ||
      usage.reasoningTokens !== null ||
      usage.cachedPromptTokens !== null);

  if (!hasAnyTokens) {
    return `${timePart} · ${t('pipeline.openspec.prepare.aiLogNoTokens')}`;
  }

  const parts = [timePart];

  if (usage.promptTokens !== null) {
    if (usage.cachedPromptTokens !== null) {
      parts.push(
        t('pipeline.openspec.prepare.aiLogTokensInputCached', {
          input: fmt(usage.promptTokens),
          cached: fmt(usage.cachedPromptTokens),
        }),
      );
    } else {
      parts.push(
        t('pipeline.openspec.prepare.aiLogTokensInput', {
          input: fmt(usage.promptTokens),
        }),
      );
    }
  }

  if (usage.completionTokens !== null && usage.reasoningTokens !== null) {
    parts.push(
      t('pipeline.openspec.prepare.aiLogTokensOutputAndReasoning', {
        output: fmt(usage.completionTokens),
        reasoning: fmt(usage.reasoningTokens),
      }),
    );
  } else if (usage.completionTokens !== null) {
    parts.push(
      t('pipeline.openspec.prepare.aiLogTokensOutput', {
        output: fmt(usage.completionTokens),
      }),
    );
  } else if (usage.reasoningTokens !== null) {
    parts.push(
      t('pipeline.openspec.prepare.aiLogTokensReasoning', {
        reasoning: fmt(usage.reasoningTokens),
      }),
    );
  }

  return parts.join(' · ');
}

export type CommitDraftLogProps = {
  /**
   * El aviso de la redacción: quién la escribió, qué falló, qué contestó.
   *
   * Vive acá y no en el centro porque decía lo mismo que este bloque ya dice, a
   * dos columnas de distancia —Ale lo marcó viendo el error repetido—. Lo pasa
   * el panel en vez de leerlo de un store porque es estado suyo: cambia una vez
   * por acción, no ocho veces por segundo, así que no hay nada que aislar.
   */
  notice?: string | null;
  /** Identificador de la corrida de redacción de este repositorio. */
  draftId?: string | null;
};

export function CommitDraftLog({ notice, draftId }: CommitDraftLogProps) {
  const t = useT();
  // Con selector: sin él, cualquier `set()` del store re-renderiza esto, y este
  // componente se vuelve a dibujar ocho veces por segundo por su cuenta.
  const uiLanguage = useGitStore((state) => state.language);
  const log = useSyncExternalStore(
    subscribeDraftLog,
    () => getDraftLogSnapshot(draftId),
    () => getDraftLogSnapshot(draftId),
  );
  const streamRef = useRef<HTMLPreElement | null>(null);
  const [copiedReasoning, setCopiedReasoning] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const copyReasoningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyContentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyReasoningTimeoutRef.current) clearTimeout(copyReasoningTimeoutRef.current);
      if (copyContentTimeoutRef.current) clearTimeout(copyContentTimeoutRef.current);
    };
  }, []);

  const handleCopyReasoning = async () => {
    if (!log.reasoning) return;
    try {
      await navigator.clipboard.writeText(log.reasoning);
      setCopiedReasoning(true);
      if (copyReasoningTimeoutRef.current) clearTimeout(copyReasoningTimeoutRef.current);
      copyReasoningTimeoutRef.current = setTimeout(() => {
        setCopiedReasoning(false);
        copyReasoningTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy reasoning: ', err);
    }
  };

  const handleCopyContent = async () => {
    if (!log.content) return;
    try {
      await navigator.clipboard.writeText(log.content);
      setCopiedContent(true);
      if (copyContentTimeoutRef.current) clearTimeout(copyContentTimeoutRef.current);
      copyContentTimeoutRef.current = setTimeout(() => {
        setCopiedContent(false);
        copyContentTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy content: ', err);
    }
  };

  // Que se vea siempre lo último, que es lo que se está mirando.
  //
  // Sin suavizado: a ocho actualizaciones por segundo un desplazamiento animado
  // nunca termina el anterior y el texto queda temblando. Y con
  // `prefers-reduced-motion` no habría que animarlo igual.
  //
  // La medición de desbordamiento vive acá adentro para no medir en cada render:
  // sólo se guarda en estado cuando el valor cambia, evitando re-renderizados
  // innecesarios durante el stream.
  useEffect(() => {
    const node = streamRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
      const overflowing = node.scrollHeight > node.clientHeight;
      setIsOverflowing((prev) => (prev !== overflowing ? overflowing : prev));
    }
  }, [log.reasoning, log.content]);

  // Sin redacción y sin aviso no hay nada que decir, y un bloque vacío
  // permanente enseña a saltear el lugar donde después aparece lo que importa.
  // El aviso solo alcanza para abrirlo: cargar o expulsar el modelo deja uno sin
  // que haya habido ninguna redacción.
  if (log.draftId === null && !notice) return null;

  const nothingYet = log.reasoning.length === 0 && log.content.length === 0;
  const timingAndTokens = formatDraftTimingAndTokens(log, t, uiLanguage);

  return (
    /* Sin título propio: la sección del panel derecho que lo contiene ya dice
       «Lo que está pensando», y el estado («en vivo», «terminó») va en ese
       encabezado (`CommitDraftLogStatus`). Ale vio el título dos veces seguidas. */
    <section className={`${styles.draftLog} ${styles.openspecScope}`} aria-label={t('pipeline.openspec.prepare.aiLogTitle')}>

      {/* El aviso de la redacción: quién la escribió, o qué falló. Estaba en el
          centro diciendo lo mismo que este bloque, a dos columnas de distancia.
          Va arriba del pensamiento porque es la conclusión, y lo de abajo es
          cómo se llegó.
          Cuando el fallo vino por el stream se calla: el bloque de abajo dice lo
          mismo **y además** el motivo técnico, así que de los dos sobra éste.
          Ale vio los dos juntos. Sigue haciendo falta para todo lo demás —quién
          redactó, «no contestó», un fallo al cargar— que nunca llega por acá. */}
      {notice && !log.error && <p className={styles.draftLogNotice}>{notice}</p>}

      {/* Lo que informó el servidor cuando falló. Va PRIMERO y no al final: si
          la placa se cayó, todo lo de abajo es historia y esto es la noticia.
          El motivo se muestra tal cual lo dio LM Studio —«ErrorDeviceLost»
          identifica el problema— porque reescribirlo a algo más suave dejaría
          sin la única pista que sirve para buscarlo. */}
      {log.error && (
        <div className={styles.draftLogError}>
          <AlertTriangle size={12} aria-hidden="true" />
          <div>
            {/* Qué pasó y qué hacer, primero y en el cuerpo de texto normal. El
                motivo crudo es exacto y no le dice a nadie qué hacer: Ale lo
                marcó viendo «vk::Device::getFenceStatus» en pantalla. Si el
                error no se reconoce no se inventa un consejo —mandar a hacer
                algo que no tiene que ver es peor que no decir nada— y queda
                sólo el detalle. */}
            {adviceKeyForStreamError(log.error) && (
              <strong>{t(`pipeline.openspec.prepare.${adviceKeyForStreamError(log.error)}`)}</strong>
            )}
            {/* El técnico NO se reemplaza: es la única pista con la que se puede
                buscar en el registro de LM Studio o en un foro. */}
            <code>{log.error}</code>
          </div>
        </div>
      )}

      {/* El cuerpo, sólo si hubo una redacción: con un aviso suelto no hay ni
          pensamiento ni respuesta que mostrar, y «Terminó sin mandar nada» sobre
          un modelo recién expulsado sería falso. */}
      {log.draftId === null ? null : nothingYet ? (
        /* Mientras no llegó nada, la frase que rota ocupa el lugar donde después
           aparece el texto real. Ale lo pidió: antes las frases estaban debajo
           del campo, en el centro, diciendo lo mismo que este bloque decía acá
           con «Todavía no llegó nada» —dos avisos de lo mismo en dos lugares—.
           El contador de segundos se queda en el centro a propósito: con la
           columna derecha cerrada, es lo único que informa que algo está
           pasando. */
        log.streaming
          ? <DraftingThought active language={uiLanguage} />
          /* Ya terminó: decía «Todavía no llegó nada… tarda en arrancar» y Ale lo
             vio junto a «terminó» con Codex. Si no llegó nada, ya no va a llegar. */
          : <p className={styles.railEmpty}>{t('pipeline.openspec.prepare.aiLogNothing')}</p>
      ) : (
        <>
          {/* Se declara que está recortado. Un texto cortado en silencio hace
              pensar que el modelo empezó por la mitad. */}
          {log.truncated && (
            <p className={styles.draftLogNote}>
              {t('pipeline.openspec.prepare.aiLogTruncated', { limit: REASONING_LIMIT })}
            </p>
          )}
          {/* Sólo si hay algo. Un modelo que no razona —medido en la notebook: 0
              de 23 cuadros— dejaba un recuadro vacío ocupando media columna. */}
          {log.reasoning.length > 0 && (
            <div className={styles.draftLogReasoningBox}>
              <div className={styles.draftLogReasoningHeader}>
                <button
                  type="button"
                  className={styles.draftLogCopyBtn}
                  data-copied={copiedReasoning ? 'true' : undefined}
                  onClick={handleCopyReasoning}
                  aria-label={copiedReasoning ? t('pipeline.openspec.prepare.aiLogCopied') : t('pipeline.openspec.prepare.aiLogCopy')}
                  title={t('pipeline.openspec.prepare.aiLogCopy')}
                >
                  {copiedReasoning ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                  <span>{copiedReasoning ? t('pipeline.openspec.prepare.aiLogCopied') : t('pipeline.openspec.prepare.aiLogCopy')}</span>
                </button>
              </div>
              <div className={styles.draftLogStreamWrapper}>
                <pre
                  ref={streamRef}
                  className={styles.draftLogStream}
                  data-expanded={isExpanded ? 'true' : undefined}
                >
                  {log.reasoning}
                </pre>
                {isOverflowing && !isExpanded && (
                  <div className={styles.draftLogFade} aria-hidden="true" />
                )}
              </div>
              {isOverflowing && (
                <button
                  type="button"
                  className={styles.draftLogToggleBtn}
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  <ChevronDown
                    size={12}
                    className={cn(styles.draftLogToggleIcon, isExpanded && styles.draftLogToggleIconRotated)}
                    aria-hidden="true"
                  />
                  <span>
                    {isExpanded
                      ? t('pipeline.openspec.prepare.aiLogCollapse')
                      : t('pipeline.openspec.prepare.aiLogExpand')}
                  </span>
                </button>
              )}
            </div>
          )}
          {/* La respuesta, aparte del razonamiento: son dos cosas distintas y
              mezclarlas haría imposible ver cuál de las dos terminó. Lo que
              queda en el campo del commit lo sigue decidiendo el resultado, no
              esto: acá se muestra lo que llegó, sin imponerlo en ningún lado. */}
          {log.content.length > 0 && (
            <div className={styles.draftLogAnswer}>
              <div className={styles.draftLogAnswerHeader}>
                <strong>{t('pipeline.openspec.prepare.aiLogAnswer')}</strong>
                <button
                  type="button"
                  className={styles.draftLogCopyBtn}
                  data-copied={copiedContent ? 'true' : undefined}
                  onClick={handleCopyContent}
                  aria-label={copiedContent ? t('pipeline.openspec.prepare.aiLogResultCopied') : t('pipeline.openspec.prepare.aiLogResultCopy')}
                  title={t('pipeline.openspec.prepare.aiLogResultCopy')}
                >
                  {copiedContent ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                  <span>{copiedContent ? t('pipeline.openspec.prepare.aiLogResultCopied') : t('pipeline.openspec.prepare.aiLogResultCopy')}</span>
                </button>
              </div>
              <span>{log.content}</span>
            </div>
          )}
        </>
      )}

      {/* El tiempo y el conteo de tokens explican la espera: cuánto tardó el
          pedido y cuánto presupuesto se fue en entrada, salida y pensar.
          Sin ellos, una espera larga no dice qué pasó. */}
      {timingAndTokens && <p className={styles.draftLogTiming}>{timingAndTokens}</p>}
    </section>
  );
}

/**
 * «en vivo» o «terminó», para el encabezado de la sección que contiene el
 * bloque. Estaba dentro del bloque, al lado de un segundo título igual al de la
 * sección; en el encabezado se ve también con la sección cerrada.
 */
export function CommitDraftLogStatus({ draftId }: { draftId?: string | null }) {
  const t = useT();
  const log = useSyncExternalStore(
    subscribeDraftLog,
    () => getDraftLogSnapshot(draftId),
    () => getDraftLogSnapshot(draftId),
  );
  // Sólo si hubo una redacción: con un aviso suelto —cargar o expulsar el
  // modelo— no hay nada que esté ni en vivo ni terminado.
  if (log.draftId === null) return null;
  // `aria-live` en la etiqueta de estado y no sobre el texto: leer en voz alta
  // cada pedazo del razonamiento sería inutilizable con lector de pantalla. Lo
  // que se anuncia es que empezó y que terminó.
  return (
    <em className={styles.draftLogStatus} aria-live="polite">
      {log.streaming
        ? <span className="ai-thinking-text">{t('pipeline.openspec.prepare.aiLogThinking')}</span>
        : t('pipeline.openspec.prepare.aiLogDone')}
    </em>
  );
}
