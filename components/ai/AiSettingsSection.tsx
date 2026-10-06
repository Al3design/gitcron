'use client';

// components/ai/AiSettingsSection.tsx
//
// Sección de ajustes «Motores y modelos» (tarea 6.1 de modelos-en-casa, tanda 24).
// Dividida en cabecera con píldora de estado y 5 grupos acordeón modulares:
// 1. Qué modelo usa cada cosa (general, rápida y usos, incluido SDD)
// 2. Proveedores y modelos (servidores y CLIs)
// 3. El archivo (gitcron.json en uso y editor integrado)
// 4. Importar desde OpenCode
// 5. Servidores MCP
// El estado de los acordeones se recuerda en localStorage; si el archivo está roto se abre el grupo 3.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Cpu, Sliders, Server, FolderOpen, Download, AlertCircle, CheckCircle2, RefreshCw, X, ShieldAlert
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { AiSettingsAccordionGroup } from './settings/AiSettingsAccordionGroup';
import { AiSettingsGroupUses } from './settings/AiSettingsGroupUses';
import { AiSettingsGroupProviders } from './settings/AiSettingsGroupProviders';
import { AiSettingsGroupFile } from './settings/AiSettingsGroupFile';
import { AiSettingsGroupOpenCode } from './settings/AiSettingsGroupOpenCode';
import { AiSettingsGroupMcp } from './settings/AiSettingsGroupMcp';
import { describeConfigParseCode, formatConfigParseError } from '@/lib/gitcron-config-messages';
import type { AiConfigStatusResult, AiMcpStatusResult } from '@/types/ai-config';

interface Props {
  repoPath?: string | null;
}

const LOCAL_STORAGE_KEY = 'gitcron:ai-settings:open-groups';

