import type { PipelineEvidenceStatus, PipelineRuntime, RuntimeCapabilityAvailability } from './runtime';

/**
 * Acciones de control supervisado (F05).
 *
 * Vive acá y no en `electron/pipeline/control/control-bus-types.ts` —que la
 * reexporta— porque el renderer necesita nombrarlas para deshabilitar opciones
 * que la sesión no soporta, y `types/` no puede depender de `electron/` sin
 * invertir la dirección de la dependencia.
 */
export type PipelineControlAction =
  | 'pause-delegations'
  | 'pause-after-task'
  | 'steer'
  | 'queue'
  | 'interrupt-turn'
  | 'interrupt-subagent'
  | 'kill-process'
  | 'cancel-run'
  | 'respond-decision';

/**
 * Proyección de una sesión de runtime viva (F03) hacia el workspace (F04).
 *
 * Es lo que Main sabe de una corrida *mientras ocurre*, a diferencia de
 * `PipelineState`, que es lo que quedó escrito en el repo. Las dos fuentes son
 * distintas y no se suman: ver `mergeRuntimeIntoSnapshot` en el adaptador.
 *
 * La regla de honestidad de F04 sigue vigente y acá es más delicada, porque un
 * stream aporta datos parciales por definición: **lo que el stream no dijo
 * todavía queda `null`, no `0`**. Y "no lo sabemos aún" no se colapsa con "el
 * runtime no lo expone": son estados distintos y se distinguen en el tipo.
 */

export type RuntimeActivityChannel = 'narrative' | 'reasoning' | 'tool' | 'file' | 'system';

export interface RuntimeActivityEntry {
  entryId: string;
  channel: RuntimeActivityChannel;
  /** Texto ya sanitizado en Main. El renderer nunca lo interpreta como HTML. */
  text: string;
  at: string | null;
  agentId: string | null;
}

export type RuntimeAgentState = 'running' | 'done' | 'failed' | 'unknown';

export interface RuntimeAgentObservation {
  agentId: string;
  /** Jerarquía **observada** en `PipelineIdentity`, no derivada ni inventada. */
  parentAgentId: string | null;
  runtime: PipelineRuntime;
  provider: string | null;
  model: string | null;
  role: string;
  state: RuntimeAgentState;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /**
   * Medido localmente entre el primer y el último evento del agente. Es
   * `locally_measured`, no lo reporta el runtime: por eso no pisa `durationMs`
   * de la evidencia del repo cuando ésta existe.
   */
  elapsedMs: number | null;
}

/**
 * Visibilidad del razonamiento.
 *
 * `unknown` existe justamente por la regla: antes de que la sesión diga algo no
 * sabemos si este runtime expone reasoning. Colapsarlo a `unavailable` haría
 * que la UI afirmara "este runtime no expone su razonamiento" sin evidencia.
 */
export type RuntimeReasoningVisibility = 'emitted' | 'summary' | 'unavailable' | 'unknown';

export type RuntimeSessionOutcome = 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export interface RuntimeTelemetryValues {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  costUsd: number | null;
  costBasis: 'runtime_reported' | 'estimated' | 'included_plan' | 'local_unpriced' | 'unknown';
  contextMaxTokens: number | null;
  contextCurrentTokens: number | null;
  compactionCount: number | null;
}

export interface RuntimeProjection {
  schemaVersion: '1.0';
  repoId: string;
  sessionId: string;
  runtime: PipelineRuntime;
  changeId: string | null;
  taskId: string | null;
  role: string;
  /** `true` mientras el proceso vive y el stream sigue abierto. */
  active: boolean;
  outcome: RuntimeSessionOutcome;
  startedAt: string;
  endedAt: string | null;
  agents: RuntimeAgentObservation[];
  activity: RuntimeActivityEntry[];
  reasoningVisibility: RuntimeReasoningVisibility;
  /**
   * `null` hasta que la corrida termina: `telemetry()` del adaptador espera a
   * que cierre el proceso. Durante la corrida no se estima nada.
   */
  telemetry: RuntimeTelemetryValues | null;
  /**
   * Acciones de control que esta sesión soporta **de verdad**, según lo que la
   * clase del adaptador implementa. No se copia del descriptor: el descriptor
   * declara capacidades de protocolo, no de control humano.
   */
  controlCapabilities: PipelineControlAction[];
  /** Entradas descartadas por el buffer acotado. Se informa, no se oculta. */
  droppedActivity: number;
  /** Diagnósticos de degradación del stream (esquema desconocido, cortes). */
  diagnostics: string[];
  /** Id de la sesión interna de la herramienta (OpenCode, Antigravity, Claude, Codex). */
  runtimeSessionId?: string | null;
  /** Modelo solicitado al lanzar la sesión. */
  requestedModel?: string | null;
  /** Nivel de esfuerzo de razonamiento solicitado al lanzar. */
  reasoningEffort?: string | null;
  /** Id de la corrida de GitCron que esta sesión continúa, o null. */
  continuesSessionId?: string | null;
}

export interface RuntimeDiscoveryEntry {
  runtime: PipelineRuntime;
  adapterId: string;
  installed: boolean;
  runtimeVersion: string | null;
  /** `true` cuando el binario está y el adaptador declara `start()`. */
  launchable: boolean;
  /**
   * Estado de evidencia del runtime, informativo y no bloqueante.
   *
   * `verified` cuando hubo handshake/observación viva que respalda la versión;
   * `pending_fixture` cuando la versión no se contrastó contra una referencia.
   * Tras retirar el gate de versión, esto NO decide `launchable`: el renderer lo
   * usa sólo para avisar a la persona si el runtime está verificado.
   */
  evidenceStatus?: PipelineEvidenceStatus;
  /**
   * Disponibilidad declarada de `session.start` por el adaptador.
   *
   * `launchable` dice si el proceso puede abrirse; esto dice **con qué alcance**.
   * Hoy los adaptadores nativos corren con herramientas de sólo lectura y lo
   * declaran como `degraded`: un botón que prometa "el agente trabaja la tarea"
   * estaría afirmando algo que el adaptador niega.
   */
  startAvailability: RuntimeCapabilityAvailability;
  /** Restricciones declaradas de `session.start`, tal como las emite el adaptador. */
  startConstraints: string[];
  /**
   * `true` cuando una sesión de este runtime puede escribir en el working tree.
   * El renderer lo usa para exigir confirmación explícita antes de arrancar: un
   * agente que edita el repo no puede lanzarse con un solo clic.
   */
  startModifiesRepo: boolean;
  /**
   * `true` cuando una sesión de este runtime puede ejecutar comandos / pruebas
   * en el repositorio.
   */
  startRunsCommands?: boolean;
  /** `true` cuando el runtime admite reanudar una sesión previa de forma comprobada. */
  canResume?: boolean;
  diagnostics: string[];
}

export type PipelineDiscoveryEntry = RuntimeDiscoveryEntry;
