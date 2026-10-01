'use client';

import { useRotatingThoughts } from '@/hooks/use-rotating-thoughts';
import { commitDraftThoughts } from '@/lib/commit-draft-thoughts';
import styles from './OpenSpecDashboard.module.css';

/**
 * La frase que rota mientras un modelo redacta.
 *
 * Existe como componente propio por una razón de rendimiento, no de orden. El
 * temporizador vivía dentro de `OpenSpecDashboard`, que es el componente más
 * grande del panel: cada 2,8 segundos su `setState` forzaba un re-render de
 * **todo** —lista de archivos, lista de cambios, actividad, especificaciones—
 * durante los 40 segundos que dura una redacción.
 *
 * Ale reportó la máquina lenta durante el proceso. Se midió y LM Studio quedó
 * descartado: durante una carga de 8,8 segundos su lado de la notebook consume
 * unos 5 segundos de CPU repartidos entre tres procesos, y la memoria libre no se
 * mueve —6,66 GB antes, 6,9 GB después—, porque el modelo se carga en la otra
 * máquina. El costo estaba de este lado.
 *
 * Acá el `setState` sólo re-renderiza este nodo. Es el mismo motivo por el que el
 * Agente Temporal nunca tuvo el problema: sus frases viven en un panel chico.
 */
export function DraftingThought({ active, language }: { active: boolean; language: string }) {
  const thought = useRotatingThoughts(commitDraftThoughts(language), active);
  if (!active || !thought) return null;
  return (
    <p className={styles.messageThought} aria-live="polite" key={thought}>
      <span className="ai-thinking-text">{thought}</span>
    </p>
  );
}
