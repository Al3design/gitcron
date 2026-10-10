import { useState } from 'react';
import { useGitStore } from '@/lib/git-store';
import { useT } from '@/hooks/use-translation';
import { composeArchiveInstruction } from '../pipeline-next-action';
import type { ArchivePlan } from '@/types/pipeline';

export interface UseArchiveFlowOptions {
  repoPath: string;
  isMainOrMaster: boolean;
  fixtureActive?: boolean;
  onRefresh?: () => void;
}

export interface UseArchiveFlowResult {
  archiveRequest: { changeId: string; command: string } | null;
  archiveReason: string;
  setArchiveReason: (reason: string) => void;
  archiveError: string | null;
  setArchiveError: (error: string | null) => void;
  archiveBusy: boolean;
  archiveCmdExecuting: boolean;
  copiedArchiveCmd: boolean;
  archivePlanData: ArchivePlan | null;
  startArchive: (changeId: string) => void;
  confirmArchive: () => void;
  handleCopyArchiveCommand: () => Promise<void>;
  handleExecuteArchiveCommand: () => Promise<void>;
  cancelArchive: () => void;
}

async function runArchiveCommand(
  command: string,
  repoPath: string,
): Promise<{ success: boolean; error?: string }> {
  const api = typeof window !== 'undefined' ? window.api : undefined;
  const execute = api?.pipelineOpenSpec?.executeCommand;
  if (!execute) return { success: false };
  try {
    const res = await execute({ repoPath, command });
    if (res.success) return { success: true };
    return { success: false, error: res.error || res.stderr || res.stdout || 'Error al ejecutar comando' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export function useArchiveFlow({
  repoPath,
  isMainOrMaster,
  fixtureActive = false,
  onRefresh,
}: UseArchiveFlowOptions): UseArchiveFlowResult {
  const t = useT();
  const setSuccess = useGitStore((state) => state.setSuccess);

  const [archiveRequest, setArchiveRequest] = useState<{ changeId: string; command: string } | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveCmdExecuting, setArchiveCmdExecuting] = useState(false);
  const [copiedArchiveCmd, setCopiedArchiveCmd] = useState(false);
  const [archivePlanData, setArchivePlanData] = useState<ArchivePlan | null>(null);

  const startArchive = (changeId: string) => {
    setArchiveError(null);
    setArchivePlanData(null);
    setArchiveRequest({ changeId, command: composeArchiveInstruction(changeId) });
    if (typeof window !== 'undefined' && window.api?.pipelineArchivePlan) {
      void window.api.pipelineArchivePlan(repoPath, changeId).then((res) => {
        if (res.success && res.data) {
          setArchivePlanData(res.data);
        }
      }).catch(() => {});
    }
  };

  const cancelArchive = () => {
    setArchiveRequest(null);
    setArchiveReason('');
    setArchiveError(null);
    setArchivePlanData(null);
  };

  const confirmArchive = () => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!archiveRequest || archiveBusy || fixtureActive || !api?.pipelineArchiveChange || isMainOrMaster) return;
    setArchiveBusy(true);
    setArchiveError(null);
    const trimmedReason = archiveReason.trim();
    const archivePromise = trimmedReason
      ? api.pipelineArchiveChange(repoPath, archiveRequest.changeId, trimmedReason)
      : api.pipelineArchiveChange(repoPath, archiveRequest.changeId);
    void archivePromise
      .then((response) => {
        const result = response as { success?: boolean; error?: string } | null;
        if (result?.success) {
          setArchiveRequest(null);
          setArchiveReason('');
          setSuccess(t('pipeline.openspec.archive.done', { change: archiveRequest.changeId }));
          onRefresh?.();
          return;
        }
        setArchiveError(result?.error || 'unknown');
      })
      .catch((error: unknown) => setArchiveError(error instanceof Error ? error.message : 'unknown'))
      .finally(() => setArchiveBusy(false));
  };

  const handleCopyArchiveCommand = async () => {
    if (!archiveRequest?.command) return;
    try {
      await navigator.clipboard.writeText(archiveRequest.command);
      setCopiedArchiveCmd(true);
      setTimeout(() => setCopiedArchiveCmd(false), 2000);
    } catch {
      // Ignorar fallo de portapapeles
    }
  };

  const handleExecuteArchiveCommand = async () => {
    if (!archiveRequest?.command || archiveCmdExecuting || isMainOrMaster) return;
    setArchiveCmdExecuting(true);
    setArchiveError(null);
    const result = await runArchiveCommand(archiveRequest.command, repoPath);
    setArchiveCmdExecuting(false);
    if (result.success) {
      setArchiveRequest(null);
      setArchiveReason('');
      setSuccess(t('pipeline.openspec.archive.done', { change: archiveRequest.changeId }));
      onRefresh?.();
    } else if (result.error) {
      setArchiveError(result.error);
    }
  };

  return {
    archiveRequest,
    archiveReason,
    setArchiveReason,
    archiveError,
    setArchiveError,
    archiveBusy,
    archiveCmdExecuting,
    copiedArchiveCmd,
    archivePlanData,
    startArchive,
    confirmArchive,
    handleCopyArchiveCommand,
    handleExecuteArchiveCommand,
    cancelArchive,
  };
}
