import { useEffect, useRef } from 'react';
import { assistContributions } from './assist-registry';
import type { AssistAction } from './view-contributions';
import type { ContextSelection } from '@/types/assist-context';

/** Registra la vista en el registro de la app mientras está montada. `read` se llama cada vez que el chat pregunta, así que lee el estado del momento. */
export function useAssistContribution(
  viewId: string,
  read: () => { selection: ContextSelection; actions: AssistAction[] },
): void {
  const readRef = useRef(read);

  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    return assistContributions.register(viewId, () => readRef.current());
  }, [viewId]);

  const current = read();
  const key = JSON.stringify({
    selection: current.selection,
    actions: (current.actions ?? []).map(({ id, available, labelKey, labelParams }) => ({
      id,
      available,
      labelKey,
      labelParams,
    })),
  });
  useEffect(() => {
    assistContributions.notify();
  }, [key]);
}
