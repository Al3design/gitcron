import { useState, useEffect, useRef, useMemo } from 'react';
import { useGitStore } from '@/lib/git-store';
import { useGitActions } from '@/hooks/use-git-actions';
import { usePipelineStore } from '@/lib/pipeline-store';
import { useRememberedAiModel, useRememberedAiSettings, rememberAiModel as rememberAiModelGlobally, getRememberedAiModel } from '@/lib/ai-model-memory';
import { appendDraftChunks, clearDraftLog, finishDraftLog, startDraftLog } from '@/lib/commit-draft-log';
import { adviceKeyForStreamError } from '@/lib/stream-error-advice';
import {
  MIN_CONTEXT_LENGTH,
  filterDraftableModels,
  type CommitAiLastRequest,
  type CommitAiParamWarning,
  type CommitAiResolvedModel,
  type CommitAiResolvedResult,
  type CommitDraftResult,
  type LocalModel,
} from '@/types/commit-message-ai';
import {
  changeIdFromBranch,
} from '@/lib/change-branch';
import {
  archivedChangeId,
  deriveRepoCommitScope,
  soleChangeId,
  suggestCommitMessage,
  type ChangeAttribution,
  type CommitFileOrigin,
  type RepoCommitScope,
} from '@/lib/change-commit-scope';
import {
  configWarningLines,
  contributingConfigFiles,
  formatConfigParseError,
  lastValidNotices,
  paramWarningText,
} from '@/lib/gitcron-config-messages';
import { useT } from '@/hooks/use-translation';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';
import type { AiUseStatus } from '@/types/ai-use';

let draftRunCounter = 0;
const activeDraftControllers = new Map<string, AbortController>();
let activeChunkUnsubscribe: (() => void) | null = null;

async function refreshLoadedCatalog(
  repoPath: string,
  aiModel: string,
  aiContext: number,
  setAiModels: React.Dispatch<React.SetStateAction<LocalModel[]>>,
  setAiNotice: (notice: string | null, repoPath?: string) => void,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const catalog = await window.api?.commitAi?.catalog({ use: 'gitcron-commit', repoPath });
  const disponibles = filterDraftableModels(catalog?.data ?? []);
  setAiModels(disponibles);
  const cargado = disponibles.find((model) => model.id === aiModel);
  const msg = cargado?.loaded
    ? t('pipeline.openspec.prepare.aiLoadedOk', {
      model: aiModel,
      context: cargado.loadedContextLength ?? aiContext,
    })
    : t('pipeline.openspec.prepare.aiLoadedUnconfirmed', { model: aiModel });
  setAiNotice(msg, repoPath);
}

function getEffectiveDraftModel(
  resolvedCommitModel: CommitAiResolvedResult | null,
  aiModel: string,
): string | null {
  if (resolvedCommitModel && 'error' in resolvedCommitModel) return null;
  return resolvedCommitModel?.modelId || aiModel || null;
}

