import { randomUUID } from 'node:crypto';
import type {
  PipelineAgentRole,
  PipelineControlAction,
  PipelineRuntime,
  RuntimeDiscoveryEntry,
  RuntimeProjection,
  RuntimeSession,
} from '../../../types/pipeline';
import type { PipelineControlBus } from '../control/control-bus';
import { createClaudeRuntimeAdapter } from '../runtime-adapters/claude-adapter';
import { createCodexRuntimeAdapter } from '../runtime-adapters/codex-adapter';
import { createAgyRuntimeAdapter } from '../runtime-adapters/agy-adapter';
import { createOpenCodeRuntimeAdapter } from '../runtime-adapters/opencode-adapter';
import { asRecord } from '../runtime-adapters/normalization';
import type { RuntimeAdapter } from '../runtime-adapters/runtime-adapter';
import { RuntimeProjectionBuilder } from './runtime-projection';
import type { RuntimeSessionEvidenceCollector, RuntimeWorkingTreeEvidence } from './runtime-session-evidence';

/**
 * Dueño de las sesiones de runtime vivas en Main.
 *
 * Es la pieza que faltaba entre F03 y F04: los adaptadores existían y el
 * workspace existía, pero nadie llamaba `start()` ni drenaba `events()`, así
 * que los tres huecos del handoff (§6) estaban cableados a constantes.
 *
 * Responsabilidades, y ninguna más:
 * - abrir y cerrar sesiones sobre los adaptadores de F03;
 * - drenar el stream hacia una proyección acotada (`RuntimeProjectionBuilder`);
 * - registrar la sesión en el bus de control de F05, con las capacidades que el
 *   adaptador **implementa de verdad**;
 * - avisar a quien corresponda que la proyección cambió.
 *
 * No decide UI ni traduce. La persistencia se delega a un repositorio inyectado
 * para que una corrida cerrada siga existiendo después de reiniciar GitCron.
 */

/**
 * Ventana de coalescencia de avisos al renderer.
 *
 * Un stream de reasoning emite un delta por token. Empujar un IPC por evento
 * congelaría el renderer, así que los avisos se agrupan por ventana. No se usa
 * `TokenDeltaBatcher` (F08) porque ése suma cantidades de tokens; acá hay que
 * coalescer notificaciones, que es otra cosa.
 */
const NOTIFY_WINDOW_MS = 120;

/**
 * Capacidades de control por familia de adaptador.
 *
 * Se declaran a partir de lo que la clase implementa, NO del `descriptor`: el
 * descriptor declara capacidades de protocolo (`events.stream`,
 * `telemetry.snapshot`), que no son acciones de control humano.
 *
 * `StructuredCliRuntimeAdapter` cierra su stdin apenas manda la instrucción, así
 * que no puede recibir una respuesta de decisión ni un `steer` a mitad de
 * corrida. Declararlos haría que el bus aceptara un comando que nadie va a
 * ejecutar; omitirlos hace que lo rechace con `CAPABILITY_UNSUPPORTED`, que es
 * el estado real.
 */
const STRUCTURED_CLI_CONTROLS: PipelineControlAction[] = ['cancel-run', 'kill-process'];

type AdapterEntry = {
  runtime: PipelineRuntime;
  executable?: string;
  create: (canonicalRepoPath: string, executable?: string) => RuntimeAdapter;
  controlCapabilities: PipelineControlAction[];
  /**
   * `false` para adaptadores que no implementan `start()` con stream — hoy
   * `agy` (wrapper de ciclo de vida) y `lmstudio` (proveedor). Se listan igual
   * en discovery para que la UI pueda decir por qué no se ofrecen, en vez de
   * ocultarlos y parecer que no existen.
   */
  launchable: boolean;
  /**
   * `true` cuando una sesión de este adaptador puede escribir en el working
   * tree. Se declara acá, explícito por adaptador, en vez de inferirse de los
   * argumentos: una sesión que edita el repo exige confirmación humana, y esa
   * decisión no puede depender de leer un string de flags.
   */
  modifiesRepo: boolean;
  /**
   * `true` cuando una sesión de este adaptador puede ejecutar comandos / pruebas
   * en el repositorio.
   */
  runsCommands?: boolean;
};

