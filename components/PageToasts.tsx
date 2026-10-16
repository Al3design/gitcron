'use client';

// Toasts globales de la página: success (auto-dismiss desde la página),
// decisión de pull (behind/diverged con acciones ff/rebase/merge) y error
// (con acciones de recuperación: borrar index.lock y confiar safe.directory).
// Extraído de app/page.tsx. success/error viven en el store; el toast de
// pull-decision es estado de la página y llega por props.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Check, X, FileText } from 'lucide-react';
import { useGitStore } from '@/lib/git-store';
import { recognizePushFailure } from '@/lib/git-push-failure';
import { GitFailureNotice } from './GitFailureNotice';
import { useGitActions } from '@/hooks/use-git-actions';
import { useT } from '@/hooks/use-translation';
import { parseGitStageIssue } from '@/lib/git-stage-issue';

export type PullDecisionToast = {
  source: 'push' | 'pull';
  branch: string;
  ahead: number;
  behind: number;
  mode: 'behind' | 'diverged';
};

type PageToastsProps = {
  pullDecision: PullDecisionToast | null;
  onPullDecision: (mode: 'ff-only' | 'rebase' | 'merge') => void | Promise<unknown>;
  onDismissPullDecision: () => void;
  canTrustSafeDirectory: boolean;
  onTrustSafeDirectory: () => void | Promise<void>;
};

