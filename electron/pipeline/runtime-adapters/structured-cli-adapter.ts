import { randomUUID } from 'node:crypto';
import type {
  PipelineEventEnvelope,
  RuntimeDescriptor,
  RuntimeDiscovery,
  RuntimeHealth,
  RuntimeSession,
  RuntimeTelemetrySnapshot,
} from '../../../types/pipeline';
import { AsyncEventQueue } from './async-event-queue';
import { BoundedJsonlDecoder, type JsonlDecodeBatch } from './jsonl-decoder';
import { createPipelineIdentity, envelope, type EventNormalizationContext } from './normalization';
import { RuntimeProcessRunner, type RuntimeProcessHandle, type RuntimeProcessResult } from './process-runner';
import type { RuntimeAdapter, RuntimeResumeRequest, RuntimeStartRequest } from './runtime-adapter';
import type { RuntimeStreamNormalizer } from './stream-normalizer';
import { validateRuntimeSessionRequest } from './conformance';

interface StructuredCliAdapterConfig {
  descriptor: RuntimeDescriptor;
  executable: string;
  versionArgs: string[];
  matchesFixtureVersion(output: string): boolean;
  buildArgs(request: RuntimeStartRequest): string[];
  createNormalizer(): RuntimeStreamNormalizer;
  evidenceRef: string;
}

interface ActiveSession {
  queue: AsyncEventQueue<PipelineEventEnvelope>;
  handle: RuntimeProcessHandle;
  completion: Promise<void>;
  normalizer: RuntimeStreamNormalizer;
}

export class StructuredCliRuntimeAdapter implements RuntimeAdapter {
  readonly descriptor: RuntimeDescriptor;
  private readonly sessions = new WeakMap<RuntimeSession, ActiveSession>();

