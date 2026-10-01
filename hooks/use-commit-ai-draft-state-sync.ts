'use client';

import { useEffect } from 'react';
import { usePipelineStore } from '@/lib/pipeline-store';
import { setDraftLogTiming } from '@/lib/commit-draft-log';

/**
 * Lleva al `pipeline-store` los cambios de estado de la fila de redacciones del
 * proceso principal (en fila → en curso → terminada o cancelada), por
 * repositorio (tarea 2.4 / D16 de modelos-en-casa).
 *
 * Registra también en `commit-draft-log` los tiempos medidos en el proceso
 * principal para cada redacción (tarea 2.5 / D18).
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
      const { draftId, repoPath, status, activeRepoPath, startedAt, finishedAt } = event;
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
          aiStartedAt: startedAt ?? Date.now(),
          aiDraftId: draftId,
          aiDraftRepoPath: repoPath,
          queueRunningRepoPath: null,
        }, repoPath);
        if (draftId && startedAt !== undefined) {
          setDraftLogTiming(draftId, { startedAt });
        }
      } else {
        if (draftId && (startedAt !== undefined || finishedAt !== undefined)) {
          setDraftLogTiming(draftId, { startedAt, finishedAt });
        }
        store.resetAiDraft(repoPath);
      }
    });
    return () => {
      unsub?.();
    };
  }, []);
}