export function PageToasts({
  pullDecision, onPullDecision, onDismissPullDecision,
  canTrustSafeDirectory, onTrustSafeDirectory,
}: PageToastsProps) {
  const t = useT();
  const { success, setSuccess, error, setError, isLoading, currentBranch } = useGitStore();
  const { removeIndexLock, stageFiles, repointUpstream, pullChanges } = useGitActions();

  const [hovered, setHovered] = useState(false);

  // Auto-dismiss success toast after 3s (short) or 10s (long pull files list).
  // Pauses auto-dismiss on hover when a files list exists.
  useEffect(() => {
    if (!success) return;

    let isLongList = false;
    try {
      const parsed = JSON.parse(success);
      if (parsed && parsed.type === 'pull' && parsed.files && parsed.files.length > 0) {
        isLongList = true;
      }
    } catch (e) {}

    if (isLongList && hovered) {
      return;
    }

    const duration = isLongList ? 10000 : 3000;
    const timer = setTimeout(() => {
      setSuccess(null);
    }, duration);

    return () => clearTimeout(timer);
  }, [success, hovered, setSuccess]);

  // Try to parse success as a pull success JSON object
  let isPullSuccess = false;
  let pullFiles: string[] = [];
  let pullSummary = '';
  let pullMode = '';
  let displayMessage = success || '';
  const stageIssue = error ? parseGitStageIssue(error) : null;
  /**
   * Un fallo de push que la aplicación sabe explicar.
   *
   * Sólo los reconocidos toman este camino: lo que no se reconoce cae al toast
   * genérico con el texto de Git, que ahí es exactamente lo correcto.
   */
  const pushFailure = error && !stageIssue && recognizePushFailure(error).kind !== 'unknown';

  if (success) {
    try {
      const parsed = JSON.parse(success);
      if (parsed && parsed.type === 'pull') {
        isPullSuccess = true;
        pullFiles = parsed.files || [];
        pullSummary = parsed.summary || '';
        pullMode = parsed.mode || 'default';
      }
    } catch (e) {
      // Keep displayMessage as success string
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[300] flex flex-col items-center gap-2 px-4"
      role="region"
      aria-label={t('notifications.regionLabel')}
    >
      {/* ──────────── SUCCESS TOAST (auto-dismiss 3s/10s) ──────────── */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            role="status"
            aria-live="polite"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={
              isPullSuccess
                ? "pointer-events-auto p-4 glass-alert-success rounded-lg shadow-2xl flex flex-col items-stretch w-[min(calc(100vw-2rem),400px)] max-w-md"
                // Ancho de contenido con tope: una frase corta no tiene por que
                // ocupar 640px. Los toasts con acciones conservan ancho fijo,
                // donde sostiene la disposicion de los botones.
                : "pointer-events-auto px-4 py-3 glass-alert-success rounded-lg shadow-2xl flex items-center gap-3 max-w-[min(calc(100vw-2rem),640px)]"
            }
          >
            {isPullSuccess ? (
              <>
                {/* HEADER fijo */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Check size={18} className="shrink-0 text-secondary" />
                    <span className="text-sm font-semibold truncate text-secondary">
                      {pullFiles.length === 0
                        ? t('success.pullTitle')
                        : pullFiles.length === 1
                        ? t('success.pullTitleWithFile')
                        : t('success.pullTitleWithFiles', { count: pullFiles.length })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSuccess(null)}
                    className="hover:opacity-70 shrink-0 text-secondary p-0.5 -mt-0.5 -mr-1"
                  >
                    <X size={16} />
                  </button>
                </div>
                {/* BODY (lista de archivos scrolleable) */}
                {pullFiles.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-secondary/20 flex flex-col gap-2 min-w-0">
                    <div className="max-h-40 overflow-y-auto pr-1 flex flex-col gap-1.5 scrollbar-thin">
                      {pullFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs font-mono text-secondary/85 min-w-0">
                          <FileText size={12} className="shrink-0 opacity-70" />
                          <span className="truncate" title={file}>{file}</span>
                        </div>
                      ))}
                    </div>
                    {pullSummary && (
                      <div className="text-[length:var(--font-size-xs)] opacity-75 font-mono text-secondary/90 border-t border-secondary/10 pt-1.5 mt-0.5 truncate" title={pullSummary}>
                        {pullSummary}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <Check size={18} className="shrink-0" />
                <span className="text-sm font-medium">{displayMessage}</span>
                <button type="button" onClick={() => setSuccess(null)} className="ml-3 hover:opacity-70 shrink-0 text-secondary">
                  <X size={14} />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────────── PULL DECISION TOAST ──────────── */}
      <AnimatePresence>
        {pullDecision && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            role="alertdialog"
            aria-modal="false"
            className="pointer-events-auto px-4 py-3 glass-alert-warning text-text-primary rounded-lg shadow-2xl flex items-center gap-3 w-[min(calc(100vw-2rem),760px)]"
          >
            <AlertCircle size={20} className="shrink-0 text-warning" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-warning leading-tight">
                {pullDecision.mode === 'diverged'
                  ? t('pullDecision.divergedTitle', { branch: pullDecision.branch })
                  : t('pullDecision.behindTitle', { branch: pullDecision.branch })}
              </p>
              <p className="text-xs text-text-secondary mt-0.5 leading-snug">
                {pullDecision.mode === 'diverged'
                  ? pullDecision.source === 'push'
                    ? t('pullDecision.divergedPushDesc', { behind: pullDecision.behind, ahead: pullDecision.ahead })
                    : t('pullDecision.divergedPullDesc', { behind: pullDecision.behind, ahead: pullDecision.ahead })
                  : t('pullDecision.behindDesc', { behind: pullDecision.behind })}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pullDecision.mode === 'behind' && (
                <button
                  type="button"
                  onClick={() => void onPullDecision('ff-only')}
                  className="px-3 py-1.5 text-xs font-bold bg-secondary/20 hover:bg-secondary/30 text-secondary rounded transition-colors whitespace-nowrap"
                  title={t('pullDecision.ffTooltip')}
                >
                  {t('pullDecision.ffBtn')}
                </button>
              )}
              {pullDecision.mode === 'diverged' && (
                <button
                  type="button"
                  onClick={() => void onPullDecision('rebase')}
                  className="px-3 py-1.5 text-xs font-bold bg-secondary/20 hover:bg-secondary/30 text-secondary rounded transition-colors whitespace-nowrap"
                  title={t('pullDecision.rebaseTooltip')}
                >
                  {t('pullDecision.rebaseBtn')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void onPullDecision('merge')}
                className="px-3 py-1.5 text-xs font-bold bg-warning/15 hover:bg-warning/25 text-warning rounded transition-colors whitespace-nowrap"
                title={t('pullDecision.mergeTooltip')}
              >
                {t('pullDecision.mergeBtn')}
              </button>
            </div>
            <button type="button" onClick={onDismissPullDecision} className="hover:opacity-70 shrink-0 text-warning">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────────── IGNORED FILES TOAST ──────────── */}
      <AnimatePresence>
        {error && stageIssue && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            role="alertdialog"
            aria-modal="false"
            className="pointer-events-auto p-4 glass-alert-warning text-text-primary rounded-lg shadow-2xl flex items-start gap-3 w-[min(calc(100vw-2rem),760px)]"
          >
            <AlertCircle size={20} className="shrink-0 mt-0.5 text-warning" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-warning leading-tight">
                {stageIssue.ignoredPaths.length === 1
                  ? t('stageIssue.titleOne')
                  : t('stageIssue.titleMany', { count: stageIssue.ignoredPaths.length })}
              </p>
              <p className="text-xs text-text-secondary mt-1 leading-snug">
                {stageIssue.ignoredPaths.length === 1
                  ? t('stageIssue.descriptionOne')
                  : t('stageIssue.descriptionMany')}
              </p>
              <div className="mt-2 max-h-24 overflow-y-auto flex flex-col gap-1">
                {stageIssue.ignoredPaths.map((file) => (
                  <div key={file} className="flex items-center gap-2 text-xs font-mono text-warning/90">
                    <FileText size={12} className="shrink-0 opacity-70" />
                    <span className="truncate" title={file}>{file}</span>
                  </div>
                ))}
              </div>
              {stageIssue.lineEndingPaths.length > 0 && (
                <p className="text-[length:var(--font-size-xs)] text-text-secondary/80 mt-2 leading-snug">
                  {stageIssue.lineEndingPaths.length === 1
                    ? t('stageIssue.lineEndingOne')
                    : t('stageIssue.lineEndingMany', { count: stageIssue.lineEndingPaths.length })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 self-center">
              <button
                type="button"
                onClick={async () => {
                  const ok = await stageFiles(stageIssue.ignoredPaths, true, true);
                  if (ok) setError(null);
                }}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-bold bg-warning/15 hover:bg-warning/25 text-warning rounded transition-colors whitespace-nowrap disabled:opacity-50"
                title={t('stageIssue.forceTooltip')}
              >
                {t('stageIssue.force')}
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="px-3 py-1.5 text-xs font-bold bg-text-secondary/10 hover:bg-text-secondary/20 text-text-primary rounded transition-colors whitespace-nowrap"
              >
                {t('stageIssue.dismiss')}
              </button>
            </div>
            <button type="button" onClick={() => setError(null)} className="hover:opacity-70 shrink-0 text-warning">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────────── FALLO DE PUSH RECONOCIDO ────────────
          Mismo patrón que el toast de archivos ignorados: cuando el error se
          reconoce, tiene su propio toast con la explicación y su salida, en vez
          de caer al genérico con la salida cruda de Git.

          Ale apretó PUSH y recibió ocho líneas en inglés nombrando
          `push.default` y `branch.autoSetupMerge`; su primera reacción fue
          preguntar si era un problema de conexión. El texto de Git no se pierde:
          va plegado adentro del aviso. */}
      <AnimatePresence>
        {error && !stageIssue && pushFailure && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            role="alert"
            aria-live="assertive"
            className="pointer-events-auto flex items-start gap-2 w-[min(calc(100vw-2rem),640px)]"
          >
            <GitFailureNotice
              className="min-w-0 flex-1 shadow-2xl"
              error={error}
              busy={isLoading}
              onRemedy={async (remedy) => {
                // Sólo corre porque la persona apretó. Y el aviso se retira acá:
                // dejarlo puesto después de resolverlo diría que sigue fallando.
                if (remedy.kind === 'repoint-upstream') {
                  if (!currentBranch) return;
                  setError(null);
                  await repointUpstream(currentBranch);
                  return;
                }
                setError(null);
                await pullChanges();
              }}
            />
            <button
              type="button"
              onClick={() => setError(null)}
              className="glass-alert-warning shrink-0 rounded-lg p-2 text-warning shadow-2xl hover:opacity-70"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────────── GENERIC ERROR TOAST ──────────── */}
      <AnimatePresence>
        {error && !stageIssue && !pushFailure && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            role="alert"
            aria-live="assertive"
            className="pointer-events-auto p-3 glass-alert-error text-text-primary rounded-lg shadow-2xl flex items-start gap-3 max-w-[min(calc(100vw-2rem),640px)]"
          >
            <AlertCircle size={20} className="shrink-0 mt-0.5 text-error" />
            <span className="text-sm font-medium flex-1 whitespace-pre-line text-text-primary">{error}</span>
            {/* Recovery action when git index is locked */}
            {error.toLowerCase().includes('index.lock') && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await removeIndexLock();
                  if (ok) setError(null);
                }}
                className="shrink-0 px-3 py-1 text-xs font-bold bg-error/15 hover:bg-error/25 text-error rounded transition-colors"
                title="Borra .git/index.lock y refresca el estado"
              >
                Eliminar lock
              </button>
            )}
            {canTrustSafeDirectory && (
              <button
                type="button"
                onClick={onTrustSafeDirectory}
                disabled={isLoading}
                className="shrink-0 px-3 py-1 text-xs font-bold bg-error/15 hover:bg-error/25 text-error rounded transition-colors disabled:opacity-50"
                title="Agrega esta carpeta a git config --global safe.directory y vuelve a abrirla"
              >
                Confiar carpeta
              </button>
            )}
            <button type="button" onClick={() => setError(null)} className="hover:opacity-70 shrink-0 text-error">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
