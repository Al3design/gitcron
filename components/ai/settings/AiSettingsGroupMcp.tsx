'use client';

// components/ai/settings/AiSettingsGroupMcp.tsx
//
// Grupo 5: «Servidores MCP» (D12).
// GitCron todavía no los usa: se muestran, se quitan y se importan.
// Permite copiar para otra herramienta (Claude Code, VS Code, OpenCode) sin filtrar secretos.

import React, { useState } from 'react';
import {
  Cpu, Copy, Trash2, RefreshCw, X, Download, ShieldAlert, AlertCircle, Key,
  ExternalLink, FolderOpen
} from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import type {
  AiImportSourceInfo,
  AiImportTargetInfo,
  AiMcpExportPlanResult,
  AiMcpExportTarget,
  AiMcpImportPlanResult,
  AiMcpImportSource,
  AiMcpServerInfo,
  AiMcpServerSummary,
  AiMcpStatusResult,
} from '@/types/ai-config';

export interface AiSettingsGroupMcpProps {
  mcpStatus: AiMcpStatusResult | null;
  repoPath?: string | null;
  isFileBroken: boolean;
  onReload: () => Promise<void>;
  onError: (err: string | null) => void;
  onSuccess: (msg: string | null) => void;
}

export function AiSettingsGroupMcp({
  mcpStatus,
  repoPath = null,
  isFileBroken,
  onReload,
  onError,
  onSuccess,
}: AiSettingsGroupMcpProps) {
  const t = useT();

  // Quitar servidor MCP
  const [mcpServerToRemove, setMcpServerToRemove] = useState<AiMcpServerInfo | null>(null);
  const [removingMcpServer, setRemovingMcpServer] = useState(false);

  // Importar MCP desde Cursor, LM Studio u OpenCode
  const [mcpImportSource, setMcpImportSource] = useState<AiMcpImportSource>('cursor');
  const [mcpPlan, setMcpPlan] = useState<AiMcpImportPlanResult | null>(null);
  const [loadingMcpPlan, setLoadingMcpPlan] = useState(false);
  const [mcpSelected, setMcpSelected] = useState<Record<string, boolean>>({});
  const [applyingMcp, setApplyingMcp] = useState(false);

  // Modal «Copiar para otra herramienta» (tarea 6.2, D12)
  const [mcpServerToCopy, setMcpServerToCopy] = useState<AiMcpServerInfo | null>(null);
  const [mcpCopyTarget, setMcpCopyTarget] = useState<AiMcpExportTarget>('claude');
  const [mcpCopyPlan, setMcpCopyPlan] = useState<AiMcpExportPlanResult | null>(null);
  const [loadingMcpCopy, setLoadingMcpCopy] = useState(false);
  const [copyingMcpToClipboard, setCopyingMcpToClipboard] = useState(false);
  const [savingMcpSecrets, setSavingMcpSecrets] = useState(false);

  const handleRemoveMcpServer = async () => {
    if (!mcpServerToRemove) return;
    setRemovingMcpServer(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.removeMcpServer({
        filePath: mcpServerToRemove.origin,
        name: mcpServerToRemove.name,
        repoPath,
      });
      if (res?.success) {
        setMcpServerToRemove(null);
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setRemovingMcpServer(false);
    }
  };

  const handlePlanMcpImport = async (source: AiMcpImportSource) => {
    setLoadingMcpPlan(true);
    onError(null);
    setMcpImportSource(source);
    try {
      const res = await window.api?.aiConfig?.planMcpImport({ source });
      if (res?.success && res.data) {
        setMcpPlan(res.data);
        const sel: Record<string, boolean> = {};
        for (const entry of res.data.entries) {
          sel[entry.name] = entry.status !== 'same';
        }
        setMcpSelected(sel);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setLoadingMcpPlan(false);
    }
  };

  const handleApplyMcpImport = async () => {
    if (!mcpPlan) return;
    setApplyingMcp(true);
    onError(null);
    try {
      const entries = mcpPlan.entries.filter((entry) => mcpSelected[entry.name]).map((entry) => entry.name);
      const res = await window.api?.aiConfig?.applyMcpImport({ source: mcpImportSource, entries });
      if (res?.success && res.data) {
        onSuccess(t('aiConfig.mcpImportSuccess', { count: res.data.count }));
        setMcpPlan(null);
        await onReload();
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setApplyingMcp(false);
    }
  };

  const handleOpenMcpCopy = async (server: AiMcpServerInfo) => {
    setMcpServerToCopy(server);
    setMcpCopyTarget('claude');
    setLoadingMcpCopy(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.prepareMcpCopy({
        filePath: server.origin,
        name: server.name,
        target: 'claude',
        repoPath,
      });
      if (res?.success && res.data) {
        setMcpCopyPlan(res.data);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setLoadingMcpCopy(false);
    }
  };

  const handleSelectMcpCopyTarget = async (target: AiMcpExportTarget) => {
    if (!mcpServerToCopy) return;
    setMcpCopyTarget(target);
    setLoadingMcpCopy(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.prepareMcpCopy({
        filePath: mcpServerToCopy.origin,
        name: mcpServerToCopy.name,
        target,
        repoPath,
      });
      if (res?.success && res.data) {
        setMcpCopyPlan(res.data);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setLoadingMcpCopy(false);
    }
  };

  const handleCopyMcpToClipboard = async () => {
    if (!mcpServerToCopy) return;
    setCopyingMcpToClipboard(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.copyMcpToClipboard({
        filePath: mcpServerToCopy.origin,
        name: mcpServerToCopy.name,
        target: mcpCopyTarget,
        repoPath,
      });
      if (res?.success) {
        const targetLabel = mcpCopyTarget === 'claude'
          ? 'Claude Code'
          : mcpCopyTarget === 'vscode'
          ? 'VS Code'
          : 'OpenCode';
        onSuccess(t('aiConfig.mcpCopiedSuccess', { target: targetLabel }));
        setMcpServerToCopy(null);
        setMcpCopyPlan(null);
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setCopyingMcpToClipboard(false);
    }
  };

  const handleSaveMcpLiteralSecrets = async () => {
    if (!mcpServerToCopy) return;
    setSavingMcpSecrets(true);
    onError(null);
    try {
      const res = await window.api?.aiConfig?.saveMcpLiteralSecrets({
        filePath: mcpServerToCopy.origin,
        name: mcpServerToCopy.name,
        repoPath,
      });
      if (res?.success) {
        onSuccess(t('aiConfig.mcpCopySecretsSaved'));
        await onReload();
        const planRes = await window.api?.aiConfig?.prepareMcpCopy({
          filePath: mcpServerToCopy.origin,
          name: mcpServerToCopy.name,
          target: mcpCopyTarget,
          repoPath,
        });
        if (planRes?.success && planRes.data) {
          setMcpCopyPlan(planRes.data);
        }
      } else {
        onError(res?.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (e: any) {
      onError(e?.message ?? t('aiConfig.unexpectedError'));
    } finally {
      setSavingMcpSecrets(false);
    }
  };

  function mcpSourceLabel(source: AiMcpImportSource) {
    if (source === 'cursor') return t('aiConfig.mcpImportSourceCursor');
    if (source === 'lmstudio') return t('aiConfig.mcpImportSourceLmStudio');
    return t('aiConfig.mcpImportSourceOpenCode');
  }

  function renderImportProblem(plan: { source: AiImportSourceInfo; target: AiImportTargetInfo }) {
    const { source, target } = plan;
    let message: string | null = null;
    if (source.status === 'absent') {
      message = t('aiConfig.mcpImportSourceNotFound', { path: source.path });
    } else if (source.status === 'invalid') {
      message = t('aiConfig.mcpImportSourceInvalid', {
        path: source.path,
        line: source.error?.line ?? 0,
      });
    } else if (target.error) {
      message = t('aiConfig.mcpImportTargetBroken');
    }
    if (!message) return null;
    return (
      <div className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-2 text-xs text-[var(--color-warning)] flex items-center gap-2">
        <AlertCircle size={13} className="shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  const handleOpenFile = async (filePath: string) => {
    try {
      const res = await window.api?.aiConfig?.openFile?.({ filePath, repoPath });
      if (res && !res.success) {
        onError(res.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleShowInFolder = async (filePath: string) => {
    try {
      const res = await window.api?.aiConfig?.showInFolder?.({ filePath, repoPath });
      if (res && !res.success) {
        onError(res.error ?? t('aiConfig.unexpectedError'));
      }
    } catch (err: any) {
      onError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const servers = mcpStatus?.servers ?? [];

  return (
    <div className="space-y-4 font-sans text-xs">
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 text-xs space-y-1">
        <p className="font-semibold text-[var(--color-text-primary)]">{t('aiConfig.mcpNotice')}</p>
        <p className="text-[var(--color-text-secondary)]">{t('aiConfig.mcpNoticeDetail')}</p>
      </div>

      {/* Los mcp.json en uso, con «Abrir el archivo» y «Mostrar en la carpeta» */}
      {mcpStatus?.files && mcpStatus.files.length > 0 && (
        <div className="grid gap-2">
          {mcpStatus.files.map((file) => (
            <div
              key={file.path}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold uppercase bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]">
                    {file.scope === 'repo' ? t('aiConfig.scopeRepo') : t('aiConfig.scopeGlobal')}
                  </span>
                  {!file.exists && (
                    <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]/70 italic">
                      ({t('aiConfig.fileNotFound')})
                    </span>
                  )}
                </div>
                <p className="font-mono text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] select-all truncate" title={file.path}>
                  {file.path}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleOpenFile(file.path)}
                  className="px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-primary)] text-xs flex items-center gap-1.5 transition-colors font-medium cursor-pointer"
                  title={t('aiConfig.openFile')}
                >
                  <ExternalLink size={12} />
                  <span>{t('aiConfig.openFile')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleShowInFolder(file.path)}
                  className="px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs flex items-center gap-1.5 transition-colors font-medium cursor-pointer"
                  title={t('aiConfig.showInFolder')}
                >
                  <FolderOpen size={12} />
                  <span>{t('aiConfig.showInFolder')}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lista de servidores MCP */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 text-xs text-[var(--color-text-secondary)]/70 italic">
            {t('aiConfig.mcpNoServers')}
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] space-y-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-[var(--color-text-primary)] truncate font-mono">
                    {server.name}
                  </span>
                  {server.kind !== 'unknown' && (
                    <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                      {server.kind === 'local' ? t('aiConfig.mcpTypeLocal') : t('aiConfig.mcpTypeRemote')}
                    </span>
                  )}
                  {server.disabled && (
                    <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/30">
                      {t('aiConfig.mcpDisabled')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleOpenMcpCopy(server)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-xs text-[var(--color-text-primary)] transition-colors cursor-pointer"
                  >
                    <Copy size={12} />
                    <span>{t('aiConfig.mcpCopy')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpServerToRemove(server)}
                    className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors cursor-pointer"
                    title={t('aiConfig.mcpRemove')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Detalles técnicos (command / host, variables y headers) */}
              <div className="space-y-1 font-mono text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                {(server.command || server.host) && <div>{server.command ?? server.host}</div>}
                {server.envVarNames.length > 0 && (
                  <div>{t('aiConfig.mcpEnvVars', { vars: server.envVarNames.join(', ') })}</div>
                )}
                {server.headerNames.length > 0 && (
                  <div>{t('aiConfig.mcpHeaders', { headers: server.headerNames.join(', ') })}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Importar servidores MCP */}
      <div className="pt-2 border-t border-[var(--color-border-subtle)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h5 className="font-bold text-xs text-[var(--color-text-primary)]">
              {t('aiConfig.mcpImport')}
            </h5>
            <p className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
              {t('aiConfig.mcpImportDesc')}
            </p>
          </div>

          {!mcpPlan && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                {t('aiConfig.mcpImportSelectSource')}
              </span>
              {(['cursor', 'lmstudio', 'opencode'] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => void handlePlanMcpImport(source)}
                  disabled={loadingMcpPlan}
                  className="px-2.5 py-1 rounded border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Download size={11} />
                  <span>{mcpSourceLabel(source)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {mcpPlan && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-4 space-y-4">
            <div className="flex items-center justify-between text-xs pb-3 border-b border-[var(--color-border-subtle)]">
              <span className="font-semibold text-[var(--color-text-primary)]">
                {t('aiConfig.mcpImportFrom', { source: mcpSourceLabel(mcpImportSource) })} ({mcpPlan.entries.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const sel: Record<string, boolean> = {};
                    for (const e of mcpPlan.entries) sel[e.name] = true;
                    setMcpSelected(sel);
                  }}
                  className="text-xs text-[var(--color-ai)] hover:underline cursor-pointer"
                >
                  {t('aiConfig.importSelectAll')}
                </button>
                <span className="text-[var(--color-border-subtle)]">|</span>
                <button
                  type="button"
                  onClick={() => setMcpSelected({})}
                  className="text-xs text-[var(--color-text-secondary)] hover:underline cursor-pointer"
                >
                  {t('aiConfig.importDeselectAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setMcpPlan(null)}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] p-1 ml-1 cursor-pointer"
                  title={t('aiConfig.cancel')}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {renderImportProblem(mcpPlan)}

            {mcpPlan.skipped.length > 0 && (
              <div className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-2 text-xs text-[var(--color-warning)]">
                {t('aiConfig.mcpImportSkipped', { servers: mcpPlan.skipped.join(', ') })}
              </div>
            )}

            {mcpPlan.source.status === 'ok' && !mcpPlan.target.error && (
              mcpPlan.entries.length === 0 ? (
                <p className="text-xs text-[var(--color-text-secondary)] italic">
                  {t('aiConfig.mcpImportNoEntries')}
                </p>
              ) : (
                <div className="space-y-2">
                  {mcpPlan.entries.map((entry) => {
                    const isChecked = Boolean(mcpSelected[entry.name]);
                    return (
                      <div
                        key={entry.name}
                        className={cn(
                          'p-2.5 rounded border text-xs space-y-1 transition-colors',
                          isChecked
                            ? 'border-[var(--color-ai)]/40 bg-[var(--color-bg-surface)]'
                            : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] opacity-70'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--color-text-primary)]">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) =>
                                setMcpSelected((prev) => ({ ...prev, [entry.name]: e.target.checked }))
                              }
                              className="rounded border-[var(--color-border-subtle)] accent-[color:var(--color-ai)]"
                            />
                            <span className="font-mono">{entry.name}</span>
                            {entry.kind !== 'unknown' && (
                              <span className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold uppercase tracking-wider bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                                {entry.kind === 'local' ? t('aiConfig.mcpTypeLocal') : t('aiConfig.mcpTypeRemote')}
                              </span>
                            )}
                          </label>
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold border uppercase tracking-wider',
                              entry.status === 'new' && 'bg-[var(--color-git-add)]/15 text-[var(--color-git-add)] border-[var(--color-git-add)]/30',
                              entry.status === 'changed' && 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/30',
                              entry.status === 'same' && 'bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]'
                            )}
                          >
                            {entry.status === 'new' && t('aiConfig.importPlanStatusNew')}
                            {entry.status === 'changed' && t('aiConfig.importPlanStatusChanged')}
                            {entry.status === 'same' && t('aiConfig.importPlanStatusSame')}
                          </span>
                        </div>
                        <div className="pl-6 space-y-1">
                          {(entry.command || entry.host) && (
                            <div className="font-mono text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)] truncate">
                              {entry.command ?? entry.host}
                            </div>
                          )}
                          {entry.envVarNames.length > 0 && (
                            <div className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                              {t('aiConfig.mcpEnvVars', { vars: entry.envVarNames.join(', ') })}
                            </div>
                          )}
                          {entry.headerNames.length > 0 && (
                            <div className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                              {t('aiConfig.mcpHeaders', { headers: entry.headerNames.join(', ') })}
                            </div>
                          )}
                          {entry.changedFields.length > 0 && (
                            <div className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                              {t('aiConfig.importChangesHeading')}{' '}
                              <span className="font-mono">{entry.changedFields.join(', ')}</span>
                            </div>
                          )}
                          {entry.fromFile.length > 0 && (
                            <div className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]">
                              {t('aiConfig.mcpFromFile', { vars: entry.fromFile.join(', ') })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={() => setMcpPlan(null)}
                className="px-3 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs cursor-pointer"
              >
                {t('aiConfig.cancel')}
              </button>
              <button
                type="button"
                onClick={handleApplyMcpImport}
                disabled={
                  applyingMcp ||
                  Boolean(mcpPlan.target.error) ||
                  !mcpPlan.entries.some((e) => mcpSelected[e.name])
                }
                className="px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
              >
                {applyingMcp ? t('aiConfig.importing') : t('aiConfig.importExecute')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Copiar Servidor MCP */}
      {mcpServerToCopy && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-overlay/80 backdrop-blur-sm font-sans"
        >
          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl shadow-2xl max-w-xl w-full p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border-subtle)]">
              <div className="flex items-center gap-2">
                <Copy size={16} className="text-[var(--color-ai)] shrink-0" />
                <h3 className="font-bold text-sm text-[var(--color-text-primary)]">
                  {t('aiConfig.mcpCopyTitle', { name: mcpServerToCopy.name })}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMcpServerToCopy(null);
                  setMcpCopyPlan(null);
                }}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] p-1 rounded cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[var(--color-text-secondary)] font-medium">
                {t('aiConfig.mcpCopyTarget')}
              </label>
              <div className="flex flex-wrap gap-2">
                {(['claude', 'vscode', 'opencode'] as const).map((tgt) => (
                  <button
                    key={tgt}
                    type="button"
                    onClick={() => handleSelectMcpCopyTarget(tgt)}
                    disabled={loadingMcpCopy}
                    className={cn(
                      'px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer',
                      mcpCopyTarget === tgt
                        ? 'border-[var(--color-ai)]/50 bg-[var(--color-ai)]/15 text-[var(--color-ai)] font-bold'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                    )}
                  >
                    {tgt === 'claude'
                      ? t('aiConfig.mcpCopyTargetClaude')
                      : tgt === 'vscode'
                      ? t('aiConfig.mcpCopyTargetVsCode')
                      : t('aiConfig.mcpCopyTargetOpenCode')}
                  </button>
                ))}
              </div>
            </div>

            {loadingMcpCopy ? (
              <div className="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
                <RefreshCw size={16} className="animate-spin mr-2" />
                <span>{t('aiConfig.loadingCatalog')}</span>
              </div>
            ) : mcpCopyPlan ? (
              <div className="space-y-3 font-mono">
                <div className="text-[var(--color-text-secondary)] text-[length:var(--font-size-2xs)]">
                  {t('aiConfig.mcpCopyDestinationHint', { hint: mcpCopyPlan.targetPathHint })}
                </div>

                {/* Avisos */}
                {mcpCopyPlan.warnings.length > 0 && (
                  <div className="space-y-1.5 font-sans">
                    {mcpCopyPlan.warnings.map((warnKey) => (
                      <div
                        key={warnKey}
                        className="p-2 rounded bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 text-[var(--color-warning)] text-xs flex items-start gap-1.5"
                      >
                        <AlertCircle size={13} className="shrink-0 mt-0.5 text-[var(--color-warning)]" />
                        <span>
                          {warnKey === 'type_sse_deprecated'
                            ? t('aiConfig.mcpWarnTypeSse')
                            : warnKey === 'type_default_streamable_http'
                            ? t('aiConfig.mcpWarnTypeDefaultHttp')
                            : warnKey === 'opencode_no_envfile'
                            ? t('aiConfig.mcpWarnOpenCodeNoEnvFile')
                            : warnKey}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <pre className="p-3 rounded bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] font-mono text-xs overflow-x-auto max-h-56 select-all text-[var(--color-text-primary)] whitespace-pre">
                  <code>{mcpCopyPlan.previewText}</code>
                </pre>

                <p className="text-[length:var(--font-size-2xs)] text-[var(--color-text-secondary)]/80 leading-relaxed italic font-sans">
                  {t('aiConfig.mcpCopyMaskNotice')}
                </p>

                {mcpCopyPlan.literalSecrets.length > 0 && (
                  <div className="p-2.5 rounded border border-[var(--color-ai)]/30 bg-[var(--color-ai)]/5 text-xs space-y-2 font-sans">
                    <div className="flex items-start gap-2 text-[var(--color-text-primary)]">
                      <ShieldAlert size={14} className="text-[var(--color-ai)] shrink-0 mt-0.5" />
                      <p>{t('aiConfig.mcpCopyLiteralNotice')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveMcpLiteralSecrets}
                      disabled={savingMcpSecrets}
                      className="px-2.5 py-1 rounded border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-semibold text-xs disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {savingMcpSecrets && <RefreshCw size={12} className="animate-spin" />}
                      <span>{savingMcpSecrets ? t('aiConfig.saving') : t('aiConfig.mcpCopySaveSecrets')}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex justify-end items-center gap-2 pt-3 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  setMcpServerToCopy(null);
                  setMcpCopyPlan(null);
                }}
                className="px-3 py-1.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs cursor-pointer"
              >
                {t('aiConfig.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCopyMcpToClipboard}
                disabled={copyingMcpToClipboard || !mcpCopyPlan || loadingMcpCopy}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold text-xs disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copyingMcpToClipboard ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <Copy size={12} />
                )}
                <span>{t('aiConfig.mcpCopyToClipboard')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo para confirmar eliminación de servidor MCP */}
      {mcpServerToRemove && (
        <DangerConfirmDialog
          open={Boolean(mcpServerToRemove)}
          title={t('aiConfig.mcpRemoveTitle', { name: mcpServerToRemove.name })}
          message={t('aiConfig.mcpRemoveMessage', { file: mcpServerToRemove.origin })}
          confirmLabel={t('aiConfig.mcpRemove')}
          cancelLabel={t('aiConfig.cancel')}
          disabled={removingMcpServer}
          onConfirm={handleRemoveMcpServer}
          onCancel={() => setMcpServerToRemove(null)}
        />
      )}
    </div>
  );
}