  constructor(
    private readonly canonicalRepoPath: string,
    private readonly config: StructuredCliAdapterConfig,
    private readonly runner = new RuntimeProcessRunner(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.descriptor = config.descriptor;
  }

  async discover(): Promise<RuntimeDiscovery> {
    try {
      const result = await this.runner.run({
        executable: this.config.executable,
        args: this.config.versionArgs,
        cwd: this.canonicalRepoPath,
        expectedCanonicalCwd: this.canonicalRepoPath,
        timeoutMs: 10_000,
        maxStdoutBytes: 16_384,
        maxStderrBytes: 16_384,
      });
      const installed = result.exitCode === 0 && !result.timedOut && !result.outputLimit;
      // La versión instalada se reporta siempre que el binario responda: es
      // información útil para la persona, independientemente de si coincide con
      // una referencia verificada. Ya no se descarta cuando no coincide.
      const versionOutput = result.stdout.toString('utf8').trim();
      const matchesReference = installed && this.config.matchesFixtureVersion(versionOutput);
      return {
        installed,
        executable: installed ? this.config.executable : null,
        runtimeVersion: installed ? (matchesReference ? this.descriptor.runtimeVersion : versionOutput) : null,
        // `evidenceStatus` es informativo, no bloqueante: que la versión no
        // coincida con una referencia no impide arrancar, sólo se avisa.
        evidenceStatus: matchesReference ? 'verified' : installed ? 'pending_fixture' : 'unknown',
        evidenceRefs: this.config.evidenceRef ? [this.config.evidenceRef] : [],
        diagnostics: matchesReference ? [] : installed ? ['Runtime version not verified against a reference'] : ['Runtime version probe failed'],
      };
    } catch (error) {
      // El motivo medido, no un genérico: si el binario existe pero la app no
      // lo resuelve, el diagnóstico debe decir por qué (camino encontrado,
      // forma no lanzable, PATH usado), no "no disponible".
      return {
        installed: false,
        executable: null,
        runtimeVersion: null,
        evidenceStatus: 'unknown',
        evidenceRefs: this.config.evidenceRef ? [this.config.evidenceRef] : [],
        diagnostics: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async health(): Promise<RuntimeHealth> {
    const startedAt = Date.now();
    const discovery = await this.discover();
    return {
      status: discovery.evidenceStatus === 'verified' ? 'healthy' : discovery.installed ? 'degraded' : 'unavailable',
      checkedAt: this.now(),
      latencyMs: Date.now() - startedAt,
      evidenceStatus: discovery.evidenceStatus,
      evidenceRefs: discovery.evidenceRefs,
      diagnostics: discovery.diagnostics,
    };
  }

  async start(request: RuntimeStartRequest): Promise<RuntimeSession> {
    const requestErrors = validateRuntimeSessionRequest(request);
    if (requestErrors.length) throw new Error(requestErrors.join('; '));
    if (!request.instruction.trim()) throw new Error('instruction is required');
    const discovery = await this.discover();
    if (!discovery.installed) throw new Error('Runtime executable unavailable');
    // El gate de versión se retiró: un runtime instalado arranca aunque su
    // evidencia sea `pending_fixture`. La negociación real del stream abajo es
    // la evidencia viva; exigir fixture bloqueaba cada actualización de CLI.
    const identity = createPipelineIdentity(request, this.descriptor);
    const session: RuntimeSession = {
      identity,
      descriptor: this.descriptor,
      ownedProcess: true,
      startedAt: this.now(),
    };
    const queue = new AsyncEventQueue<PipelineEventEnvelope>();
    const decoder = new BoundedJsonlDecoder();
    const normalizer = this.config.createNormalizer();
    const instanceId = randomUUID();
    let sequence = 0;

    const context = (sourceEventId: string | null = null): EventNormalizationContext => ({
      identity,
      descriptor: this.descriptor,
      instanceId,
      observedAt: this.now(),
      sequence: ++sequence,
      sourceEventId,
    });
    const consume = (batch: JsonlDecodeBatch) => {
      for (const record of batch.records) {
        for (const event of normalizer.normalize(record, context())) queue.push(event);
      }
      for (const diagnostic of batch.diagnostics) {
        queue.push(envelope(context(), 'runtime.stream.degraded', {
          code: diagnostic.code,
          line: diagnostic.line,
        }, 'unknown'));
      }
    };

    const handle = await this.runner.start({
      executable: this.config.executable,
      args: this.config.buildArgs(request),
      cwd: request.canonicalRepoPath,
      expectedCanonicalCwd: this.canonicalRepoPath,
      stdin: request.instruction,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      onStdout: (chunk) => consume(decoder.push(chunk)),
    });

    const completion = handle.result.then((result) => {
      consume(decoder.finish());
      queue.push(this.processCompletedEvent(result, context()));
    }).catch(() => {
      queue.push(envelope(context(), 'runtime.process.failed', { reason: 'spawn_error' }, 'unknown'));
    }).finally(() => queue.close());

    this.sessions.set(session, { queue, handle, completion, normalizer });
    return session;
  }

  async resume(request: RuntimeResumeRequest): Promise<RuntimeSession> {
    return this.start({ ...request, resumeSessionId: request.resumeSessionId ?? request.sessionId });
  }

  async *events(session: RuntimeSession): AsyncIterable<PipelineEventEnvelope> {
    const active = this.requireSession(session);
    yield* active.queue;
  }

  async telemetry(session: RuntimeSession): Promise<RuntimeTelemetrySnapshot> {
    const active = this.requireSession(session);
    await active.completion;
    return active.normalizer.telemetry(session.identity);
  }

  async shutdown(session: RuntimeSession): Promise<void> {
    const active = this.requireSession(session);
    active.handle.terminate();
    await active.completion;
    this.sessions.delete(session);
  }

  private requireSession(session: RuntimeSession): ActiveSession {
    const active = this.sessions.get(session);
    if (!active) throw new Error('Runtime session does not belong to this adapter instance');
    return active;
  }

  private processCompletedEvent(result: RuntimeProcessResult, context: EventNormalizationContext): PipelineEventEnvelope {
    return envelope(context, 'runtime.process.completed', {
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      aborted: result.aborted,
      outputLimit: result.outputLimit,
      stderrBytes: result.stderr.length,
    }, result.exitCode === 0 && !result.timedOut && !result.outputLimit ? 'verified' : 'unknown', 'derived');
  }
}
