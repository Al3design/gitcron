/**
 * Lo que una vista tiene seleccionado, compartido entre las pantallas y el
 * proceso principal (que lo valida en electron/assist/context-reference.ts).
 */

/** Lo que la persona tiene seleccionado en una vista, con el HEAD en el que lo tomó. */
export type ContextSelection =
  | { kind: 'none' }
  | { kind: 'commit'; sha: string }
  | { kind: 'file'; path: string; at: 'worktree' | string; takenAtHead: string }
  | { kind: 'change'; changeId: string; taskId?: string }
  | { kind: 'temporal-idea'; runId: string; branchId: string }
  | { kind: 'carto-node'; nodeId: string; takenAtHead: string };

export interface CheckoutHead {
  sha: string;
  /** `null` con HEAD separado. */
  branch: string | null;
}
