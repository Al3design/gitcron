'use client';

// components/ai/settings/AiSettingsGroupOpenCode.tsx
//
// Grupo 4: «Importar desde OpenCode» (tarea 5.2 / D12).
// Trae proveedores y agentes declarados en opencode.json al archivo global gitcron.json.
// Una clave escrita a mano no llega a la pantalla: va al baúl al importar.

import React, { useState } from 'react';
import { Download, RefreshCw, X, AlertCircle, Key } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type {
  AiImportFieldChange,
  AiImportSourceInfo,
  AiImportTargetInfo,
  AiImportVariable,
  AiOpenCodeImportPlanResult,
} from '@/types/ai-config';

export interface AiSettingsGroupOpenCodeProps {
  onReload: () => Promise<void>;
  onError: (err: string | null) => void;
  onSuccess: (msg: string | null) => void;
}

export function AiSettingsGroupOpenCode({
  onReload,
  onError,
  onSuccess,
}: AiSettingsGroupOpenCodeProps) {
  const t = useT();

  const [openCodePlan, setOpenCodePlan] = useState<AiOpenCodeImportPlanResult | null>(null);
  const [loadingOpenCodePlan, setLoadingOpenCodePlan] = useState(false);
  const [openCodeSelected, setOpenCodeSelected] = useState<Record<string, boolean>>({});
  const [applyingOpenCode, setApplyingOpenCode] = useState(false);

  // Claves para variables que se cargan antes de importar
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});

  const loadOpenCodePlan = async (keepSelection = false) => {
    setLoadingOpenCodePlan(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.planOpenCodeImport();
      if (res?.success && res.data) {
        const entries = res.data.entries;
        setOpenCodePlan(res.data);
        setOpenCodeSelected((prev) => {
          const sel: Record<string, boolean> = {};
          for (const entry of entries) {
            const key = `${entry.kind}:${entry.id}`;
            sel[key] = keepSelection && key in prev ? prev[key] : entry.status !== 'same';
          }
          return sel;
        });
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setLoadingOpenCodePlan(false);
    }
  };

  const handleApplyOpenCodeImport = async () => {
    if (!openCodePlan) return;
    setApplyingOpenCode(true);
    onError(null);
    try {
      const entries = openCodePlan.entries
        .filter((entry) => openCodeSelected[`${entry.kind}:${entry.id}`])
        .map((entry) => ({ kind: entry.kind, id: entry.id }));
      const res = await window.api?.aiConfig?.applyOpenCodeImport({ entries });
      if (res?.success && res.data) {
        onSuccess(t('aiConfig.importSuccess', { count: res.data.count }));
        setOpenCodePlan(null);
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setApplyingOpenCode(false);
    }
  };

  const handleSaveKey = async (varName: string) => {
    const key = keyDrafts[varName]?.trim();
    if (!key) return;

    setSavingKey((prev) => ({ ...prev, [varName]: true }));
    onError(null);
    try {
      const res = await window.api?.ai?.setEnvVar(varName, key);
      if (res?.success) {
        setKeyDrafts((prev) => {
          const next = { ...prev };
          delete next[varName];
          return next;
        });
        onSuccess(t('aiConfig.keySavedNotice'));
        setTimeout(() => onSuccess(null), 3000);
        await loadOpenCodePlan(true);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingKey((prev) => ({ ...prev, [varName]: false }));
    }
  };

  function renderImportStatusBadge(status: 'new' | 'same' | 'changed') {
    return (
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold border uppercase tracking-wider',
          status === 'new' && 'bg-[var(--color-git-add)]/15 text-[var(--color-git-add)] border-[var(--color-git-add)]/30',
          status === 'changed' && 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/30',
          status === 'same' && 'bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]',
        )}
      >
        {status === 'new' && t('aiConfig.importPlanStatusNew')}
        {status === 'changed' && t('aiConfig.importPlanStatusChanged')}
        {status === 'same' && t('aiConfig.importPlanStatusSame')}
      </span>
    );
  }

  function renderImportProblem(plan: { source: AiImportSourceInfo; target: AiImportTargetInfo }) {
    const { source, target } = plan;
    let message: string | null = null;
    if (source.status === 'absent') {
      message = t('aiConfig.importSourceNotFound', { path: source.path });
    } else if (source.status === 'invalid') {
      message = t('aiConfig.importSourceInvalid', {
        path: source.path,
        line: source.error?.line ?? 0,
      });
    } else if (target.error) {
      message = t('aiConfig.importTargetBroken');
    }
    if (!message) return null;
    return (
      <div className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-2 text-xs text-[var(--color-warning)] flex items-center gap-2">
        <AlertCircle size={13} className="shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  function renderChangeValue(change: AiImportFieldChange, side: 'before' | 'after') {
    if (side === 'before' ? change.beforeHidden : change.afterHidden) {
      return t('aiConfig.importSecretInFile');
    }
    const value = side === 'before' ? change.before : change.after;
    if (value === undefined) return '—';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function renderEnvVarRow(v: { name: string; status: AiImportVariable['status'] }) {
    const isSaving = Boolean(savingKey[v.name]);
    const draft = keyDrafts[v.name] ?? '';

    return (
      <div
        key={v.name}
        className="flex flex-wrap items-center justify-between gap-2 text-xs bg-[var(--color-bg-surface)] p-2.5 rounded border border-[var(--color-border-subtle)]"
      >
        <div className="flex items-center gap-2">
          <Key size={13} className="text-[var(--color-text-secondary)]" />
          <code className="font-mono text-[var(--color-text-primary)]">{`{env:${v.name}}`}</code>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold',
              (v.status === 'stored' || v.status === 'fromFile') && 'bg-[var(--color-ai)]/15 text-[var(--color-ai)]',
              v.status === 'system' && 'bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)]',
              v.status === 'missing' && 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
            )}
          >
            {v.status === 'stored' && t('aiConfig.envVarStored')}
            {v.status === 'system' && t('aiConfig.envVarSystem')}
            {v.status === 'missing' && t('aiConfig.envVarMissing')}
            {v.status === 'fromFile' && t('aiConfig.importVarFromFile')}
          </span>
        </div>

        {v.status !== 'fromFile' && (
          <div className="flex items-center gap-2 flex-1 justify-end min-w-[260px]">
            <input
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(e) => setKeyDrafts({ ...keyDrafts, [v.name]: e.target.value })}
              placeholder={v.status !== 'missing' ? t('aiConfig.keyPlaceholderSet') : t('aiConfig.keyPlaceholderMissing')}
              className="px-2.5 py-1 rounded border bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] text-xs text-[var(--color-text-primary)] w-44 focus:outline-none focus:border-[var(--color-ai)]"
            />
            <button
              type="button"
              onClick={() => handleSaveKey(v.name)}
              disabled={isSaving || !draft.trim()}
              className="px-2.5 py-1 rounded border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs disabled:opacity-40 transition-colors cursor-pointer"
            >
              {isSaving ? t('aiConfig.saving') : t('aiConfig.saveKey')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans text-xs">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-text-secondary)]">
          {t('aiConfig.importOpenCodeDesc')}
        </p>
        {!openCodePlan && (
          <button
            type="button"
            onClick={() => void loadOpenCodePlan()}
            disabled={loadingOpenCodePlan}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {loadingOpenCodePlan ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            <span>{t('aiConfig.importOpenCodeCheck')}</span>
          </button>
        )}
      </div>

      {openCodePlan && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-4 space-y-4">
          <div className="flex items-center justify-between text-xs pb-3 border-b border-[var(--color-border-subtle)]">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {t('aiConfig.importOpenCode')} ({openCodePlan.entries.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const sel: Record<string, boolean> = {};
                  for (const e of openCodePlan.entries) sel[`${e.kind}:${e.id}`] = true;
                  setOpenCodeSelected(sel);
                }}
                className="text-xs text-[var(--color-ai)] hover:underline cursor-pointer"
              >
                {t('aiConfig.importSelectAll')}
              </button>
              <span className="text-[var(--color-border-subtle)]">|</span>
              <button
                type="button"
                onClick={() => setOpenCodeSelected({})}
                className="text-xs text-[var(--color-text-secondary)] hover:underline cursor-pointer"
              >
                {t('aiConfig.importDeselectAll')}
              </button>
              <button
                type="button"
                onClick={() => setOpenCodePlan(null)}
                aria-label={t('aiConfig.cancel')}
                title={t('aiConfig.cancel')}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] ml-2 p-1 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {renderImportProblem(openCodePlan)}

          {openCodePlan.source.status === 'ok' && !openCodePlan.target.error && (
            openCodePlan.entries.length === 0 ? (
              <p className="text-xs text-[var(--color-text-secondary)] italic">
                {t('aiConfig.importNoEntries')}
              </p>
            ) : (
              <div className="space-y-3">
                {openCodePlan.entries.map((entry) => {
                  const key = `${entry.kind}:${entry.id}`;
                  const isChecked = Boolean(openCodeSelected[key]);
                  return (
                    <div
                      key={key}
                      className={cn(
                        'p-3 rounded-lg border text-xs space-y-2 transition-colors',
                        isChecked
                          ? 'border-[var(--color-ai)]/40 bg-[var(--color-bg-surface)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] opacity-70',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--color-text-primary)]">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setOpenCodeSelected((prev) => ({ ...prev, [key]: e.target.checked }))
                            }
                            className="rounded border-[var(--color-border-subtle)] accent-[color:var(--color-ai)]"
                          />
                          <span className="font-mono">{entry.kind}: {entry.id}</span>
                        </label>
                        {renderImportStatusBadge(entry.status)}
                      </div>

                      {entry.changes.length > 0 && (
                        <div className="pl-6 pt-1 space-y-1 text-[var(--color-text-secondary)]">
                          <span className="font-semibold text-[length:var(--font-size-2xs)] block text-[var(--color-text-primary)]">
                            {t('aiConfig.importChangesHeading')}
                          </span>
                          {entry.changes.map((ch, idx) => (
                            <div key={idx} className="font-mono text-[length:var(--font-size-2xs)] break-all">
                              <span className="text-[var(--color-ai)]">{ch.segments.join('.')}:</span>{' '}
                              <span className="line-through opacity-70">{renderChangeValue(ch, 'before')}</span>{' '}
                              &rarr;{' '}
                              <span className="text-[var(--color-git-add)]">{renderChangeValue(ch, 'after')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {entry.variables.length > 0 && (
                        <div className="pl-6 pt-1 space-y-1.5">
                          <span className="font-semibold text-[length:var(--font-size-2xs)] block text-[var(--color-text-primary)]">
                            {t('aiConfig.importVariables')}
                          </span>
                          {entry.variables.map((v) => renderEnvVarRow(v))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setOpenCodePlan(null)}
              className="px-3 py-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs cursor-pointer"
            >
              {t('aiConfig.cancel')}
            </button>
            <button
              type="button"
              onClick={handleApplyOpenCodeImport}
              disabled={
                applyingOpenCode ||
                Boolean(openCodePlan.target.error) ||
                !openCodePlan.entries.some((e) => openCodeSelected[`${e.kind}:${e.id}`])
              }
              className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              {applyingOpenCode ? t('aiConfig.importing') : t('aiConfig.importExecute')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
