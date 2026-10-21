'use client';

// CartoAISettings — Cartografía, Fase 4.
//
// La IA de Cartografía en Ajustes: el interruptor (opt-in, apagado por defecto: es la
// decisión de mandar contexto del repositorio a un modelo), la línea del uso y un botón
// para probar la conexión sin gastar una generación. Autocontenido: maneja su propio
// estado vía `window.api.cartoAi`.
//
// Motor, modelo y clave se eligen en «Motores y modelos» (D11, tarea 6.1). El modo
// local/online y el modelo que se guardaban acá siguen en carto-ai.json: la oferta
// «usar lo que tenías» de la línea del uso los lee sin controles en esta pantalla.

import { useEffect, useState } from 'react';
import { Bot, Check, Loader2, Wifi, WifiOff, Cpu } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type { CartoAISettings as Settings, CartoAIProbe } from '@/types/carto-ai';
import { AiUseLine } from '../ai/AiUseLine';
import styles from './CartoAISettings.module.css';

interface Props {
  /** Abre la sección «Motores y modelos» de Ajustes. */
  onNavigateToAiModels?: () => void;
}

export function CartoAISettings({ onNavigateToAiModels }: Props = {}) {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [probe, setProbe] = useState<CartoAIProbe | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let active = true;
    void window.api.cartoAi.getSettings().then((res) => {
      if (active && res.success && res.data) setSettings(res.data);
    });
    return () => {
      active = false;
    };
  }, []);

  async function patch(next: Partial<Settings>) {
    const res = await window.api.cartoAi.setSettings(next);
    if (res.success && res.data) {
      setSettings(res.data);
      setProbe(null); // un cambio invalida el último sondeo
    }
  }

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    try {
      const res = await window.api.cartoAi.probe();
      if (res.success && res.data) setProbe(res.data);
    } finally {
      setProbing(false);
    }
  }

  if (!settings) {
    return (
      <div className={styles.loadingContainer}>
        <Loader2 size={18} className={styles.spinner} />
      </div>
    );
  }

  return (
    <section className={styles.section} aria-label={t('cartography.ai.title')}>
      <div className={styles.header}>
        <Bot size={14} className={styles.headerIcon} />
        <h4 className={styles.title}>
          {t('cartography.ai.title')}
        </h4>
      </div>
      <p className={styles.description}>{t('cartography.ai.settingsDesc')}</p>

      {/* Master switch (opt-in, apagado por defecto) */}
      <button
        type="button"
        onClick={() => patch({ enabled: !settings.enabled })}
        aria-label={settings.enabled ? 'IA de Cartografía: Activa' : 'IA de Cartografía: Inactiva'}
        className={cn(
          styles.masterSwitch,
          settings.enabled && styles.masterSwitchEnabled,
        )}
      >
        {settings.enabled ? <><Check size={14} strokeWidth={3} />{t('cartography.ai.enabled')}</> : t('cartography.ai.disabled')}
      </button>

      {/* Configuración del uso: sólo visible si la IA está activa */}
      {settings.enabled && (
        <div className={styles.activeContent}>
          <div className={styles.useLineRow}>
            <div className={styles.useLineContainer}>
              <AiUseLine use="gitcron-cartography" />
            </div>
            {onNavigateToAiModels && (
              <button
                type="button"
                onClick={onNavigateToAiModels}
                className={styles.goToModelsBtn}
              >
                <Cpu size={13} />
                <span>{t('cartography.ai.goToAiModels')}</span>
              </button>
            )}
          </div>

          {/* Probar conexión (sin gastar una generación) */}
          <div className={styles.probeRow}>
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probing}
              className={styles.probeBtn}
            >
              {probing ? <Loader2 size={14} className={styles.spinner} /> : <Wifi size={14} />}
              {probing ? t('cartography.ai.checking') : t('cartography.ai.check')}
            </button>
            {probe && (
              <span className={cn(styles.probeStatus, probe.available ? styles.probeAvailable : styles.probeUnavailable)}>
                {probe.available ? <Wifi size={13} /> : <WifiOff size={13} />}
                <span className={styles.probeDetail}>
                  {probe.available ? t('cartography.ai.available') : (probe.detail || t('cartography.ai.unavailable'))}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
