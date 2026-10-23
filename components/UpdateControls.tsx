'use client';

// Cluster de updates del topbar: botón UPDATE (instalación lista), barra de
// progreso de descarga, link a GitHub Releases y el dropdown de versión con
// las acciones de check/download/install. Extraído de app/page.tsx; el estado
// vive en useAppUpdate (instanciado por la página) y llega por props.

import { motion, AnimatePresence } from 'motion/react';
import { Download, Github } from 'lucide-react';
import pkg from '../package.json';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type { UpdateStatus, UpdateInfo } from '@/hooks/use-app-update';

type UpdateControlsProps = {
  updateStatus: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  showUpdateMenu: boolean;
  setShowUpdateMenu: React.Dispatch<React.SetStateAction<boolean>>;
  updateMenuRef: React.RefObject<HTMLDivElement | null>;
  onCheckForUpdate: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
};

export function UpdateControls({
  updateStatus,
  updateInfo,
  downloadProgress,
  showUpdateMenu,
  setShowUpdateMenu,
  updateMenuRef,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: UpdateControlsProps) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5 mr-1 shrink-0">
      {updateStatus === 'downloaded' && (
        <button
          type="button"
          onClick={onInstallUpdate}
          className="h-7 px-2.5 rounded border border-secondary/45 bg-secondary/18 text-[length:var(--font-size-2xs)] font-bold text-secondary hover:bg-secondary/28 transition-colors"
          title={t('update.install')}
        >
          UPDATE
        </button>
      )}
      {updateStatus === 'downloading' && (
        <div className="w-28 flex items-center gap-1.5">
          <Download size={11} className="shrink-0 text-secondary" />
          <div className="flex-1 h-1 bg-border-subtle/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <span className="text-[length:var(--font-size-xs)] font-mono text-secondary w-7 text-right shrink-0">
            {downloadProgress}%
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => window.api.shellOpenExternal('https://github.com/Al3design/gitcron/releases/')}
        title="GitHub Releases"
        className="w-8 h-8 shrink-0 flex items-center justify-center text-text-secondary hover:text-secondary hover:bg-bg-overlay/70 rounded transition-colors"
      >
        <Github size={16} />
      </button>
      <div className="relative" ref={updateMenuRef}>
        <button
          type="button"
          onClick={() => setShowUpdateMenu((v) => !v)}
          className="relative text-[length:var(--font-size-2xs)] font-mono font-bold text-bg-base bg-secondary border border-git-add rounded px-2 py-0.5 select-none hover:brightness-110 transition"
          title={updateInfo ? t('update.availableTitle', { version: updateInfo.version }) : t('settings.version')}
        >
          v{pkg.version}
          {(updateStatus === 'available' || updateStatus === 'downloaded') && (
            <span className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-git-mod ring-2 ring-bg-base/70 shadow-[0_0_8px_var(--color-git-mod)]" />
          )}
        </button>
        <AnimatePresence>
          {showUpdateMenu && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute left-0 bottom-full mb-2 w-64 rounded-xl bg-bg-surface shadow-2xl p-3 z-[220]"
            >
              <div className="flex items-start gap-2.5">
                <div className={cn(
                  'mt-1 h-2 w-2 rounded-full shrink-0',
                  updateStatus === 'available' || updateStatus === 'downloaded'
                    ? 'bg-git-mod shadow-[0_0_8px_var(--color-git-mod)]'
                    : 'bg-border-subtle',
                )} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text-primary">
                    {updateInfo
                      ? t('update.availableTitle', { version: updateInfo.version })
                      : t('update.currentTitle')}
                  </p>
                  <p className="mt-0.5 text-[length:var(--font-size-xs)] text-text-secondary">
                    {updateInfo
                      ? t('update.currentVersion', { version: pkg.version })
                      : t('update.currentDesc')}
                  </p>
                </div>
              </div>
              {updateStatus === 'downloading' && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-bg-base/70/90 rounded-full overflow-hidden">
                    <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                  </div>
                  <span className="text-[length:var(--font-size-xs)] font-mono text-secondary w-8 text-right">{downloadProgress}%</span>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                {updateStatus === 'available' && (
                  <button
                    type="button"
                    onClick={onDownloadUpdate}
                    className="flex-1 px-3 py-2 rounded border border-secondary/40 bg-secondary/15 text-xs font-bold text-secondary hover:bg-secondary/25 transition-colors"
                  >
                    {t('update.download')}
                  </button>
                )}
                {updateStatus === 'downloaded' && (
                  <button
                    type="button"
                    onClick={onInstallUpdate}
                    className="flex-1 px-3 py-2 rounded border border-secondary/45 bg-secondary/18 text-xs font-bold text-secondary hover:bg-secondary/28 transition-colors"
                  >
                    UPDATE
                  </button>
                )}
                {(updateStatus === 'idle' || updateStatus === 'error') && (
                  <button
                    type="button"
                    onClick={onCheckForUpdate}
                    className="flex-1 px-3 py-2 rounded border border-border-subtle/25 bg-bg-base/70/70 text-xs font-semibold text-text-secondary hover:text-secondary hover:border-secondary/35 transition-colors"
                  >
                    {t('settings.checkUpdatesButton')}
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
