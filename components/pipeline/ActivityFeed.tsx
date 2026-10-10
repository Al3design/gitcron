'use client';

import { useMemo, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import styles from './OpenSpecDashboard.module.css';
import { Row } from '@/components/ui';
import {
  groupActivity,
  runtimeDisplayName,
  type ActivityChannel,
  type ActivityEntry,
} from './pipeline-domain';
import {
  IconFile,
  IconNarrative,
  IconReasoning,
  IconSystem,
  IconTool,
  type PipelineIconProps,
} from './PipelineIcons';

const CHANNELS: ActivityChannel[] = ['narrative', 'reasoning', 'tool', 'file', 'system'];

/** Un icono por canal: el filtro se reconoce por forma antes que por texto. */
const CHANNEL_ICONS: Record<ActivityChannel, React.ComponentType<PipelineIconProps>> = {
  narrative: IconNarrative,
  reasoning: IconReasoning,
  tool: IconTool,
  file: IconFile,
  system: IconSystem,
};

export type ActivityFeedProps = {
  entries: ActivityEntry[];
  /**
   * `true` lo emite · `false` el runtime declara que no lo expone · `null`
   * todavía no lo sabemos (no hay sesión de runtime adjunta).
   */
  reasoningAvailable: boolean | null;
  agentRuntimes?: Record<string, string | null>;
  /** `true` cuando hay una sesión de runtime viva alimentando la bitácora. */
  runtimeAttached?: boolean;
};

/**
 * Bitácora combinada con filtros por canal.
 *
 * Los deltas consecutivos se agrupan antes de renderizar: un stream de
 * reasoning produciría un nodo por token y volvería la vista inservible.
 */
export function ActivityFeed({
  entries,
  reasoningAvailable,
  agentRuntimes = {},
  runtimeAttached = false,
}: ActivityFeedProps) {
  const t = useT();
  const [active, setActive] = useState<Set<ActivityChannel>>(() => new Set(CHANNELS));

  const toggle = (channel: ActivityChannel) => {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  const groups = useMemo(
    () => groupActivity(entries.filter((entry) => active.has(entry.channel))),
    [entries, active],
  );

  return (
    <div className={`pipeline-activity ${styles.activityContainer}`}>
      <div className={styles.activityBody}>
        <div className={styles.activityContent}>
          {/* El brief es explícito: un runtime sin reasoning lo dice, no muestra un
              panel vacío que se lea como "no pensó nada".
              Y "todavía no sabemos" (`null`) tampoco puede leerse como "no expone":
              sin sesión adjunta no hay runtime que haya declarado nada. */}
          {reasoningAvailable === false && (
            <p className="pipeline-activity__no-reasoning">{t('pipeline.activity.noReasoning')}</p>
          )}
          {reasoningAvailable === null && (
            <p className="pipeline-activity__no-reasoning">{t('pipeline.activity.reasoningUnknown')}</p>
          )}

          {groups.length === 0 ? (
            <p className="pipeline-activity__empty">
              {runtimeAttached ? t('pipeline.activity.empty') : t('pipeline.activity.noRuntime')}
            </p>
          ) : (
            <ol className="pipeline-activity__list">
              {groups.map((group) => (
                <li key={group.key} className="pipeline-activity__entry" data-channel={group.channel}>
                  {/* Nodo sobre el riel temporal: mismo vocabulario que la vía y el
                      árbol de agentes. El canal se lee por forma y color. */}
                  {/* Las cuatro celdas se emiten SIEMPRE, incluso vacías. La fila
                      es una grilla de columnas fijas: si una entrada sin agente
                      omitiera su celda, el texto treparía a la columna del agente y
                      la alineación se rompería fila por medio. */}
                  <span className="pipeline-activity__dot" aria-hidden="true" />
                  <span className="pipeline-activity__channel">{t(`pipeline.channel.${group.channel}`)}</span>
                  <span className="pipeline-activity__agent">
                    {group.agentId && agentRuntimes[group.agentId]
                      ? runtimeDisplayName(agentRuntimes[group.agentId])
                      : ''}
                  </span>
                  <span className="pipeline-activity__text">{group.text}</span>
                  <span className="pipeline-activity__count">
                    {group.count > 1 ? t('pipeline.activity.grouped', { count: group.count }) : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {entries.length > 0 && (
          <aside className={styles.activityFilterColumn} role="group" aria-label={t('pipeline.activity.filters')}>
            {CHANNELS.map((channel) => {
              const disabled = channel === 'reasoning' && reasoningAvailable !== true;
              const pressed = active.has(channel) && !disabled;
              const Icon = CHANNEL_ICONS[channel];
              return (
                <Row key={channel} gap="2">
                  <button
                    type="button"
                    role="switch"
                    id={`filter-switch-${channel}`}
                    aria-checked={pressed}
                    aria-labelledby={`filter-label-${channel}`}
                    className={styles.profileSwitch}
                    data-state={pressed ? 'on' : 'off'}
                    data-channel={channel}
                    disabled={disabled}
                    onClick={() => toggle(channel)}
                  >
                    <span className={styles.profileSwitchThumb} aria-hidden="true" />
                  </button>
                  <label
                    id={`filter-label-${channel}`}
                    htmlFor={`filter-switch-${channel}`}
                    className={styles.activityFilterLabel}
                    data-disabled={disabled ? 'true' : undefined}
                    onClick={() => !disabled && toggle(channel)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{t(`pipeline.channel.${channel}`)}</span>
                  </label>
                </Row>
              );
            })}
          </aside>
        )}
      </div>
    </div>
  );
}
