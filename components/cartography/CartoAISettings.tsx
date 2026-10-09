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
      <div className="flex min-h-24 items-center justify-center text-text-secondary">
        <Loader2 size={18} className="animate-spin text-secondary" />
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label={t('cartography.ai.title')}>
      <div className="flex items-center gap-2">
        <Bot size={14} className="text-secondary" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          {t('cartography.ai.title')}
        </h4>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{t('cartography.ai.settingsDesc')}</p>

      {/* Master switch (opt-in, apagado por defecto) */}
      <button
        type="button"
        onClick={() => patch({ enabled: !settings.enabled })}
        aria-label={settings.enabled ? 'IA de Cartografía: Activa' : 'IA de Cartografía: Inactiva'}
        className={cn(
          'w-full px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors font-semibold',
          settings.enabled
            ? 'bg-secondary/15 border-secondary/50 text-secondary'
            : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
        )}
      >
        {settings.enabled ? <><Check size={14} strokeWidth={3} />{t('cartography.ai.enabled')}</> : t('cartography.ai.disabled')}
      </button>

      {/* Configuración del uso: sólo visible si la IA está activa */}
      {settings.enabled && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex-1">
              <AiUseLine use="gitcron-cartography" />
            </div>
            {onNavigateToAiModels && (
              <button
                type="button"
                onClick={onNavigateToAiModels}
                className="shrink-0 self-start sm:self-center px-3 py-1.5 rounded-lg border border-border-subtle/30 bg-bg-base/70 text-xs text-text-secondary hover:border-secondary/40 hover:text-secondary transition-colors flex items-center gap-1.5 font-medium"
              >
                <Cpu size={13} />
                <span>{t('cartography.ai.goToAiModels')}</span>
              </button>
            )}
          </div>

          {/* Probar conexión (sin gastar una generación) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probing}
              className="shrink-0 px-3 py-2 rounded-lg border border-border-subtle/30 bg-bg-base/70 text-sm text-text-secondary hover:border-secondary/40 hover:text-secondary transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {probing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
              {probing ? t('cartography.ai.checking') : t('cartography.ai.check')}
            </button>
            {probe && (
              <span className={cn('flex items-center gap-1.5 text-xs', probe.available ? 'text-secondary' : 'text-error')}>
                {probe.available ? <Wifi size={13} /> : <WifiOff size={13} />}
                <span className="min-w-0">
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
