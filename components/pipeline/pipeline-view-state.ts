/**
 * Contrato de estado del workspace Pipeline (F04).
 *
 * Vive aparte del componente para que la lógica de resolución de estado sea
 * testeable sin montar React y sin tocar el DOM.
 */

import type {
  ActivityEntry,
  AgentNode,
  DecisionRequest,
  EconomyState,
  PipelineDiffItem,
} from './pipeline-domain';
import type { BranchDivergence, ChangeLastCommit, ChangeTimestamp, OpenSpecChangeArtifacts, OpenSpecChangeStatus, OpenSpecToolEvidence, OpenSpecValidationStatus, TaskEvidence } from '@/types/pipeline';

export type PipelineSource = 'git' | 'openspec' | 'runtime';

/** Versión de sobre que esta build sabe interpretar (F01/F03). */
export const SUPPORTED_SNAPSHOT_VERSION = '1.0';

export type OpenSpecChangeSummary = {
  changeId: string;
  intent: string | null;
  tasks: TaskEvidence[];
  proposalExists: boolean;
  designExists: boolean;
  specsCount: number;
  validation: OpenSpecValidationStatus;
  /** Markdown de los artefactos. Sólo lo trae el cambio seleccionado. */
  artifacts: OpenSpecChangeArtifacts | null;
  /**
   * Grafo de artefactos con estados `blocked` / `ready` / `done`. Sólo lo
   * trae el cambio seleccionado; `null` para los demás.
   */
  status?: OpenSpecChangeStatus | null;
  /** Cuándo se creó, con la fuente de la que salió la marca. */
  createdAt?: ChangeTimestamp | null;
  /** Último commit que tocó este cambio. */
  lastCommit?: ChangeLastCommit | null;
};

/**
 * Orden de la lista de cambios activos: primero los más avanzados.
 *
 * Antes no se ordenaban por ningún criterio —llegaban en el orden en que el
 * sistema de archivos lista el directorio, alfabético por accidente—, así que un
 * cambio al 96% podía quedar debajo de tres parqueados en 0%.
 *
 * El desempate por fecha de creación no es decorativo: varios cambios comparten
 * el 0% —los recién creados y los parqueados hace semanas— y sin él un cambio
 * que se acaba de abrir caería al fondo junto a los que nadie va a tocar. Con el
 * desempate, lo nuevo queda arriba de lo viejo dentro del mismo avance.
 *
 * Es pura y no muta la lista recibida: se prueba con tablas y el orden no puede
 * depender de en qué momento la vista la llame.
 */
export function sortActiveChangesByProgress<T extends {
  tasks: TaskEvidence[];
  createdAt?: ChangeTimestamp | null;
  changeId: string;
}>(changes: readonly T[]): T[] {
  const percent = (change: T) => {
    const total = change.tasks.length;
    if (total === 0) return 0;
    return change.tasks.filter((task) => task.completed).length / total;
  };
  return [...changes].sort((left, right) => {
    const byProgress = percent(right) - percent(left);
    if (byProgress !== 0) return byProgress;
    // Sin marca de creación no se inventa una posición: se cae al identificador,
    // que al menos es estable entre relecturas.
    const leftAt = left.createdAt?.at ?? '';
    const rightAt = right.createdAt?.at ?? '';
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    return left.changeId.localeCompare(right.changeId);
  });
}

export type OpenSpecWorkspaceSnapshot = {
  selectedChangeId: string | null;
  activeChanges: OpenSpecChangeSummary[];
  archivedChanges: Array<{
    changeId: string;
    archivedAt: string | null;
    sourceRef: string;
    /** Sólo el archivado seleccionado transporta contenido. */
    artifacts?: OpenSpecChangeSummary['artifacts'];
    createdAt?: ChangeTimestamp | null;
    archivedOn?: ChangeTimestamp | null;
    lastCommit?: ChangeLastCommit | null;
  }>;
  specifications: Array<{
    specificationId: string;
    requirements: number | null;
    sourceRef: string;
  }>;
  reports: string[];
  diagnostics: Array<{ code: string; message: string; severity: string; sourceRef: string }>;
  observedAt: string | null;
  latestGate: { result: 'VERDE' | 'ROJO' | 'PENDIENTE'; mode: string; ts: string } | null;
  /** Si el repositorio tiene `openspec/`. Distinto de «sin cambios activos». */
  openSpecPresent?: boolean;
  /**
   * Herramientas presentes en el repositorio y si tienen OpenSpec configurado.
   * Una sin configurar significa que su ejecutor no sabe que el canal existe.
   */
  openSpecTools?: OpenSpecToolEvidence[];
};

export type PipelineSnapshot = {
  schemaVersion: string;
  repoId: string;
  availableSources: PipelineSource[];
  hasPipelineActivity: boolean;
  decisions: DecisionRequest[];
  agents: AgentNode[];
  activity: ActivityEntry[];
  economy: EconomyState;
  diffs?: PipelineDiffItem[];
  /** Vista OpenSpec. Opcional para snapshots/fixtures históricos. */
  openSpec?: OpenSpecWorkspaceSnapshot;
  /**
   * Distancia entre la rama actual y la base local. Ausente en un snapshot de
   * una versión anterior o de fixture, y ausente no es «está al día».
   */
  branchDivergence?: BranchDivergence;
};

export type PipelineViewState =
  | { kind: 'loading' }
  | { kind: 'no-repo' }
  | { kind: 'no-pipeline' }
  | { kind: 'incompatible'; foundVersion: string | null }
  | { kind: 'error'; messageKey: string; canRetry: boolean }
  | { kind: 'ready'; snapshot: PipelineSnapshot };

/**
 * Traduce un snapshot crudo al estado que la UI debe mostrar.
 *
 * El orden de las guardas importa y es deliberado:
 *
 * 1. Sin repo no hay nada que resolver.
 * 2. Una versión desconocida gana sobre todo lo demás: si no sabemos leer el
 *    sobre, no podemos afirmar nada sobre su contenido.
 * 3. Sin actividad no es un error, es un repo que todavía no corrió nada.
 * 4. Hermes desconectado y repo sin kit son degradaciones informativas, no
 *    fallas: el resto de la evidencia sigue siendo válida y se muestra.
 */
export function resolvePipelineViewState(input: {
  repoPath: string | null;
  snapshot: PipelineSnapshot | null;
  isLoading: boolean;
  error: { messageKey: string; canRetry: boolean } | null;
}): PipelineViewState {
  if (!input.repoPath) return { kind: 'no-repo' };
  if (input.error) return { kind: 'error', ...input.error };
  if (input.isLoading) return { kind: 'loading' };
  if (!input.snapshot) return { kind: 'no-pipeline' };

  const { snapshot } = input;
  if (snapshot.schemaVersion !== SUPPORTED_SNAPSHOT_VERSION) {
    return { kind: 'incompatible', foundVersion: snapshot.schemaVersion || null };
  }
  if (!snapshot.hasPipelineActivity) return { kind: 'no-pipeline' };
  // Ya no se exige la presencia del kit multi-agente ni una conexión con un
  // orquestador: el workspace se muestra con la evidencia de OpenSpec y Git, y
  // resuelve por sí mismo el caso de no tener ningún cambio activo.
  return { kind: 'ready', snapshot };
}
