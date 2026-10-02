'use client';

// CartoAISettings — Cartografía, Fase 4.
//
// Selector de proveedor de IA en Ajustes: opt-in (apagado por defecto), local vs
// online, modelo y un botón para probar la conexión sin gastar una generación.
// Autocontenido: maneja su propio estado vía `window.api.cartoAi`, mismo patrón
// que TemporalAgentSettings (no enchufa props por el árbol).
//
// Modo ONLINE: reutiliza la MISMA lógica del Temporal Agent para la API key y el
// modelo — el mismo vault (`window.api.ai.*` con 'openrouter') y el mismo catálogo
// de modelos (lib/openrouter-models). La key nunca llega al renderer: sólo se
// consulta si existe (booleano) y su huella SHA-256; se usa sólo en main.

import { useEffect, useState } from 'react';
import { Bot, Check, Loader2, Wifi, WifiOff, HardDrive, Globe, KeyRound } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { OPENROUTER_MODELS, OPENROUTER_PROVIDER_ID } from '@/lib/openrouter-models';
import type { CartoAISettings as Settings, CartoAIMode, CartoAIProbe } from '@/types/carto-ai';
import type { AiUseStatus } from '@/types/ai-use';
import { AiUseLine } from '../ai/AiUseLine';

export function CartoAISettings() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [probe, setProbe] = useState<CartoAIProbe | null>(null);
  const [probing, setProbing] = useState(false);
  // El modelo sale de gitcron.json (tarea 4.3). Local u online y el modelo de acá
  // son la elección de antes: se muestran sólo si el uso no tiene modelo, para
  // elegir qué escribir en el archivo con «usar lo que tenías».
  const [useStatus, setUseStatus] = useState<AiUseStatus | null>(null);
  const showLegacyChoice = useStatus === null || useStatus.status === 'unset';

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

  const modes: { id: CartoAIMode; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: 'local', label: t('cartography.ai.modeLocal'), icon: <HardDrive size={14} />, hint: t('cartography.ai.localHint') },
    { id: 'online', label: t('cartography.ai.modeOnline'), icon: <Globe size={14} />, hint: t('cartography.ai.onlineHint') },
  ];
  const activeHint = modes.find((m) => m.id === settings.mode)?.hint ?? '';

  return (
    <section className="space-y-4">
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
        className={cn(
          'w-full px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors font-semibold',
          settings.enabled
            ? 'bg-secondary/15 border-secondary/50 text-secondary'
            : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary',
        )}
      >
        {settings.enabled ? <><Check size={14} strokeWidth={3} />{t('cartography.ai.enabled')}</> : t('cartography.ai.disabled')}
      </button>

      {/* Selector de proveedor + config: sólo visible si la IA está activa */}
      {settings.enabled && (
        <div className="space-y-4">
          <AiUseLine
            use="gitcron-cartography"
            onStatus={setUseStatus}
            refreshKey={`${settings.mode}:${settings.model ?? ''}`}
          />
          {showLegacyChoice && (
          <div>
            <span className="mb-2 block text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider text-text-secondary">
              {t('cartography.ai.providerLabel')}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => patch({ mode: m.id })}
                  className={cn(
                    'px-3 py-2.5 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors',
                    settings.mode === m.id
                      ? 'bg-secondary/15 border-secondary/50 text-secondary'
                      : 'bg-bg-base/70 border-border-subtle/15 text-text-secondary hover:text-text-primary hover:border-border-subtle/30',
                  )}
                >
                  {m.icon}
                  <span className="font-semibold">{m.label}</span>
                  {settings.mode === m.id && <Check size={13} strokeWidth={3} />}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-secondary/80 leading-relaxed">{activeHint}</p>
          </div>
          )}

          {/* LOCAL: el modelo es el nombre cargado en LM Studio (texto libre). */}
          {showLegacyChoice && settings.mode === 'local' && (
            <div>
              <label className="mb-2 block text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider text-text-secondary">
                {t('cartography.ai.modelLabel')}
              </label>
              <input
                type="text"
                value={settings.model ?? ''}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                onBlur={(e) => patch({ model: e.target.value })}
                placeholder={t('cartography.ai.modelPlaceholderLocal')}
                className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-secondary/50 focus:border-secondary/50 focus:outline-none"
              />
            </div>
          )}

          {/* ONLINE: misma lógica que el Temporal Agent (key cifrada + modelo). */}
          {showLegacyChoice && settings.mode === 'online' && (
            <OnlineAccess
              model={settings.model ?? ''}
              onModelChange={(v) => patch({ model: v })}
            />
          )}

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

// ── Acceso online: API key (OpenRouter) + selector de modelo ────────────────
// Reutiliza window.api.ai.* (vault del Temporal Agent) con 'openrouter'. El
// renderer sólo ve un booleano "hay key" + la huella SHA-256; la key real vive
// y se usa sólo en main. El modelo se persiste en los settings de Cartografía.

function OnlineAccess({ model, onModelChange }: { model: string; onModelChange: (v: string) => void }) {
  const t = useT();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [hasR, fpR] = await Promise.all([
      window.api.ai.hasKey(OPENROUTER_PROVIDER_ID),
      window.api.ai.keyFingerprint(OPENROUTER_PROVIDER_ID),
    ]);
    setHasKey(hasR.success ? Boolean(hasR.data) : false);
    setFingerprint(fpR.success ? fpR.data ?? null : null);
  }

  async function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    setSavingKey(true);
    try {
      await window.api.ai.setKey(OPENROUTER_PROVIDER_ID, k);
      setKeyDraft(''); // nunca dejamos la key en estado del componente
      await refresh();
    } finally {
      setSavingKey(false);
    }
  }

  async function removeKey() {
    await window.api.ai.removeKey(OPENROUTER_PROVIDER_ID);
    await refresh();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-subtle/15 bg-bg-base/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound size={13} className="text-secondary" />
        <span className="text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider text-text-secondary">
          {t('cartography.ai.onlineKeyTitle')}
        </span>
        <span className="ml-auto text-xs">
          {hasKey === null ? (
            <span className="text-text-secondary/70">{t('cartography.ai.keyChecking')}</span>
          ) : hasKey ? (
            <span className="text-secondary">{t('cartography.ai.keyConfigured')}</span>
          ) : (
            <span className="text-error">{t('cartography.ai.keyNotSet')}</span>
          )}
        </span>
      </div>

      {hasKey && fingerprint && (
        <code className="block font-mono text-[length:var(--font-size-xs)] text-text-secondary/70">
          {t('cartography.ai.keyFingerprint', { fp: fingerprint })}
        </code>
      )}

      <p className="text-xs text-text-secondary/80 leading-relaxed">{t('cartography.ai.sharedKeyHint')}</p>

      <div className="flex items-center gap-2">
        <input
          type="password"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          autoComplete="off"
          placeholder={hasKey ? t('cartography.ai.keyPlaceholderReplace') : t('cartography.ai.keyPlaceholderPaste')}
          className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-secondary/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void saveKey()}
          disabled={savingKey || !keyDraft.trim()}
          className="shrink-0 rounded-lg border border-secondary/45 bg-secondary/15 px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-secondary/25 disabled:opacity-40"
        >
          {savingKey ? t('cartography.ai.saving') : t('cartography.ai.saveKey')}
        </button>
        {hasKey && (
          <button
            type="button"
            onClick={() => void removeKey()}
            className="shrink-0 rounded-lg border border-border-subtle/20 bg-bg-base/70 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-error hover:border-error/30"
          >
            {t('cartography.ai.removeKey')}
          </button>
        )}
      </div>

      {/* Selector de modelo (mismo catálogo que el Temporal Agent) */}
      <div>
        <label className="mb-2 block text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider text-text-secondary">
          {t('cartography.ai.onlineModelLabel')}
        </label>
        <ModelSelect value={model} onChange={onModelChange} />
      </div>
    </div>
  );
}

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const knownIds = OPENROUTER_MODELS.map((m) => m.id);
  const isKnown = knownIds.includes(value);
  const [customMode, setCustomMode] = useState(!!value && !isKnown);
  const selectValue = customMode ? '__custom__' : !value ? '' : isKnown ? value : '__custom__';

  return (
    <div className="flex flex-col gap-2">
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom__') {
            setCustomMode(true);
            onChange('');
          } else {
            setCustomMode(false);
            onChange(v);
          }
        }}
        className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-secondary/50 focus:outline-none"
      >
        <option value="">{t('cartography.ai.modelDefaultOption')}</option>
        {OPENROUTER_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.price}/M tokens
          </option>
        ))}
        <option value="__custom__">{t('cartography.ai.modelCustomOption')}</option>
      </select>
      {(customMode || (!isKnown && value)) && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('cartography.ai.modelCustomPlaceholder')}
          className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-secondary/50 focus:border-secondary/50 focus:outline-none"
        />
      )}
    </div>
  );
}
