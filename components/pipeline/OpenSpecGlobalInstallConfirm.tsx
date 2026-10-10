import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { usePipelineStore } from '@/lib/pipeline-store';
import { Text } from '@/components/ui';
import type { OpenSpecInstallResult } from '@/types/pipeline';
import { assessOpenSpecEngineAfterInstall } from './pipeline-domain';
import styles from './OpenSpecDashboard.module.css';

export function formatInstallErrorCode(
  code: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (code) {
    case 'no-manifest':
      return t('pipeline.openspec.engine.install.error.noManifest');
    case 'package-manager-not-found':
      return t('pipeline.openspec.engine.install.error.packageManagerNotFound');
    case 'permission-denied':
      return t('pipeline.openspec.engine.install.error.permissionDenied');
    case 'invalid-target-version':
      return t('pipeline.openspec.engine.install.error.invalidTargetVersion');
    case 'install-failed':
      return t('pipeline.openspec.engine.install.error.installFailed');
    default:
      return '';
  }
}

export interface OpenSpecGlobalInstallConfirmProps {
  command?: string | null;
  nodePath?: string | null;
  packageManagerPath?: string | null;
  packageManagerName?: string | null;
  openRepoPaths?: string[];
  repoPath?: string;
  installedVersion?: string | null;
  targetVersion?: string | null;
  isBusy?: boolean;
  onCancel: () => void;
  onInstalled?: (result: OpenSpecInstallResult) => void;
}

