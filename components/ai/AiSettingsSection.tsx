'use client';

// components/ai/AiSettingsSection.tsx
// Sección de ajustes «Motores y modelos» (tarea 6.1 de modelos-en-casa).
// Configura proveedores, claves, modelos, elección general y los 4 usos de texto
// desde la pantalla sin abrir gitcron.json, con escritura puntual (D3) y baúl seguro (D5).

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Cpu, Server, Key, Plus, Trash2, ExternalLink, FolderOpen,
  AlertCircle, CheckCircle2, RefreshCw, X, ShieldAlert, Sliders,
  ChevronDown, ChevronRight, Terminal, Lock
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { AiModelPicker } from './AiModelPicker';
import { AiUseLine } from './AiUseLine';
import {
  formatConfigParseError,
  lastValidNotices,
  configWarningLines,
} from '@/lib/gitcron-config-messages';
import type {
  AiConfigStatusResult,
  AiConfigFileInfo,
  AiConfigProviderInfo,
  AiConfigUseInfo,
} from '@/types/ai-config';
import type { AiTextUse } from '@/types/ai-use';

interface Props {
  repoPath?: string | null;
}

interface ProviderModelDetail {
  id: string;
  name?: string;
  declared: boolean;
  reported: boolean;
  contextLength?: number;
  ttlMinutes?: number;
}

