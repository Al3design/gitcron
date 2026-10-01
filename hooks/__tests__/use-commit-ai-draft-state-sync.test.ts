// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePipelineStore } from '@/lib/pipeline-store';
import { useCommitAiDraftStateSync } from '../use-commit-ai-draft-state-sync';

/**
 * La fila de redacciones se sincroniza aunque el panel de SDD no esté montado:
 * antes la escuchaba el panel y, al pasar a Graph, un evento «empezó» se perdía
 * y al volver seguía diciendo «esperando» (auditoría de la tanda 05).
 */

type DraftStateEvent = {
  draftId: string;
  repoPath: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled';
  activeRepoPath?: string | null;
};

let emit: (event: DraftStateEvent) => void = () => undefined;
const unsubscribe = vi.fn();

beforeEach(() => {
  usePipelineStore.getState().reset();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      commitAi: {
        onDraftState: (cb: (event: DraftStateEvent) => void) => {
          emit = cb;
          return unsubscribe;
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  unsubscribe.mockClear();
});

describe('useCommitAiDraftStateSync', () => {
  it('lleva en fila, en curso y terminada al estado de cada repositorio, sin el panel de SDD', () => {
    renderHook(() => useCommitAiDraftStateSync());

    emit({ draftId: '2', repoPath: 'C:/repoB', status: 'queued', activeRepoPath: 'C:/repoA' });
    expect(usePipelineStore.getState().getRepoAiDraft('C:/repoB').aiPhase).toBe('queued');

    emit({ draftId: '2', repoPath: 'C:/repoB', status: 'running' });
    expect(usePipelineStore.getState().getRepoAiDraft('C:/repoB').aiPhase).toBe('drafting');
    expect(usePipelineStore.getState().getRepoAiDraft('C:/repoA').aiPhase).toBe('idle');

    emit({ draftId: '2', repoPath: 'C:/repoB', status: 'completed' });
    expect(usePipelineStore.getState().getRepoAiDraft('C:/repoB').aiPhase).toBe('idle');
  });

  it('se da de baja al desmontar la app', () => {
    const { unmount } = renderHook(() => useCommitAiDraftStateSync());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