interface DraftSuccessOptions {
  draft: Extract<CommitDraftResult, { status: 'drafted' }>;
  originRepoPath: string;
  isMounted: boolean;
  setCommitMessage: (msg: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function applyDraftSuccess({
  draft,
  originRepoPath,
  isMounted,
  setCommitMessage,
  t,
}: DraftSuccessOptions) {
  const gitStore = useGitStore.getState();
  const originRepo = gitStore.openRepos.find((repo) => repo.path === originRepoPath);
  const originRepoName = originRepo?.name ?? originRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? originRepoPath;
  const aiDraftRecord = draft.recordId ? { recordId: draft.recordId, originalSubject: draft.subject } : null;
  if (originRepo) {
    gitStore.updateRepoByPath(originRepoPath, {
      commitMessage: draft.subject,
      aiDraftRecord,
    });
  }
  const isCurrentRepo = !gitStore.repoPath || gitStore.repoPath === originRepoPath;
  if (isMounted && isCurrentRepo) {
    setCommitMessage(draft.subject);
  } else {
    gitStore.setSuccess(t('pipeline.openspec.prepare.aiFinishedNotice', { repo: originRepoName }));
  }
  usePipelineStore.getState().setAiNotice(t('pipeline.openspec.prepare.aiWrote', { model: draft.model }), originRepoPath);
}

function notifyDraftOutcome(
  draft: Exclude<CommitDraftResult, { status: 'drafted' }>,
  originRepoPath: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (draft.status === 'no-answer') {
    const msg = draft.reason === 'budget'
      ? t('pipeline.openspec.prepare.aiNoAnswerBudget', { model: draft.model })
      : t('pipeline.openspec.prepare.aiNoAnswer', { model: draft.model });
    usePipelineStore.getState().setAiNotice(msg, originRepoPath);
    return;
  }
  if (draft.status === 'malformed') {
    const msg = t('pipeline.openspec.prepare.aiMalformed', {
      model: draft.model,
      subject: draft.subject,
    });
    usePipelineStore.getState().setAiNotice(msg, originRepoPath);
    return;
  }
  if (draft.status === 'unavailable') {
    const consejo = adviceKeyForStreamError(draft.detail);
    const msg = consejo ? t(`pipeline.openspec.prepare.${consejo}`) : draft.detail;
    usePipelineStore.getState().setAiNotice(msg, originRepoPath);
  }
}

function canDraftWithAi(aiBusy: boolean, repoPath: string, effectiveModel: string | null, chosenLength: number): boolean {
  return !aiBusy && Boolean(repoPath) && Boolean(effectiveModel) && chosenLength > 0;
}

function processDraftResponse({
  result,
  controller,
  originRepoPath,
  isMounted,
  setCommitMessage,
  t,
}: {
  result: { success: boolean; data?: CommitDraftResult; error?: string } | undefined;
  controller: AbortController;
  originRepoPath: string;
  isMounted: boolean;
  setCommitMessage: (msg: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (controller.signal.aborted) return;
  const draft = result?.data;
  if (!result?.success || !draft) {
    const detail = result?.error ?? '—';
    usePipelineStore.getState().setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail }), originRepoPath);
    return;
  }
  if (draft.status === 'drafted') {
    applyDraftSuccess({ draft, originRepoPath, isMounted, setCommitMessage, t });
    return;
  }
  notifyDraftOutcome(draft, originRepoPath, t);
}

function finalizeDraftRun(
  draftId: string,
  originRepoPath: string,
  isMounted: () => boolean,
  setLastAiRequest: (req: CommitAiLastRequest) => void,
) {
  activeDraftControllers.delete(draftId);
  usePipelineStore.getState().resetAiDraft(originRepoPath);
  finishDraftLog(draftId);
  window.api?.commitAi?.lastRequest?.().then((res) => {
    if (res?.success && res.data) {
      const currentRepo = useGitStore.getState().repoPath;
      if (isMounted() && (!currentRepo || currentRepo === originRepoPath)) {
        setLastAiRequest(res.data);
      }
    }
  }).catch(() => undefined);
}

function applyCommitMessageSuggestion(
  isMounted: boolean,
  originRepoPath: string,
  chosen: string[],
  branchAttribution: ChangeAttribution | null,
  commitMessage: string,
  setCommitMessage: (msg: string) => void,
) {
  if (isMounted) {
    if (!commitMessage.trim()) setCommitMessage(suggestCommitMessage(chosen, branchAttribution));
    return;
  }
  const gitStore = useGitStore.getState();
  const originRepo = gitStore.openRepos.find((repo) => repo.path === originRepoPath);
  if (originRepo && !originRepo.commitMessage.trim()) {
    gitStore.updateRepoByPath(originRepoPath, {
      commitMessage: suggestCommitMessage(chosen, branchAttribution),
    });
  }
}

export interface UsePrepareCommitOptions {
  repoPath: string;
  currentBranch: string;
  selectedChange?: OpenSpecChangeSummary | null;
  fixtureActive?: boolean;
  rightOpen?: boolean;
}

export type UsePrepareCommitResult = ReturnType<typeof usePrepareCommit>;

export function usePrepareCommit({
  repoPath,
  currentBranch,
  selectedChange = null,
  fixtureActive = false,
  rightOpen = false,
}: UsePrepareCommitOptions) {
  const t = useT();
  const tCount = (key: string, count: number, params: Record<string, unknown> = {}) =>
    t(count === 1 ? `${key}.one` : key, { count, ...params });

  const setSuccess = useGitStore((state) => state.setSuccess);
  const modifiedFiles = useGitStore((state) => state.modifiedFiles);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const { stageFiles } = useGitActions();

  const [chosenFiles, setChosenFiles] = useState<string[]>([]);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [lastPreparedCount, setLastPreparedCount] = useState<number | null>(null);

  const prepareOpen = usePipelineStore((state) =>
    (repoPath && state.prepareOpenByRepo[repoPath] !== undefined
      ? state.prepareOpenByRepo[repoPath]
      : state.prepareOpen),
  );
  const setPrepareOpen = usePipelineStore((state) => state.setPrepareOpen);

  const [aiModels, setAiModels] = useState<LocalModel[]>([]);
  const [resolvedCommitModel, setResolvedCommitModel] = useState<CommitAiResolvedResult | null>(null);
  const aiModel = useRememberedAiModel(repoPath);

  const fallbackAiNotice = usePipelineStore((state) => state.aiNotice);
  const storeRepoAiDraft = usePipelineStore((state) => (repoPath ? state.repoAiDrafts[repoPath] : null));
  const aiPhase = storeRepoAiDraft?.aiPhase ?? 'idle';
  const aiStartedAt = storeRepoAiDraft?.aiStartedAt ?? null;
  const aiOpKind = storeRepoAiDraft?.aiOpKind ?? 'load';
  const aiDraftId = storeRepoAiDraft?.aiDraftId ?? null;
  const queueRunningRepoPath = storeRepoAiDraft?.queueRunningRepoPath ?? null;
  const aiNotice = storeRepoAiDraft?.aiNotice ?? fallbackAiNotice;
  const setAiDraftState = usePipelineStore((state) => state.setAiDraftState);
  const resetAiDraft = usePipelineStore((state) => state.resetAiDraft);
  const setAiNotice = usePipelineStore((state) => state.setAiNotice);

  const aiBusy = aiPhase !== 'idle';
  const setAiBusy = (busy: boolean) => {
    if (busy) {
      setAiDraftState({
        aiPhase: 'drafting',
        aiStartedAt: Date.now(),
        aiDraftRepoPath: repoPath,
      }, repoPath);
    } else {
      resetAiDraft(repoPath);
    }
  };

  const [aiDeviceNames, setAiDeviceNames] = useState<Record<string, string>>({});
  const aiSettings = useRememberedAiSettings(repoPath);
  const aiContext = aiSettings.contextLength;
  const aiTtlMinutes = aiSettings.ttlMinutes;

  const [lastAiRequest, setLastAiRequest] = useState<CommitAiLastRequest | null>(null);
  const [commitUseStatus, setCommitUseStatus] = useState<AiUseStatus | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, [repoPath]);

