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

/** El uso de una respuesta, tal como lo devolvió el servidor. Un null es «sin datos», nunca cero. */
export interface AssistMessageUsage {
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  durationMs: number | null;
  /** El `limit.context` del modelo; null si no lo declara. */
  contextLength: number | null;
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
  usage?: AssistMessageUsage | null;
}

export interface AssistConversationSummary {
  id: string;
  title: string;
  viewId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Cuándo se fijó; null si no está fijada. */
  pinnedAt: string | null;
  /** Cuándo se archivó; null si no está archivada. */
  archivedAt: string | null;
  /** El cambio de SDD de la primera pregunta con un destino `change`; null si ninguna lo tuvo. */
  changeId: string | null;
}

export interface AssistConversationDetail {
  conversation: AssistConversationSummary;
  messages: AssistMessage[];
}

export interface AssistSendArgs {
  repoPath: string;
  /** Lo pone la pantalla (un UUID); sirve para cancelar ese pedido. */
  requestId: string;
  /** `null` para empezar una conversación nueva. */
  conversationId: string | null;
  viewId: string | null;
  question: string;
  /** La selección de la vista; el proceso principal la valida. */
  selection: unknown;
}

export type AssistSendResult =
  | { status: 'answered'; conversationId: string; question: AssistMessage; answer: AssistMessage }
  | { status: 'cancelled'; conversationId: string }
  | { status: 'discarded'; conversationId: string }
  | {
      status: 'failed';
      conversationId: string | null;
      reason: string;
      message: string;
      /** Otros proveedores que declaran el mismo modelo, como en los demás usos. */
      alternatives: { providerId: string; providerName: string }[];
    };
