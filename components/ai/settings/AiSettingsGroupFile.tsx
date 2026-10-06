'use client';

// components/ai/settings/AiSettingsGroupFile.tsx
//
// Grupo 3: «El archivo» (gitcron.json en uso: global y repositorio).
// Muestra rutas, estado de sintaxis (válido / con error), acciones «Abrir»,
// «Mostrar en la carpeta» y el editor integrado GitCronJsonEditor.

import React, { useState } from 'react';
import { ExternalLink, FolderOpen, Edit3, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { GitCronJsonEditor } from './GitCronJsonEditor';
import { formatConfigParseError } from '@/lib/gitcron-config-messages';
import type { AiConfigFileInfo, AiConfigStatusResult } from '@/types/ai-config';

export interface AiSettingsGroupFileProps {
  status: AiConfigStatusResult | null;
  repoPath?: string | null;
  onReload: () => Promise<void>;
}

export function AiSettingsGroupFile({
  status,
  repoPath = null,
  onReload,
}: AiSettingsGroupFileProps) {
  const t = useT();
  const [editingScope, setEditingScope] = useState<'global' | 'repo' | null>(null);

  const files = status?.files ?? [];

  const handleOpenFile = async (filePath: string) => {
    await window.api?.aiConfig?.openFile?.({ filePath, repoPath });
  };

  const handleShowInFolder = async (filePath: string) => {
    await window.api?.aiConfig?.showInFolder?.({ filePath, repoPath });
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      <div className="space-y-3">
        {files.map((file) => {
          const isEditing = editingScope === file.scope;
          const hasError = Boolean(file.error);

          return (
            <div
              key={file.scope}
              data-testid={`file-row-${file.scope}`}
              className="p-3.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-[var(--color-text-primary)]">
                      {file.scope === 'global' ? t('aiConfig.scopeGlobal') : t('aiConfig.scopeRepo')}
                    </span>
                    <span
                      data-testid={`file-status-badge-${file.scope}`}
                      className={cn(
                        'px-2 py-0.5 rounded text-[length:var(--font-size-2xs)] font-bold border',
                        hasError
                          ? 'bg-[var(--color-error)]/15 text-[var(--color-error)] border-[var(--color-error)]/30'
                          : 'bg-[var(--color-git-add)]/15 text-[var(--color-git-add)] border-[var(--color-git-add)]/30',
                      )}
                    >
                      {hasError ? t('aiConfig.fileStatusError') : t('aiConfig.fileStatusValid')}
                    </span>
                  </div>

                  <p className="font-mono text-xs text-[var(--color-text-secondary)] truncate">
                    {file.path || t('aiConfig.fileNotFound')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingScope(isEditing ? null : file.scope)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-xs font-medium text-[var(--color-text-primary)] transition-colors cursor-pointer"
                  >
                    <Edit3 size={13} />
                    <span>{t('aiConfig.editFile')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleOpenFile(file.path)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-xs font-medium text-[var(--color-text-primary)] transition-colors cursor-pointer"
                  >
                    <ExternalLink size={13} />
                    <span>{t('aiConfig.openFile')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleShowInFolder(file.path)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-border-subtle)]/20 text-xs font-medium text-[var(--color-text-primary)] transition-colors cursor-pointer"
                  >
                    <FolderOpen size={13} />
                    <span>{t('aiConfig.showInFolder')}</span>
                  </button>
                </div>
              </div>

              {/* Mensaje detallado si el archivo tiene errores de sintaxis */}
              {file.error && (
                <div className="p-3 rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-xs text-[var(--color-error)] space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldAlert size={14} />
                    <span>{formatConfigParseError(file.error, t)}</span>
                  </div>
                  <p className="text-[var(--color-text-secondary)]">
                    {t('aiConfig.fileBroken', {
                      line: file.error.line ?? '—',
                      reason: file.error.code,
                    })}
                  </p>
                </div>
              )}

              {/* Editor integrado si está abierto para este archivo */}
              {isEditing && (
                <div className="pt-2">
                  <GitCronJsonEditor
                    scope={file.scope}
                    repoPath={repoPath}
                    filePath={file.path}
                    onClose={() => setEditingScope(null)}
                    onSaved={async () => {
                      await onReload();
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
