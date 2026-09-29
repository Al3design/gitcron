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
      engineChangeToken: 0,
      attentionRequest: 0,
    }),
}));
