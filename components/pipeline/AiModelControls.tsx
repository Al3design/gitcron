'use client';

import React, { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-translation';
import {
  MIN_CONTEXT_LENGTH,
  filterDraftableModels,
  type LocalModel,
} from '@/types/commit-message-ai';
import {
  useRememberedAiSettings,
  rememberAiSettings,
  formatAiDeviceLabel,
} from '@/lib/ai-model-memory';
import { useGitStore } from '@/lib/git-store';
import { AiElapsed } from './AiElapsed';
import styles from './OpenSpecDashboard.module.css';

export function EjectIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 4.5 3.5 15.5h17z" />
      <rect x="3.5" y="17.5" width="17" height="2.5" rx="0.6" />
    </svg>
  );
}

export interface AiModelControlsProps {
  repoPath?: string | null;
  models?: LocalModel[];
  deviceNames?: Record<string, string>;
  onModelsChange?: (models: LocalModel[]) => void;
  actions?: React.ReactNode;
  busy?: boolean;
  phase?: 'idle' | 'loading' | 'drafting' | 'queued';
  startedAt?: number | null;
  opKind?: 'load' | 'draft' | 'eject';
  notice?: string | null;
  queueRunningRepoPath?: string | null;
  onNoticeChange?: (notice: string | null) => void;
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
  elapsedNode?: React.ReactNode;
  className?: string;
  showLoadButton?: boolean;
}

