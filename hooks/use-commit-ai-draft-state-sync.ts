'use client';

import { useEffect } from 'react';
import { usePipelineStore } from '@/lib/pipeline-store';

/**
 * Lleva al `pipeline-store` los cambios de estado de la fila de redacciones del
 * proceso principal (en fila → en curso → terminada o cancelada), por
 * repositorio (tarea 2.4 / D16 de modelos-en-casa).
 *
 * Vive en la raíz de la app y no en el panel de SDD: el panel se desmonta al
 * pasar a Graph o a otra solapa, y un evento que llegara en ese momento —por
 * ejemplo, que la redacción de odontoPro dejó la fila y empezó— se perdía, y al
 * volver el panel seguía diciendo «esperando». Auditoría de la tanda 05,
 * 2026-10-01.
 */
export function useCommitAiDraftStateSync(): void {
  useEffect(() => {
    const unsub = window.api?.commitAi?.onDraftState?.((event) => {
      const { draftId, repoPath, status, activeRepoPath } = event;
      const store = usePipelineStore.getState();
      if (status === 'queued') {
        store.setAiDraftState({
          aiPhase: 'queued',
          aiDraftId: draftId,
          aiDraftRepoPath: repoPath,
          queueRunningRepoPath: activeRepoPath ?? null,
        }, repoPath);
      } else if (status === 'running') {
        store.setAiDraftState({
          aiPhase: 'drafting',
          aiStartedAt: Date.now(),
          aiDraftId: draftId,
          aiDraftRepoPath: repoPath,
          queueRunningRepoPath: null,
        }, repoPath);
      } else {
        store.resetAiDraft(repoPath);
      }
    });
    return () => {
      unsub?.();
    };
  }, []);
}
