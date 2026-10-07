import type {
  PipelineEventEnvelope,
  PipelineRuntime,
  RuntimeActivityChannel,
  RuntimeActivityEntry,
  RuntimeAgentObservation,
  RuntimeAgentState,
  RuntimeProjection,
  RuntimeReasoningVisibility,
  RuntimeTelemetrySnapshot,
  RuntimeTelemetryValues,
  PipelineControlAction,
} from '../../../types/pipeline';
import { PipelineSecuritySanitizer } from '../security/pipeline-security-sanitizer';

/**
 * Pliega el stream de sobres de F03 en la proyección que consume el workspace.
 *
 * Es intencionalmente **puro**: no spawnea, no lee disco y no conoce Electron.
 * Toda la lógica que decide qué se puede afirmar vive acá, así que se puede
 * testear con sobres a mano y sin proceso hijo.
 *
 * Regla de la fase, aplicada al stream: lo que el stream todavía no dijo queda
 * `null`. Y "no lo sabemos aún" nunca se colapsa con "el runtime no lo expone".
 */

/**
 * Tope del buffer de actividad.
 *
 * Un stream de reasoning emite un delta por token: sin tope, una corrida larga
 * se come la memoria de Main. Lo que se descarta se cuenta y se informa en
 * `droppedActivity` — un feed truncado en silencio se leería como completo.
 */
const MAX_ACTIVITY_ENTRIES = 2_000;

/** Tope de diagnósticos retenidos: el mismo error repetido no aporta. */
const MAX_DIAGNOSTICS = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Canal de la bitácora para cada tipo de evento.
 *
 * Nota sobre el canal `file`: ningún normalizador de F03 emite rutas de archivo
 * —las redacta antes de llegar acá—, así que ninguna entrada cae en `file`.
 * Mapear `tool.started` con nombre `Edit` o `Write` a `file` sería inferir que
 * un archivo se tocó a partir de que se pidió una herramienta, y una llamada
 * pedida no es una escritura ocurrida. Queda vacío a propósito.
 */
function channelForKind(kind: string): RuntimeActivityChannel | null {
  if (kind === 'agent.message' || kind === 'agent.message.delta') return 'narrative';
  if (kind === 'reasoning.delta') return 'reasoning';
  if (kind === 'tool.started' || kind === 'tool.completed') return 'tool';
  // `tool.input.delta` sólo transporta un byteLength: una entrada sin texto
  // legible es peor que ninguna entrada.
  if (kind === 'tool.input.delta') return null;
  if (kind.startsWith('session.') || kind.startsWith('agent.') || kind.startsWith('run.')) return 'system';
  if (kind.startsWith('runtime.')) return 'system';
  return 'system';
}

/**
 * Clave de la corriente de fragmentos, o `null` si el evento no es un delta.
 *
 * Sólo los eventos que transportan texto parcial se acumulan. Un `agent.message`
 * completo no lleva clave: llega entero y no tiene nada que absorber.
 */
function coalesceKeyForEvent(kind: string, agentId: string | null): string | null {
  if (kind !== 'agent.message.delta' && kind !== 'reasoning.delta') return null;
  return `${kind}:${agentId ?? 'unknown'}`;
}

/**
 * Une los fragmentos de una actividad ya persistida.
 *
 * Las sesiones guardadas antes de que la acumulación existiera conservan un
 * mensaje partido en varias entradas. Se reparan al cargarlas, con la misma
 * regla que aplica la ingesta.
 *
 * La diferencia con la ingesta es que acá la clase de evento ya se perdió: una
 * entrada guardada no dice si fue un delta o un mensaje completo. Por eso se
 * unen las entradas de narrativa consecutivas del mismo agente, asumiendo que
 * dos mensajes distintos del mismo agente aparecen separados por algún otro
 * evento. Es lo máximo que la evidencia almacenada permite afirmar.
 */
export function coalescePersistedActivity(entries: RuntimeActivityEntry[]): RuntimeActivityEntry[] {
  const merged: RuntimeActivityEntry[] = [];
  for (const entry of entries) {
    const last = merged[merged.length - 1];
    const joinable = entry.channel === 'narrative'
      && last?.channel === 'narrative'
      && last.agentId === entry.agentId;
    if (joinable) {
      merged[merged.length - 1] = { ...last, text: last.text + entry.text, at: entry.at ?? last.at };
      continue;
    }
    merged.push(entry);
  }
  return merged;
}

