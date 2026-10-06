'use client';

// components/ai/settings/AiSettingsGroupProviders.tsx
//
// Grupo 2: «Proveedores y modelos» (servidores y CLIs, por familia).
// Incluye «+ Agregar proveedor» y «Agregar modelo» en tarjetas desplegables en el lugar
// (sin modales), autofocus en el primer campo, cancelación con Escape y retorno de foco.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronRight, Plus, Trash2, Key, Server, Terminal, Lock,
  RefreshCw, Check, X, ExternalLink
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import type { AiConfigProviderInfo, AiConfigStatusResult } from '@/types/ai-config';

export interface AiSettingsGroupProvidersProps {
  status: AiConfigStatusResult | null;
  repoPath?: string | null;
  isFileBroken: boolean;
  onReload: () => Promise<void>;
  onError: (err: string | null) => void;
  onSuccess: (msg: string | null) => void;
}

interface ProviderModelDetail {
  id: string;
  name?: string;
  declared: boolean;
  reported: boolean;
  contextLength?: number;
  ttlMinutes?: number;
}

export function AiSettingsGroupProviders({
  status,
  repoPath = null,
  isFileBroken,
  onReload,
  onError,
  onSuccess,
}: AiSettingsGroupProvidersProps) {
  const t = useT();

  // Proveedores expandidos
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  // Modelos consultados por proveedor
  const [providerModelsData, setProviderModelsData] = useState<Record<string, {
    loading: boolean;
    models: ProviderModelDetail[];
    canLoad: boolean;
  }>>({});

  // Claves en borrador
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});

  // Ajustes de carga en borrador por provider:model
  const [loadSettingsDrafts, setLoadSettingsDrafts] = useState<Record<string, {
    contextLength?: number;
    ttlMinutes?: number;
  }>>({});
  const [savingLoadSettings, setSavingLoadSettings] = useState<Record<string, boolean>>({});

  // Formulario en tarjeta "+ Agregar proveedor" (sin modal)
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
  const [newProviderId, setNewProviderId] = useState('');
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderBaseURL, setNewProviderBaseURL] = useState('');
  const [newProviderApiKey, setNewProviderApiKey] = useState('');
  const [addingProvider, setAddingProvider] = useState(false);
  const addProviderBtnRef = useRef<HTMLButtonElement | null>(null);
  const firstProviderInputRef = useRef<HTMLInputElement | null>(null);

  // Formulario en tarjeta "+ Agregar modelo" (sin modal)
  const [addModelProviderId, setAddModelErrorProviderId] = useState<string | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const addModelBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const firstModelInputRef = useRef<HTMLInputElement | null>(null);

  // Diálogo para quitar proveedor
  const [providerToRemove, setProviderToRemove] = useState<AiConfigProviderInfo | null>(null);
  const [deleteStoredVarOnRemove, setDeleteStoredVarOnRemove] = useState(false);
  const [removingProvider, setRemovingProvider] = useState(false);

  // Diálogo para quitar modelo
  const [modelToRemove, setModelToRemove] = useState<{ providerId: string; modelId: string } | null>(null);
  const [removingModel, setRemovingModel] = useState(false);

  // Autofocus en el primer campo al abrir tarjeta de agregar proveedor
  useEffect(() => {
    if (isAddProviderOpen && firstProviderInputRef.current) {
      firstProviderInputRef.current.focus();
    }
  }, [isAddProviderOpen]);

  // Retorno de foco al cerrar tarjeta de agregar proveedor
  const wasAddProviderOpen = useRef(false);
  useEffect(() => {
    if (wasAddProviderOpen.current && !isAddProviderOpen) {
      addProviderBtnRef.current?.focus();
    }
    wasAddProviderOpen.current = isAddProviderOpen;
  }, [isAddProviderOpen]);

  // Autofocus en el primer campo al abrir tarjeta de agregar modelo
  useEffect(() => {
    if (addModelProviderId && firstModelInputRef.current) {
      firstModelInputRef.current.focus();
    }
  }, [addModelProviderId]);

  // Retorno de foco al cerrar tarjeta de agregar modelo
  const prevAddModelProviderId = useRef<string | null>(null);
  useEffect(() => {
    if (prevAddModelProviderId.current && !addModelProviderId) {
      addModelBtnRefs.current[prevAddModelProviderId.current]?.focus();
    }
    prevAddModelProviderId.current = addModelProviderId;
  }, [addModelProviderId]);

  const toggleProvider = (providerId: string) => {
    const next = !expandedProviders[providerId];
    setExpandedProviders((prev) => ({ ...prev, [providerId]: next }));
    if (next && !providerModelsData[providerId]) {
      void loadProviderModels(providerId);
    }
  };

  const loadProviderModels = async (providerId: string) => {
    setProviderModelsData((prev) => ({
      ...prev,
      [providerId]: { loading: true, models: prev[providerId]?.models ?? [], canLoad: false },
    }));
    try {
      const res = await window.api?.aiConfig?.providerModels({ providerId, repoPath });
      if (res?.success && res.data) {
        const declared = res.data.declared ?? [];
        const reported = res.data.reported ?? [];
        const canLoad = Boolean(res.data.canLoad);

        const modelMap = new Map<string, ProviderModelDetail>();

        for (const mId of declared) {
          modelMap.set(mId, {
            id: mId,
            declared: true,
            reported: false,
          });
        }

        for (const rep of reported) {
          const existing = modelMap.get(rep.id);
          if (existing) {
            existing.reported = true;
            existing.name = rep.name ?? existing.name;
          } else {
            modelMap.set(rep.id, {
              id: rep.id,
              name: rep.name,
              declared: false,
              reported: true,
            });
          }
        }

        // Si canLoad, obtener settings de cada modelo declarado
        if (canLoad) {
          for (const m of modelMap.values()) {
            if (m.declared) {
              try {
                const s = await window.api?.aiConfig?.getModelLoadSettings({
                  providerId,
                  modelId: m.id,
                  repoPath,
                });
                if (s?.success && s.data) {
                  m.contextLength = s.data.contextLength;
                  m.ttlMinutes = s.data.ttlMinutes;
                }
              } catch {
                // Ignore load settings error for model preview
              }
            }
          }
        }

        const modelsList = Array.from(modelMap.values());
        setProviderModelsData((prev) => ({
          ...prev,
          [providerId]: {
            loading: false,
            models: modelsList,
            canLoad,
          },
        }));

        // Inicializar borradores de ajustes de carga
        const initialDrafts: Record<string, { contextLength?: number; ttlMinutes?: number }> = {};
        for (const m of modelsList) {
          initialDrafts[`${providerId}:${m.id}`] = {
            contextLength: m.contextLength,
            ttlMinutes: m.ttlMinutes,
          };
        }
        setLoadSettingsDrafts((prev) => ({ ...prev, ...initialDrafts }));
      } else {
        setProviderModelsData((prev) => ({
          ...prev,
          [providerId]: { loading: false, models: [], canLoad: false },
        }));
      }
    } catch {
      setProviderModelsData((prev) => ({
        ...prev,
        [providerId]: { loading: false, models: [], canLoad: false },
      }));
    }
  };

  const handleCancelAddProvider = () => {
    setIsAddProviderOpen(false);
    setNewProviderId('');
    setNewProviderName('');
    setNewProviderBaseURL('');
    setNewProviderApiKey('');
    addProviderBtnRef.current?.focus();
  };

  const handleAddProviderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newProviderId.trim();
    const baseURL = newProviderBaseURL.trim();
    const name = newProviderName.trim() || id;
    const apiKey = newProviderApiKey.trim() || undefined;
    if (!id || !baseURL) return;

    setAddingProvider(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.addProvider({
        id,
        baseURL,
        name,
        apiKey,
        repoPath,
      });
      if (res?.success) {
        handleCancelAddProvider();
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setAddingProvider(false);
    }
  };

  const handleCancelAddModel = (providerId: string) => {
    setAddModelErrorProviderId(null);
    setNewModelId('');
    setNewModelName('');
    addModelBtnRefs.current[providerId]?.focus();
  };

  const handleAddModelSubmit = async (providerId: string, e: React.FormEvent) => {
    e.preventDefault();
    const modelId = newModelId.trim();
    const name = newModelName.trim() || undefined;
    if (!modelId) return;

    setAddingModel(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.addModel({
        providerId,
        modelId,
        name,
        repoPath,
      });
      if (res?.success) {
        handleCancelAddModel(providerId);
        await onReload();
        await loadProviderModels(providerId);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setAddingModel(false);
    }
  };

  const handleSaveKey = async (provider: AiConfigProviderInfo) => {
    const raw = keyDrafts[provider.id]?.trim();
    if (!raw) return;

    const apiKeyVar = provider.envVars.find((v) => v.isApiKey) ?? provider.envVars[0];
    let varName = apiKeyVar?.name;
    if (!varName) {
      let clean = provider.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (/^[0-9]/.test(clean)) clean = `AI_${clean}`;
      varName = `${clean}_API_KEY`;
    }

    setSavingKey((prev) => ({ ...prev, [provider.id]: true }));
    onError(null);
    try {
      const res = await window.api?.ai?.setEnvVar(varName, raw);
      if (res?.success) {
        setKeyDrafts((prev) => {
          const next = { ...prev };
          delete next[provider.id];
          return next;
        });
        onSuccess(t('aiConfig.keySavedNotice'));
        setTimeout(() => onSuccess(null), 3000);
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingKey((prev) => ({ ...prev, [provider.id]: false }));
    }
  };

  const handleRemoveKey = async (provider: AiConfigProviderInfo) => {
    const apiKeyVar = provider.envVars.find((v) => v.isApiKey) ?? provider.envVars[0];
    if (!apiKeyVar) return;
    setSavingKey((prev) => ({ ...prev, [provider.id]: true }));
    onError(null);
    try {
      const res = await window.api?.ai?.removeEnvVar(apiKeyVar.name);
      if (res?.success) {
        setKeyDrafts((prev) => {
          const next = { ...prev };
          delete next[provider.id];
          return next;
        });
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingKey((prev) => ({ ...prev, [provider.id]: false }));
    }
  };

  const handleSaveModelLoadSettings = async (providerId: string, modelId: string) => {
    const key = `${providerId}:${modelId}`;
    const draft = loadSettingsDrafts[key];
    if (!draft) return;

    setSavingLoadSettings((prev) => ({ ...prev, [key]: true }));
    onError(null);
    try {
      const res = await window.api?.aiConfig?.setModelLoadSettings({
        providerId,
        modelId,
        contextLength: draft.contextLength,
        ttlMinutes: draft.ttlMinutes,
        repoPath,
      });
      if (res?.success) {
        onSuccess(t('aiConfig.saved'));
        setTimeout(() => onSuccess(null), 3000);
        await onReload();
        await loadProviderModels(providerId);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingLoadSettings((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleConfirmRemoveProvider = async () => {
    if (!providerToRemove) return;
    setRemovingProvider(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.removeProvider({
        id: providerToRemove.id,
        deleteStoredVar: deleteStoredVarOnRemove,
        repoPath,
      });
      if (res?.success) {
        setProviderToRemove(null);
        setDeleteStoredVarOnRemove(false);
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setRemovingProvider(false);
    }
  };

  const handleConfirmRemoveModel = async () => {
    if (!modelToRemove) return;
    setRemovingModel(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.removeModel({
        providerId: modelToRemove.providerId,
        modelId: modelToRemove.modelId,
        repoPath,
      });
      if (res?.success) {
        const pId = modelToRemove.providerId;
        setModelToRemove(null);
        await onReload();
        await loadProviderModels(pId);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setRemovingModel(false);
    }
  };

  const providers = status?.providers ?? [];
  const providersByFamily = {
    'openai-compatible': providers.filter((p) => p.family === 'openai-compatible'),
    anthropic: providers.filter((p) => p.family === 'anthropic'),
    cli: providers.filter((p) => p.family === 'cli'),
  };

  // Helper para renderizar destino según diseño D11
  const renderDestinationBadge = (provider: AiConfigProviderInfo) => {
    const dest = provider.destination;
    let label = t('aiConfig.destinationExternalService');
    if (dest === 'this-machine') label = t('aiConfig.destinationThisMachine');
    if (dest === 'own-server') label = t('aiConfig.destinationOwnServer');
    return (
      <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono">
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-5 font-sans text-xs">
      {/* Botón "+ Agregar proveedor" arriba de la familia de servidores */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            {t('aiConfig.familyOpenAi')}
          </div>
          <button
            ref={addProviderBtnRef}
            type="button"
            onClick={() => setIsAddProviderOpen(true)}
            disabled={isFileBroken || isAddProviderOpen}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            <Plus size={13} />
            <span>{t('aiConfig.addProvider')}</span>
          </button>
        </div>

        {/* Tarjeta desplegable en el lugar para agregar proveedor (sin modal) */}
        {isAddProviderOpen && (
          <form
            data-testid="add-provider-inline-card"
            onSubmit={handleAddProviderSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelAddProvider();
              }
            }}
            className="p-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] space-y-3 font-mono shadow-sm"
          >
            <div className="flex items-center justify-between font-sans">
              <span className="font-bold text-sm text-[var(--color-text-primary)]">
                {t('aiConfig.addProviderTitle')}
              </span>
              <button
                type="button"
                onClick={handleCancelAddProvider}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                  {t('aiConfig.providerId')} *
                </label>
                <input
                  ref={firstProviderInputRef}
                  type="text"
                  required
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value)}
                  placeholder={t('aiConfig.providerIdPlaceholder')}
                  className="w-full px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                />
              </div>

              <div>
                <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                  {t('aiConfig.providerName')}
                </label>
                <input
                  type="text"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  placeholder={t('aiConfig.providerNamePlaceholder')}
                  className="w-full px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                  {t('aiConfig.providerBaseURL')} *
                </label>
                <input
                  type="url"
                  required
                  value={newProviderBaseURL}
                  onChange={(e) => setNewProviderBaseURL(e.target.value)}
                  placeholder={t('aiConfig.providerBaseURLPlaceholder')}
                  className="w-full px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                  {t('aiConfig.providerApiKey')}
                </label>
                <input
                  type="password"
                  value={newProviderApiKey}
                  onChange={(e) => setNewProviderApiKey(e.target.value)}
                  placeholder={t('aiConfig.providerApiKeyPlaceholder')}
                  className="w-full px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                />
                <p className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] mt-1 font-sans">
                  {t('aiConfig.providerApiKeyHint')}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)] font-sans">
              <button
                type="button"
                onClick={handleCancelAddProvider}
                className="px-3 py-1.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs cursor-pointer"
              >
                {t('aiConfig.cancel')}
              </button>
              <button
                type="submit"
                disabled={addingProvider || !newProviderId.trim() || !newProviderBaseURL.trim()}
                className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {addingProvider ? t('aiConfig.saving') : t('aiConfig.save')}
              </button>
            </div>
          </form>
        )}

        {/* Servidores compatibles con OpenAI */}
        {providersByFamily['openai-compatible'].length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 text-xs text-[var(--color-text-secondary)]/70 italic">
            {t('aiConfig.noProviders')}
          </div>
        ) : (
          providersByFamily['openai-compatible'].map((p) => renderProviderCard(p))
        )}
      </div>

      {/* Familia 2: Anthropic */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          {t('aiConfig.familyAnthropic')}
        </div>
        {providersByFamily.anthropic.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 text-xs text-[var(--color-text-secondary)]/70 italic">
            {t('aiConfig.noProviders')}
          </div>
        ) : (
          providersByFamily.anthropic.map((p) => renderProviderCard(p))
        )}
      </div>

      {/* Familia 3: Herramientas CLI */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          {t('aiConfig.familyCli')}
        </div>
        {providersByFamily.cli.map((p) => renderCliProviderCard(p))}
      </div>

      {/* Diálogo para confirmar eliminación de proveedor */}
      {providerToRemove && (() => {
        const uses = status?.uses ?? [];
        const affected = uses.filter((u) => u.model?.startsWith(providerToRemove.id + '/'));
        const affectedText = affected.length > 0
          ? t('aiConfig.removeProviderWarningUses', { uses: affected.map((a) => a.use).join(', ') })
          : undefined;
        const hasStoredVar = providerToRemove.envVars.some((v) => v.status === 'stored');
        const storedVarName = providerToRemove.envVars.find((v) => v.status === 'stored')?.name ?? '';

        return (
          <DangerConfirmDialog
            open={Boolean(providerToRemove)}
            title={t('aiConfig.removeProviderTitle', { name: providerToRemove.name || providerToRemove.id })}
            message={
              <span className="space-y-2 text-xs block">
                <span>{t('aiConfig.removeProviderMessage')}</span>
                {hasStoredVar && (
                  <label className="flex items-center gap-2 pt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteStoredVarOnRemove}
                      onChange={(e) => setDeleteStoredVarOnRemove(e.target.checked)}
                      className="rounded border-[var(--color-border-subtle)]"
                    />
                    <span>{t('aiConfig.removeProviderDeleteVar', { varName: storedVarName })}</span>
                  </label>
                )}
              </span>
            }
            warning={affectedText}
            confirmLabel={t('aiConfig.removeProvider')}
            cancelLabel={t('aiConfig.cancel')}
            disabled={removingProvider}
            onConfirm={handleConfirmRemoveProvider}
            onCancel={() => {
              setProviderToRemove(null);
              setDeleteStoredVarOnRemove(false);
            }}
          />
        );
      })()}

      {/* Diálogo para confirmar eliminación de modelo */}
      {modelToRemove && (
        <DangerConfirmDialog
          open={Boolean(modelToRemove)}
          title={t('aiConfig.removeModelTitle', { model: modelToRemove.modelId })}
          message={t('aiConfig.removeModelMessage', {
            model: modelToRemove.modelId,
            provider: modelToRemove.providerId,
          })}
          confirmLabel={t('aiConfig.removeModel')}
          cancelLabel={t('aiConfig.cancel')}
          disabled={removingModel}
          onConfirm={handleConfirmRemoveModel}
          onCancel={() => setModelToRemove(null)}
        />
      )}
    </div>
  );

  function renderProviderCard(provider: AiConfigProviderInfo) {
    const isExpanded = Boolean(expandedProviders[provider.id]);
    const modelsData = providerModelsData[provider.id];
    const isAddingModel = addModelProviderId === provider.id;

    const hasKey = provider.envVars.some((v) => v.status === 'stored' || v.status === 'system');
    const isMissingKey = provider.envVars.some((v) => v.status === 'missing');

    // Punto de disponibilidad
    let dotColor = 'bg-[var(--color-text-secondary)]/40';
    if (provider.available) {
      dotColor = isMissingKey ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-git-add)]';
    } else if (isMissingKey) {
      dotColor = 'bg-[var(--color-warning)]';
    }

    return (
      <div
        key={provider.id}
        data-testid={`provider-row-${provider.id}`}
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] overflow-hidden"
      >
        {/* Cabecera cerrada accesible */}
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`provider-content-${provider.id}`}
          onClick={() => toggleProvider(provider.id)}
          className="w-full text-left p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-border-subtle)]/20 transition-colors select-none"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[var(--color-text-primary)]">
                  {provider.name || provider.id}
                </span>
                <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono">
                  ({provider.id})
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {renderDestinationBadge(provider)}
                <span className="text-[var(--color-text-secondary)] opacity-40">·</span>
                <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                  {hasKey ? t('aiConfig.keyConfigured') : t('aiConfig.keyMissing')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ChevronRight
              className={cn(
                'w-4 h-4 text-[var(--color-text-secondary)] transition-transform duration-200 ease-out transform motion-reduce:transition-none',
                isExpanded && 'rotate-90',
              )}
            />
          </div>
        </button>

        {/* Desplegado del proveedor */}
        {isExpanded && (
          <div id={`provider-content-${provider.id}`} className="p-4 border-t border-[var(--color-border-subtle)] space-y-4 bg-[var(--color-bg-surface)]">
            {/* Dirección base */}
            {provider.baseURL && (
              <div className="text-xs text-[var(--color-text-secondary)] font-mono">
                {t('aiConfig.providerAddress', { url: provider.baseURL })}
              </div>
            )}

            {/* Formulario de clave */}
            <div className="space-y-1.5 p-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
              <div className="flex items-center justify-between">
                <label className="font-medium text-xs text-[var(--color-text-secondary)] flex items-center gap-1.5">
                  <Key size={12} />
                  <span>{t('aiConfig.providerApiKey')}</span>
                </label>
                <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono">
                  {hasKey ? t('aiConfig.envVarStored') : t('aiConfig.envVarMissing')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={keyDrafts[provider.id] ?? ''}
                  onChange={(e) =>
                    setKeyDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))
                  }
                  placeholder={
                    hasKey
                      ? t('aiConfig.keyPlaceholderSet')
                      : t('aiConfig.keyPlaceholderMissing')
                  }
                  disabled={isFileBroken || savingKey[provider.id]}
                  className="flex-1 px-2.5 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)] disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => handleSaveKey(provider)}
                  disabled={isFileBroken || !keyDrafts[provider.id]?.trim() || savingKey[provider.id]}
                  className="px-2.5 py-1 rounded border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {savingKey[provider.id] ? t('aiConfig.saving') : t('aiConfig.saveKey')}
                </button>
                {hasKey && (
                  <button
                    type="button"
                    onClick={() => handleRemoveKey(provider)}
                    disabled={isFileBroken || savingKey[provider.id]}
                    className="px-2.5 py-1 rounded border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 text-xs disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {t('aiConfig.removeKey')}
                  </button>
                )}
              </div>
            </div>

            {/* Modelos del proveedor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[var(--color-text-secondary)] uppercase tracking-wide">
                  {t('aiConfig.models')}
                </span>
                <button
                  ref={(el) => {
                    addModelBtnRefs.current[provider.id] = el;
                  }}
                  type="button"
                  onClick={() => setAddModelErrorProviderId(provider.id)}
                  disabled={isFileBroken || isAddingModel}
                  className="px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:bg-[var(--color-border-subtle)]/20 text-xs text-[var(--color-text-primary)] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <Plus size={12} />
                  <span>{t('aiConfig.addModel')}</span>
                </button>
              </div>

              {/* Tarjeta inline "+ Agregar modelo" (sin modal) */}
              {isAddingModel && (
                <form
                  data-testid="add-model-inline-card"
                  onSubmit={(e) => handleAddModelSubmit(provider.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelAddModel(provider.id);
                    }
                  }}
                  className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] space-y-2.5 font-mono shadow-sm"
                >
                  <div className="flex items-center justify-between font-sans">
                    <span className="font-bold text-xs text-[var(--color-text-primary)]">
                      {t('aiConfig.addModelTitle', { provider: provider.name || provider.id })}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelAddModel(provider.id)}
                      className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                        {t('aiConfig.modelId')} *
                      </label>
                      <input
                        ref={firstModelInputRef}
                        type="text"
                        required
                        value={newModelId}
                        onChange={(e) => setNewModelId(e.target.value)}
                        placeholder={t('aiConfig.modelIdPlaceholder')}
                        className="w-full px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[var(--color-text-secondary)] mb-1 font-sans">
                        {t('aiConfig.modelName')}
                      </label>
                      <input
                        type="text"
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        placeholder={t('aiConfig.modelNamePlaceholder')}
                        className="w-full px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)] font-sans">
                    <button
                      type="button"
                      onClick={() => handleCancelAddModel(provider.id)}
                      className="px-2.5 py-1 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-border-subtle)]/20 text-xs text-[var(--color-text-secondary)] cursor-pointer"
                    >
                      {t('aiConfig.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={addingModel || !newModelId.trim()}
                      className="px-2.5 py-1 rounded border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {addingModel ? t('aiConfig.saving') : t('aiConfig.save')}
                    </button>
                  </div>
                </form>
              )}

              {/* Lista de modelos */}
              {modelsData?.loading ? (
                <div className="p-3 text-center text-xs text-[var(--color-text-secondary)] font-mono">
                  <RefreshCw size={13} className="inline mr-2 animate-spin" />
                  {t('aiConfig.loadingCatalog')}
                </div>
              ) : modelsData?.models && modelsData.models.length > 0 ? (
                <div className="space-y-2">
                  {modelsData.models.map((model) => {
                    const settingKey = `${provider.id}:${model.id}`;
                    const draft = loadSettingsDrafts[settingKey];
                    return (
                      <div
                        key={model.id}
                        className="p-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[var(--color-text-primary)]">
                              {model.name || model.id}
                            </span>
                            <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono">
                              ({model.id})
                            </span>
                            {model.declared && (
                              <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">
                                {t('aiConfig.modelDeclared')}
                              </span>
                            )}
                            {model.reported && (
                              <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-[var(--color-git-add)]/10 text-[var(--color-git-add)] border border-[var(--color-git-add)]/20">
                                {t('aiConfig.modelReported')}
                              </span>
                            )}
                          </div>

                          {model.declared && (
                            <button
                              type="button"
                              onClick={() => setModelToRemove({ providerId: provider.id, modelId: model.id })}
                              disabled={isFileBroken}
                              className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] p-1 transition-colors disabled:opacity-40 cursor-pointer"
                              title={t('aiConfig.removeModel')}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Ajustes de carga del modelo */}
                        {modelsData.canLoad && (
                          <div className="pt-2 border-t border-[var(--color-border-subtle)] flex flex-wrap items-center gap-3 text-[length:var(--font-size-2xs)]">
                            <div className="flex items-center gap-1.5">
                              <label className="text-[var(--color-text-secondary)]">
                                {t('aiConfig.contextLength')}:
                              </label>
                              <input
                                type="number"
                                min={512}
                                step={512}
                                value={draft?.contextLength ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  setLoadSettingsDrafts((prev) => ({
                                    ...prev,
                                    [settingKey]: { ...prev[settingKey], contextLength: val },
                                  }));
                                }}
                                placeholder={t('aiConfig.contextLengthPlaceholder')}
                                className="w-24 px-2 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] font-mono text-[length:var(--font-size-2xs)]"
                              />
                            </div>

                            <div className="flex items-center gap-1.5">
                              <label className="text-[var(--color-text-secondary)]">
                                {t('aiConfig.loadTtl')}:
                              </label>
                              <input
                                type="number"
                                min={-1}
                                step={1}
                                value={draft?.ttlMinutes ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  setLoadSettingsDrafts((prev) => ({
                                    ...prev,
                                    [settingKey]: { ...prev[settingKey], ttlMinutes: val },
                                  }));
                                }}
                                placeholder={t('aiConfig.loadTtlPlaceholder')}
                                className="w-24 px-2 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] font-mono text-[length:var(--font-size-2xs)]"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSaveModelLoadSettings(provider.id, model.id)}
                              disabled={savingLoadSettings[settingKey]}
                              className="px-2 py-0.5 rounded bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 border border-[var(--color-border-subtle)] text-[length:var(--font-size-2xs)] font-medium cursor-pointer"
                            >
                              {savingLoadSettings[settingKey] ? t('aiConfig.saving') : t('aiConfig.save')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-secondary)] italic">
                  {t('aiConfig.noModels')}
                </p>
              )}
            </div>

            {/* Quitar proveedor */}
            <div className="pt-2 border-t border-[var(--color-border-subtle)] flex justify-end">
              <button
                type="button"
                onClick={() => setProviderToRemove(provider)}
                disabled={isFileBroken}
                className="px-2.5 py-1 rounded border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 text-xs flex items-center gap-1.5 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Trash2 size={12} />
                <span>{t('aiConfig.removeProvider')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderCliProviderCard(provider: AiConfigProviderInfo) {
    const isExpanded = Boolean(expandedProviders[provider.id]);
    const dotColor = provider.available ? 'bg-[var(--color-git-add)]' : 'bg-[var(--color-text-secondary)]/40';

    return (
      <div
        key={provider.id}
        data-testid={`provider-row-${provider.id}`}
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] overflow-hidden"
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`provider-content-${provider.id}`}
          onClick={() => toggleProvider(provider.id)}
          className="w-full text-left p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-border-subtle)]/20 transition-colors select-none"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[var(--color-text-primary)]">
                  {provider.name || provider.id}
                </span>
                <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono">
                  (CLI)
                </span>
              </div>
              <div className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] font-mono mt-0.5">
                {provider.available ? t('aiConfig.providerAvailable') : t('aiConfig.providerUnavailable')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ChevronRight
              className={cn(
                'w-4 h-4 text-[var(--color-text-secondary)] transition-transform duration-200 ease-out transform motion-reduce:transition-none',
                isExpanded && 'rotate-90',
              )}
            />
          </div>
        </button>

        {isExpanded && (
          <div id={`provider-content-${provider.id}`} className="p-4 border-t border-[var(--color-border-subtle)] space-y-2 bg-[var(--color-bg-surface)] text-xs">
            <p className="text-[var(--color-text-secondary)]">
              {provider.available
                ? t('aiConfig.providerAvailable')
                : t('aiConfig.providerUnavailable')}
            </p>
          </div>
        )}
      </div>
    );
  }
}
