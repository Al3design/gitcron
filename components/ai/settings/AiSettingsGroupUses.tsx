'use client';

// components/ai/settings/AiSettingsGroupUses.tsx
//
// Grupo 1: «Qué modelo usa cada cosa» (elección general, rápida y los 5 usos, incluido el agente de SDD).
// Cada fila es desplegable: cerrado muestra lo esencial y desplegado parámetros, opciones avanzadas
// y el selector AiModelPicker embebido directamente en la fila del uso con scrollIntoView({ block: 'nearest' }).

import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, Sliders, X, Plus } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { AiModelPicker } from '../AiModelPicker';
import { AiUseLine } from '../AiUseLine';
import type { AiConfigProviderInfo, AiConfigStatusResult, AiConfigUseInfo } from '@/types/ai-config';
import type { AiUse } from '@/types/ai-use';

export interface AiSettingsGroupUsesProps {
  status: AiConfigStatusResult | null;
  repoPath?: string | null;
  isFileBroken: boolean;
  onReload: () => Promise<void>;
  onError: (err: string | null) => void;
}

export function formatClosedUseSummary(
  useInfo: AiConfigUseInfo,
  providers: AiConfigProviderInfo[] = [],
  fallbackText: string,
): string {
  if (!useInfo.model) {
    return fallbackText;
  }

  let providerName: string | null = null;
  let modelName = useInfo.model;

  if (useInfo.model.includes('/')) {
    const slashIdx = useInfo.model.indexOf('/');
    const provId = useInfo.model.slice(0, slashIdx);
    modelName = useInfo.model.slice(slashIdx + 1);
    const found = providers.find((p) => p.id === provId);
    providerName = found?.name ?? provId;
  } else {
    const found = providers.find((p) => p.declaredModels?.includes(useInfo.model!));
    if (found) {
      providerName = found.name;
    }
  }

  const level = useInfo.effort || useInfo.variant;
  const parts = [providerName, modelName, level].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : useInfo.model;
}

export function getUseLabelKey(use: AiUse): string {
  switch (use) {
    case 'gitcron-commit':
      return 'aiConfig.useCommit';
    case 'gitcron-cartography':
      return 'aiConfig.useCarto';
    case 'gitcron-openspec-analysis':
      return 'aiConfig.useOpenspec';
    case 'gitcron-temporal':
      return 'aiConfig.useTemporal';
    case 'gitcron-sdd':
      return 'aiConfig.useSdd';
    default:
      return 'aiConfig.useGeneralModelBadge';
  }
}

