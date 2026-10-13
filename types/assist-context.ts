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

export type AssistMessageRole = 'user' | 'assistant';

/** Una referencia de contexto usada en un mensaje, ya validada en main. */
export interface AssistMessageReference {
  selection: ContextSelection;
  headSha: string | null;
  status: 'ok' | 'stale';
}

export interface AssistMessage {
  id: string;
  seq: number;
  role: AssistMessageRole;
  text: string;
  providerName: string | null;
  modelId: string | null;
  createdAt: string;
  references: AssistMessageReference[];
}

export interface AssistConversationSummary {
  id: string;
  title: string;
  viewId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AssistConversationDetail {
  conversation: AssistConversationSummary;
  messages: AssistMessage[];
}
