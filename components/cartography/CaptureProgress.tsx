'use client';

// components/cartography/CaptureProgress.tsx
//
// Avance de las capturas dentro de la franja del catálogo (decisión 14, tarea 2.10): un círculo de
// progreso, la pantalla que se está capturando con «N de T» y un detalle desplegable con el
// estado de cada pantalla. Al terminar queda el resumen y el detalle sigue desplegable.

import { useId, useState } from 'react';
import { Check, ChevronDown, Circle, Loader2, Minus, X } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type { CaptureItem, CaptureItemState } from '@/types/screen-map';
import styles from './ScreenCatalog.module.css';

export interface CaptureProgressProps {
  items: CaptureItem[];
  /** La corrida sigue: se muestra la pantalla en curso; si no, el resumen. */
  running: boolean;
}

const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const STATE_LABEL_KEY: Record<CaptureItemState, string> = {
  pending: 'cartography.screens.captures.progress.statePending',
  running: 'cartography.screens.captures.progress.stateRunning',
  done: 'cartography.screens.captures.progress.stateDone',
  failed: 'cartography.screens.captures.progress.stateFailed',
  skipped: 'cartography.screens.captures.progress.stateSkipped',
  stopped: 'cartography.screens.captures.progress.stateStopped',
};

function StateIcon({ state, label }: { state: CaptureItemState; label: string }) {
  const common = { size: 13, 'aria-label': label, role: 'img' } as const;
  switch (state) {
    case 'running':
      return <Loader2 {...common} className={cn(styles.progressIcon, styles.progressSpin)} />;
    case 'done':
      return <Check {...common} className={cn(styles.progressIcon, styles.progressIconDone)} />;
    case 'failed':
      return <X {...common} className={cn(styles.progressIcon, styles.progressIconFailed)} />;
    case 'skipped':
    case 'stopped':
      return <Minus {...common} className={cn(styles.progressIcon, styles.progressIconMuted)} />;
    default:
      return <Circle {...common} className={cn(styles.progressIcon, styles.progressIconMuted)} />;
  }
}

type Translate = ReturnType<typeof useT>;

function countItems(items: CaptureItem[]) {
  const count = (state: CaptureItemState) => items.filter((item) => item.state === state).length;
  const done = count('done');
  const failed = count('failed');
  const skipped = count('skipped');
  return {
    done,
    failed,
    skipped,
    stopped: count('stopped'),
    notCaptured: count('pending') + count('running'),
    total: items.length - skipped,
    finishedCount: done + failed,
  };
}

/** «Capturando “B”… 2 de 3» mientras corre; «1 lista · 2 detenidas» al terminar. */
function progressText(items: CaptureItem[], running: boolean, t: Translate): string {
  const c = countItems(items);
  if (running) {
    const current = items.find((item) => item.state === 'running');
    return current
      ? t('cartography.screens.captures.progress.running', {
          name: current.name,
          n: Math.min(c.finishedCount + 1, c.total),
          total: c.total,
        })
      : t('cartography.screens.captures.progress.runningNoName', { n: c.finishedCount, total: c.total });
  }
  // Singular y plural por clave: «1 lista», «2 listas» (auditoría de carto-05e).
  const parts = [
    c.done > 0 && t(c.done === 1 ? 'cartography.screens.captures.progress.doneOne' : 'cartography.screens.captures.progress.done', { n: c.done }),
    c.failed > 0 && t(c.failed === 1 ? 'cartography.screens.captures.progress.failedOne' : 'cartography.screens.captures.progress.failed', { n: c.failed }),
    c.stopped > 0 && t(c.stopped === 1 ? 'cartography.screens.captures.progress.stoppedOne' : 'cartography.screens.captures.progress.stopped', { n: c.stopped }),
    c.skipped > 0 && t('cartography.screens.captures.progress.skipped', { n: c.skipped }),
    c.notCaptured > 0 && t('cartography.screens.captures.progress.pending', { n: c.notCaptured }),
  ];
  return parts.filter(Boolean).join(' · ');
}

export function CaptureProgress({ items, running }: CaptureProgressProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const { failed, total, finishedCount } = countItems(items);
  const text = progressText(items, running, t);
  const ratio = total > 0 ? finishedCount / total : 0;

  return (
    <div className={styles.progress} data-testid="capture-progress">
      <div className={styles.progressRow}>
        <span className={styles.progressBadge} aria-hidden="true">
          {running ? (
            <svg className={styles.progressRing} width="20" height="20" viewBox="0 0 20 20">
              <circle className={styles.progressRingTrack} cx="10" cy="10" r={RING_RADIUS} />
              <circle
                className={styles.progressRingArc}
                cx="10"
                cy="10"
                r={RING_RADIUS}
                strokeDasharray={`${ratio * RING_LENGTH} ${RING_LENGTH}`}
              />
            </svg>
          ) : failed > 0 ? (
            <span className={styles.progressFailCount} data-testid="capture-progress-fail-count">
              {failed}
            </span>
          ) : (
            <Check size={16} className={styles.progressIconDone} />
          )}
        </span>

        <span className={styles.captureBannerText} data-testid="capture-progress-text">
          {text}
        </span>

        <button
          type="button"
          className={styles.progressToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          data-testid="capture-progress-toggle"
        >
          <span>
            {expanded
              ? t('cartography.screens.captures.progress.hideDetail')
              : t('cartography.screens.captures.progress.showDetail')}
          </span>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={cn(styles.progressChevron, expanded && styles.progressChevronOpen)}
          />
        </button>
      </div>

      {expanded && (
        <ul
          id={listId}
          className={styles.progressList}
          aria-label={t('cartography.screens.captures.progress.listLabel')}
          data-testid="capture-progress-list"
        >
          {items.map((item) => (
            <li
              key={item.screenId}
              className={styles.progressItem}
              data-state={item.state}
              data-testid={`capture-progress-item-${item.screenId}`}
            >
              <StateIcon state={item.state} label={t(STATE_LABEL_KEY[item.state])} />
              <span className={styles.progressItemName}>{item.name}</span>
              {item.detail && (
                <span className={styles.progressItemDetail} title={item.detail}>
                  {item.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
