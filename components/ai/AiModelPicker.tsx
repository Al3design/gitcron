'use client';

// components/ai/AiModelPicker.tsx
//
// Selector compartido para elegir el modelo y la intensidad de pensamiento
// de un uso de texto entre lo que cada herramienta ofrece de verdad (tarea 4.5
// de modelos-en-casa). Nada se escribe en gitcron.json hasta apretar «Guardar».

import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import type { AiTextUse, AiToolProvider, AiUseChoosePayload } from '@/types/ai-use';
import styles from './AiModelPicker.module.css';

export interface AiModelPickerProps {
  use: AiTextUse;
  repoPath?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function AiModelPicker({ use, repoPath = null, onClose, onSaved }: AiModelPickerProps) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AiToolProvider[]>([]);

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedEffort, setSelectedEffort] = useState<string>('');
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const aiUse = window.api?.aiUse;
      if (!aiUse?.models) {
        if (alive) setLoading(false);
        return;
      }

      try {
        const res = await aiUse.models({ use, repoPath });
        if (!alive) return;
        setLoading(false);
        if (!res?.success || !res.data) {
          setError(res?.error ?? t('aiUse.chooseFailed', { detail: '—' }));
          return;
        }

        const data = res.data;
        setProviders(data.providers);

        // Proveedor inicial
        let initProvider = data.providers.find((p) => p.id === data.current?.providerId);
        if (!initProvider) {
          initProvider = data.providers.find((p) => p.available && p.models.length > 0) ?? data.providers[0];
        }
        const pId = initProvider?.id ?? '';
        setSelectedProviderId(pId);

        // Modelo inicial
        let initModel = initProvider?.models.find((m) => m.id === data.current?.modelId);
        if (!initModel && initProvider && initProvider.models.length > 0) {
          initModel = initProvider.models[0];
        }
        const mId = initModel?.id ?? '';
        setSelectedModelId(mId);

        // Nivel de intensidad inicial
        if (data.current?.effort && initModel?.supportedLevels?.includes(data.current.effort)) {
          setSelectedEffort(data.current.effort);
        } else if (initModel?.defaultLevel) {
          setSelectedEffort(initModel.defaultLevel);
        } else {
          setSelectedEffort('');
        }

        // Variante inicial
        if (data.current?.variant && initModel?.variants?.includes(data.current.variant)) {
          setSelectedVariant(data.current.variant);
        } else {
          setSelectedVariant('');
        }
      } catch (err: any) {
        if (!alive) return;
        setLoading(false);
        setError(err?.message ?? t('aiUse.chooseFailed', { detail: '—' }));
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [use, repoPath, t]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  const currentModel = useMemo(
    () => currentProvider?.models.find((m) => m.id === selectedModelId),
    [currentProvider, selectedModelId],
  );

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProviderId = e.target.value;
    setSelectedProviderId(nextProviderId);
    const nextProvider = providers.find((p) => p.id === nextProviderId);
    const nextModel = nextProvider?.models[0];
    const nextModelId = nextModel?.id ?? '';
    setSelectedModelId(nextModelId);
    setSelectedVariant('');
    setSelectedEffort(nextModel?.defaultLevel ?? '');
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModelId = e.target.value;
    setSelectedModelId(nextModelId);
    const nextModel = currentProvider?.models.find((m) => m.id === nextModelId);
    setSelectedVariant('');
    setSelectedEffort(nextModel?.defaultLevel ?? '');
  };

  const effortOptions = useMemo(() => {
    if (!currentModel?.supportedLevels || currentModel.supportedLevels.length === 0) {
      return [];
    }
    const items: { value: string; label: string }[] = [];
    if (!currentModel.defaultLevel) {
      items.push({ value: '', label: t('aiUse.effortToolDefault') });
    }
    for (const lvl of currentModel.supportedLevels) {
      const isDefault = lvl === currentModel.defaultLevel;
      items.push({
        value: lvl,
        label: isDefault ? `${lvl} (${t('aiUse.defaultSuffix')})` : lvl,
      });
    }
    return items;
  }, [currentModel, t]);

  const hasVariants = Boolean(currentModel?.variants && currentModel.variants.length > 0);
  const hasEffort = effortOptions.length > 0;

  const handleSave = async () => {
    if (!selectedProviderId || !selectedModelId) return;
    setSaving(true);
    setError(null);
    try {
      const fullModel = `${selectedProviderId}/${selectedModelId}`;
      const payload: AiUseChoosePayload = {
        use,
        repoPath,
        model: fullModel,
        effort: selectedEffort ? selectedEffort : undefined,
        variant: selectedVariant ? selectedVariant : undefined,
      };
      const res = await window.api?.aiUse?.choose(payload);
      if (!res?.success) {
        setError(t('aiUse.chooseFailed', { detail: res?.error ?? '—' }));
        return;
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(t('aiUse.chooseFailed', { detail: err?.message ?? '—' }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.pickerCard}>
        <p className={styles.pickerNotice}>{t('aiUse.loadingModels')}</p>
      </div>
    );
  }

  return (
    <div className={styles.pickerCard} data-testid="ai-model-picker">
      <div className={styles.pickerHeader}>
        <p className={styles.pickerTitle}>{t('aiUse.pickerTitle')}</p>
      </div>

      <div className={styles.fieldGrid}>
        {/* Proveedor */}
        <div className={styles.fieldGroup}>
          <label htmlFor={`picker-provider-${use}`} className={styles.fieldLabel}>
            {t('aiUse.provider')}
          </label>
          <select
            id={`picker-provider-${use}`}
            className={styles.fieldSelect}
            value={selectedProviderId}
            onChange={handleProviderChange}
            disabled={saving}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available && p.models.length === 0}>
                {p.name}
                {!p.available ? ` (${p.unavailableReason ?? '—'})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Modelo */}
        <div className={styles.fieldGroup}>
          <label htmlFor={`picker-model-${use}`} className={styles.fieldLabel}>
            {t('aiUse.model')}
          </label>
          <select
            id={`picker-model-${use}`}
            className={styles.fieldSelect}
            value={selectedModelId}
            onChange={handleModelChange}
            disabled={saving || !currentProvider || currentProvider.models.length === 0}
          >
            {currentProvider && currentProvider.models.length > 0 ? (
              currentProvider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))
            ) : (
              <option value="">{t('aiUse.noModelsAvailable')}</option>
            )}
          </select>
        </div>

        {/* Variante (si el modelo declara) */}
        {hasVariants && (
          <div className={styles.fieldGroup}>
            <label htmlFor={`picker-variant-${use}`} className={styles.fieldLabel}>
              {t('aiUse.variant')}
            </label>
            <select
              id={`picker-variant-${use}`}
              className={styles.fieldSelect}
              value={selectedVariant}
              onChange={(e) => setSelectedVariant(e.target.value)}
              disabled={saving}
            >
              <option value="">{t('aiUse.variantNone')}</option>
              {currentModel?.variants?.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Intensidad / razonamiento (si el modelo declara) */}
        {hasEffort && (
          <div className={styles.fieldGroup}>
            <label htmlFor={`picker-effort-${use}`} className={styles.fieldLabel}>
              {t('aiUse.effort')}
            </label>
            <select
              id={`picker-effort-${use}`}
              className={styles.fieldSelect}
              value={selectedEffort}
              onChange={(e) => setSelectedEffort(e.target.value)}
              disabled={saving}
            >
              {effortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <p className={styles.pickerError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.pickerActions}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSave}
          disabled={saving || !selectedModelId}
        >
          {saving ? t('aiUse.saving') : t('aiUse.save')}
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onClose}
          disabled={saving}
        >
          {t('aiUse.cancel')}
        </button>
      </div>
    </div>
  );
}
