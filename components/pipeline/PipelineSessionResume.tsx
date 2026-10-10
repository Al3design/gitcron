import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import type { RuntimeProjection, PipelineDiscoveryEntry } from '@/types/pipeline/projection';
import { runtimeDisplayName } from './pipeline-domain';
import { useT } from '@/hooks/use-translation';
import { Stack } from '@/components/ui';
import styles from './OpenSpecDashboard.module.css';

export interface PipelineSessionResumeProps {
  repoPath: string | null;
  session: RuntimeProjection;
  discovery?: PipelineDiscoveryEntry[] | null;
  onStarted?: (newSessionId: string) => void;
}

/**
 * Formulario desplegable en el lugar (.ai-surface, sin modal) para continuar
 * una sesión previa de un motor que soporte reanudación (OpenCode, Antigravity).
 *
 * Motor y modelo se toman de la corrida previa y son fijos. Esc cancela
 * y restaura el foco en el botón disparador.
 */
export function PipelineSessionResume({
  repoPath,
  session,
  discovery: propDiscovery,
  onStarted,
}: PipelineSessionResumeProps) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [localDiscovery, setLocalDiscovery] = useState<PipelineDiscoveryEntry[] | null>(null);

  useEffect(() => {
    if (propDiscovery !== undefined || !repoPath) return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineRuntime?.discover) return;
    let cancelled = false;
    void api.pipelineRuntime.discover(repoPath).then((result) => {
      if (!cancelled) setLocalDiscovery(result.success ? result.data ?? [] : []);
    }).catch(() => {
      if (!cancelled) setLocalDiscovery([]);
    });
    return () => {
      cancelled = true;
    };
  }, [propDiscovery, repoPath]);

  const effectiveDiscovery = propDiscovery ?? localDiscovery;
  const entry = effectiveDiscovery?.find((d) => d.runtime === session.runtime);

  const resumeBtnRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOpenRef = useRef(false);
  const instructionInputId = useId();

  // El botón y formulario sólo se muestran si: la sesión terminó, su motor declara
  // canResume en el descubrimiento y tiene runtimeSessionId persistido.
  const canResume = !session.active && Boolean(entry?.canResume) && Boolean(session.runtimeSessionId);

  // Autofocus en textarea al abrir
  useEffect(() => {
    if (isOpen) {
      textareaRef.current?.focus();
    }
  }, [isOpen]);

  // Retorno de foco al botón al cerrar
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      resumeBtnRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const handleCancel = () => {
    if (busy) return;
    setIsOpen(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed || busy || !repoPath) return;
    setBusy(true);
    setError(null);
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.pipelineRuntime?.resume) {
      setBusy(false);
      setError('resume_unavailable');
      return;
    }
    try {
      const result = await api.pipelineRuntime.resume({
        repoPath,
        fromSessionId: session.sessionId,
        instruction: trimmed,
      });
      if (result.success && result.data?.sessionId) {
        setIsOpen(false);
        setInstruction('');
        onStarted?.(result.data.sessionId);
      } else {
        setError(result.error ?? 'resume_failed');
      }
    } catch {
      setError('resume_failed');
    } finally {
      setBusy(false);
    }
  };

  const scopeNotice = useMemo(() => {
    if (!entry) return null;
    const modifiesRepo = entry.startModifiesRepo ?? false;
    if (modifiesRepo) {
      return {
        availability: 'writes',
        text: t(entry.startRunsCommands === true ? 'pipeline.launcher.scope.writes' : 'pipeline.launcher.scope.writesWithoutCommands'),
      };
    }
    if (entry.startAvailability && entry.startAvailability !== 'available') {
      const key = `pipeline.launcher.scope.${entry.startAvailability}` as const;
      return {
        availability: entry.startAvailability,
        text: t(key),
      };
    }
    return null;
  }, [entry, t]);

  const errorText = error
    ? (() => {
      const key = `pipeline.launcher.error.${error}` as const;
      const translated = t(key);
      return translated === key ? error : translated;
    })()
    : null;

  if (!canResume) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        ref={resumeBtnRef}
        type="button"
        className={styles.resumeTrigger}
        onClick={() => setIsOpen(true)}
      >
        {t('pipeline.openspec.resume.button')}
      </button>
    );
  }

  const modelText = session.requestedModel ?? null;

  return (
    <form
      className={`${styles.resumeCard} ai-surface`}
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      }}
      aria-label={t('pipeline.openspec.resume.title')}
      aria-busy={busy}
    >
      <div className={styles.resumeCardHeader}>
        <span className={styles.resumeCardTitle}>{t('pipeline.openspec.resume.title')}</span>
      </div>

      <div className={styles.resumeModelBadge}>
        <span>{t('pipeline.openspec.resume.fixedModel')}:</span>
        <strong>
          {runtimeDisplayName(session.runtime) ?? session.runtime}
          {modelText ? ` · ${modelText}` : ''}
          {session.reasoningEffort ? ` (${session.reasoningEffort})` : ''}
        </strong>
      </div>

      {scopeNotice && (
        <p className={styles.resumeScopeNotice} data-availability={scopeNotice.availability}>
          {scopeNotice.text}
        </p>
      )}

      <Stack gap="1">
        <label htmlFor={instructionInputId} className={styles.resumeLabel}>
          {t('pipeline.openspec.resume.instructionLabel')}
        </label>
        <textarea
          id={instructionInputId}
          name="instruction"
          ref={textareaRef}
          className={styles.resumeTextarea}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t('pipeline.openspec.resume.instructionPlaceholder')}
          disabled={busy}
          rows={3}
        />
      </Stack>

      {errorText && (
        <p className={styles.resumeError} role="alert">
          {errorText}
        </p>
      )}

      <div className={styles.resumeActions}>
        <button
          type="button"
          className={styles.resumeCancelBtn}
          onClick={handleCancel}
          disabled={busy}
        >
          {t('pipeline.openspec.resume.cancel')}
        </button>
        <button
          type="submit"
          className={styles.resumeSubmitBtn}
          disabled={busy || !instruction.trim()}
        >
          {busy ? t('pipeline.openspec.resume.resuming') : t('pipeline.openspec.resume.submit')}
        </button>
      </div>
    </form>
  );
}