/**
 * Texto ya legible para cada evento.
 *
 * Los eventos de sistema se describen con una cadena técnica compacta en vez de
 * una clave i18n: es evidencia citable del stream, no prosa de producto, y
 * fabricar claves para cada `kind` posible garantizaría claves faltantes.
 */
function textForEvent(kind: string, payload: unknown): string | null {
  const data = asRecord(payload);
  switch (kind) {
    case 'agent.message':
    case 'agent.message.delta':
      return str(data.text);
    case 'reasoning.delta':
      return str(data.reasoning);
    case 'tool.started': {
      const name = str(data.name);
      return name ? `${name}` : 'tool';
    }
    case 'tool.completed':
      return `${str(data.status) ?? 'completed'}`;
    case 'session.started': {
      const parts = [str(data.model), str(data.runtimeVersion)].filter(Boolean);
      return `session.started${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
    }
    case 'run.completed': {
      const parts = [
        data.success === true ? 'ok' : data.success === false ? 'error' : null,
        str(data.stopReason),
        // El motivo del rechazo se cita acá porque es la línea donde se lee el
        // desenlace del run. Sin él, `run.completed · error` no explica nada.
        str(data.reason),
        num(data.durationMs) !== null ? `${num(data.durationMs)}ms` : null,
      ].filter(Boolean);
      return `run.completed${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
    }
    case 'runtime.process.completed': {
      const exitCode = num(data.exitCode);
      return `process.completed · exit=${exitCode === null ? 'unknown' : exitCode}`;
    }
    case 'runtime.process.failed':
      return `process.failed · ${str(data.reason) ?? 'unknown'}`;
    case 'runtime.error': {
      const message = str(data.message);
      return message ? `runtime.error · ${message}` : 'runtime.error';
    }
    case 'runtime.rate_limit':
      return 'rate_limit';
    default:
      return kind;
  }
}

function isDegraded(kind: string): boolean {
  return kind === 'runtime.schema.degraded'
    || kind === 'runtime.stream.degraded'
    || kind === 'runtime.process.failed';
}

/** Extrae el valor de una `MetricSample`, que ya distingue `null` de medido. */
function metricValue(sample: { value: number | null } | undefined): number | null {
  return sample ? sample.value : null;
}

export function telemetryValues(snapshot: RuntimeTelemetrySnapshot): RuntimeTelemetryValues {
  return {
    inputTokens: metricValue(snapshot.usage.inputTokens),
    outputTokens: metricValue(snapshot.usage.outputTokens),
    reasoningTokens: metricValue(snapshot.usage.reasoningTokens),
    cacheReadTokens: metricValue(snapshot.usage.cacheReadTokens),
    costUsd: metricValue(snapshot.cost.usd),
    costBasis: snapshot.cost.billingStatus === 'reported'
      ? 'runtime_reported'
      : snapshot.cost.billingStatus === 'estimated'
        ? 'estimated'
        : snapshot.cost.billingStatus === 'included_plan'
          ? 'included_plan'
          : snapshot.cost.billingStatus === 'local_unpriced'
            ? 'local_unpriced'
            : 'unknown',
    contextMaxTokens: metricValue(snapshot.context.maxTokens),
    contextCurrentTokens: metricValue(snapshot.context.currentTokens),
    compactionCount: metricValue(snapshot.context.compactionCount),
  };
}

type AgentAccumulator = {
  observation: RuntimeAgentObservation;
  /** `true` si el agente llegó a emitir su propio `agent.completed`. */
  sawCompletion: boolean;
};

export interface RuntimeProjectionInit {
  repoId: string;
  sessionId: string;
  runtime: PipelineRuntime;
  changeId: string | null;
  taskId: string | null;
  role: string;
  startedAt: string;
  controlCapabilities: PipelineControlAction[];
  runtimeSessionId?: string | null;
  requestedModel?: string | null;
  reasoningEffort?: string | null;
  continuesSessionId?: string | null;
}

export class RuntimeProjectionBuilder {
  private readonly agents = new Map<string, AgentAccumulator>();
  private readonly activity: RuntimeActivityEntry[] = [];
  /** Corriente de deltas abierta, o `null` si la última entrada la cerró. */
  private openStream: string | null = null;
  private readonly diagnostics: string[] = [];
  private readonly sanitizer = new PipelineSecuritySanitizer();

  private reasoningVisibility: RuntimeReasoningVisibility = 'unknown';
  private telemetry: RuntimeTelemetryValues | null = null;
  private droppedActivity = 0;
  private active = true;
  private outcome: RuntimeProjection['outcome'] = 'running';
  private endedAt: string | null = null;
  private runtimeSessionId: string | null;
  private readonly requestedModel: string | null;
  private readonly reasoningEffort: string | null;
  private readonly continuesSessionId: string | null;

  constructor(private readonly init: RuntimeProjectionInit) {
    this.runtimeSessionId = init.runtimeSessionId ?? null;
    this.requestedModel = init.requestedModel ?? null;
    this.reasoningEffort = init.reasoningEffort ?? null;
    this.continuesSessionId = init.continuesSessionId ?? null;
  }

  ingest(event: PipelineEventEnvelope): void {
    if (this.runtimeSessionId === null && event.identity.sessionId && event.identity.sessionId !== this.init.sessionId) {
      this.runtimeSessionId = event.identity.sessionId;
    }

    this.trackAgent(event);
    this.trackReasoning(event);

    if (isDegraded(event.kind) && this.diagnostics.length < MAX_DIAGNOSTICS) {
      this.diagnostics.push(`${event.kind}: ${JSON.stringify(event.payload).slice(0, 200)}`);
    }

    const channel = channelForKind(event.kind);
    if (!channel) return;
    const rawText = textForEvent(event.kind, event.payload);
    if (rawText === null) return;

    this.push({
      entryId: event.eventId,
      channel,
      // Doble red: el normalizador ya redacta ids, y el sanitizador de F08
      // vuelve a pasar por el texto libre que sí llega del modelo.
      text: this.sanitizer.sanitizeOutput(rawText),
      at: event.emittedAt ?? event.observedAt,
      agentId: event.identity.agentId,
    }, coalesceKeyForEvent(event.kind, event.identity.agentId));
  }

  addObservedActivity(entry: RuntimeActivityEntry): void {
    this.push({ ...entry, text: this.sanitizer.sanitizeOutput(entry.text) });
  }

  /**
   * Cierra la sesión.
   *
   * Un agente que seguía corriendo cuando el stream se cortó queda `unknown`,
   * no `done`: dejamos de observarlo, que no es lo mismo que verlo terminar.
   * Sólo un fallo explícito del proceso lo marca `failed`.
   */
  close(endedAt: string, outcome: Exclude<RuntimeProjection['outcome'], 'running' | 'unknown'>): void {
    this.active = false;
    this.outcome = outcome;
    this.endedAt = endedAt;
    this.push({
      entryId: `${this.init.sessionId}:${outcome}`,
      channel: 'system',
      text: `session.${outcome}`,
      at: endedAt,
      agentId: null,
    });
    for (const accumulator of this.agents.values()) {
      if (accumulator.observation.state !== 'running') continue;
      accumulator.observation.state = outcome === 'failed'
        ? 'failed'
        : accumulator.sawCompletion ? 'done' : 'unknown';
    }
  }

  setTelemetry(snapshot: RuntimeTelemetrySnapshot): void {
    this.telemetry = telemetryValues(snapshot);
    // La telemetría es la palabra final sobre visibilidad de reasoning: si el
    // stream no emitió ninguno pero el runtime declara que no lo expone, se
    // dice; si sólo no lo vimos, se queda en `unknown`.
    if (snapshot.reasoningVisibility === 'emitted' || snapshot.reasoningVisibility === 'summary') {
      this.reasoningVisibility = snapshot.reasoningVisibility;
    } else if (this.reasoningVisibility === 'unknown') {
      this.reasoningVisibility = 'unavailable';
    }
  }

  addDiagnostic(message: string): void {
    if (this.diagnostics.length < MAX_DIAGNOSTICS) this.diagnostics.push(message);
  }

  snapshot(): RuntimeProjection {
    return {
      schemaVersion: '1.0',
      repoId: this.init.repoId,
      sessionId: this.init.sessionId,
      runtime: this.init.runtime,
      changeId: this.init.changeId,
      taskId: this.init.taskId,
      role: this.init.role,
      active: this.active,
      outcome: this.outcome,
      startedAt: this.init.startedAt,
      endedAt: this.endedAt,
      agents: [...this.agents.values()].map((entry) => ({ ...entry.observation })),
      activity: [...this.activity],
      reasoningVisibility: this.reasoningVisibility,
      telemetry: this.telemetry,
      controlCapabilities: [...this.init.controlCapabilities],
      droppedActivity: this.droppedActivity,
      diagnostics: [...this.diagnostics],
      runtimeSessionId: this.runtimeSessionId,
      requestedModel: this.requestedModel,
      reasoningEffort: this.reasoningEffort,
      continuesSessionId: this.continuesSessionId,
    };
  }

  /**
   * Agrega una entrada, acumulando los deltas consecutivos del mismo agente.
   *
   * Un runtime que emite mensajes parciales manda el texto en fragmentos, y sin
   * acumularlos la actividad muestra un mensaje partido en varias entradas que
   * empiezan a mitad de palabra. `coalesceKey` identifica la corriente abierta:
   * mientras no cambie, el texto se concatena sobre la última entrada.
   *
   * Cualquier entrada sin clave —o con una clave distinta— cierra la corriente,
   * así el orden observado se conserva y dos agentes nunca se mezclan.
   */
  private push(entry: RuntimeActivityEntry, coalesceKey: string | null = null): void {
    const last = this.activity[this.activity.length - 1];
    if (coalesceKey !== null && coalesceKey === this.openStream && last !== undefined) {
      // Se reemplaza en vez de mutar: la proyección entrega copias superficiales
      // y mutar una entrada ya leída la cambiaría a espaldas del consumidor.
      // El saneo corre sobre el texto unido, así un secreto partido entre dos
      // fragmentos tampoco se escapa.
      this.activity[this.activity.length - 1] = {
        ...last,
        text: this.sanitizer.sanitizeOutput(last.text + entry.text),
        at: entry.at,
      };
      return;
    }

    this.openStream = coalesceKey;
    this.activity.push(entry);
    if (this.activity.length > MAX_ACTIVITY_ENTRIES) {
      this.activity.shift();
      this.droppedActivity += 1;
    }
  }

  private trackReasoning(event: PipelineEventEnvelope): void {
    if (event.kind !== 'reasoning.delta') return;
    const visibility = str(asRecord(event.payload).visibility);
    if (visibility === 'summary') this.reasoningVisibility = 'summary';
    else this.reasoningVisibility = 'emitted';
  }

  /**
   * Acumula la identidad de cada agente tal como viene en el sobre.
   *
   * `agentId` y `parentAgentId` salen de `PipelineIdentity`: es jerarquía
   * observada por el adaptador, no derivada acá. Si un runtime emite un solo
   * agente, el árbol tiene un solo nodo — y eso es el dato correcto, no una
   * limitación que haya que rellenar.
   *
   * Los tokens por agente quedan fuera a propósito: el stream sólo reporta
   * totales de sesión al final. Repartirlos entre agentes sería inventar una
   * atribución que nadie midió.
   */
  private trackAgent(event: PipelineEventEnvelope): void {
    const { identity } = event;
    const at = event.emittedAt ?? event.observedAt;
    const existing = this.agents.get(identity.agentId);

    const nextState = (current: RuntimeAgentState): RuntimeAgentState => {
      if (event.kind === 'agent.started' || event.kind === 'session.started') return 'running';
      if (event.kind === 'agent.completed') return 'done';
      if (event.kind === 'runtime.process.failed') return 'failed';
      if (event.kind === 'runtime.process.completed') {
        const payload = asRecord(event.payload);
        if (payload.exitCode !== 0 && payload.aborted !== true) return 'failed';
      }
      if (event.kind === 'run.completed') {
        const success = asRecord(event.payload).success;
        if (success === false) return 'failed';
        if (success === true) return 'done';
        return current;
      }
      return current;
    };

    if (!existing) {
      this.agents.set(identity.agentId, {
        observation: {
          agentId: identity.agentId,
          parentAgentId: identity.parentAgentId,
          runtime: identity.runtime,
          provider: identity.provider,
          model: identity.effectiveModel ?? identity.reportedModel ?? identity.requestedModel,
          role: identity.role,
          state: nextState('unknown'),
          firstSeenAt: at,
          lastSeenAt: at,
          elapsedMs: null,
        },
        sawCompletion: event.kind === 'agent.completed',
      });
      return;
    }

    const { observation } = existing;
    observation.state = nextState(observation.state);
    observation.lastSeenAt = at;
    // El modelo efectivo se conoce recién en `session.started`: se actualiza
    // cuando llega, nunca se adivina antes.
    observation.model = identity.effectiveModel ?? identity.reportedModel ?? observation.model;
    if (event.kind === 'agent.completed') existing.sawCompletion = true;

    const first = observation.firstSeenAt ? Date.parse(observation.firstSeenAt) : NaN;
    const last = at ? Date.parse(at) : NaN;
    observation.elapsedMs = Number.isFinite(first) && Number.isFinite(last) && last >= first
      ? last - first
      : observation.elapsedMs;
  }
}
