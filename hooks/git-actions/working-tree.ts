'use client';

// Working-tree actions: commit, staging, stash, descartes y operaciones de
// archivos del árbol de trabajo. Sub-hook de useGitActions — no usar directo.

import { useGitStore } from '@/lib/git-store';
import { useRepoLoader } from '../use-repo-loader';
import { tNow as t } from '../use-translation';
import { setRepoLoading } from './repo-loading';
import { makeGitStageIssueMessage } from '@/lib/git-stage-issue';

export const useWorkingTreeActions = () => {
  const {
    repoPath,
    commitMessage,
    setCommitMessage,
    modifiedFiles,
    setModifiedFiles,
    setError,
    setSuccess,
  } = useGitStore();

  const { refreshLog, refreshStatus, refreshBranches, refreshStashes } = useRepoLoader();
  const setLoading = (isLoading: boolean) => setRepoLoading(repoPath, isLoading);

  const commitChanges = async () => {
    if (!commitMessage.trim()) { setError('El mensaje del commit no puede estar vacío'); return; }
    const stagedFiles = modifiedFiles.filter((f) => f.staged);
    if (stagedFiles.length === 0) { setError('No hay archivos staged para commitear'); return; }

    setLoading(true); setError(null);
    try {
      if (!window.api || !repoPath) {
        setCommitMessage('');
        setModifiedFiles(modifiedFiles.filter((f) => !f.staged));
        return;
      }
      const result = await window.api.gitCommand(repoPath, ['commit', '-m', commitMessage]);
      if (result.success) {
        const store = useGitStore.getState();
        const currentRepo = store.openRepos.find((r) => r.path === repoPath);
        const aiDraftRecord = currentRepo?.aiDraftRecord;
        if (aiDraftRecord?.recordId && window.api?.aiUseHistory?.linkCommit) {
          let commitHash: string | null = null;
          if (result.data) {
            try {
              const parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
              if (parsed && typeof parsed.commit === 'string') {
                commitHash = parsed.commit;
              }
            } catch {
              // ignore json parse error
            }
          }
          if (commitHash) {
            const commitEdited = commitMessage.trim() !== aiDraftRecord.originalSubject.trim();
            await window.api.aiUseHistory.linkCommit({
              repoPath,
              recordId: aiDraftRecord.recordId,
              commitHash,
              edited: commitEdited,
            }).catch(() => undefined);
          }
        }
        store.updateRepoByPath(repoPath, { aiDraftRecord: null });
        setCommitMessage('');
        setSuccess('Commit realizado correctamente');
        await refreshStatus();
        await refreshLog();
        await refreshBranches();
      } else {
        setError(result.error ?? 'Error al commitear');
      }
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const stashChanges = async (message?: string) => {
    if (!window.api || !repoPath) return { success: false, error: 'No repo' };
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitStashPush(repoPath, message);
      if (result.success) {
        setSuccess('Cambios guardados en el stash');
        await refreshStatus();
        await refreshStashes();
      } else {
        setError(result.error ?? 'Error al guardar stash');
      }
      return result;
    } catch (err: any) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const discardFileChanges = async (filePath: string) => {
    if (!window.api || !repoPath) {
      setModifiedFiles(modifiedFiles.filter((f) => f.path !== filePath));
      return { success: true };
    }
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitCommand(repoPath, ['restore', filePath]);
      if (result.success) await refreshStatus();
      else setError(result.error ?? 'Error al descartar cambios');
      return result;
    } catch (err: any) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally { setLoading(false); }
  };

  const stageFile = async (filePath: string, stage: boolean) => {
    if (!window.api || !repoPath) {
      setModifiedFiles(modifiedFiles.map((f) => (f.path === filePath ? { ...f, staged: stage } : f)));
      return;
    }
    try {
      const result = stage
        ? await window.api.gitStage(repoPath, filePath)
        : await window.api.gitUnstage(repoPath, filePath);
      if (result.success) await refreshStatus();
      else setError(makeGitStageIssueMessage(result.error ?? 'Error al stagear archivo', [filePath]));
    } catch (err: any) { setError(err.message); }
  };

  /**
   * Batch stage/unstage. Use this for "Stage all" / "Unstage all" — sends a
   * single git command for all files, avoiding parallel writes to .git/index
   * (which cause "index.lock: File exists" errors).
   */
  const stageFiles = async (filePaths: string[], stage: boolean, force = false) => {
    if (!window.api || !repoPath || filePaths.length === 0) return false;
    setLoading(true);
    setError(null);
    try {
      const result = stage
        ? await window.api.gitStageBatch(repoPath, filePaths, force)
        : await window.api.gitUnstageBatch(repoPath, filePaths);
      if (result.success) {
        await refreshStatus();
        return true;
      } else {
        setError(makeGitStageIssueMessage(result.error ?? 'Error al stagear archivos', filePaths));
        return false;
      }
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  /** Append a path to the repo's .gitignore and (if tracked) untrack it. */
  const addToGitignore = async (filePath: string) => {
    if (!window.api || !repoPath) return { success: false as const };
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.gitAddToGitignore(repoPath, filePath);
      if (r.success) {
        await refreshStatus();
        return { success: true as const, alreadyIgnored: r.data?.alreadyIgnored ?? false };
      }
      setError(r.error ?? 'Error al agregar al .gitignore');
      return { success: false as const };
    } finally {
      setLoading(false);
    }
  };

  /** Discard ALL changes (staged + unstaged + untracked). Destructive. */
  const resetAll = async () => {
    if (!window.api || !repoPath) return false;
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.gitResetAll(repoPath);
      if (r.success) {
        await refreshStatus();
        setSuccess(t('success.resetAll'));
        return true;
      }
      setError(r.error ?? 'Error al resetear');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /** Stash a single file. */
  const stashFile = async (filePath: string) => {
    if (!window.api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.gitStashFile(repoPath, filePath);
      if (r.success) {
        await refreshStatus();
        await refreshStashes();
      } else {
        setError(r.error ?? 'Error al stashear archivo');
      }
    } finally {
      setLoading(false);
    }
  };

  const showInFolder = async (filePath: string) => {
    if (!window.api || !repoPath) return;
    await window.api.shellShowInFolder(repoPath, filePath);
  };

  const openInDefault = async (filePath: string) => {
    if (!window.api || !repoPath) return;
    const r = await window.api.shellOpenItem(repoPath, filePath);
    if (!r.success) setError(r.error ?? 'No se pudo abrir el archivo');
  };

  const deleteFile = async (filePath: string) => {
    if (!window.api || !repoPath) return false;
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.fsDeleteFile(repoPath, filePath);
      if (r.success) {
        await refreshStatus();
        return true;
      }
      setError(r.error ?? 'No se pudo eliminar');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const cleanUntracked = async (files?: string[]) => {
    if (!window.api || !repoPath) return { success: false as const, files: [] as string[] };
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.gitClean(repoPath, files);
      if (r.success) {
        await refreshStatus();
        const deletedCount = r.data?.deleted?.length ?? 0;
        if (deletedCount > 0) {
          setSuccess(t('success.cleanUntracked', { count: deletedCount }));
        }
        return { success: true as const, files: r.data?.files ?? [], deleted: r.data?.deleted ?? [] };
      }
      setError(r.error ?? t('error.cleanUntracked', { error: 'Unknown error' }));
      return { success: false as const, files: [] as string[] };
    } finally {
      setLoading(false);
    }
  };

  const copyFilePath = async (filePath: string) => {
    if (!repoPath) return;
    // We expose the full absolute path (more useful for terminal/editor pasting)
    const absolute = `${repoPath}\\${filePath.replace(/\//g, '\\')}`;
    await navigator.clipboard.writeText(absolute);
  };

  /**
   * Force-remove a stuck .git/index.lock file. Returns true if a lock was
   * present and removed (or wasn't there to begin with).
   */
  const removeIndexLock = async () => {
    if (!window.api || !repoPath) return false;
    const r = await window.api.gitRemoveLock(repoPath);
    if (r.success) {
      setError(null);
      // Refresh state so the UI catches up
      await refreshStatus();
      return true;
    }
    setError(r.error ?? 'No se pudo eliminar el lock');
    return false;
  };

  const openTerminal = async () => {
    if (!window.api || !repoPath) return;
    const result = await window.api.terminalOpen(repoPath);
    if (!result.success) setError(result.error ?? 'No se pudo abrir el terminal');
  };

  const applyPatchFile = async () => {
    if (!window.api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.gitApplyPatchFile(repoPath);
      if (result.success) {
        await refreshStatus();
        setSuccess(t('success.patchApplied', { file: result.data?.fileName ?? '' }));
      } else if (!result.canceled) {
        setError(result.error ?? t('error.patchApply'));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t('error.patchApply'));
    } finally {
      setLoading(false);
    }
  };

  const stashApply = async (index: number) => {
    if (!window.api || !repoPath) return;
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitStashApply(repoPath, index);
      if (result.success) {
        setSuccess('Stash aplicado correctamente');
        await refreshStashes();
        await refreshStatus();
      }
      else setError(result.error ?? 'Error al aplicar stash');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const stashPop = async (index: number) => {
    if (!window.api || !repoPath) return;
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitStashPop(repoPath, index);
      if (result.success) {
        setSuccess('Stash aplicado y removido correctamente');
        await refreshStashes();
        await refreshStatus();
      }
      else setError(result.error ?? 'Error al hacer pop del stash');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const stashPreview = async (index: number) => {
    if (!window.api || !repoPath) return { success: false as const, files: [] as string[], diff: '' };
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitStashPreview(repoPath, index);
      if (result.success && result.data) {
        return { success: true as const, files: result.data.files, diff: result.data.diff };
      }
      setError(result.error ?? 'Error al previsualizar stash');
      return { success: false as const, files: [] as string[], diff: '' };
    } catch (err: any) {
      setError(err.message);
      return { success: false as const, files: [] as string[], diff: '' };
    } finally {
      setLoading(false);
    }
  };

  const stashClear = async () => {
    if (!window.api || !repoPath) return false;
    setLoading(true); setError(null);
    try {
      const r = await window.api.gitStashClear(repoPath);
      if (r.success) {
        setSuccess('Todos los stashes eliminados');
        await refreshStashes();
        return true;
      }
      setError(r.error ?? 'Error al limpiar stashes');
      return false;
    } finally { setLoading(false); }
  };

  const stashDrop = async (index: number) => {
    if (!window.api || !repoPath) return;
    setLoading(true); setError(null);
    try {
      const result = await window.api.gitStashDrop(repoPath, index);
      if (result.success) await refreshStashes();
      else setError(result.error ?? 'Error al borrar stash');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return {
    commitChanges,
    stashChanges,
    discardFileChanges,
    stageFile,
    stageFiles,
    addToGitignore,
    resetAll,
    stashFile,
    showInFolder,
    openInDefault,
    deleteFile,
    cleanUntracked,
    copyFilePath,
    removeIndexLock,
    openTerminal,
    stashApply,
    applyPatchFile,
    stashPop,
    stashPreview,
    stashDrop,
    stashClear,
  };
};
