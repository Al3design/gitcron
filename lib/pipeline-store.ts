import { create } from 'zustand';
import type { PipelineSnapshot } from '@/components/pipeline/pipeline-view-state';
import type { RuntimeProjection } from '@/types/pipeline';

export type PipelineStoreState = {
  snapshot: PipelineSnapshot | null;
  projection: RuntimeProjection | null;
  runtimeHistory: RuntimeProjection[];
  selectedChangeId: string | null;
  openSpecificationId: string | null;
  expandedChanges: Record<string, boolean>;
  prepareOpen: boolean;
  reviewOpen: boolean;
  lastPreparedCount: number | null;
  aiNotice: string | null;
  aiPhase: 'idle' | 'loading' | 'drafting';
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
  engineChangeToken: number;
  attentionRequest: number;

  setSnapshot: (snapshot: PipelineSnapshot | null) => void;
  setProjection: (projection: RuntimeProjection | null) => void;
  setRuntimeHistory: (history: RuntimeProjection[]) => void;
  setSelectedChangeId: (id: string | null) => void;
  setOpenSpecificationId: (id: string | null) => void;
  setExpandedChanges: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  toggleExpandedChange: (changeId: string) => void;
  setPrepareOpen: (open: boolean) => void;
  setReviewOpen: (open: boolean) => void;
  toggleReviewOpen: () => void;
  setLastPreparedCount: (count: number | null) => void;
  setAiNotice: (notice: string | null) => void;
  setAiDraftState: (state: Partial<{
    aiPhase: 'idle' | 'loading' | 'drafting';
    aiStartedAt: number | null;
    aiDraftId: string | null;
    aiDraftRepoPath: string | null;
    aiOpKind: 'load' | 'eject';
  }>) => void;
  resetAiDraft: () => void;
  notifyEngineChanged: () => void;
  requestAttentionFocus: () => void;
  reset: () => void;
};

export const usePipelineStore = create<PipelineStoreState>((set) => ({
  snapshot: null,
  projection: null,
  runtimeHistory: [],
  selectedChangeId: null,
  openSpecificationId: null,
  expandedChanges: {},
  prepareOpen: false,
  reviewOpen: false,
  lastPreparedCount: null,
  aiNotice: null,
  aiPhase: 'idle',
  aiStartedAt: null,
  aiDraftId: null,
  aiDraftRepoPath: null,
  aiOpKind: 'load',
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
  setPrepareOpen: (prepareOpen) => set({ prepareOpen }),
  setReviewOpen: (reviewOpen) => set({ reviewOpen }),
  toggleReviewOpen: () => set((state) => ({ reviewOpen: !state.reviewOpen })),
  setLastPreparedCount: (lastPreparedCount) => set({ lastPreparedCount }),
  setAiNotice: (aiNotice) => set({ aiNotice }),
  setAiDraftState: (patch) => set((state) => ({ ...state, ...patch })),
  resetAiDraft: () =>
    set({
      aiPhase: 'idle',
      aiStartedAt: null,
      aiDraftId: null,
      aiDraftRepoPath: null,
      aiOpKind: 'load',
    }),
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
      reviewOpen: false,
      lastPreparedCount: null,
      aiNotice: null,
      aiPhase: 'idle',
      aiStartedAt: null,
      aiDraftId: null,
      aiDraftRepoPath: null,
      aiOpKind: 'load',
      engineChangeToken: 0,
      attentionRequest: 0,
    }),
}));