  const branchAttribution = useMemo<ChangeAttribution | null>(() => {
    const changeId = changeIdFromBranch(currentBranch);
    return changeId ? { changeId, source: 'branch' } : null;
  }, [currentBranch]);

  const commitScope: RepoCommitScope = useMemo(
    () => deriveRepoCommitScope(
      modifiedFiles.filter((file) => !file.staged).map((file) => file.path),
      branchAttribution,
    ),
    [modifiedFiles, branchAttribution],
  );

  const nothingLeftToPrepare = commitScope.files.length === 0;

  const groupLabel = (origin: CommitFileOrigin): string => (
    origin.kind === 'change'
      ? origin.source === 'branch'
        ? t('pipeline.openspec.prepare.groupBranch', { change: origin.changeId })
        : t('pipeline.openspec.prepare.groupChange', { change: origin.changeId })
      : origin.kind === 'archived'
        ? t('pipeline.openspec.prepare.groupArchived')
        : t('pipeline.openspec.prepare.groupUnattributed')
  );

  const groupHelp = (group: { origin: CommitFileOrigin; entries: Array<{ path: string }> }): string => {
    if (group.origin.kind === 'change') {
      return group.origin.source === 'branch'
        ? t('pipeline.openspec.prepare.groupBranchHelp', { branch: currentBranch || 'change/…' })
        : t('pipeline.openspec.prepare.groupChangeHelp');
    }
    if (group.origin.kind === 'unattributed') return t('pipeline.openspec.prepare.groupUnattributedHelp');
    const archived = group.entries.map((entry) => archivedChangeId(entry.path)).find(Boolean);
    return archived
      ? t('pipeline.openspec.prepare.groupArchivedHelp', { change: archived })
      : t('pipeline.openspec.prepare.groupArchivedHelpPlain');
  };