export function AiSettingsSection({ repoPath = null }: Props) {
  const t = useT();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AiConfigStatusResult | null>(null);
  const [mcpStatus, setMcpStatus] = useState<AiMcpStatusResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Estado de los 5 grupos acordeón (por omisión sólo el grupo 1 abierto)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }
      }
    } catch {
      // Ignorar fallos al acceder a localStorage
    }
    return { uses: true };
  });

  const hasAutoOpenedBrokenRef = useRef(false);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        // Ignorar fallos al guardar en localStorage
      }
      return next;
    });
  };

  const reload = useCallback(async () => {
    try {
      const api = window.api?.aiConfig;
      if (!api) return;
      const [configRes, mcpRes] = await Promise.all([
        api.status({ repoPath }),
        api.getMcpStatus({ repoPath }),
      ]);
      if (configRes?.success && configRes.data) {
        setStatus(configRes.data);
      } else {
        setLoadError(configRes?.error ?? t('aiConfig.unexpectedError'));
      }
      if (mcpRes?.success && mcpRes.data) {
        setMcpStatus(mcpRes.data);
      }
    } catch (err: any) {
      setLoadError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  }, [repoPath, t]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const api = window.api?.aiConfig;
      if (!api) {
        if (alive) setLoading(false);
        return;
      }
      try {
        const [configRes, mcpRes] = await Promise.all([
          api.status({ repoPath }),
          api.getMcpStatus({ repoPath }),
        ]);
        if (!alive) return;
        if (configRes?.success && configRes.data) {
          setStatus(configRes.data);
        } else {
          setLoadError(configRes?.error ?? t('aiConfig.unexpectedError'));
        }
        if (mcpRes?.success && mcpRes.data) {
          setMcpStatus(mcpRes.data);
        }
      } catch (err: any) {
        if (!alive) return;
        setLoadError(err?.message ?? t('aiConfig.unexpectedError'));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [repoPath, t]);

  // Si el archivo pasa a estar roto, el grupo 3 («El archivo») se abre solo una vez (C.16)
  const files = useMemo(() => status?.files ?? [], [status?.files]);
  const brokenFile = useMemo(() => files.find((f) => Boolean(f.error)), [files]);
  const isFileBroken = Boolean(brokenFile);

  useEffect(() => {
    if (isFileBroken && !hasAutoOpenedBrokenRef.current) {
      hasAutoOpenedBrokenRef.current = true;
      setOpenGroups((prev) => ({ ...prev, file: true }));
    } else if (!isFileBroken) {
      hasAutoOpenedBrokenRef.current = false;
    }
  }, [isFileBroken]);

  // Resúmenes de los grupos cuando están cerrados
  const groupUsesSummary = useMemo(() => {
    const uses = status?.uses ?? [];
    const exceptionsCount = uses.filter((u) => u.isException).length;
    const exceptionsStr = exceptionsCount === 0
      ? t('aiConfig.groupUsesNoExceptions')
      : exceptionsCount === 1
      ? t('aiConfig.groupUsesExceptionsCount', { count: 1 })
      : t('aiConfig.groupUsesExceptionsCountPlural', { count: exceptionsCount });
    const generalModel = status?.generalModel;
    let providerName = '—';
    let modelName = t('aiConfig.noModelConfigured');
    if (generalModel) {
      if (generalModel.includes('/')) {
        const [pId, mId] = generalModel.split('/');
        providerName = status?.providers?.find((p) => p.id === pId)?.name || pId;
        modelName = mId;
      } else {
        modelName = generalModel;
      }
    }
    return t('aiConfig.groupUsesSummary', {
      model: modelName,
      provider: providerName,
      exceptions: exceptionsStr,
    });
  }, [status, t]);

  const groupProvidersSummary = useMemo(() => {
    const providers = status?.providers ?? [];
    const servers = providers.filter((p) => p.family !== 'cli');
    const clis = providers.filter((p) => p.family === 'cli');
    const serversStr = servers.length === 1
      ? t('aiConfig.serversCountSingle')
      : t('aiConfig.serversCount', { count: servers.length });
    const clisStr = clis.length === 1
      ? t('aiConfig.clisCountSingle')
      : t('aiConfig.clisCount', { count: clis.length });
    const hasWarning = providers.some(
      (p) => !p.available || p.envVars.some((v) => v.status === 'missing'),
    );
    return (
      <span className="inline-flex items-center gap-1.5">
        {hasWarning && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] shrink-0" />}
        <span>{t('aiConfig.groupProvidersSummary', { servers: serversStr, clis: clisStr })}</span>
      </span>
    );
  }, [status, t]);

  const groupFileSummary = useMemo(() => {
    const activeFile = files.find((f) => f.scope === (repoPath ? 'repo' : 'global')) ?? files[0];
    const path = activeFile?.path || '';
    if (brokenFile?.error) {
      return t('aiConfig.groupFileSummaryError', {
        path,
        line: brokenFile.error.line ?? 1,
      });
    }
    return t('aiConfig.groupFileSummaryValid', { path });
  }, [files, brokenFile, repoPath, t]);

  const groupMcpSummary = useMemo(() => {
    const count = mcpStatus?.servers?.length ?? 0;
    if (count === 1) return t('aiConfig.groupMcpSummarySingle');
    return t('aiConfig.groupMcpSummary', { count });
  }, [mcpStatus, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)] font-mono text-xs">
        <RefreshCw size={16} className="animate-spin text-[var(--color-ai)] mr-2" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 p-4 text-sm text-[var(--color-error)]">
        <div className="flex items-center gap-2 font-bold mb-1">
          <AlertCircle size={16} />
          <span>{t('aiConfig.error', { detail: loadError })}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[var(--color-text-primary)]">
      {/* Cabecera de la sección: título, descripción y píldora de estado del archivo */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-border-subtle)]">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Cpu size={18} className="text-[var(--color-ai)]" />
            <span>{t('settings.aiModels')}</span>
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
            {t('settings.aiModelsDesc')}
          </p>
        </div>

        <div>
          <span
            data-testid="section-file-status-pill"
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5',
              isFileBroken
                ? 'bg-[var(--color-error)]/15 text-[var(--color-error)] border-[var(--color-error)]/30'
                : 'bg-[var(--color-git-add)]/15 text-[var(--color-git-add)] border-[var(--color-git-add)]/30',
            )}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isFileBroken ? 'bg-[var(--color-error)]' : 'bg-[var(--color-git-add)]',
              )}
            />
            {isFileBroken ? t('aiConfig.fileStatusError') : t('aiConfig.fileStatusValid')}
          </span>
        </div>
      </div>

      {/* Avisos de error y éxito */}
      {actionError && (
        <div className="rounded-lg border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 p-3 text-xs text-[var(--color-error)] flex items-start gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[var(--color-error)] hover:opacity-80 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {successNotice && (
        <div className="rounded-lg border border-[var(--color-git-add)]/40 bg-[var(--color-git-add)]/10 p-3 text-xs text-[var(--color-git-add)] flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Banner de archivo roto si aplica */}
      {brokenFile && (
        <div className="rounded-lg border border-[var(--color-error)]/50 bg-[var(--color-error)]/15 p-4 text-xs space-y-1 text-[var(--color-error)]">
          <div className="flex items-center gap-2 font-bold">
            <ShieldAlert size={16} />
            <span>
              {brokenFile.error
                ? formatConfigParseError(brokenFile.error, t)
                : t('aiConfig.fileBrokenNoLine', { reason: t('aiConfig.fileStatusError') })}
            </span>
          </div>
          <p className="text-[var(--color-text-secondary)] leading-relaxed">
            {brokenFile.error
              ? t('aiConfig.fileBroken', { line: brokenFile.error.line, reason: describeConfigParseCode(brokenFile.error.code, t) })
              : t('aiConfig.fileBrokenNoLine', { reason: t('aiConfig.fileStatusError') })}
          </p>
        </div>
      )}

      {/* ─── Los 5 Grupos Acordeón ─── */}
      <div className="space-y-4">
        {/* Grupo 1: Qué modelo usa cada cosa */}
        <AiSettingsAccordionGroup
          id="uses"
          isOpen={Boolean(openGroups.uses)}
          onToggle={() => toggleGroup('uses')}
          icon={<Sliders size={16} />}
          title={t('aiConfig.groupUsesTitle')}
          summary={groupUsesSummary}
        >
          <AiSettingsGroupUses
            status={status}
            repoPath={repoPath}
            isFileBroken={isFileBroken}
            onReload={reload}
            onError={setActionError}
          />
        </AiSettingsAccordionGroup>

        {/* Grupo 2: Proveedores y modelos */}
        <AiSettingsAccordionGroup
          id="providers"
          isOpen={Boolean(openGroups.providers)}
          onToggle={() => toggleGroup('providers')}
          icon={<Server size={16} />}
          title={t('aiConfig.groupProvidersTitle')}
          summary={groupProvidersSummary}
        >
          <AiSettingsGroupProviders
            status={status}
            repoPath={repoPath}
            isFileBroken={isFileBroken}
            onReload={reload}
            onError={setActionError}
            onSuccess={setSuccessNotice}
          />
        </AiSettingsAccordionGroup>

        {/* Grupo 3: El archivo */}
        <AiSettingsAccordionGroup
          id="file"
          isOpen={Boolean(openGroups.file)}
          onToggle={() => toggleGroup('file')}
          icon={<FolderOpen size={16} />}
          title={t('aiConfig.groupFileTitle')}
          summary={groupFileSummary}
        >
          <AiSettingsGroupFile
            status={status}
            repoPath={repoPath}
            onReload={reload}
          />
        </AiSettingsAccordionGroup>

        {/* Grupo 4: Importar desde OpenCode */}
        <AiSettingsAccordionGroup
          id="opencode"
          isOpen={Boolean(openGroups.opencode)}
          onToggle={() => toggleGroup('opencode')}
          icon={<Download size={16} />}
          title={t('aiConfig.groupOpenCodeTitle')}
          summary={t('aiConfig.groupOpenCodeSummary')}
        >
          <AiSettingsGroupOpenCode
            onReload={reload}
            onError={setActionError}
            onSuccess={setSuccessNotice}
          />
        </AiSettingsAccordionGroup>

        {/* Grupo 5: Servidores MCP */}
        <AiSettingsAccordionGroup
          id="mcp"
          isOpen={Boolean(openGroups.mcp)}
          onToggle={() => toggleGroup('mcp')}
          icon={<Cpu size={16} />}
          title={t('aiConfig.groupMcpTitle')}
          summary={groupMcpSummary}
        >
          <AiSettingsGroupMcp
            mcpStatus={mcpStatus}
            repoPath={repoPath}
            isFileBroken={isFileBroken}
            onReload={reload}
            onError={setActionError}
            onSuccess={setSuccessNotice}
          />
        </AiSettingsAccordionGroup>
      </div>
    </div>
  );
}