export function AiSettingsSection({ repoPath = null }: Props) {
  const t = useT();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AiConfigStatusResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Claves en borrador (se vacían inmediatamente al guardar/cancelar, NUNCA se guardan en el estado largo)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});

  // Modelos expandidos por proveedor
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [providerModelsData, setProviderModelsData] = useState<Record<string, {
    loading: boolean;
    models: ProviderModelDetail[];
    canLoad: boolean;
  }>>({});

  // Ajustes de carga en borrador por proveedor:modelo
  const [loadSettingsDrafts, setLoadSettingsDrafts] = useState<Record<string, { contextLength?: number; ttlMinutes?: number }>>({});
  const [savingLoadSettings, setSavingLoadSettings] = useState<Record<string, boolean>>({});

  // Modal para agregar proveedor
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
  const [newProviderId, setNewProviderId] = useState('');
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderBaseURL, setNewProviderBaseURL] = useState('');
  const [newProviderApiKey, setNewProviderApiKey] = useState('');
  const [addingProvider, setAddingProvider] = useState(false);

  // Diálogo para quitar proveedor
  const [providerToRemove, setProviderToRemove] = useState<AiConfigProviderInfo | null>(null);
  const [deleteStoredVarOnRemove, setDeleteStoredVarOnRemove] = useState(false);
  const [removingProvider, setRemovingProvider] = useState(false);

  // Diálogo para quitar modelo
  const [modelToRemove, setModelToRemove] = useState<{ providerId: string; modelId: string } | null>(null);
  const [removingModel, setRemovingModel] = useState(false);

  // Modal para agregar modelo manual
  const [addModelProviderId, setAddModelErrorProviderId] = useState<string | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  // Picker de modelo activo
  const [pickerTarget, setPickerTarget] = useState<AiTextUse | 'general' | null>(null);

  // Borradores de parámetros de uso (temperature, max_tokens, advanced)
  const [useParamDrafts, setUseParamDrafts] = useState<Record<string, {
    temperature?: string;
    maxTokens?: string;
    newKey?: string;
    newValue?: string;
  }>>({});

  const reload = useCallback(async () => {
    try {
      const api = window.api?.aiConfig;
      if (!api) return;
      const res = await api.status({ repoPath });
      if (res?.success && res.data) {
        setStatus(res.data);
        setLoadError(null);
      } else {
        setLoadError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setLoadError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [repoPath, t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void reload();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // Si algún archivo está roto, se deshabilitan las ediciones desde la pantalla
  const isFileBroken = useMemo(() => {
    return status?.files?.some((f) => Boolean(f.error)) ?? false;
  }, [status?.files]);

  const loadProviderModels = useCallback(async (providerId: string) => {
    setProviderModelsData((prev) => ({
      ...prev,
      [providerId]: { loading: true, models: [], canLoad: false },
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

        setProviderModelsData((prev) => ({
          ...prev,
          [providerId]: {
            loading: false,
            models: Array.from(modelMap.values()),
            canLoad,
          },
        }));
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
  }, [repoPath]);

  const toggleProviderExpand = (providerId: string) => {
    const next = !expandedProviders[providerId];
    setExpandedProviders((prev) => ({ ...prev, [providerId]: next }));
    if (next && !providerModelsData[providerId]) {
      void loadProviderModels(providerId);
    }
  };

  const handleOpenFile = async (file: AiConfigFileInfo) => {
    try {
      const res = await window.api?.aiConfig?.openFile({ filePath: file.path, repoPath });
      if (!res?.success) {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleShowInFolder = async (file: AiConfigFileInfo) => {
    try {
      const res = await window.api?.aiConfig?.showInFolder({ filePath: file.path, repoPath });
      if (!res?.success) {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleSaveKey = async (varName: string) => {
    const raw = keyDrafts[varName]?.trim();
    if (!raw) return;
    setSavingKey((prev) => ({ ...prev, [varName]: true }));
    setActionError(null);
    try {
      const res = await window.api?.ai?.setEnvVar(varName, raw);
      // NUNCA retener el valor secreto en el estado
      setKeyDrafts((prev) => {
        const next = { ...prev };
        delete next[varName];
        return next;
      });
      if (res?.success) {
        setSuccessNotice(t('aiConfig.keySavedNotice'));
        setTimeout(() => setSuccessNotice(null), 3000);
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingKey((prev) => ({ ...prev, [varName]: false }));
    }
  };

  const handleRemoveKey = async (varName: string) => {
    setActionError(null);
    try {
      const res = await window.api?.ai?.removeEnvVar(varName);
      if (res?.success) {
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleAddProviderSubmit = async () => {
    const id = newProviderId.trim().toLowerCase();
    const name = newProviderName.trim() || id;
    const baseURL = newProviderBaseURL.trim();
    const apiKey = newProviderApiKey.trim();

    if (!id || !baseURL) return;
    setAddingProvider(true);
    setActionError(null);

    try {
      const res = await window.api?.aiConfig?.addProvider({
        id,
        name,
        baseURL,
        apiKey: apiKey || undefined,
        repoPath,
      });

      // Limpiar borrador de clave
      setNewProviderApiKey('');

      if (res?.success) {
        setIsAddProviderOpen(false);
        setNewProviderId('');
        setNewProviderName('');
        setNewProviderBaseURL('');
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setAddingProvider(false);
    }
  };

  const handleConfirmRemoveProvider = async () => {
    if (!providerToRemove) return;
    setRemovingProvider(true);
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.removeProvider({
        id: providerToRemove.id,
        repoPath,
        deleteStoredVar: deleteStoredVarOnRemove,
      });
      if (res?.success) {
        setProviderToRemove(null);
        setDeleteStoredVarOnRemove(false);
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setRemovingProvider(false);
    }
  };

  const handleAddModelSubmit = async (providerId: string) => {
    const modelId = newModelId.trim();
    const name = newModelName.trim() || undefined;
    if (!modelId) return;

    setAddingModel(true);
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.addModel({
        providerId,
        modelId,
        name,
        repoPath,
      });
      if (res?.success) {
        setAddModelErrorProviderId(null);
        setNewModelId('');
        setNewModelName('');
        await reload();
        await loadProviderModels(providerId);
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setAddingModel(false);
    }
  };

  const handleConfirmRemoveModel = async () => {
    if (!modelToRemove) return;
    setRemovingModel(true);
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.removeModel({
        providerId: modelToRemove.providerId,
        modelId: modelToRemove.modelId,
        repoPath,
      });
      if (res?.success) {
        const pId = modelToRemove.providerId;
        setModelToRemove(null);
        await reload();
        await loadProviderModels(pId);
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setRemovingModel(false);
    }
  };

  const handleSaveModelLoadSettings = async (providerId: string, modelId: string) => {
    const key = `${providerId}:${modelId}`;
    const draft = loadSettingsDrafts[key];
    if (!draft) return;

    setSavingLoadSettings((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.setModelLoadSettings({
        providerId,
        modelId,
        contextLength: draft.contextLength,
        ttlMinutes: draft.ttlMinutes,
        repoPath,
      });
      if (res?.success) {
        setSuccessNotice(t('aiConfig.saved'));
        setTimeout(() => setSuccessNotice(null), 3000);
        await reload();
        await loadProviderModels(providerId);
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingLoadSettings((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleClearUseException = async (use: AiTextUse) => {
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.clearUseException({ use, repoPath });
      if (res?.success) {
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleSetUseParam = async (use: AiTextUse, param: string, value: unknown) => {
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.setUseParam({ use, param, value, repoPath });
      if (res?.success) {
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleRemoveUseParam = async (use: AiTextUse, param: string) => {
    setActionError(null);
    try {
      const res = await window.api?.aiConfig?.removeUseParam({ use, param, repoPath });
      if (res?.success) {
        await reload();
      } else {
        setActionError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      setActionError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleAddAdvancedOption = async (use: AiTextUse) => {
    const draft = useParamDrafts[use];
    const key = draft?.newKey?.trim();
    if (!key) return;

    let parsedVal: unknown = draft?.newValue?.trim() ?? '';
    try {
      parsedVal = JSON.parse(draft?.newValue ?? '');
    } catch {
      // Si no es JSON válido, dejar como string
    }

    await handleSetUseParam(use, key, parsedVal);
    setUseParamDrafts((prev) => ({
      ...prev,
      [use]: { ...prev[use], newKey: '', newValue: '' },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary">
        <RefreshCw size={18} className="animate-spin text-secondary mr-2" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
        <div className="flex items-center gap-2 font-bold mb-1">
          <AlertCircle size={16} />
          <span>{t('aiConfig.error', { detail: loadError })}</span>
        </div>
      </div>
    );
  }

  const files = status?.files ?? [];
  const providers = status?.providers ?? [];
  const uses = status?.uses ?? [];

  const providersByFamily = {
    'openai-compatible': providers.filter((p) => p.family === 'openai-compatible'),
    anthropic: providers.filter((p) => p.family === 'anthropic'),
    cli: providers.filter((p) => p.family === 'cli'),
  };

  const brokenFile = files.find((f) => f.error);

  return (
    <div className="space-y-6 text-text-primary">
      {/* Encabezado y aviso de éxito / error */}
      <div>
        <h3 className="text-base font-bold flex items-center gap-2 mb-1">
          <Cpu size={18} className="text-[color:var(--color-ai)]" />
          <span>{t('settings.aiModels')}</span>
        </h3>
        <p className="text-xs text-text-secondary leading-relaxed">
          {t('settings.aiModelsDesc')}
        </p>
      </div>

      {actionError && (
        <div className="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error flex items-start gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1">{actionError}</div>
          <button onClick={() => setActionError(null)} className="text-error hover:opacity-80">
            <X size={14} />
          </button>
        </div>
      )}

      {successNotice && (
        <div className="rounded-lg border border-secondary/40 bg-secondary/10 p-3 text-xs text-secondary flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Banner de archivo roto (D3) */}
      {brokenFile && (
        <div className="rounded-lg border border-error/50 bg-error/15 p-4 text-xs space-y-1 text-error">
          <div className="flex items-center gap-2 font-bold">
            <ShieldAlert size={16} />
            <span>
              {brokenFile.error
                ? formatConfigParseError(brokenFile.error, t)
                : t('aiConfig.fileBrokenNoLine', { reason: 'Error de sintaxis' })}
            </span>
          </div>
          <p className="text-text-secondary leading-relaxed">
            {brokenFile.error
              ? t('aiConfig.fileBroken', { line: brokenFile.error.line, reason: brokenFile.error.code })
              : t('aiConfig.fileBrokenNoLine', { reason: 'Error' })}
          </p>
        </div>
      )}

      {/* Avisos de última versión válida y advertencias de esquema */}
      {lastValidNotices(files as any, t).map((notice, idx) => (
        <div key={idx} className="rounded border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{notice}</span>
        </div>
      ))}

      {configWarningLines(status?.warnings as any, t).map((warn, idx) => (
        <div key={idx} className="rounded border border-warning/30 bg-warning/5 p-2 text-xs text-text-secondary flex items-center gap-2">
          <AlertCircle size={13} className="text-warning shrink-0" />
          <span>{warn}</span>
        </div>
      ))}

      {/* ─── 1. Archivos de configuración en uso ─── */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
          <FolderOpen size={13} />
          <span>{t('aiConfig.filesInUse')}</span>
        </h4>
        <div className="grid gap-2">
          {files.map((file) => (
            <div
              key={file.path}
              className="rounded-lg border border-border-subtle/15 bg-bg-base/70 p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold uppercase',
                    file.scope === 'repo'
                      ? 'bg-secondary/15 text-secondary'
                      : 'bg-bg-surface text-text-secondary'
                  )}>
                    {file.scope === 'repo' ? t('aiConfig.scopeRepo') : t('aiConfig.scopeGlobal')}
                  </span>
                  {!file.exists && (
                    <span className="text-[length:var(--font-size-2xs)] text-text-secondary/70 italic">
                      ({t('aiConfig.fileNotFound')})
                    </span>
                  )}
                  {file.error && (
                    <span className="text-[length:var(--font-size-2xs)] text-error font-bold flex items-center gap-1">
                      <AlertCircle size={11} />
                      Línea {file.error.line}
                    </span>
                  )}
                </div>
                <p className="font-mono text-[length:var(--font-size-2xs)] text-text-secondary select-all truncate" title={file.path}>
                  {file.path}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenFile(file)}
                  className="px-2.5 py-1.5 rounded border border-border-subtle/20 bg-bg-surface hover:bg-border-subtle/30 text-text-primary text-xs flex items-center gap-1.5 transition-colors font-medium"
                  title={t('aiConfig.openFile')}
                >
                  <ExternalLink size={12} />
                  <span>{t('aiConfig.openFile')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleShowInFolder(file)}
                  className="px-2.5 py-1.5 rounded border border-border-subtle/20 bg-bg-surface hover:bg-border-subtle/30 text-text-secondary hover:text-text-primary text-xs flex items-center gap-1.5 transition-colors font-medium"
                  title={t('aiConfig.showInFolder')}
                >
                  <FolderOpen size={12} />
                  <span>{t('aiConfig.showInFolder')}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 2. Proveedores agrupados por familia ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
            <Server size={13} />
            <span>{t('aiConfig.providers')}</span>
          </h4>
          <button
            type="button"
            onClick={() => setIsAddProviderOpen(true)}
            disabled={isFileBroken}
            className="px-3 py-1.5 rounded-lg border border-secondary/40 bg-secondary/15 hover:bg-secondary/25 text-secondary text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={13} />
            <span>{t('aiConfig.addProvider')}</span>
          </button>
        </div>

        {/* Familia 1: OpenAI-compatible */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-text-secondary/80 uppercase tracking-wide">
            {t('aiConfig.familyOpenAi')}
          </div>
          {providersByFamily['openai-compatible'].length === 0 ? (
            <div className="rounded-lg border border-border-subtle/10 bg-bg-base/30 p-3 text-xs text-text-secondary/70 italic">
              {t('aiConfig.noProviders')}
            </div>
          ) : (
            providersByFamily['openai-compatible'].map((provider) => renderProviderCard(provider))
          )}
        </div>

        {/* Familia 2: Anthropic */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-text-secondary/80 uppercase tracking-wide">
            {t('aiConfig.familyAnthropic')}
          </div>
          {providersByFamily.anthropic.length === 0 ? (
            <div className="rounded-lg border border-border-subtle/10 bg-bg-base/30 p-3 text-xs text-text-secondary/70 italic">
              {t('aiConfig.noProviders')}
            </div>
          ) : (
            providersByFamily.anthropic.map((provider) => renderProviderCard(provider))
          )}
        </div>

        {/* Familia 3: CLI de suscripción */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-text-secondary/80 uppercase tracking-wide">
            {t('aiConfig.familyCli')}
          </div>
          {providersByFamily.cli.map((provider) => renderCliProviderCard(provider))}
        </div>
      </section>

      {/* ─── 3. Elección general y usos ─── */}
      <section className="space-y-4 pt-2 border-t border-border-subtle/15">
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
          <Sliders size={13} />
          <span>{t('aiConfig.generalSection')}</span>
        </h4>

        {/* Modelo general */}
        <div className="rounded-lg border border-border-subtle/15 bg-bg-base/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-text-primary block mb-0.5">
                {t('aiConfig.generalModel')}
              </span>
              <p className="text-xs text-text-secondary font-mono">
                {status?.generalModel || <span className="italic text-text-secondary/60">No configurado</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPickerTarget('general')}
              disabled={isFileBroken}
              className="px-3 py-1.5 rounded-lg border border-secondary/40 bg-secondary/15 hover:bg-secondary/25 text-secondary text-xs font-bold transition-colors disabled:opacity-40"
            >
              {t('aiConfig.chooseModel')}
            </button>
          </div>

          {/* small_model si está presente en el archivo */}
          {status?.smallModel && (
            <div className="pt-2 border-t border-border-subtle/10 flex items-center justify-between text-xs">
              <div>
                <span className="text-text-secondary/90 font-medium block">
                  {t('aiConfig.smallModel')}: <code className="font-mono text-text-primary">{status.smallModel}</code>
                </span>
                <span className="text-[length:var(--font-size-2xs)] text-text-secondary/60 italic">
                  {t('aiConfig.smallModelNote')}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Los 4 usos de texto */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-text-secondary/80 uppercase tracking-wide">
            {t('aiConfig.textUses')}
          </div>
          {uses.map((useInfo) => renderUseCard(useInfo))}
        </div>
      </section>

      {/* Modal: Agregar Proveedor OpenAI */}
      {isAddProviderOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4" onClick={() => setIsAddProviderOpen(false)}>
          <div className="glass-overlay rounded-xl shadow-2xl p-6 w-[500px] max-w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-primary text-sm flex items-center gap-2">
                <Server size={16} className="text-secondary" />
                <span>{t('aiConfig.addProviderTitle')}</span>
              </h3>
              <button onClick={() => setIsAddProviderOpen(false)} className="text-text-secondary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.providerId')}</label>
                <input
                  type="text"
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder={t('aiConfig.providerIdPlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary font-mono text-xs focus:outline-none focus:border-secondary"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.providerName')}</label>
                <input
                  type="text"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  placeholder={t('aiConfig.providerNamePlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary text-xs focus:outline-none focus:border-secondary"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.providerBaseURL')}</label>
                <input
                  type="text"
                  value={newProviderBaseURL}
                  onChange={(e) => setNewProviderBaseURL(e.target.value)}
                  placeholder={t('aiConfig.providerBaseURLPlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary font-mono text-xs focus:outline-none focus:border-secondary"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.providerApiKey')}</label>
                <input
                  type="password"
                  autoComplete="off"
                  value={newProviderApiKey}
                  onChange={(e) => setNewProviderApiKey(e.target.value)}
                  placeholder={t('aiConfig.providerApiKeyPlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary text-xs focus:outline-none focus:border-secondary"
                />
                <p className="text-[length:var(--font-size-2xs)] text-text-secondary/70 mt-1 italic">
                  {t('aiConfig.providerApiKeyHint')}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddProviderOpen(false)}
                className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary"
              >
                {t('aiConfig.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAddProviderSubmit}
                disabled={addingProvider || !newProviderId.trim() || !newProviderBaseURL.trim()}
                className="px-4 py-2 bg-secondary text-bg-surface font-bold text-xs rounded hover:bg-secondary/90 disabled:opacity-50"
              >
                {addingProvider ? t('aiConfig.saving') : t('aiConfig.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Agregar Modelo a Proveedor */}
      {addModelProviderId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4" onClick={() => setAddModelErrorProviderId(null)}>
          <div className="glass-overlay rounded-xl shadow-2xl p-6 w-[450px] max-w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-primary text-sm">
                {t('aiConfig.addModelTitle', { provider: addModelProviderId })}
              </h3>
              <button onClick={() => setAddModelErrorProviderId(null)} className="text-text-secondary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.modelId')}</label>
                <input
                  type="text"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value.trim())}
                  placeholder={t('aiConfig.modelIdPlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary font-mono text-xs focus:outline-none focus:border-secondary"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1 font-medium">{t('aiConfig.modelName')}</label>
                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder={t('aiConfig.modelNamePlaceholder')}
                  className="w-full px-3 py-2 rounded border bg-bg-base/70 border-border-subtle/30 text-text-primary text-xs focus:outline-none focus:border-secondary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddModelErrorProviderId(null)}
                className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary"
              >
                {t('aiConfig.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleAddModelSubmit(addModelProviderId)}
                disabled={addingModel || !newModelId.trim()}
                className="px-4 py-2 bg-secondary text-bg-surface font-bold text-xs rounded hover:bg-secondary/90 disabled:opacity-50"
              >
                {addingModel ? t('aiConfig.saving') : t('aiConfig.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de Confirmación: Quitar Proveedor */}
      {providerToRemove && (() => {
        const affected = uses.filter((u) => u.model?.startsWith(providerToRemove.id + '/'));
        const affectedText = affected.length > 0
          ? t('aiConfig.removeProviderWarningUses', { uses: affected.map((a) => t(getUseLabelKey(a.use))).join(', ') })
          : undefined;
        const hasStoredVar = providerToRemove.envVars.some((v) => v.status === 'stored');
        const storedVarName = providerToRemove.envVars.find((v) => v.status === 'stored')?.name ?? '';

        return (
          <DangerConfirmDialog
            open={Boolean(providerToRemove)}
            title={t('aiConfig.removeProviderTitle', { name: providerToRemove.name })}
            message={
              hasStoredVar ? (
                <span className="block space-y-2">
                  <span className="block">Se quitará la configuración de este proveedor de gitcron.json.</span>
                  <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-border-subtle/15 text-xs text-text-primary">
                    <input
                      type="checkbox"
                      checked={deleteStoredVarOnRemove}
                      onChange={(e) => setDeleteStoredVarOnRemove(e.target.checked)}
                      className="accent-secondary rounded"
                    />
                    <span>
                      {t('aiConfig.removeProviderDeleteVar', { varName: storedVarName })}
                    </span>
                  </label>
                </span>
              ) : (
                'Se quitará la configuración de este proveedor de gitcron.json.'
              )
            }
            warning={affectedText}
            confirmLabel={removingProvider ? t('aiConfig.saving') : t('aiConfig.removeProvider')}
            cancelLabel={t('aiConfig.cancel')}
            disabled={removingProvider}
            onCancel={() => setProviderToRemove(null)}
            onConfirm={handleConfirmRemoveProvider}
          />
        );
      })()}

      {/* Diálogo de Confirmación: Quitar Modelo */}
      {modelToRemove && (
        <DangerConfirmDialog
          open={Boolean(modelToRemove)}
          title={t('aiConfig.removeModelTitle', { model: modelToRemove.modelId })}
          message={t('aiConfig.removeModelMessage', { provider: modelToRemove.providerId })}
          confirmLabel={removingModel ? t('aiConfig.saving') : t('aiConfig.removeModel')}
          cancelLabel={t('aiConfig.cancel')}
          disabled={removingModel}
          onCancel={() => setModelToRemove(null)}
          onConfirm={handleConfirmRemoveModel}
        />
      )}

      {/* Picker de modelo compartido (AiModelPicker) */}
      {pickerTarget && (
        <AiModelPicker
          use={pickerTarget}
          repoPath={repoPath}
          onClose={() => setPickerTarget(null)}
          onSaved={() => {
            setPickerTarget(null);
            void reload();
          }}
          onChoose={pickerTarget === 'general' ? async ({ model, effort, variant }) => {
            // La elección general no lleva nivel ni variante (el selector no los ofrece).
            void effort;
            void variant;
            const res = await window.api?.aiConfig?.setGeneralModel({ model, repoPath });
            // Un fallo lo muestra el selector, que sigue abierto.
            if (!res?.success) throw new Error(res?.error ?? '—');
            setPickerTarget(null);
            void reload();
          } : undefined}
        />
      )}
    </div>
  );

  // ── Render Helpers ──

  function renderProviderCard(provider: AiConfigProviderInfo) {
    const isExpanded = Boolean(expandedProviders[provider.id]);
    const modelsState = providerModelsData[provider.id];

    return (
      <div
        key={provider.id}
        className="rounded-lg border border-border-subtle/15 bg-bg-base/70 p-4 space-y-3 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-sm text-text-primary">{provider.name}</span>
              <code className="text-[length:var(--font-size-2xs)] font-mono text-text-secondary bg-bg-surface px-1.5 py-0.5 rounded">
                {provider.id}
              </code>
              <span className={cn(
                'px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold',
                provider.available
                  ? 'bg-secondary/15 text-secondary'
                  : 'bg-error/15 text-error'
              )}>
                {provider.available ? t('aiConfig.providerAvailable') : t('aiConfig.providerUnavailable')}
              </span>
            </div>
            {provider.baseURL && (
              <p className="text-xs font-mono text-text-secondary select-all">
                {t('aiConfig.providerAddress', { url: provider.baseURL })}
              </p>
            )}
            {!provider.available && provider.unavailableReason && (
              <p className="text-xs text-error/80 italic mt-0.5">
                {provider.unavailableReason}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => toggleProviderExpand(provider.id)}
              className="px-2.5 py-1.5 rounded border border-border-subtle/20 bg-bg-surface hover:bg-border-subtle/30 text-text-secondary hover:text-text-primary text-xs flex items-center gap-1 transition-colors font-medium"
            >
              <span>{t('aiConfig.models')}</span>
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setProviderToRemove(provider)}
              disabled={isFileBroken}
              className="p-1.5 rounded text-text-secondary hover:text-error hover:bg-error/10 transition-colors disabled:opacity-40"
              title={t('aiConfig.removeProvider')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Variables de entorno y gestión de claves */}
        {provider.envVars.length > 0 && (
          <div className="pt-2 border-t border-border-subtle/10 space-y-2">
            {provider.envVars.map((v) => renderEnvVarRow(v))}
          </div>
        )}

        {/* Modelos expandidos */}
        {isExpanded && (
          <div className="pt-3 border-t border-border-subtle/15 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-text-secondary uppercase tracking-wider text-[length:var(--font-size-2xs)]">
                {t('aiConfig.models')}
              </span>
              <button
                type="button"
                onClick={() => setAddModelErrorProviderId(provider.id)}
                disabled={isFileBroken}
                className="px-2 py-1 rounded border border-border-subtle/30 bg-bg-surface text-secondary text-xs flex items-center gap-1 hover:bg-secondary/15 transition-colors disabled:opacity-40"
              >
                <Plus size={11} />
                <span>{t('aiConfig.addModel')}</span>
              </button>
            </div>

            {modelsState?.loading ? (
              <div className="text-xs text-text-secondary flex items-center gap-1.5 py-2">
                <RefreshCw size={12} className="animate-spin text-secondary" />
                <span>Cargando catálogo…</span>
              </div>
            ) : modelsState?.models && modelsState.models.length > 0 ? (
              <div className="grid gap-2">
                {modelsState.models.map((m) => renderModelItem(provider, m, modelsState.canLoad))}
              </div>
            ) : (
              <div className="text-xs text-text-secondary/70 italic py-1">
                {t('aiConfig.noModels')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderCliProviderCard(provider: AiConfigProviderInfo) {
    return (
      <div
        key={provider.id}
        className="rounded-lg border border-border-subtle/15 bg-bg-base/70 p-3.5 flex items-center justify-between gap-3 text-xs"
      >
        <div className="flex items-center gap-2.5">
          <Terminal size={15} className="text-text-secondary" />
          <span className="font-bold text-text-primary">{provider.name}</span>
          <code className="text-[length:var(--font-size-2xs)] font-mono text-text-secondary bg-bg-surface px-1.5 py-0.5 rounded">
            {provider.id}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold',
            provider.available
              ? 'bg-secondary/15 text-secondary'
              : 'bg-text-secondary/15 text-text-secondary'
          )}>
            {provider.available ? t('aiConfig.providerInstalled') : t('aiConfig.providerNotInstalled')}
          </span>
        </div>
      </div>
    );
  }

  function renderEnvVarRow(v: { name: string; isApiKey: boolean; status: 'system' | 'stored' | 'missing' }) {
    const isSaving = Boolean(savingKey[v.name]);
    const draft = keyDrafts[v.name] ?? '';

    return (
      <div key={v.name} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-bg-surface/50 p-2.5 rounded border border-border-subtle/10">
        <div className="flex items-center gap-2">
          <Key size={13} className="text-text-secondary" />
          <code className="font-mono text-text-primary">{`{env:${v.name}}`}</code>
          <span className={cn(
            'px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold',
            v.status === 'stored' && 'bg-secondary/15 text-secondary',
            v.status === 'system' && 'bg-border-subtle/20 text-text-secondary',
            v.status === 'missing' && 'bg-warning/15 text-warning',
          )}>
            {v.status === 'stored' && t('aiConfig.envVarStored')}
            {v.status === 'system' && t('aiConfig.envVarSystem')}
            {v.status === 'missing' && t('aiConfig.envVarMissing')}
          </span>
        </div>

        {/* Input de contraseña para la clave */}
        <div className="flex items-center gap-2 flex-1 justify-end min-w-[260px]">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setKeyDrafts({ ...keyDrafts, [v.name]: e.target.value })}
            placeholder={v.status !== 'missing' ? t('aiConfig.keyPlaceholderSet') : t('aiConfig.keyPlaceholderMissing')}
            className="px-2.5 py-1 rounded border bg-bg-base border-border-subtle/25 text-xs text-text-primary w-44 focus:outline-none focus:border-secondary"
          />
          <button
            type="button"
            onClick={() => handleSaveKey(v.name)}
            disabled={isSaving || !draft.trim()}
            className="px-2.5 py-1 rounded bg-secondary text-bg-surface font-bold text-xs hover:bg-secondary/90 disabled:opacity-40 transition-colors"
          >
            {isSaving ? t('aiConfig.saving') : t('aiConfig.saveKey')}
          </button>
          {v.status === 'stored' && (
            <button
              type="button"
              onClick={() => handleRemoveKey(v.name)}
              className="px-2.5 py-1 rounded border border-border-subtle/20 text-text-secondary hover:text-error text-xs transition-colors"
            >
              {t('aiConfig.removeKey')}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderModelItem(provider: AiConfigProviderInfo, m: ProviderModelDetail, canLoad: boolean) {
    const key = `${provider.id}:${m.id}`;
    const draft = loadSettingsDrafts[key] ?? {
      contextLength: m.contextLength ?? 4096,
      ttlMinutes: m.ttlMinutes ?? -1,
    };
    const isSavingLoad = Boolean(savingLoadSettings[key]);

    return (
      <div key={m.id} className="rounded border border-border-subtle/15 bg-bg-surface/30 p-2.5 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono font-bold text-text-primary block truncate">{m.id}</span>
            {m.name && <span className="text-[length:var(--font-size-2xs)] text-text-secondary">{m.name}</span>}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {m.declared && (
              <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-bg-surface text-text-secondary font-medium">
                {t('aiConfig.modelDeclared')}
              </span>
            )}
            {m.reported && !m.declared && (
              <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-secondary/10 text-secondary font-medium">
                {t('aiConfig.modelReported')}
              </span>
            )}

            {!m.declared && (
              <button
                type="button"
                onClick={() => {
                  void window.api?.aiConfig?.addModel({ providerId: provider.id, modelId: m.id, name: m.name, repoPath })
                    .then(() => {
                      void reload();
                      void loadProviderModels(provider.id);
                    });
                }}
                disabled={isFileBroken}
                className="px-2 py-0.5 rounded border border-secondary/30 bg-secondary/10 text-secondary text-xs hover:bg-secondary/20 font-bold disabled:opacity-40"
              >
                {t('aiConfig.addModel')}
              </button>
            )}

            {m.declared && (
              <button
                type="button"
                onClick={() => setModelToRemove({ providerId: provider.id, modelId: m.id })}
                disabled={isFileBroken}
                className="p-1 rounded text-text-secondary hover:text-error hover:bg-error/10 transition-colors disabled:opacity-40"
                title={t('aiConfig.removeModel')}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Capacidad de carga (LM Studio D6) */}
        {canLoad && m.declared && (
          <div className="pt-2 border-t border-border-subtle/10 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-text-secondary font-medium">{t('aiConfig.contextLength')}:</span>
              <input
                type="number"
                min={512}
                step={512}
                value={draft.contextLength ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setLoadSettingsDrafts((prev) => ({
                    ...prev,
                    [key]: { ...draft, contextLength: isNaN(val) ? undefined : val },
                  }));
                }}
                className="w-20 px-2 py-0.5 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-text-secondary font-medium">{t('aiConfig.loadTtl')}:</span>
              <input
                type="number"
                min={-1}
                value={draft.ttlMinutes ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setLoadSettingsDrafts((prev) => ({
                    ...prev,
                    [key]: { ...draft, ttlMinutes: isNaN(val) ? undefined : val },
                  }));
                }}
                className="w-16 px-2 py-0.5 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary"
              />
            </div>

            <button
              type="button"
              onClick={() => handleSaveModelLoadSettings(provider.id, m.id)}
              disabled={isSavingLoad || isFileBroken}
              className="px-2.5 py-0.5 rounded bg-secondary/15 border border-secondary/40 text-secondary hover:bg-secondary/25 text-xs font-bold transition-colors disabled:opacity-40"
            >
              {isSavingLoad ? t('aiConfig.saving') : t('aiConfig.saveLoadSettings')}
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderUseCard(useInfo: AiConfigUseInfo) {
    const use = useInfo.use;
    const labelKey = getUseLabelKey(use);
    const draft = useParamDrafts[use] ?? {};

    return (
      <div key={use} className="rounded-lg border border-border-subtle/15 bg-bg-base/70 p-4 space-y-3">
        {/* Cabecera del uso */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-text-primary">{t(labelKey)}</span>
              <span className={cn(
                'px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold',
                useInfo.isException
                  ? 'bg-secondary/15 text-secondary'
                  : 'bg-bg-surface text-text-secondary'
              )}>
                {useInfo.isException ? t('aiConfig.useExceptionBadge') : t('aiConfig.useGeneralModelBadge')}
              </span>
            </div>
            {/* Línea del uso en vivo */}
            <AiUseLine use={use} repoPath={repoPath} />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {useInfo.isException && (
              <button
                type="button"
                onClick={() => handleClearUseException(use)}
                disabled={isFileBroken}
                className="px-2.5 py-1.5 rounded border border-border-subtle/20 bg-bg-surface hover:bg-border-subtle/30 text-text-secondary hover:text-text-primary text-xs font-medium transition-colors disabled:opacity-40"
              >
                {t('aiConfig.clearException')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPickerTarget(use)}
              disabled={isFileBroken}
              className="px-3 py-1.5 rounded-lg border border-secondary/40 bg-secondary/15 hover:bg-secondary/25 text-secondary text-xs font-bold transition-colors disabled:opacity-40"
            >
              {t('aiConfig.chooseModel')}
            </button>
          </div>
        </div>

        {/* Parámetros del uso */}
        <div className="pt-3 border-t border-border-subtle/10 space-y-3 text-xs">
          {/* Temperature & Max tokens */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-text-secondary font-medium">{t('aiConfig.temperature')}:</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature ?? (useInfo.temperature !== undefined ? String(useInfo.temperature) : '')}
                onChange={(e) => setUseParamDrafts((prev) => ({
                  ...prev,
                  [use]: { ...draft, temperature: e.target.value },
                }))}
                onBlur={() => {
                  if (draft.temperature !== undefined) {
                    const val = parseFloat(draft.temperature);
                    if (!isNaN(val)) void handleSetUseParam(use, 'temperature', val);
                  }
                }}
                placeholder="0.7"
                disabled={isFileBroken}
                className="w-16 px-2 py-1 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary disabled:opacity-40"
              />
              {useInfo.temperature !== undefined && (
                <button
                  type="button"
                  onClick={() => handleRemoveUseParam(use, 'temperature')}
                  disabled={isFileBroken}
                  className="text-text-secondary hover:text-error p-1 disabled:opacity-40"
                  title={t('aiConfig.removeOption')}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-text-secondary font-medium">{t('aiConfig.maxTokens')}:</label>
              <input
                type="number"
                min={1}
                step={128}
                value={draft.maxTokens ?? (useInfo.maxTokens !== undefined ? String(useInfo.maxTokens) : '')}
                onChange={(e) => setUseParamDrafts((prev) => ({
                  ...prev,
                  [use]: { ...draft, maxTokens: e.target.value },
                }))}
                onBlur={() => {
                  if (draft.maxTokens !== undefined) {
                    const val = parseInt(draft.maxTokens, 10);
                    if (!isNaN(val)) void handleSetUseParam(use, 'max_tokens', val);
                  }
                }}
                placeholder="4096"
                disabled={isFileBroken}
                className="w-20 px-2 py-1 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary disabled:opacity-40"
              />
              {useInfo.maxTokens !== undefined && (
                <button
                  type="button"
                  onClick={() => handleRemoveUseParam(use, 'max_tokens')}
                  disabled={isFileBroken}
                  className="text-text-secondary hover:text-error p-1 disabled:opacity-40"
                  title={t('aiConfig.removeOption')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Opciones avanzadas (clave -> valor) */}
          <div className="space-y-2 pt-2 border-t border-border-subtle/10">
            <span className="text-[length:var(--font-size-2xs)] font-bold text-text-secondary uppercase tracking-wider block">
              {t('aiConfig.advancedOptions')}
            </span>

            {useInfo.advancedOptions.map((opt) => (
              <div key={opt.key} className="flex items-center justify-between gap-2 p-2 rounded bg-bg-surface/40 border border-border-subtle/10 font-mono text-xs">
                <div>
                  <span className="font-bold text-text-primary mr-2">{opt.key}:</span>
                  <span className="text-text-secondary select-all">{JSON.stringify(opt.value)}</span>
                  {opt.warning && (
                    <span className="text-warning text-[length:var(--font-size-2xs)] block mt-0.5">
                      {opt.warning}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveUseParam(use, opt.key)}
                  disabled={isFileBroken}
                  className="text-text-secondary hover:text-error p-1 transition-colors disabled:opacity-40"
                  title={t('aiConfig.removeOption')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Agregar opción avanzada */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={draft.newKey ?? ''}
                onChange={(e) => setUseParamDrafts((prev) => ({
                  ...prev,
                  [use]: { ...draft, newKey: e.target.value },
                }))}
                placeholder={t('aiConfig.optionKeyPlaceholder')}
                disabled={isFileBroken}
                className="w-32 px-2 py-1 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary disabled:opacity-40"
              />
              <input
                type="text"
                value={draft.newValue ?? ''}
                onChange={(e) => setUseParamDrafts((prev) => ({
                  ...prev,
                  [use]: { ...draft, newValue: e.target.value },
                }))}
                placeholder={t('aiConfig.optionValuePlaceholder')}
                disabled={isFileBroken}
                className="flex-1 px-2 py-1 rounded border bg-bg-base border-border-subtle/25 font-mono text-xs focus:outline-none focus:border-secondary disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => handleAddAdvancedOption(use)}
                disabled={isFileBroken || !draft.newKey?.trim()}
                className="px-2.5 py-1 rounded bg-secondary/15 border border-secondary/40 text-secondary hover:bg-secondary/25 font-bold text-xs transition-colors disabled:opacity-40"
              >
                {t('aiConfig.addOption')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function getUseLabelKey(use: AiTextUse): string {
  switch (use) {
    case 'gitcron-commit':
      return 'aiConfig.useCommit';
    case 'gitcron-cartography':
      return 'aiConfig.useCarto';
    case 'gitcron-openspec-analysis':
      return 'aiConfig.useOpenspec';
    case 'gitcron-temporal':
      return 'aiConfig.useTemporal';
    default:
      return use;
  }
}