  const chosen = commitScope.files
    .filter((entry) => chosenFiles.includes(entry.path))
    .map((entry) => entry.path);

  const toggleMany = (paths: string[]) => {
    const allChosen = paths.every((path) => chosenFiles.includes(path));
    setChosenFiles((current) => (allChosen
      ? current.filter((path) => !paths.includes(path))
      : [...new Set([...current, ...paths])]
    ));
  };

  // Carga catálogo y modelo resuelto al abrir
  useEffect(() => {
    if (!prepareOpen || !repoPath) return;
    let alive = true;
    const loadResolvedModel = () => window.api?.commitAi?.resolvedModel?.(repoPath).then((res) => {
      if (!alive) return;
      if (!res?.success) {
        setResolvedCommitModel({
          status: 'error',
          error: res?.error ?? '',
        });
        return;
      }
      if (res.data === null) {
        setResolvedCommitModel(null);
        return;
      }
      if (res.data === undefined) {
        setResolvedCommitModel({
          status: 'error',
          error: res?.error ?? '',
        });
        return;
      }
      setResolvedCommitModel(res.data);
    }).catch((err) => {
      if (alive) {
        setResolvedCommitModel({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    loadResolvedModel();

    const sameRepo = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
    const stopConfigWatch = window.api?.commitAi?.onConfigChanged?.((event) => {
      if (!alive) return;
      if (event.repoPath === null || sameRepo(event.repoPath, repoPath)) loadResolvedModel();
    });

    window.api?.commitAi?.lastRequest?.().then((res) => {
      if (alive && res?.success && res.data) {
        setLastAiRequest(res.data);
      }
    }).catch(() => undefined);

    window.api?.commitAi?.catalog({ use: 'gitcron-commit', repoPath }).then((result) => {
      if (!alive) return;
      const disponibles = filterDraftableModels(result?.data ?? []);
      setAiModels(disponibles);
      const currentModel = getRememberedAiModel(repoPath);
      if (currentModel && !disponibles.some((model) => model.id === currentModel)) {
        rememberAiModelGlobally(repoPath, '');
      }
    }).catch(() => { if (alive) setAiModels([]); });

    window.api?.commitAi?.deviceNames?.().then((result) => {
      if (alive && result?.data) setAiDeviceNames(result.data);
    }).catch(() => undefined);

    return () => {
      alive = false;
      stopConfigWatch?.();
    };
  }, [prepareOpen, repoPath]);

  // Suscripción a chunks de IA
  useEffect(() => {
    if (!prepareOpen && aiPhase !== 'drafting') return;
    if (activeChunkUnsubscribe) {
      activeChunkUnsubscribe();
      activeChunkUnsubscribe = null;
    }
    const unsub = window.api?.commitAi?.onChunk?.((event) => appendDraftChunks(event));
    return () => {
      const anyDrafting = Object.values(usePipelineStore.getState().repoAiDrafts).some(
        (draft) => draft.aiPhase === 'drafting',
      ) || usePipelineStore.getState().aiPhase === 'drafting';
      if (anyDrafting) {
        activeChunkUnsubscribe = unsub ?? null;
      } else {
        unsub?.();
        activeChunkUnsubscribe = null;
      }
    };
  }, [prepareOpen, aiPhase]);

  const aiChosenModel = aiModels.find((model) => model.id === aiModel) ?? null;
  const aiNeedsLoad = Boolean(aiChosenModel)
    && !(aiChosenModel!.loaded && (aiChosenModel!.loadedContextLength ?? 0) >= MIN_CONTEXT_LENGTH);

  const confirmAiLoad = async () => {
    if (aiBusy || !aiModel) return;
    if (aiContext < MIN_CONTEXT_LENGTH || aiTtlMinutes < 1) return;
    setAiDraftState({
      aiOpKind: 'load',
      aiPhase: 'loading',
      aiStartedAt: Date.now(),
      aiDraftRepoPath: repoPath,
      queueRunningRepoPath: null,
    }, repoPath);
    setAiNotice(null, repoPath);
    try {
      const result = await window.api?.commitAi?.load(aiModel, { use: 'gitcron-commit', repoPath }, aiContext, aiTtlMinutes * 60);
      if (!result?.success) {
        setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }), repoPath);
        return;
      }
      await refreshLoadedCatalog(repoPath, aiModel, aiContext, setAiModels, setAiNotice, t);
    } finally {
      setAiBusy(false);
    }
  };

  const unloadAiModel = async () => {
    if (aiBusy || !aiModel) return;
    setAiDraftState({
      aiOpKind: 'eject',
      aiPhase: 'loading',
      aiStartedAt: Date.now(),
      aiDraftRepoPath: repoPath,
      queueRunningRepoPath: null,
    }, repoPath);
    setAiNotice(null, repoPath);
    try {
      const previo = await window.api?.commitAi?.catalog({ use: 'gitcron-commit', repoPath });
      const antes = filterDraftableModels(previo?.data ?? []);
      setAiModels(antes);
      const vigente = antes.find((model) => model.id === aiModel);
      if (!vigente?.loaded) {
        setAiNotice(t('pipeline.openspec.prepare.aiAlreadyEjected', { model: aiModel }), repoPath);
        return;
      }

      const result = await window.api?.commitAi?.unload(aiModel, { use: 'gitcron-commit', repoPath });
      if (!result?.success) {
        setAiNotice(t('pipeline.openspec.prepare.aiFailed', { detail: result?.error ?? '—' }), repoPath);
        return;
      }
      setAiModels((actuales) => actuales.map((model) => (
        model.id === aiModel
          ? { ...model, loaded: false, loadedContextLength: null, loadedInstanceId: null }
          : model
      )));
      setAiNotice(t('pipeline.openspec.prepare.aiEjectedOk', { model: aiModel }), repoPath);
    } finally {
      setAiBusy(false);
    }
  };

  const abortInFlightAiDraft = (targetDraftId?: string | null) => {
    const draftToCancel = targetDraftId ?? aiDraftId;
    if (draftToCancel && activeDraftControllers.has(draftToCancel)) {
      activeDraftControllers.get(draftToCancel)!.abort();
      activeDraftControllers.delete(draftToCancel);
    } else if (!draftToCancel) {
      for (const ctrl of activeDraftControllers.values()) {
        ctrl.abort();
      }
      activeDraftControllers.clear();
    }
    finishDraftLog(draftToCancel ?? undefined);
    usePipelineStore.getState().resetAiDraft(repoPath);
    void window.api?.commitAi?.cancel(draftToCancel ?? undefined);
  };

  const cancelAiDraft = () => {
    abortInFlightAiDraft(aiDraftId);
    setAiBusy(false);
    setAiNotice(null, repoPath);
  };

  const closePrepare = () => {
    if (aiBusy) cancelAiDraft();
    setAiNotice(null, repoPath);
    if (aiDraftId) clearDraftLog(aiDraftId);
    else clearDraftLog();
    setPrepareOpen(false, repoPath);
  };

  const resolvedErrorText = resolvedCommitModel && 'error' in resolvedCommitModel
    ? (resolvedCommitModel.parseError
        ? formatConfigParseError(resolvedCommitModel.parseError, t)
        : resolvedCommitModel.error || t('pipeline.openspec.prepare.aiConfigReadError'))
    : '';

  const resolvedFilesText = resolvedCommitModel && !('error' in resolvedCommitModel)
    ? (contributingConfigFiles(resolvedCommitModel.configFiles).join(t('pipeline.openspec.prepare.aiFilesJoin'))
        || resolvedCommitModel.sourceFile)
    : '';

  const fixParamInFile = async (warning: CommitAiParamWarning) => {
    if (!warning.file || warning.suggestion === undefined) return;
    const res = await window.api?.commitAi?.fixParam?.({
      repoPath,
      file: warning.file,
      segments: warning.segments,
      value: warning.suggestion as string | number | boolean,
    });
    if (!res?.success) return;
    const refreshed = await window.api?.commitAi?.resolvedModel?.(repoPath);
    if (refreshed?.success) setResolvedCommitModel(refreshed.data ?? null);
  };

  const draftWithAi = async () => {
    const effectiveModel = getEffectiveDraftModel(resolvedCommitModel, aiModel);
    if (!canDraftWithAi(aiBusy, repoPath, effectiveModel, chosen.length)) return;
    const originRepoPath = repoPath;
    const draftId = String(++draftRunCounter);
    setAiDraftState({
      aiPhase: 'drafting',
      aiStartedAt: Date.now(),
      aiDraftId: draftId,
      aiDraftRepoPath: originRepoPath,
      queueRunningRepoPath: null,
    }, originRepoPath);
    setAiNotice(null, originRepoPath);
    const controller = new AbortController();
    activeDraftControllers.set(draftId, controller);
    startDraftLog(draftId);
    try {
      const result = await window.api?.commitAi?.draft({
        repoPath: originRepoPath,
        paths: chosen,
        changeId: soleChangeId(chosen, branchAttribution),
        intent: selectedChange?.intent ?? null,
        model: effectiveModel!,
        draftId,
      });
      processDraftResponse({
        result,
        controller,
        originRepoPath,
        isMounted: isMountedRef.current,
        setCommitMessage,
        t,
      });
    } finally {
      finalizeDraftRun(draftId, originRepoPath, () => isMountedRef.current, setLastAiRequest);
    }
  };

  const prepareCommit = async () => {
    if (prepareBusy || fixtureActive || chosen.length === 0 || !repoPath) return;
    const originRepoPath = repoPath;
    setPrepareBusy(true);
    try {
      const staged = await stageFiles(chosen, true);
      if (!staged) return;
      applyCommitMessageSuggestion(
        isMountedRef.current,
        originRepoPath,
        chosen,
        branchAttribution,
        commitMessage,
        setCommitMessage,
      );
      if (!isMountedRef.current) return;
      setLastPreparedCount(chosen.length);
      setChosenFiles([]);
      setSuccess(tCount('pipeline.openspec.prepare.done', chosen.length));
    } catch (error: unknown) {
      if (isMountedRef.current) {
        setAiNotice(error instanceof Error ? error.message : t('pipeline.openspec.prepare.aiFailed', { detail: '—' }));
      }
    } finally {
      if (isMountedRef.current) setPrepareBusy(false);
    }
  };

  return {
    t,
    tCount,
    commitMessage,
    setCommitMessage,
    modifiedFiles,
    chosenFiles,
    setChosenFiles,
    prepareBusy,
    lastPreparedCount,
    prepareOpen,
    closePrepare,
    commitScope,
    nothingLeftToPrepare,
    chosen,
    toggleMany,
    prepareCommit,
    branchAttribution,
    groupLabel,
    groupHelp,
    // AI state & operations
    aiModels,
    setAiModels,
    aiModel,
    aiDeviceNames,
    resolvedCommitModel,
    resolvedErrorText,
    resolvedFilesText,
    aiBusy,
    aiPhase,
    aiStartedAt,
    aiOpKind,
    queueRunningRepoPath,
    aiNotice,
    setAiNotice,
    lastAiRequest,
    commitUseStatus,
    setCommitUseStatus,
    aiNeedsLoad,
    confirmAiLoad,
    unloadAiModel,
    draftWithAi,
    cancelAiDraft,
    fixParamInFile,
  };
}