export function AiModelControls({
  repoPath,
  models: externalModels,
  deviceNames: externalDeviceNames,
  onModelsChange,
  actions,
  busy: externalBusy,
  phase: externalPhase,
  startedAt: externalStartedAt,
  opKind: externalOpKind,
  notice: externalNotice,
  queueRunningRepoPath,
  onNoticeChange,
  onLoad,
  onUnload,
  elapsedNode,
  className,
  showLoadButton = true,
}: AiModelControlsProps) {
  const t = useT();
  const settings = useRememberedAiSettings(repoPath);
  const aiModel = settings.model;

  const [internalModels, setInternalModels] = useState<LocalModel[]>([]);
  const [internalDeviceNames, setInternalDeviceNames] = useState<Record<string, string>>({});
  const [internalBusy, setInternalBusy] = useState(false);
  const [internalPhase, setInternalPhase] = useState<'idle' | 'loading' | 'drafting' | 'queued'>('idle');
  const [internalStartedAt, setInternalStartedAt] = useState<number | null>(null);
  const [internalOpKind, setInternalOpKind] = useState<'load' | 'draft' | 'eject'>('load');
  const [internalNotice, setInternalNotice] = useState<string | null>(null);

  const models = externalModels ?? internalModels;
  const deviceNames = externalDeviceNames ?? internalDeviceNames;
  const busy = externalBusy ?? internalBusy;
  const phase = externalPhase ?? internalPhase;
  const startedAt = externalStartedAt ?? internalStartedAt;
  const opKind = externalOpKind ?? internalOpKind;
  const notice = externalNotice !== undefined ? externalNotice : internalNotice;

  useEffect(() => {
    if (externalModels !== undefined) return;
    let alive = true;
    if (typeof window !== 'undefined' && window.api?.commitAi?.catalog) {
      window.api.commitAi
        .catalog()
        .then((result) => {
          if (!alive) return;
          const disponibles = filterDraftableModels(result?.data ?? []);
          setInternalModels(disponibles);
          onModelsChange?.(disponibles);
          if (aiModel && !disponibles.some((m) => m.id === aiModel)) {
            rememberAiSettings(repoPath, { model: '' });
          }
        })
        .catch(() => {
          if (alive) setInternalModels([]);
        });
    }
    if (typeof window !== 'undefined' && window.api?.commitAi?.deviceNames) {
      window.api.commitAi
        .deviceNames()
        .then((result) => {
          if (alive && result?.data) setInternalDeviceNames(result.data);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [externalModels, repoPath, aiModel, onModelsChange]);

  const chosenModel = models.find((m) => m.id === aiModel);
  const aiNeedsLoad = Boolean(
    chosenModel &&
      !chosenModel.loaded &&
      !(chosenModel.loaded && (chosenModel.loadedContextLength ?? 0) >= MIN_CONTEXT_LENGTH),
  );

  const aiLoadBlocker = ((): string | null => {
    if (!aiModel) return null;
    if (settings.contextLength < MIN_CONTEXT_LENGTH) {
      return t('pipeline.openspec.prepare.aiContextTooLow', { minimum: MIN_CONTEXT_LENGTH });
    }
    if (settings.ttlMinutes < 1) return t('pipeline.openspec.prepare.aiTtlTooLow');
    return null;
  })();

  const setNotice = (msg: string | null) => {
    if (onNoticeChange) onNoticeChange(msg);
    else setInternalNotice(msg);
  };

  const handleDefaultLoad = async () => {
    if (busy || !aiModel || settings.contextLength < MIN_CONTEXT_LENGTH || settings.ttlMinutes < 1) return;
    if (onLoad) {
      await onLoad();
      return;
    }
    setInternalBusy(true);
    setInternalPhase('loading');
    setInternalOpKind('load');
    setInternalStartedAt(Date.now());
    setNotice(null);
    try {
      const result = await window.api?.commitAi?.load?.(
        aiModel,
        undefined,
        settings.contextLength,
        settings.ttlMinutes * 60,
      );
      if (!result?.success) {
        setNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }));
        return;
      }
      const catalog = await window.api?.commitAi?.catalog?.();
      const disponibles = filterDraftableModels(catalog?.data ?? []);
      setInternalModels(disponibles);
      onModelsChange?.(disponibles);
      const cargado = disponibles.find((m) => m.id === aiModel);
      setNotice(
        cargado?.loaded
          ? t('pipeline.openspec.prepare.aiLoadedOk', {
              model: aiModel,
              context: cargado.loadedContextLength ?? settings.contextLength,
            })
          : t('pipeline.openspec.prepare.aiLoadedUnconfirmed', { model: aiModel }),
      );
    } finally {
      setInternalBusy(false);
      setInternalPhase('idle');
    }
  };

  const handleDefaultUnload = async () => {
    if (busy || !aiModel) return;
    if (onUnload) {
      await onUnload();
      return;
    }
    setInternalBusy(true);
    setInternalPhase('loading');
    setInternalOpKind('eject');
    setInternalStartedAt(Date.now());
    setNotice(null);
    try {
      const previo = await window.api?.commitAi?.catalog?.();
      const antes = filterDraftableModels(previo?.data ?? []);
      setInternalModels(antes);
      onModelsChange?.(antes);
      const vigente = antes.find((m) => m.id === aiModel);
      if (!vigente?.loaded) {
        setNotice(t('pipeline.openspec.prepare.aiAlreadyEjected', { model: aiModel }));
        return;
      }
      const result = await window.api?.commitAi?.unload?.(aiModel);
      if (!result?.success) {
        setNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }));
        return;
      }
      const catalog = await window.api?.commitAi?.catalog?.();
      const despues = filterDraftableModels(catalog?.data ?? []);
      setInternalModels(despues);
      onModelsChange?.(despues);
      setNotice(t('pipeline.openspec.prepare.aiEjectedOk', { model: aiModel }));
    } finally {
      setInternalBusy(false);
      setInternalPhase('idle');
    }
  };

  const deviceLabel = chosenModel ? formatAiDeviceLabel(chosenModel.devices, deviceNames, t) : null;

  return (
    <section className={className ?? styles.aiPanel}>
      <div className={styles.aiRow}>
        <select
          value={aiModel}
          disabled={busy || models.length === 0}
          aria-label={t('pipeline.openspec.prepare.aiModel')}
          onChange={(e) => rememberAiSettings(repoPath, { model: e.target.value })}
        >
          <option value="">
            {models.length === 0
              ? t('pipeline.openspec.prepare.aiNoModels')
              : t('pipeline.openspec.prepare.aiChoose')}
          </option>
          {models.map((m) => {
            const dev = formatAiDeviceLabel(m.devices, deviceNames, t);
            return (
              <option key={m.id} value={m.id}>
                {m.loaded
                  ? `${m.id} · ${m.loadedContextLength ?? '?'}`
                  : `${m.id} · ${t('pipeline.openspec.prepare.aiNotLoaded')}`}
                {dev && ` · ${dev}`}
              </option>
            );
          })}
        </select>

        {aiNeedsLoad && showLoadButton && (
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={busy || !aiModel}
            aria-disabled={aiLoadBlocker !== null}
            title={aiLoadBlocker ?? undefined}
            onClick={handleDefaultLoad}
          >
            {phase === 'loading'
              ? t('pipeline.openspec.prepare.aiLoading')
              : t('pipeline.openspec.prepare.aiLoad')}
          </button>
        )}

        {actions}

        {chosenModel?.loaded && (
          <button
            type="button"
            className={styles.aiIconAction}
            disabled={busy}
            aria-label={t('pipeline.openspec.prepare.aiEject')}
            title={t('pipeline.openspec.prepare.aiEject')}
            onClick={handleDefaultUnload}
          >
            <EjectIcon />
          </button>
        )}

        <label
          className={styles.aiNumber}
          title={aiNeedsLoad ? undefined : t('pipeline.openspec.prepare.aiFixedAtLoad')}
        >
          <span>{t('pipeline.openspec.prepare.aiContextLabel')}</span>
          <input
            type="number"
            min={MIN_CONTEXT_LENGTH}
            step={8192}
            value={
              chosenModel?.loaded
                ? (chosenModel.loadedContextLength ?? settings.contextLength)
                : settings.contextLength
            }
            disabled={busy || !aiNeedsLoad}
            onChange={(e) =>
              rememberAiSettings(repoPath, { contextLength: Number(e.target.value) || 0 })
            }
          />
        </label>

        <label
          className={styles.aiNumber}
          title={aiNeedsLoad ? undefined : t('pipeline.openspec.prepare.aiFixedAtLoad')}
        >
          <span>{t('pipeline.openspec.prepare.aiTtlLabel')}</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.ttlMinutes}
            disabled={busy || !aiNeedsLoad}
            onChange={(e) =>
              rememberAiSettings(repoPath, { ttlMinutes: Number(e.target.value) || 0 })
            }
          />
        </label>

        {chosenModel && phase === 'idle' && (
          <span className={styles.aiModelState} data-loaded={chosenModel.loaded}>
            {chosenModel.loaded
              ? t('pipeline.openspec.prepare.aiStateLoaded')
              : t('pipeline.openspec.prepare.aiStateOnDisk')}
          </span>
        )}

        {elapsedNode ?? (
          <AiElapsed
            key={startedAt ?? 'idle'}
            phase={phase}
            startedAt={startedAt}
            kind={opKind === 'eject' ? 'eject' : 'load'}
            queueRunningRepoName={
              queueRunningRepoPath
                ? (useGitStore.getState().openRepos.find((r) => r.path === queueRunningRepoPath)?.name ??
                   queueRunningRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? queueRunningRepoPath)
                : null
            }
          />
        )}
      </div>

      {aiNeedsLoad && aiLoadBlocker && (
        <p className={styles.aiBlocker}>{aiLoadBlocker}</p>
      )}

      {notice && <p className={styles.aiNotice}>{notice}</p>}

      {chosenModel && (
        <ul className={styles.aiFacts}>
          <li>
            <span>{t('pipeline.openspec.prepare.aiFactState')}</span>
            <strong>
              {chosenModel.loaded
                ? t('pipeline.openspec.prepare.aiFactLoaded', {
                    context: chosenModel.loadedContextLength ?? '?',
                  })
                : t('pipeline.openspec.prepare.aiFactOnDisk', {
                    context: settings.contextLength,
                    minutes: settings.ttlMinutes,
                  })}
            </strong>
          </li>
          {deviceLabel && (
            <li>
              <span>{t('pipeline.openspec.prepare.aiFactDevice')}</span>
              <strong>{deviceLabel}</strong>
            </li>
          )}
          {chosenModel.sizeBytes !== null && (
            <li>
              <span>{t('pipeline.openspec.prepare.aiFactSize')}</span>
              <strong>{(chosenModel.sizeBytes / 1024 ** 3).toFixed(2)} GiB</strong>
            </li>
          )}
          {chosenModel.params && (
            <li>
              <span>{t('pipeline.openspec.prepare.aiFactParams')}</span>
              <strong>
                {chosenModel.params}
                {chosenModel.quantization ? ` · ${chosenModel.quantization}` : ''}
              </strong>
            </li>
          )}
          {chosenModel.maxContextLength !== null && (
            <li>
              <span>{t('pipeline.openspec.prepare.aiFactMaxContext')}</span>
              <strong>{chosenModel.maxContextLength}</strong>
            </li>
          )}
          {chosenModel.reasoningDefault && (
            <li>
              <span>{t('pipeline.openspec.prepare.aiFactReasoning')}</span>
              <strong>
                {chosenModel.reasoningDefault === 'on'
                  ? t('pipeline.openspec.prepare.aiFactReasons')
                  : t('pipeline.openspec.prepare.aiFactNoReasons')}
              </strong>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export default AiModelControls;
