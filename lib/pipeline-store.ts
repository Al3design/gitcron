import { create } from 'zustand';
import type { PipelineSnapshot } from '@/components/pipeline/pipeline-view-state';
import type { RuntimeProjection } from '@/types/pipeline';

export type RepoAiDraftState = {
  aiPhase: 'idle' | 'loading' | 'drafting' | 'queued';
  /** Cuándo arrancó lo que está corriendo, para contar los segundos. */
  aiStartedAt: number | null;
  aiDraftId: string | null;
  /**
   * Repositorio donde se pidió la redacción o la carga. Vive en el store y no en
   * el panel para que pasar a Graph y volver, en el mismo repositorio, no la
   * pierda (visto por Ale el 2026-09-30).
   */
  aiDraftRepoPath: string | null;
  /**
   * Cuál de las dos operaciones corre dentro de la fase «loading».
   *
   * Cargar y expulsar comparten fase porque ocupan al servidor igual y bloquean
   * los mismos controles, pero no dicen lo mismo: expulsar mostraba «Cargando el
   * modelo…», lo contrario de lo que pasaba. Ale lo vio expulsando.
   */
  aiOpKind: 'load' | 'eject';
  /** Si está en fila, qué repositorio está corriendo actualmente. */
  queueRunningRepoPath: string | null;
  aiNotice: string | null;
};

export const DEFAULT_REPO_AI_DRAFT: RepoAiDraftState = {
  aiPhase: 'idle',
  aiStartedAt: null,
  aiDraftId: null,
  aiDraftRepoPath: null,
  aiOpKind: 'load',
  queueRunningRepoPath: null,
  aiNotice: null,
};

export type PipelineStoreState = {
  snapshot: PipelineSnapshot | null;
  projection: RuntimeProjection | null;
  runtimeHistory: RuntimeProjection[];
  selectedChangeId: string | null;
  openSpecificationId: string | null;
  expandedChanges: Record<string, boolean>;
  prepareOpen: boolean;
  prepareOpenByRepo: Record<string, boolean>;
  reviewOpen: boolean;
  lastPreparedCount: number | null;
  aiNotice: string | null;
  aiPhase: 'idle' | 'loading' | 'drafting' | 'queued';
  /** Cuándo arrancó lo que está corriendo, para contar los segundos. */
  aiStartedAt: number | null;
  aiDraftId: string | null;
  /**
   * Repositorio donde se pidió la redacción o la carga. Vive en el store y no en
   * el panel para que pasar a Graph y volver, en el mismo repositorio, no la
   * pierda (visto por Ale el 2026-09-30).
   */
  aiDraftRepoPath: string | null;
  /**
   * Cuál de las dos operaciones corre dentro de la fase «loading».
   *
   * Cargar y expulsar comparten fase porque ocupan al servidor igual y bloquean
   * los mismos controles, pero no dicen lo mismo: expulsar mostraba «Cargando el
   * modelo…», lo contrario de lo que pasaba. Ale lo vio expulsando.
   */
  aiOpKind: 'load' | 'eject';
  /** Estado de redacción por repositorio (tarea 2.4 / D16). */
  repoAiDrafts: Record<string, RepoAiDraftState>;
  engineChangeToken: number;
  attentionRequest: number;

  setSnapshot: (snapshot: PipelineSnapshot | null) => void;
  setProjection: (projection: RuntimeProjection | null) => void;
  setRuntimeHistory: (history: RuntimeProjection[]) => void;
  setSelectedChangeId: (id: string | null) => void;
  setOpenSpecificationId: (id: string | null) => void;
  setExpandedChanges: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  toggleExpandedChange: (changeId: string) => void;
  setPrepareOpen: (open: boolean, repoPath?: string) => void;
  setReviewOpen: (open: boolean) => void;
  toggleReviewOpen: () => void;
  setLastPreparedCount: (count: number | null) => void;
  setAiNotice: (notice: string | null, repoPath?: string) => void;
  setAiDraftState: (state: Partial<RepoAiDraftState>, repoPath?: string) => void;
  resetAiDraft: (repoPath?: string) => void;
  getRepoAiDraft: (repoPath: string) => RepoAiDraftState;
  notifyEngineChanged: () => void;
  requestAttentionFocus: () => void;
  reset: () => void;
};

