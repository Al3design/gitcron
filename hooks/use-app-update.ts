'use client';

// App auto-update flow: estado del updater (check/download/install), listeners
// IPC de electron-updater, menú de update con click-outside, changelog y el
// modo mock (NEXT_PUBLIC_MOCK_UPDATE=1) para probar la UI sin releases reales.
// Extraído de app/page.tsx.

import { useEffect, useMemo, useRef, useState } from 'react';
import pkg from '../package.json';
import { useGitStore } from '@/lib/git-store';
import { useT } from './use-translation';
import { parseChangelog } from '@/lib/changelog';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  releaseDate?: string;
};

/** Marca del desplegable de actualización, que vive fuera de updateMenuRef. */
const UPDATE_MENU_ATTR = 'data-update-menu';

const MOCK_UPDATE_ENABLED = process.env.NEXT_PUBLIC_MOCK_UPDATE === '1';
const MOCK_UPDATE_VERSION = '1.3.1-dev';

export const useAppUpdate = () => {
  const t = useT();
  const setError = useGitStore((s) => s.setError);
  const setSuccess = useGitStore((s) => s.setSuccess);

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [changelogRaw, setChangelogRaw] = useState<string | null>(null);
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const [showUpdateMenu, setShowUpdateMenu] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);
  const mockUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const changelogEntries = useMemo(() => parseChangelog(changelogRaw ?? ''), [changelogRaw]);

  // Close the update menu when clicking outside of it.
  useEffect(() => {
    if (!showUpdateMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (updateMenuRef.current?.contains(e.target as Node)) return;
      // El desplegable se dibuja en document.body, fuera de updateMenuRef.
      if ((e.target as Element | null)?.closest?.(`[${UPDATE_MENU_ATTR}]`)) return;
      setShowUpdateMenu(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showUpdateMenu]);

  // Wire up auto-update IPC events from the main process.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (MOCK_UPDATE_ENABLED) {
      const timer = setTimeout(() => {
        setUpdateInfo({
          version: MOCK_UPDATE_VERSION,
          currentVersion: pkg.version,
          releaseDate: new Date().toISOString(),
        });
        setUpdateStatus('available');
        setDownloadProgress(0);
      }, 1200);
      return () => clearTimeout(timer);
    }

    if (!window.api?.onUpdateNotAvailable) return;
    const unsubAvailable = window.api.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setUpdateStatus('available');
      setDownloadProgress(0);
    });
    const unsubNotAvailable = window.api.onUpdateNotAvailable(() => {
      setUpdateStatus('idle');
      setUpdateInfo(null);
      setDownloadProgress(0);
      setSuccess(t('update.toastNotAvailable'));
    });
    const unsubError = window.api.onUpdateError((msg: string) => {
      setUpdateStatus((status) => status === 'downloading' ? 'available' : 'error');
      setDownloadProgress(0);
      setError(t('update.toastError', { error: msg }));
    });
    const unsubProgress = window.api.onDownloadProgress(({ percent }) => {
      setUpdateStatus('downloading');
      setDownloadProgress(percent);
    });
    const unsubDownloaded = window.api.onUpdateDownloaded((info) => {
      setUpdateInfo(info);
      setUpdateStatus('downloaded');
      setDownloadProgress(100);
      setShowUpdateMenu(false);
    });
    return () => {
      unsubAvailable();
      unsubNotAvailable();
      unsubError();
      unsubProgress();
      unsubDownloaded();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (!window.api?.getChangelog) {
      setChangelogError('El changelog está disponible en la app de escritorio.');
      return () => { cancelled = true; };
    }

    window.api.getChangelog().then((result) => {
      if (cancelled) return;
      if (result.success && result.data) {
        setChangelogRaw(result.data);
        setChangelogError(null);
      } else {
        setChangelogError(result.error ?? 'No se pudo cargar el changelog');
      }
    }).catch((error) => {
      if (!cancelled) setChangelogError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleCheckForUpdate = async () => {
    if (updateStatus === 'checking' || updateStatus === 'downloading') return;
    if (MOCK_UPDATE_ENABLED) {
      setUpdateStatus('checking');
      setSuccess(t('update.toastChecking'));
      window.setTimeout(() => {
        setUpdateInfo({
          version: MOCK_UPDATE_VERSION,
          currentVersion: pkg.version,
          releaseDate: new Date().toISOString(),
        });
        setUpdateStatus('available');
        setDownloadProgress(0);
        setSuccess(null);
      }, 600);
      return;
    }

    setUpdateStatus('checking');
    setSuccess(t('update.toastChecking'));
    const result = await window.api.checkForUpdate();
    if (!result.success) {
      setUpdateStatus('error');
      setError(result.error ?? t('update.toastError', { error: 'unknown' }));
    }
    // On success the IPC listeners (onUpdateNotAvailable / onUpdateError) handle the rest.
  };

  const handleDownloadUpdate = async () => {
    if (updateStatus === 'downloading') return;
    if (MOCK_UPDATE_ENABLED) {
      if (mockUpdateTimerRef.current) clearInterval(mockUpdateTimerRef.current);
      setUpdateInfo((info) => info ?? {
        version: MOCK_UPDATE_VERSION,
        currentVersion: pkg.version,
        releaseDate: new Date().toISOString(),
      });
      setUpdateStatus('downloading');
      setDownloadProgress(0);
      mockUpdateTimerRef.current = setInterval(() => {
        setDownloadProgress((prev) => {
          const next = Math.min(prev + 12, 100);
          if (next >= 100) {
            if (mockUpdateTimerRef.current) {
              clearInterval(mockUpdateTimerRef.current);
              mockUpdateTimerRef.current = null;
            }
            setUpdateStatus('downloaded');
            setShowUpdateMenu(false);
          }
          return next;
        });
      }, 220);
      return;
    }

    setUpdateStatus('downloading');
    setDownloadProgress(0);
    const result = await window.api.downloadUpdate();
    if (!result.success) {
      setUpdateStatus(updateInfo ? 'available' : 'error');
      setError(result.error ?? t('update.toastError', { error: 'unknown' }));
    }
  };

  const handleInstallUpdate = async () => {
    if (MOCK_UPDATE_ENABLED) {
      setSuccess(t('update.mockInstall'));
      setShowUpdateMenu(false);
      return;
    }

    const result = await window.api.installUpdate();
    if (!result.success) {
      setError(result.error ?? t('update.toastError', { error: 'unknown' }));
    }
  };

  useEffect(() => {
    return () => {
      if (mockUpdateTimerRef.current) clearInterval(mockUpdateTimerRef.current);
    };
  }, []);

  return {
    updateStatus,
    updateInfo,
    downloadProgress,
    changelogRaw,
    changelogError,
    changelogEntries,
    showUpdateMenu,
    setShowUpdateMenu,
    updateMenuRef,
    handleCheckForUpdate,
    handleDownloadUpdate,
    handleInstallUpdate,
  };
};