/**
 * LM Studio queda fuera a propósito: su descriptor declara `runtime: 'unknown'`
 * porque es un **proveedor de modelos**, no un runtime de agente, y la unión
 * `PipelineRuntime` lo excluye deliberadamente. Meterlo acá bajo `'unknown'` le
 * inventaría una identidad de runtime que su propio adaptador se niega a
 * afirmar.
 */
const ADAPTERS: AdapterEntry[] = [
  { runtime: 'claude', create: (repo) => createClaudeRuntimeAdapter(repo), controlCapabilities: STRUCTURED_CLI_CONTROLS, launchable: true, modifiesRepo: true, runsCommands: true },
  { runtime: 'codex', create: (repo) => createCodexRuntimeAdapter(repo), controlCapabilities: STRUCTURED_CLI_CONTROLS, launchable: true, modifiesRepo: true, runsCommands: true },
  { runtime: 'agy', create: (repo) => createAgyRuntimeAdapter(repo), controlCapabilities: STRUCTURED_CLI_CONTROLS, launchable: true, modifiesRepo: true, runsCommands: false },
  {
    runtime: 'opencode',
    create: (repo) => createOpenCodeRuntimeAdapter(repo),
    controlCapabilities: STRUCTURED_CLI_CONTROLS,
    launchable: true,
    modifiesRepo: true,
    runsCommands: true,
  },
];

export interface StartRuntimeSessionInput {
  canonicalRepoPath: string;
  repoId: string;
  runtime: PipelineRuntime;
  instruction: string;
  role: PipelineAgentRole;
  requestedModel: string | null;
  reasoningEffort?: string | null;
  changeId: string | null;
  taskId: string | null;
}

export type StartRuntimeSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

type LiveSession = {
  sessionId: string;
  repoPath: string;
  adapter: RuntimeAdapter;
  session: RuntimeSession;
  builder: RuntimeProjectionBuilder;
  abort: AbortController;
  drained: Promise<void>;
  stopRequested: boolean;
  workingTreeBefore: RuntimeWorkingTreeEvidence | null;
};

export interface RuntimeSessionHistoryStore {
  persistRuntimeProjection(projection: RuntimeProjection): void;
  loadRuntimeProjections(repoId: string, limit?: number): RuntimeProjection[];
}

