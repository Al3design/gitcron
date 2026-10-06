'use client';

// components/ai/settings/GitCronJsonEditor.tsx
//
// Editor de texto integrado para gitcron.json (tanda 24, Pedido 6 y tanda 24b).
// Edita directamente el archivo global o del repositorio de forma monoespaciada
// con atajo Ctrl+S, guardado atómico, chequeo de sintaxis previo y protección de secretos.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useT } from '@/hooks/use-translation';
import { AlertCircle, AlertTriangle, Check, ExternalLink, RefreshCw, Save } from 'lucide-react';
import { configWarningLines, formatConfigParseError } from '@/lib/gitcron-config-messages';
import type { AiConfigFileContentResult, AiConfigFileSaveResult } from '@/types/ai-config';

export interface GitCronJsonEditorProps {
  scope: 'global' | 'repo';
  repoPath?: string | null;
  filePath?: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function GitCronJsonEditor({
  scope,
  repoPath = null,
  filePath,
  onClose,
  onSaved,
}: GitCronJsonEditorProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [hasLiteralSecrets, setHasLiteralSecrets] = useState(false);
  const [resolvedPath, setResolvedPath] = useState<string>(filePath ?? '');

  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [baseHash, setBaseHash] = useState('');

  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [syntaxError, setSyntaxError] = useState<{ line?: number; reason: string } | null>(null);
  const [secretRejected, setSecretRejected] = useState<{ line?: number } | null>(null);
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const isDirty = content !== initialContent;

  const reloadFile = useCallback(async () => {
    setLoading(true);
    setReadError(null);
    setConflict(false);
    setSyntaxError(null);
    setSecretRejected(null);
    setSchemaWarnings([]);
    setSuccessNotice(null);

    const api = window.api?.aiConfig;
    if (!api?.readFileContent) {
      setLoading(false);
      return;
    }

    try {
      const res = await api.readFileContent({ scope, repoPath });
      setLoading(false);
      if (!res?.success || !res.data) {
        setReadError(res?.error ?? t('aiConfig.unexpectedError'));
        return;
      }
      if (res.data.path) {
        setResolvedPath(res.data.path);
      }
      if (res.data.hasLiteralSecrets) {
        setHasLiteralSecrets(true);
        setContent('');
        setInitialContent('');
        return;
      }
      setHasLiteralSecrets(false);
      const text = res.data.content ?? '';
      setContent(text);
      setInitialContent(text);
      setBaseHash(res.data.hash ?? '');
    } catch (err: any) {
      setLoading(false);
      setReadError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  }, [scope, repoPath, t]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void reloadFile();
    });
    return () => {
      alive = false;
    };
  }, [reloadFile]);

  const handleSave = async () => {
    if (saving || !isDirty || hasLiteralSecrets) return;
    setSaving(true);
    setSyntaxError(null);
    setSecretRejected(null);
    setConflict(false);
    setSchemaWarnings([]);
    setSuccessNotice(null);

    const api = window.api?.aiConfig;
    if (!api?.saveFileContent) {
      setSaving(false);
      return;
    }

    try {
      const res = await api.saveFileContent({
        scope,
        repoPath,
        content,
        baseHash,
      });

      setSaving(false);
      if (!res?.success || !res.data) {
        setReadError(res?.error ?? t('aiConfig.unexpectedError'));
        return;
      }

      if (res.data.conflict) {
        setConflict(true);
        return;
      }

      if (res.data.secretRejected) {
        setSecretRejected({ line: res.data.secretLine });
        return;
      }

      if (res.data.parseError) {
        const errorText = formatConfigParseError(
          {
            file: resolvedPath,
            line: res.data.parseError.line ?? 0,
            column: res.data.parseError.column ?? 0,
            code: res.data.parseError.code,
          },
          t,
        );
        setSyntaxError({
          line: res.data.parseError.line,
          reason: errorText,
        });
        return;
      }

      setInitialContent(content);
      if (res.data.hash) {
        setBaseHash(res.data.hash);
      }
      if (res.data.warnings && res.data.warnings.length > 0) {
        setSchemaWarnings(configWarningLines(res.data.warnings, t));
      }
      setSuccessNotice(t('aiConfig.editorSaveSuccess'));
      onSaved?.();
    } catch (err: any) {
      setSaving(false);
      setReadError(err?.message ?? t('aiConfig.unexpectedError'));
    }
  };

  const handleDiscard = () => {
    setContent(initialContent);
    setSyntaxError(null);
    setSecretRejected(null);
    setConflict(false);
    setSchemaWarnings([]);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void handleSave();
    }
  };

  const handleOpenExternally = async () => {
    if (resolvedPath) {
      await window.api?.aiConfig?.openFile?.({ filePath: resolvedPath, repoPath });
    }
  };

  if (loading) {
    return (
      <div className="p-4 border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-bg-base)] text-xs text-[var(--color-text-secondary)] font-mono">
        <RefreshCw className="w-3.5 h-3.5 inline-block mr-2 animate-spin" />
        {t('aiConfig.loadingCatalog')}
      </div>
    );
  }

  // Protección de secretos literales (D5 y tanda 24)
  if (hasLiteralSecrets) {
    return (
      <div
        data-testid="editor-secret-notice"
        className="p-4 border border-[var(--color-warning)]/40 rounded-md bg-[var(--color-warning)]/10 space-y-3 font-mono text-xs"
      >
        <div className="flex items-start gap-2 text-[var(--color-warning)]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-sans leading-relaxed">{t('aiConfig.editorSecretNotice')}</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleOpenExternally}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-border-subtle)]/20 text-xs text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('aiConfig.openFile')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-transparent text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            {t('aiConfig.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="gitcron-json-editor"
      className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-bg-base)] overflow-hidden font-mono flex flex-col"
    >
      {/* Barra de herramientas del editor */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[var(--color-text-secondary)] truncate">
            {resolvedPath}
          </span>
          {isDirty && (
            <span
              data-testid="editor-dirty-badge"
              className="px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/30 font-sans"
            >
              {t('aiConfig.editorDirtyNotice')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="editor-save-btn"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-ai)]/40 bg-[var(--color-ai)]/15 hover:bg-[var(--color-ai)]/25 text-[var(--color-ai)] font-bold font-sans text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? t('aiConfig.saving') : t('aiConfig.save')}</span>
            <span className="opacity-60 text-[length:var(--font-size-2xs)] hidden sm:inline">(Ctrl+S)</span>
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={saving}
            className="px-2.5 py-1.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-border-subtle)]/20 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] font-sans text-xs transition-colors cursor-pointer"
          >
            {t('aiConfig.discard')}
          </button>
        </div>
      </div>

      {/* Alerta de conflicto externo */}
      {conflict && (
        <div
          data-testid="editor-conflict-notice"
          className="p-3 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 flex items-center justify-between text-xs text-[var(--color-warning)]"
        >
          <div className="flex items-center gap-2 font-sans">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t('aiConfig.editorConflict')}</span>
          </div>
          <button
            type="button"
            onClick={reloadFile}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--color-warning)]/40 hover:bg-[var(--color-warning)]/20 text-xs text-[var(--color-warning)] font-sans cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t('aiConfig.editorReload')}
          </button>
        </div>
      )}

      {/* Alerta de clave literal rechazada al guardar */}
      {secretRejected && (
        <div
          data-testid="editor-secret-rejected-notice"
          className="p-3 border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/10 flex items-start gap-2 text-xs text-[var(--color-error)] font-sans"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold">
            {t('aiConfig.editorSecretRejected', { line: secretRejected.line ?? '—' })}
          </p>
        </div>
      )}

      {/* Error de sintaxis */}
      {syntaxError && (
        <div
          data-testid="editor-syntax-error"
          className="p-3 border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/10 flex items-start gap-2 text-xs text-[var(--color-error)] font-sans"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              {t('aiConfig.editorSyntaxError', {
                line: syntaxError.line ?? '—',
                reason: syntaxError.reason,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Advertencias de esquema */}
      {schemaWarnings.length > 0 && (
        <div className="p-3 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-xs text-[var(--color-warning)] font-sans space-y-1">
          <p className="font-semibold">{t('aiConfig.editorSchemaWarnings')}</p>
          <ul className="list-disc list-inside space-y-0.5 text-[length:var(--font-size-2xs)] opacity-90">
            {schemaWarnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Noticia de guardado exitoso */}
      {successNotice && (
        <div className="p-2 border-b border-[var(--color-git-add)]/30 bg-[var(--color-git-add)]/10 flex items-center gap-2 text-xs text-[var(--color-git-add)] font-sans">
          <Check className="w-3.5 h-3.5" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Error general de lectura */}
      {readError && (
        <div className="p-3 border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-xs text-[var(--color-error)] font-sans">
          {readError}
        </div>
      )}

      {/* Textarea de edición monoespaciada */}
      <textarea
        ref={textareaRef}
        data-testid="gitcron-json-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        rows={18}
        className="w-full p-3 bg-transparent text-[var(--color-text-primary)] text-xs font-mono resize-y outline-none leading-relaxed border-0 focus:ring-0"
        aria-label={resolvedPath}
      />
    </div>
  );
}