export const OpenSpecGlobalInstallConfirm: React.FC<OpenSpecGlobalInstallConfirmProps> = ({
  command,
  nodePath,
  packageManagerPath,
  packageManagerName,
  openRepoPaths,
  repoPath,
  installedVersion,
  targetVersion,
  isBusy = false,
  onCancel,
  onInstalled,
}) => {
  const t = useT();
  const [phase, setPhase] = useState<'confirm' | 'done'>('confirm');
  const [lastResult, setLastResult] = useState<OpenSpecInstallResult | null>(null);
  const [rollbackDone, setRollbackDone] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const handleConfirm = async (overrideTarget?: string | null) => {
    if (isBusy || isInstalling) return;
    if (typeof window === 'undefined' || !window.api?.pipelineOpenSpec?.installGlobal) return;

    setIsInstalling(true);
    setInstallError(null);

    const target = overrideTarget !== undefined ? overrideTarget : targetVersion;
    const payload: { repoPath?: string; targetVersion?: string } = {
      repoPath: repoPath || undefined,
      ...(target ? { targetVersion: target } : {}),
    };

    try {
      const result = await window.api.pipelineOpenSpec.installGlobal(payload);
      if (result.success) {
        usePipelineStore.getState().notifyEngineChanged();
        onInstalled?.(result);
        setLastResult(result);
        setPhase('done');
      } else {
        const errorMsg =
          formatInstallErrorCode(result.code, t) ||
          result.error ||
          t('pipeline.openspec.engine.install.error.installFailed');
        setInstallError(errorMsg);
      }
    } catch (err: unknown) {
      setInstallError((err as Error)?.message || t('pipeline.openspec.engine.install.error.installFailed'));
    } finally {
      setIsInstalling(false);
    }
  };

  const handleRollback = async (target: string) => {
    setRollbackDone(true);
    await handleConfirm(target);
  };

  if (phase === 'done') {
    const assessment = assessOpenSpecEngineAfterInstall(lastResult?.engineStatus);
    const newVersion = lastResult?.engineStatus?.cli?.runtimeVersion ?? '?';
    const canRollback =
      !rollbackDone &&
      Boolean(installedVersion) &&
      installedVersion !== newVersion;

    return (
      <div
        className={styles.engineInstallConfirmBox}
        role="region"
        aria-label={t('pipeline.openspec.engine.afterInstall.resultTitle')}
      >
        {assessment.verdict === 'ok' ? (
          <>
            <p role="status">
              {t('pipeline.openspec.engine.afterInstall.ok', { version: newVersion })}
            </p>
            <div className={styles.engineInstallConfirmActions}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onCancel}
                disabled={isBusy || isInstalling}
              >
                {t('common.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            {assessment.verdict === 'broken' ? (
              <div
                role="alert"
                className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
              >
                <AlertCircle size={14} aria-hidden="true" />
                <span>
                  {t('pipeline.openspec.engine.afterInstall.broken', {
                    version: newVersion,
                    reasons: assessment.reasonKeys.map((k) => t(k)).join(' · '),
                  })}
                </span>
              </div>
            ) : (
              <div
                role="alert"
                className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
              >
                <AlertCircle size={14} aria-hidden="true" />
                <span>
                  {t('pipeline.openspec.engine.afterInstall.unverified')}
                </span>
              </div>
            )}

            {installError && (
              <div
                className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`}
                role="alert"
                style={{ marginTop: 'var(--space-2)' }}
              >
                <AlertCircle size={14} aria-hidden="true" />
                <span>{installError}</span>
              </div>
            )}

            <div className={styles.engineInstallConfirmActions}>
              {canRollback && (
                <button
                  type="button"
                  className={styles.primaryAction}
                  onClick={() => handleRollback(installedVersion!)}
                  disabled={isBusy || isInstalling}
                >
                  {isInstalling ? (
                    <>
                      <Loader2 size={12} className={styles.spin} aria-hidden="true" />
                      <span>
                        {t('pipeline.openspec.engine.afterInstall.rollingBack', {
                          version: installedVersion!,
                        })}
                      </span>
                    </>
                  ) : (
                    t('pipeline.openspec.engine.afterInstall.rollback', {
                      version: installedVersion!,
                    })
                  )}
                </button>
              )}
              <button
                type="button"
                className={canRollback ? styles.reviewCopyBtn : styles.primaryAction}
                onClick={onCancel}
                disabled={isBusy || isInstalling}
              >
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <OpenSpecGlobalInstallPrompt
      command={command}
      nodePath={nodePath}
      packageManagerPath={packageManagerPath}
      packageManagerName={packageManagerName}
      openRepoPaths={openRepoPaths}
      installError={installError}
      targetVersion={targetVersion}
      isInstalling={isInstalling}
      disabled={isBusy}
      onConfirm={() => handleConfirm()}
      onCancel={onCancel}
    />
  );
};

export interface OpenSpecGlobalInstallPromptProps {
  command?: string | null;
  nodePath?: string | null;
  packageManagerPath?: string | null;
  packageManagerName?: string | null;
  openRepoPaths?: string[];
  installError?: string | null;
  targetVersion?: string | null;
  isInstalling?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const OpenSpecGlobalInstallPrompt: React.FC<OpenSpecGlobalInstallPromptProps> = ({
  command,
  nodePath,
  packageManagerPath,
  packageManagerName,
  openRepoPaths,
  installError,
  targetVersion,
  isInstalling = false,
  disabled = false,
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={styles.engineInstallConfirmBox}
      role="region"
      aria-label={t('pipeline.openspec.engine.install.confirmGlobalAction')}
    >
      <Text variant="secondary-xs" as="p">
        {t('pipeline.openspec.engine.install.confirmGlobalPrompt')}
      </Text>

      {command ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
          <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)' }}>
            {command}
          </code>
          <button
            type="button"
            className={styles.reviewCopyBtn}
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                void navigator.clipboard.writeText(command);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            title={t('pipeline.openspec.archive.copyCommand')}
          >
            {copied ? (
              <>
                <Check size={12} aria-hidden="true" />
                <span>{t('pipeline.openspec.archive.copiedCommand')}</span>
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden="true" />
                <span>{t('pipeline.openspec.archive.copyCommand')}</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          {t('pipeline.openspec.engine.install.commandPendingResolution')}
        </p>
      )}

      <div className={styles.engineInstallDetails}>
        {nodePath && (
          <p style={{ margin: 'var(--space-1) 0 0' }}>
            <code>Node: {nodePath}</code>
          </p>
        )}
        {packageManagerPath && (
          <p style={{ margin: 'var(--space-1) 0 0' }}>
            <code>{`${packageManagerName ?? 'npm'}: ${packageManagerPath}`}</code>
          </p>
        )}
        {openRepoPaths && openRepoPaths.length > 0 && (
          <p style={{ margin: 'var(--space-1) 0 0' }}>
            <span>{t('pipeline.openspec.engine.install.affectedRepos', { count: openRepoPaths.length })} </span>
            <code>{openRepoPaths.join(', ')}</code>
          </p>
        )}
      </div>

      {installError && (
        <div className={`${styles.engineInstallFeedback} ${styles.engineInstallFeedbackError}`} role="alert" style={{ marginTop: 'var(--space-2)' }}>
          <AlertCircle size={14} aria-hidden="true" />
          <span>{installError}</span>
        </div>
      )}

      <div className={styles.engineInstallConfirmActions}>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onConfirm}
          disabled={disabled || isInstalling}
        >
          {isInstalling ? (
            <>
              <Loader2 size={12} className={styles.spin} aria-hidden="true" />
              <span>
                {targetVersion
                  ? t('pipeline.openspec.engine.afterInstall.rollingBack', { version: targetVersion })
                  : t('pipeline.openspec.engine.install.installingGlobal')}
              </span>
            </>
          ) : (
            targetVersion
              ? t('pipeline.openspec.engine.afterInstall.rollback', { version: targetVersion })
              : t('pipeline.openspec.engine.install.confirmGlobalAction')
          )}
        </button>
        <button
          type="button"
          className={styles.reviewCopyBtn}
          onClick={onCancel}
          disabled={disabled || isInstalling}
        >
          {t('pipeline.openspec.engine.install.cancelGlobalAction')}
        </button>
      </div>
    </div>
  );
};