export function AiSettingsGroupUses({
  status,
  repoPath = null,
  isFileBroken,
  onReload,
  onError,
}: AiSettingsGroupUsesProps) {
  const t = useT();

  // Filas expandidas (por omisión ninguna o la general)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  // Selector de modelo activo (id de fila: 'general' o uso)
  const [activePickerTarget, setActivePickerTarget] = useState<AiUse | 'general' | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Borradores de parámetros de uso (temperature, max_tokens, advanced)
  const [useParamDrafts, setUseParamDrafts] = useState<Record<string, {
    temperature?: string;
    maxTokens?: string;
    newKey?: string;
    newValue?: string;
  }>>({});

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const openPicker = (target: AiUse | 'general') => {
    // Asegurar que la fila esté expandida
    setExpandedRows((prev) => ({ ...prev, [target]: true }));
    setActivePickerTarget(target);
  };

  useEffect(() => {
    if (activePickerTarget && pickerRef.current) {
      pickerRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activePickerTarget]);

  const handleClearUseException = async (use: AiUse) => {
    onError(null);
    try {
      const res = await window.api?.aiConfig?.clearUseException({ use, repoPath });
      if (res?.success) {
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleSetUseParam = async (use: AiUse, param: string, value: unknown) => {
    onError(null);
    try {
      const res = await window.api?.aiConfig?.setUseParam({ use, param, value, repoPath });
      if (res?.success) {
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleRemoveUseParam = async (use: AiUse, param: string) => {
    onError(null);
    try {
      const res = await window.api?.aiConfig?.removeUseParam({ use, param, repoPath });
      if (res?.success) {
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleAddAdvancedOption = async (use: AiUse) => {
    const draft = useParamDrafts[use];
    const key = draft?.newKey?.trim();
    if (!key) return;

    let parsedVal: unknown = draft?.newValue?.trim() ?? '';
    try {
      parsedVal = JSON.parse(draft?.newValue ?? '');
    } catch {
      // Si no es JSON válido, dejar como texto
    }

    await handleSetUseParam(use, key, parsedVal);
    setUseParamDrafts((prev) => ({
      ...prev,
      [use]: { ...prev[use], newKey: '', newValue: '' },
    }));
  };

  const uses = status?.uses ?? [];
  const isGeneralExpanded = Boolean(expandedRows['general']);

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* 1. Elección general (model) */}
      <div
        data-testid="use-row-general"
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] overflow-hidden"
      >
        <button
          type="button"
          aria-expanded={isGeneralExpanded}
          aria-controls="use-content-general"
          onClick={() => toggleRow('general')}
          className="w-full text-left p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-border-subtle)]/20 transition-colors select-none"
        >
          <div className="min-w-0">
            <span className="font-bold text-sm text-[var(--color-text-primary)] block mb-0.5">
              {t('aiConfig.generalModel')}
            </span>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[var(--color-text-secondary)]">
                {status?.generalModel || (
                  <span className="italic opacity-60">{t('aiConfig.noModelConfigured')}</span>
                )}
              </span>
              <span className="px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">
                {t('aiConfig.useGeneralModelBadge')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                'w-4 h-4 text-[var(--color-text-secondary)] transition-transform duration-200 ease-out transform motion-reduce:transition-none',
                isGeneralExpanded && 'rotate-90',
              )}
            />
          </div>
        </button>

        {/* Desplegado de elección general */}
        {isGeneralExpanded && (
          <div id="use-content-general" className="p-3 border-t border-[var(--color-border-subtle)] space-y-3 bg-[var(--color-bg-surface)]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-secondary)]">
                {status?.generalModel ? `model = ${status.generalModel}` : t('aiConfig.noModelConfigured')}
              </span>
              <button
                type="button"
                onClick={() => openPicker('general')}
                disabled={isFileBroken}
                className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold transition-colors disabled:opacity-40 cursor-pointer"
              >
                {t('aiConfig.chooseModel')}
              </button>
            </div>

            {/* small_model si está presente en el archivo */}
            {status?.smallModel && (
              <div className="pt-2 border-t border-[var(--color-border-subtle)] flex items-center justify-between text-xs">
                <div>
                  <span className="text-[var(--color-text-secondary)] font-medium block">
                    {t('aiConfig.smallModel')}:{' '}
                    <code className="font-mono text-[var(--color-text-primary)]">{status.smallModel}</code>
                  </span>
                  <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]/70 italic">
                    {t('aiConfig.smallModelNote')}
                  </span>
                </div>
              </div>
            )}

            {/* Selector de modelo embebido debajo de la fila */}
            {activePickerTarget === 'general' && (
              <div ref={pickerRef} className="pt-2">
                <AiModelPicker
                  use="general"
                  repoPath={repoPath}
                  onClose={() => setActivePickerTarget(null)}
                  onSaved={() => {
                    setActivePickerTarget(null);
                    void onReload();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Lista de usos de texto (incluido SDD) */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          {t('aiConfig.textUses')}
        </div>

        {uses.map((useInfo) => {
          const use = useInfo.use;
          const labelKey = getUseLabelKey(use);
          const draft = useParamDrafts[use] ?? {};
          const isExpanded = Boolean(expandedRows[use]);
          const isPickerActive = activePickerTarget === use;

          // Modelo en etiqueta para el estado cerrado (proveedor · modelo · nivel)
          const modelTag = formatClosedUseSummary(
            useInfo,
            status?.providers ?? [],
            t('aiConfig.noModelConfigured'),
          );

          return (
            <div
              key={use}
              data-testid={`use-row-${use}`}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] overflow-hidden"
            >
              {/* Fila cerrada accesible */}
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={`use-content-${use}`}
                onClick={() => toggleRow(use)}
                className="w-full text-left p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-border-subtle)]/20 transition-colors select-none"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-[var(--color-text-primary)]">
                      {t(labelKey)}
                    </span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold border',
                        useInfo.modelSource === 'agent'
                          ? 'bg-[var(--color-ai)]/15 text-[var(--color-ai)] border-[var(--color-ai)]/30'
                          : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]',
                      )}
                    >
                      {/* «Excepción» se aparta de una general que existe; con modelo propio y sin
                          general no hay de qué apartarse, pero tampoco «sigue la general»
                          (lo encontró la prueba e2e del 2026-10-06 con un perfil nuevo). */}
                      {useInfo.isException
                        ? t('aiConfig.useExceptionBadge')
                        : useInfo.modelSource === 'agent'
                          ? t('aiConfig.useOwnModelBadge')
                          : t('aiConfig.useGeneralModelBadge')}
                    </span>
                  </div>

                  <div className="text-xs font-mono text-[var(--color-text-secondary)] truncate">
                    {modelTag}
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

              {/* Fila desplegada con todas sus opciones */}
              {isExpanded && (
                <div id={`use-content-${use}`} className="p-3 border-t border-[var(--color-border-subtle)] space-y-4 bg-[var(--color-bg-surface)]">
                  {/* Línea del uso en vivo */}
                  <div>
                    <AiUseLine use={use} repoPath={repoPath} />
                  </div>

                  {/* Acciones de modelo para el uso */}
                  <div className="flex items-center gap-2">
                    {useInfo.isException && (
                      <button
                        type="button"
                        onClick={() => void handleClearUseException(use)}
                        disabled={isFileBroken}
                        className="px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        {t('aiConfig.clearException')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openPicker(use)}
                      disabled={isFileBroken}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      {t('aiConfig.chooseModel')}
                    </button>
                  </div>

                  {/* Parámetros de uso (Temperature, Max tokens) */}
                  <div className="pt-3 border-t border-[var(--color-border-subtle)] space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-[var(--color-text-secondary)] font-medium">
                          {t('aiConfig.temperature')}:
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={
                            draft.temperature ??
                            (useInfo.temperature !== undefined ? String(useInfo.temperature) : '')
                          }
                          onChange={(e) =>
                            setUseParamDrafts((prev) => ({
                              ...prev,
                              [use]: { ...draft, temperature: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            if (draft.temperature !== undefined) {
                              const val = parseFloat(draft.temperature);
                              if (!isNaN(val)) void handleSetUseParam(use, 'temperature', val);
                            }
                          }}
                          placeholder="0.7"
                          disabled={isFileBroken}
                          className="w-16 px-2 py-1 rounded border bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)] disabled:opacity-40"
                        />
                        {useInfo.temperature !== undefined && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveUseParam(use, 'temperature')}
                            disabled={isFileBroken}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] p-1 disabled:opacity-40 cursor-pointer"
                            title={t('aiConfig.removeOption')}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-[var(--color-text-secondary)] font-medium">
                          {t('aiConfig.maxTokens')}:
                        </label>
                        <input
                          type="number"
                          min={1}
                          step={128}
                          value={
                            draft.maxTokens ??
                            (useInfo.maxTokens !== undefined ? String(useInfo.maxTokens) : '')
                          }
                          onChange={(e) =>
                            setUseParamDrafts((prev) => ({
                              ...prev,
                              [use]: { ...draft, maxTokens: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            if (draft.maxTokens !== undefined) {
                              const val = parseInt(draft.maxTokens, 10);
                              if (!isNaN(val)) void handleSetUseParam(use, 'max_tokens', val);
                            }
                          }}
                          placeholder="4096"
                          disabled={isFileBroken}
                          className="w-20 px-2 py-1 rounded border bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] font-mono text-xs focus:outline-none focus:border-[var(--color-ai)] disabled:opacity-40"
                        />
                        {useInfo.maxTokens !== undefined && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveUseParam(use, 'max_tokens')}
                            disabled={isFileBroken}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] p-1 disabled:opacity-40 cursor-pointer"
                            title={t('aiConfig.removeOption')}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Opciones avanzadas */}
                    <div className="space-y-2 pt-2 border-t border-[var(--color-border-subtle)]">
                      <span className="text-[length:var(--font-size-2xs)] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider block">
                        {t('aiConfig.advancedOptions')}
                      </span>

                      {useInfo.advancedOptions.map((opt) => (
                        <div
                          key={opt.key}
                          className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] font-mono text-xs"
                        >
                          <div>
                            <span className="font-bold text-[var(--color-text-primary)] mr-2">
                              {opt.key}:
                            </span>
                            <span className="text-[var(--color-text-secondary)] select-all">
                              {JSON.stringify(opt.value)}
                            </span>
                            {opt.warning && (
                              <span className="text-[var(--color-warning)] text-[length:var(--font-size-2xs)] block mt-0.5">
                                {opt.warning}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveUseParam(use, opt.key)}
                            disabled={isFileBroken}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] p-1 transition-colors disabled:opacity-40 cursor-pointer"
                            title={t('aiConfig.removeOption')}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}

                      {/* Agregar opción avanzada */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={draft.newKey ?? ''}
                          onChange={(e) =>
                            setUseParamDrafts((prev) => ({
                              ...prev,
                              [use]: { ...draft, newKey: e.target.value },
                            }))
                          }
                          placeholder={t('aiConfig.optionKeyPlaceholder')}
                          disabled={isFileBroken}
                          className="px-2 py-1 rounded border bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] font-mono text-xs w-36 focus:outline-none focus:border-[var(--color-ai)] disabled:opacity-40"
                        />
                        <input
                          type="text"
                          value={draft.newValue ?? ''}
                          onChange={(e) =>
                            setUseParamDrafts((prev) => ({
                              ...prev,
                              [use]: { ...draft, newValue: e.target.value },
                            }))
                          }
                          placeholder={t('aiConfig.optionValuePlaceholder')}
                          disabled={isFileBroken}
                          className="px-2 py-1 rounded border bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] font-mono text-xs w-44 focus:outline-none focus:border-[var(--color-ai)] disabled:opacity-40"
                        />
                        <button
                          type="button"
                          onClick={() => void handleAddAdvancedOption(use)}
                          disabled={isFileBroken || !draft.newKey?.trim()}
                          className="px-2.5 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-primary)] text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={11} />
                          <span>{t('aiConfig.addOption')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Selector AiModelPicker embebido directamente en la fila del uso */}
                  {isPickerActive && (
                    <div ref={pickerRef} className="pt-2">
                      <AiModelPicker
                        use={use}
                        repoPath={repoPath}
                        onClose={() => setActivePickerTarget(null)}
                        onSaved={() => {
                          setActivePickerTarget(null);
                          void onReload();
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