export class RuntimeSessionHub {
  private readonly live = new Map<string, LiveSession>();
  private readonly notifyTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly controlBus: Pick<PipelineControlBus, 'registerSession' | 'unregisterSession'>,
    private readonly onProjectionChanged: (repoPath: string) => void,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly adapters: AdapterEntry[] = ADAPTERS,
    private readonly historyStore: RuntimeSessionHistoryStore | null = null,
    private readonly evidenceCollector: RuntimeSessionEvidenceCollector | null = null,
  ) {}

  /** Qué runtimes hay instalados y cuáles se pueden lanzar de verdad. */
  async discover(canonicalRepoPath: string): Promise<RuntimeDiscoveryEntry[]> {
    return Promise.all(this.adapters.map(async (entry) => {
      const adapter = entry.create(canonicalRepoPath, entry.executable);
      const discovery = await adapter.discover();
      // El alcance real de una sesión lo declara el adaptador, no lo infiere la
      // UI: hoy los nativos corren con herramientas de sólo lectura y lo dicen
      // en `session.start`. Se propaga para que el renderer no prometa trabajo
      // que el runtime no puede hacer.
      const startCapability = adapter.descriptor.capabilities
        .find((capability) => capability.capabilityId === 'session.start');
      return {
        runtime: entry.runtime,
        adapterId: adapter.descriptor.adapterId,
        installed: discovery.installed,
        runtimeVersion: discovery.runtimeVersion,
        // Metadato informativo, no bloqueante: el renderer lo usa para avisar si
        // el runtime está verificado, no para decidir si se ofrece.
        evidenceStatus: discovery.evidenceStatus,
        startAvailability: startCapability?.availability ?? 'unknown',
        startConstraints: startCapability?.constraints ?? [],
        startModifiesRepo: entry.modifiesRepo,
        startRunsCommands: entry.runsCommands ?? false,
        canResume: adapter.descriptor.capabilities
          .find((capability) => capability.capabilityId === 'session.resume')?.availability === 'available',
        // Lanzable requiere dos cosas: que el adaptador tenga `start()` (lo
        // declara `entry.launchable`) y que el binario esté instalado. La
        // coincidencia de versión con un fixture de referencia dejó de ser
        // condición: ese encuadre se retiró, y exigirlo bloqueaba el arranque
        // en cada actualización de CLI. La verificación sigue como metadato
        // informativo (`evidenceStatus`), no como compuerta.
        launchable: entry.launchable && discovery.installed,
        diagnostics: entry.launchable
          ? discovery.diagnostics
          : [...discovery.diagnostics, 'adapter_has_no_event_stream'],
      };
    }));
  }

  get(canonicalRepoPath: string): RuntimeProjection | null {
    return this.live.get(canonicalRepoPath)?.builder.snapshot() ?? null;
  }

  history(repoId: string, limit = 20): RuntimeProjection[] {
    return this.historyStore?.loadRuntimeProjections(repoId, limit) ?? [];
  }

  async start(input: StartRuntimeSessionInput): Promise<StartRuntimeSessionResult> {
    const instruction = input.instruction.trim();
    if (!instruction) return { ok: false, error: 'instruction_required' };

    const existing = this.live.get(input.canonicalRepoPath);
    // Una sesión por repo: dos corridas simultáneas sobre el mismo working tree
    // se pisarían los archivos y la vista no podría atribuir qué hizo cuál.
    if (existing?.builder.snapshot().active) return { ok: false, error: 'session_already_active' };

    const entry = this.adapters.find((candidate) => candidate.runtime === input.runtime);
    if (!entry) return { ok: false, error: 'unknown_runtime' };
    if (!entry.launchable) return { ok: false, error: 'runtime_not_launchable' };

    const adapter = entry.create(input.canonicalRepoPath, entry.executable);
    if (!adapter.start) return { ok: false, error: 'runtime_not_launchable' };

    const abort = new AbortController();
    const workingTreeBefore = this.evidenceCollector
      ? await this.evidenceCollector.captureWorkingTree(input.canonicalRepoPath).catch(() => null)
      : null;
    let session: RuntimeSession;
    try {
      session = await adapter.start({
        repoId: input.repoId,
        canonicalRepoPath: input.canonicalRepoPath,
        changeId: input.changeId,
        taskId: input.taskId,
        runId: randomUUID(),
        attemptId: randomUUID(),
        parentSessionId: null,
        parentAgentId: null,
        orchestrationMode: 'direct',
        // GitCron coordina, pero no es un runtime: nombrarlo acá inventaría un
        // ejecutor que no existe.
        orchestratorRuntime: null,
        provider: null,
        requestedModel: input.requestedModel,
        reasoningEffort: input.reasoningEffort ?? null,
        role: input.role,
        instruction,
        signal: abort.signal,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'start_failed' };
    }

    const builder = new RuntimeProjectionBuilder({
      repoId: input.repoId,
      sessionId: session.identity.sessionId,
      runtime: session.identity.runtime,
      changeId: session.identity.changeId,
      taskId: session.identity.taskId,
      role: session.identity.role,
      startedAt: session.startedAt,
      controlCapabilities: entry.controlCapabilities,
    });

    this.controlBus.registerSession({
      sessionId: session.identity.sessionId,
      repoPath: input.canonicalRepoPath,
      runtime: session.identity.runtime,
      capabilities: entry.controlCapabilities,
    });

    const record: LiveSession = {
      sessionId: session.identity.sessionId,
      repoPath: input.canonicalRepoPath,
      adapter,
      session,
      builder,
      abort,
      drained: Promise.resolve(),
      stopRequested: false,
      workingTreeBefore,
    };
    record.drained = this.drain(record);
    this.live.set(input.canonicalRepoPath, record);
    this.persist(record);
    this.notify(input.canonicalRepoPath);

    return { ok: true, sessionId: session.identity.sessionId };
  }

  /** Termina la sesión del repo. Devuelve `false` si no había ninguna viva. */
  async stop(canonicalRepoPath: string): Promise<boolean> {
    const record = this.live.get(canonicalRepoPath);
    if (!record || !record.builder.snapshot().active) return false;
    record.stopRequested = true;
    record.abort.abort();
    try {
      await record.adapter.shutdown(record.session);
    } catch {
      // `shutdown` ya mató el proceso vía AbortController; que falle el cierre
      // ordenado no debe dejar la sesión colgada en el mapa.
    }
    await record.drained;
    return true;
  }

  /** Cierra todo. Se llama al salir de la app para no dejar procesos huérfanos. */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((repoPath) => this.stop(repoPath)));
    for (const timer of this.notifyTimers.values()) clearTimeout(timer);
    this.notifyTimers.clear();
  }

  private async drain(record: LiveSession): Promise<void> {
    let outcome: 'completed' | 'failed' = 'completed';
    try {
      for await (const event of record.adapter.events(record.session, record.abort.signal)) {
        record.builder.ingest(event);
        // Un fracaso puede venir declarado dentro del stream sin que el proceso
        // falle: un runtime que rechaza la instrucción sale con código 0. Leer
        // sólo el fallo del proceso hacía que la actividad registrara el error y
        // el desenlace afirmara lo contrario, para la misma sesión.
        if (event.kind === 'runtime.process.failed') outcome = 'failed';
        if (event.kind === 'run.completed' && asRecord(event.payload)?.success === false) outcome = 'failed';
        if (event.kind === 'runtime.process.completed') {
          const payload = asRecord(event.payload);
          if (payload && payload.exitCode !== 0 && payload.aborted !== true) outcome = 'failed';
        }
        this.notify(record.repoPath);
      }
    } catch (error) {
      outcome = 'failed';
      record.builder.addDiagnostic(
        `stream_error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    // La telemetría de `StructuredCliRuntimeAdapter` espera a que el proceso
    // cierre, así que recién acá hay totales. Durante la corrida quedan `null`:
    // no se estima nada a mitad de camino.
    try {
      record.builder.setTelemetry(await record.adapter.telemetry(record.session));
    } catch (error) {
      record.builder.addDiagnostic(
        `telemetry_unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    if (this.evidenceCollector) {
      const observedAt = this.now();
      try {
        const after = await this.evidenceCollector.captureWorkingTree(record.repoPath);
        if (record.workingTreeBefore && after.signature !== record.workingTreeBefore.signature) {
          const additions = after.additions === null ? 'unknown' : after.additions;
          const deletions = after.deletions === null ? 'unknown' : after.deletions;
          record.builder.addObservedActivity({
            entryId: `${record.sessionId}:working-tree`,
            channel: 'file',
            text: `git.changed files=${after.filesChanged} additions=${additions} deletions=${deletions}`,
            at: observedAt,
            agentId: null,
          });
        }
      } catch {
        record.builder.addDiagnostic('working_tree_evidence_unavailable');
      }
      if (record.session.identity.changeId) {
        const validation = await this.evidenceCollector.validateChange(record.repoPath, record.session.identity.changeId);
        record.builder.addObservedActivity({
          entryId: `${record.sessionId}:validation`,
          channel: 'system',
          text: `openspec.validation.${validation}`,
          at: this.now(),
          agentId: null,
        });
      }
    }

    record.builder.close(this.now(), record.stopRequested ? 'interrupted' : outcome);
    this.controlBus.unregisterSession(record.sessionId);
    this.flushNotify(record.repoPath);
  }

  private persist(record: LiveSession): void {
    if (!this.historyStore) return;
    try {
      this.historyStore.persistRuntimeProjection(record.builder.snapshot());
    } catch {
      record.builder.addDiagnostic('history_persist_failed');
    }
  }

  /** Aviso coalescido: agrupa ráfagas de deltas en un solo push. */
  private notify(repoPath: string): void {
    if (this.notifyTimers.has(repoPath)) return;
    const timer = setTimeout(() => {
      this.notifyTimers.delete(repoPath);
      const record = this.live.get(repoPath);
      if (record) this.persist(record);
      this.onProjectionChanged(repoPath);
    }, NOTIFY_WINDOW_MS);
    timer.unref?.();
    this.notifyTimers.set(repoPath, timer);
  }

  /** Aviso inmediato: el cierre de sesión no debe esperar la ventana. */
  private flushNotify(repoPath: string): void {
    const timer = this.notifyTimers.get(repoPath);
    if (timer) {
      clearTimeout(timer);
      this.notifyTimers.delete(repoPath);
    }
    const record = this.live.get(repoPath);
    if (record) this.persist(record);
    this.onProjectionChanged(repoPath);
  }
}