export const usePipelineStore = create<PipelineStoreState>((set, get) => ({
  snapshot: null,
  projection: null,
  runtimeHistory: [],
  selectedChangeId: null,
  openSpecificationId: null,
  expandedChanges: {},
  prepareOpen: false,
  prepareOpenByRepo: {},
  reviewOpen: false,
  lastPreparedCount: null,
  aiNotice: null,
  aiPhase: 'idle',
  aiStartedAt: null,
  aiDraftId: null,
  aiDraftRepoPath: null,
  aiOpKind: 'load',
  repoAiDrafts: {},
  engineChangeToken: 0,
  attentionRequest: 0,

  setSnapshot: (snapshot) => set({ snapshot }),
  setProjection: (projection) => set({ projection }),
  setRuntimeHistory: (runtimeHistory) => set({ runtimeHistory }),
  setSelectedChangeId: (selectedChangeId) => set({ selectedChangeId }),
  setOpenSpecificationId: (openSpecificationId) => set({ openSpecificationId }),
  setExpandedChanges: (updater) => set((state) => ({ expandedChanges: updater(state.expandedChanges) })),
  toggleExpandedChange: (changeId) =>
    set((state) => ({
      expandedChanges: {
        ...state.expandedChanges,
        [changeId]: !state.expandedChanges[changeId],
      },
    })),
  setPrepareOpen: (prepareOpen, repoPath) =>
    set((state) => ({
      prepareOpen,
      prepareOpenByRepo: repoPath
        ? { ...state.prepareOpenByRepo, [repoPath]: prepareOpen }
        : state.prepareOpenByRepo,
    })),
  setReviewOpen: (reviewOpen) => set({ reviewOpen }),
  toggleReviewOpen: () => set((state) => ({ reviewOpen: !state.reviewOpen })),
  setLastPreparedCount: (lastPreparedCount) => set({ lastPreparedCount }),
  setAiNotice: (aiNotice, repoPath) =>
    set((state) => {
      if (!repoPath) return { aiNotice };
      const current = state.repoAiDrafts[repoPath] ?? DEFAULT_REPO_AI_DRAFT;
      return {
        aiNotice,
        repoAiDrafts: {
          ...state.repoAiDrafts,
          [repoPath]: { ...current, aiNotice },
        },
      };
    }),
  setAiDraftState: (patch, repoPath) =>
    set((state) => {
      const targetRepo = repoPath ?? patch.aiDraftRepoPath ?? state.aiDraftRepoPath;
      const nextRoot = {
        ...state,
        ...patch,
      };
      if (!targetRepo) return nextRoot;
      const current = state.repoAiDrafts[targetRepo] ?? DEFAULT_REPO_AI_DRAFT;
      return {
        ...nextRoot,
        repoAiDrafts: {
          ...state.repoAiDrafts,
          [targetRepo]: { ...current, ...patch },
        },
      };
    }),
  resetAiDraft: (repoPath) =>
    set((state) => {
      const targetRepo = repoPath ?? state.aiDraftRepoPath;
      const nextRoot = {
        aiPhase: 'idle' as const,
        aiStartedAt: null,
        aiDraftId: null,
        aiDraftRepoPath: null,
        aiOpKind: 'load' as const,
      };
      if (!targetRepo) return nextRoot;
      const current = state.repoAiDrafts[targetRepo] ?? DEFAULT_REPO_AI_DRAFT;
      return {
        ...nextRoot,
        repoAiDrafts: {
          ...state.repoAiDrafts,
          [targetRepo]: {
            ...current,
            aiPhase: 'idle',
            aiStartedAt: null,
            aiDraftId: null,
            aiDraftRepoPath: null,
            aiOpKind: 'load',
            queueRunningRepoPath: null,
          },
        },
      };
    }),
  getRepoAiDraft: (repoPath) => {
    return get().repoAiDrafts[repoPath] ?? DEFAULT_REPO_AI_DRAFT;
  },
  notifyEngineChanged: () => set((state) => ({ engineChangeToken: state.engineChangeToken + 1 })),
  requestAttentionFocus: () => set((state) => ({ attentionRequest: state.attentionRequest + 1 })),
  reset: () =>
    set({
      snapshot: null,
      projection: null,
      runtimeHistory: [],
      selectedChangeId: null,
      openSpecificationId: null,
      expandedChanges: {},
      prepareOpen: false,
      prepareOpenByRepo: {},
      reviewOpen: false,
      lastPreparedCount: null,
      aiNotice: null,
      aiPhase: 'idle',
      aiStartedAt: null,
      aiDraftId: null,
      aiDraftRepoPath: null,
      aiOpKind: 'load',
      repoAiDrafts: {},
      engineChangeToken: 0,
      attentionRequest: 0,
    }),
}));
