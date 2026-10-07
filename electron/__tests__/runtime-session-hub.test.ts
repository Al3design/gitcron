import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PipelineEventEnvelope,
  RuntimeDescriptor,
  RuntimeDiscovery,
  RuntimeHealth,
  RuntimeSession,
  RuntimeTelemetrySnapshot,
  RuntimeProjection,
} from '../../types/pipeline';
import type { RuntimeAdapter, RuntimeStartRequest } from '../pipeline/runtime-adapters/runtime-adapter';
import { RuntimeSessionHub } from '../pipeline/runtime/runtime-session-hub';
import type { RuntimeSessionEvidenceCollector } from '../pipeline/runtime/runtime-session-evidence';

const DESCRIPTOR: RuntimeDescriptor = {
  adapterId: 'fake', runtime: 'claude', adapterKind: 'structured-cli',
  transport: 'test', runtimeVersion: '1.0.0', protocolVersion: null, capabilities: [],
};

const hubFixtureDirectories: string[] = [];

async function hubFixtureDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-runtime-hub-'));
  hubFixtureDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(hubFixtureDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function withPath(pathValue: string, fn: () => Promise<void>): Promise<void> {
  const original = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    await fn();
  } finally {
    process.env.PATH = original;
  }
}

function envelope(kind: string, payload: unknown = {}): PipelineEventEnvelope {
  return {
    schemaVersion: '1.0', eventId: `${kind}-1`, sequence: 1, sequenceScope: 's',
    emittedAt: null, observedAt: '2026-07-26T00:00:00.000Z',
    identity: {
      repoId: 'repo-1', repoPath: 'C:/repo', changeId: null, taskId: null, runId: 'run-1',
      attemptId: 'attempt-1', sessionId: 'session-1', parentSessionId: null, agentId: 'agent-1',
      parentAgentId: null, orchestrationMode: 'direct', orchestratorRuntime: null,
      runtime: 'claude', provider: null, requestedModel: null, effectiveModel: null,
      reportedModel: null, role: 'builder',
    },
    kind,
    source: { adapterId: 'fake', instanceId: 'i', transport: 'test', protocolVersion: null },
    payload, provenance: 'runtime', evidenceStatus: 'verified', evidenceRefs: [], redactionVersion: '1',
  };
}

/** Adaptador de mentira: mismo contrato que F03, sin proceso hijo. */
class FakeAdapter implements RuntimeAdapter {
  // Copia por instancia: un test que agregue capabilities no debe filtrarlas al
  // siguiente a través del descriptor compartido del módulo.
  readonly descriptor: RuntimeDescriptor = { ...DESCRIPTOR, capabilities: [...DESCRIPTOR.capabilities] };
  shutdownCalls = 0;

  constructor(private readonly options: { verified?: boolean; events?: PipelineEventEnvelope[] } = {}) {}

  async discover(): Promise<RuntimeDiscovery> {
    return {
      installed: true, executable: 'fake', runtimeVersion: '1.0.0',
      evidenceStatus: this.options.verified === false ? 'pending_fixture' : 'verified',
      evidenceRefs: [], diagnostics: [],
    };
  }

  async health(): Promise<RuntimeHealth> {
    return { status: 'healthy', checkedAt: '', latencyMs: 0, evidenceStatus: 'verified', evidenceRefs: [], diagnostics: [] };
  }

  async start(request: RuntimeStartRequest): Promise<RuntimeSession> {
    return {
      identity: {
        repoId: request.repoId, repoPath: request.canonicalRepoPath, changeId: request.changeId, taskId: request.taskId,
        runId: request.runId, attemptId: request.attemptId, sessionId: 'session-1',
        parentSessionId: null, agentId: 'agent-1', parentAgentId: null,
        orchestrationMode: 'direct', orchestratorRuntime: null, runtime: 'claude',
        provider: null, requestedModel: request.requestedModel, effectiveModel: null,
        reportedModel: null, role: request.role,
      },
      descriptor: DESCRIPTOR, ownedProcess: true, startedAt: '2026-07-26T00:00:00.000Z',
    };
  }

  async *events(): AsyncIterable<PipelineEventEnvelope> {
    for (const event of this.options.events ?? []) yield event;
  }

  async telemetry(): Promise<RuntimeTelemetrySnapshot> {
    throw new Error('no telemetry');
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }
}

function makeHub(
  adapter: RuntimeAdapter,
  launchable = true,
  evidenceCollector: RuntimeSessionEvidenceCollector | null = null,
  modifiesRepo = false,
) {
  const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
  const notified: string[] = [];
  const history = new Map<string, RuntimeProjection>();
  const historyStore = {
    persistRuntimeProjection: (projection: RuntimeProjection) => history.set(projection.sessionId, structuredClone(projection)),
    loadRuntimeProjections: (repoId: string) => [...history.values()].filter((projection) => projection.repoId === repoId),
  };
  const hub = new RuntimeSessionHub(
    bus,
    (repoPath) => notified.push(repoPath),
    () => '2026-07-26T00:05:00.000Z',
    [{ runtime: 'claude', create: () => adapter, controlCapabilities: ['cancel-run'], launchable, modifiesRepo }],
    historyStore,
    evidenceCollector,
  );
  return { hub, bus, notified, history };
}

const START = {
  canonicalRepoPath: 'C:/repo',
  repoId: 'repo-1',
  runtime: 'claude' as const,
  instruction: 'auditá el repo',
  role: 'builder' as const,
  requestedModel: null,
  changeId: 'change-1',
  taskId: '1.1',
};

describe('RuntimeSessionHub', () => {
  it('reserva el repositorio antes de un arranque asíncrono: dos continuaciones no lanzan dos procesos', async () => {
    const adapter = new FakeAdapter();
    const originalStart = adapter.start.bind(adapter);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const start = vi.spyOn(adapter, 'start').mockImplementation(async (request) => {
      await pending;
      return originalStart(request);
    });
    const { hub } = makeHub(adapter);
    const first = hub.start({ ...START, resumeSessionId: 'tool-session', continuesSessionId: 'parent' });
    const second = hub.start({ ...START, resumeSessionId: 'tool-session', continuesSessionId: 'parent' });
    release();
    const results = await Promise.all([first, second]);
    expect(results[1]).toEqual({ ok: false, error: 'session_already_active' });
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('registers the live session on the control bus with only the capabilities it implements', async () => {
    // Éste es el cuarto hueco: sin este registro el bus rechazaba cualquier
    // comando con UNAUTHORIZED_TARGET y el inbox de decisiones era decorativo.
    const { hub, bus } = makeHub(new FakeAdapter());
    const result = await hub.start(START);
    expect(result).toEqual({ ok: true, sessionId: 'session-1' });
    expect(bus.registerSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      repoPath: 'C:/repo',
      runtime: 'claude',
      capabilities: ['cancel-run'],
    });
  });

  it('does not claim control actions the adapter cannot perform', async () => {
    const { hub } = makeHub(new FakeAdapter());
    await hub.start(START);
    expect(hub.get('C:/repo')?.controlCapabilities).not.toContain('respond-decision');
  });

  it('unregisters the session once the stream closes', async () => {
    const adapter = new FakeAdapter({ events: [envelope('agent.message', { text: 'hola' })] });
    const { hub, bus } = makeHub(adapter);
    await hub.start(START);
    await hub.stop('C:/repo');
    expect(bus.unregisterSession).toHaveBeenCalledWith('session-1');
    expect(hub.get('C:/repo')?.active).toBe(false);
    expect(hub.get('C:/repo')).toMatchObject({ outcome: 'interrupted', changeId: 'change-1', taskId: '1.1' });
  });

  it('refuses a second session on the same repo', async () => {
    const { hub } = makeHub(new FakeAdapter({ events: [] }));
    await hub.start(START);
    // Dos corridas sobre el mismo working tree se pisarían los archivos.
    const second = await hub.start(START);
    expect(second.ok === false && second.error).toBe('session_already_active');
  });

  it('rejects an empty instruction before touching a process', async () => {
    const { hub } = makeHub(new FakeAdapter());
    const result = await hub.start({ ...START, instruction: '   ' });
    expect(result).toEqual({ ok: false, error: 'instruction_required' });
  });

  it('refuses to launch an adapter that has no event stream', async () => {
    const { hub } = makeHub(new FakeAdapter(), false);
    const result = await hub.start(START);
    expect(result).toEqual({ ok: false, error: 'runtime_not_launchable' });
  });

  it('closes the session as failed when a run declares failure without the process failing', async () => {
    // Un runtime que rechaza la instrucción sale con código 0: si el desenlace
    // sólo mirara el proceso, la actividad registraría el error y la sesión
    // afirmaría "finalizada correctamente" en el mismo registro.
    const adapter = new FakeAdapter({
      events: [envelope('run.completed', { success: false, reason: 'Unknown command: /opsx:apply' })],
    });
    const { hub } = makeHub(adapter);
    await hub.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hub.get('C:/repo')).toMatchObject({ active: false, outcome: 'failed' });
    expect(hub.get('C:/repo')?.activity.map((entry) => entry.text)).toContain('session.failed');
  });

  it('describes a session the user stopped as interrupted even after a failed run', async () => {
    const adapter = new FakeAdapter({
      events: [envelope('run.completed', { success: false, reason: 'Unknown command: /opsx:apply' })],
    });
    const { hub } = makeHub(adapter);
    await hub.start(START);
    await hub.stop('C:/repo');

    expect(hub.get('C:/repo')).toMatchObject({ outcome: 'interrupted' });
  });

  it('records a diagnostic instead of crashing when telemetry is unavailable', async () => {
    const adapter = new FakeAdapter({ events: [envelope('run.completed', { success: true })] });
    const { hub } = makeHub(adapter);
    await hub.start(START);
    await hub.stop('C:/repo');
    const projection = hub.get('C:/repo');
    expect(projection?.telemetry).toBeNull();
    expect(projection?.diagnostics.some((line) => line.startsWith('telemetry_unavailable'))).toBe(true);
  });

  it('persists the closed projection so it remains available in session history', async () => {
    const adapter = new FakeAdapter({ events: [envelope('run.completed', { success: true })] });
    const { hub } = makeHub(adapter);
    await hub.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saved] = hub.history('repo-1');
    expect(saved).toMatchObject({
      sessionId: 'session-1',
      changeId: 'change-1',
      taskId: '1.1',
      outcome: 'completed',
      active: false,
    });
  });

  it('adds only locally observed Git and OpenSpec evidence to the durable activity', async () => {
    let captures = 0;
    const evidenceCollector: RuntimeSessionEvidenceCollector = {
      captureWorkingTree: vi.fn(async () => {
        captures += 1;
        return captures === 1
          ? { signature: 'before', filesChanged: 0, additions: 0, deletions: 0 }
          : { signature: 'after', filesChanged: 2, additions: 12, deletions: 3 };
      }),
      validateChange: vi.fn(async () => 'passed' as const),
    };
    const { hub } = makeHub(new FakeAdapter({ events: [envelope('run.completed', { success: true })] }), true, evidenceCollector);
    await hub.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saved] = hub.history('repo-1');
    expect(saved.activity.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      'git.changed files=2 additions=12 deletions=3',
      'openspec.validation.passed',
      'session.completed',
    ]));
  });

  it('marks outcome failed when runtime.process.completed has non-zero exitCode and not aborted', async () => {
    // 1. run.completed success:true seguido de runtime.process.completed exitCode:1 termina en failed
    const { hub: hub1 } = makeHub(new FakeAdapter({
      events: [
        envelope('run.completed', { success: true }),
        envelope('runtime.process.completed', { exitCode: 1, aborted: false }),
      ],
    }));
    await hub1.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saved1] = hub1.history('repo-1');
    expect(saved1.outcome).toBe('failed');

    // 2. con exitCode:0, completed
    const { hub: hub2 } = makeHub(new FakeAdapter({
      events: [
        envelope('run.completed', { success: true }),
        envelope('runtime.process.completed', { exitCode: 0, aborted: false }),
      ],
    }));
    await hub2.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saved2] = hub2.history('repo-1');
    expect(saved2.outcome).toBe('completed');

    // 3. con aborted:true, no cambia el desenlace
    const { hub: hub3 } = makeHub(new FakeAdapter({
      events: [
        envelope('run.completed', { success: true }),
        envelope('runtime.process.completed', { exitCode: 1, aborted: true }),
      ],
    }));
    await hub3.start(START);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saved3] = hub3.history('repo-1');
    expect(saved3.outcome).toBe('completed');
  });

  it('launches an installed runtime even when its version has no verified reference', async () => {
    // El gate de versión se retiró: un runtime instalado es lanzable aunque su
    // evidencia sea `pending_fixture`. La verificación es informativa, no
    // bloqueante.
    const { hub } = makeHub(new FakeAdapter({ verified: false }));
    const [entry] = await hub.discover('C:/repo');
    expect(entry.installed).toBe(true);
    expect(entry.launchable).toBe(true);
  });

  // Un runtime lanzable no es necesariamente un runtime que pueda hacer el
  // trabajo: los adaptadores nativos corren hoy con herramientas de sólo lectura
  // y lo declaran en `session.start`. Si el alcance no viaja al renderer, la UI
  // termina prometiendo algo que el adaptador niega.
  it('propagates the declared scope of session.start to discovery', async () => {
    const adapter = new FakeAdapter();
    adapter.descriptor.capabilities.push({
      capabilityId: 'session.start',
      capabilityVersion: null,
      availability: 'degraded',
      evidenceStatus: 'verified',
      targetScopes: ['repo'],
      constraints: ['read-only tools in F03'],
      evidenceRefs: [],
    });
    const { hub } = makeHub(adapter);
    const [entry] = await hub.discover('C:/repo');
    expect(entry.launchable).toBe(true);
    expect(entry.startAvailability).toBe('degraded');
    expect(entry.startConstraints).toEqual(['read-only tools in F03']);
  });

  it('propagates whether a session can write to the working tree', async () => {
    const [readOnly] = await makeHub(new FakeAdapter()).hub.discover('C:/repo');
    expect(readOnly.startModifiesRepo).toBe(false);

    const [writer] = await makeHub(new FakeAdapter(), true, null, true).hub.discover('C:/repo');
    expect(writer.startModifiesRepo).toBe(true);
  });

  it('reports an unknown scope when the adapter declares no session.start', async () => {
    const { hub } = makeHub(new FakeAdapter());
    const [entry] = await hub.discover('C:/repo');
    expect(entry.startAvailability).toBe('unknown');
    expect(entry.startConstraints).toEqual([]);
  });

  it('shuts every session down on dispose so no process outlives the app', async () => {
    const adapter = new FakeAdapter({ events: [] });
    const { hub } = makeHub(adapter);
    await hub.start(START);
    await hub.disposeAll();
    expect(adapter.shutdownCalls).toBeGreaterThan(0);
  });

  it('discovers OpenCode as launchable when the binary responds', async () => {
    class RespondingOpenCodeAdapter extends FakeAdapter {
      override async discover(): Promise<RuntimeDiscovery> {
        return {
          installed: true,
          executable: 'opencode',
          runtimeVersion: '1.18.3',
          evidenceStatus: 'pending_fixture',
          evidenceRefs: [],
          diagnostics: [],
        };
      }
    }
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(
      bus,
      vi.fn(),
      () => '2026-07-26T00:05:00.000Z',
      [
        { runtime: 'claude', create: () => new FakeAdapter(), controlCapabilities: ['cancel-run'], launchable: true, modifiesRepo: true },
        { runtime: 'opencode', executable: 'opencode', create: () => new RespondingOpenCodeAdapter(), controlCapabilities: ['cancel-run', 'kill-process'], launchable: true, modifiesRepo: true },
      ],
    );
    const discovered = await hub.discover('C:/repo');
    const openCode = discovered.find((entry) => entry.runtime === 'opencode');
    expect(openCode).toBeDefined();
    expect(openCode).toMatchObject({
      runtime: 'opencode',
      installed: true,
      launchable: true,
      startModifiesRepo: true,
    });
  });

  it('lists missing OpenCode with diagnostics without breaking other runtimes', async () => {
    class MissingOpenCodeAdapter extends FakeAdapter {
      override async discover(): Promise<RuntimeDiscovery> {
        return {
          installed: false,
          executable: null,
          runtimeVersion: null,
          evidenceStatus: 'unknown',
          evidenceRefs: [],
          diagnostics: ['OpenCode executable unavailable'],
        };
      }
    }
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(
      bus,
      vi.fn(),
      () => '2026-07-26T00:05:00.000Z',
      [
        { runtime: 'claude', create: () => new FakeAdapter(), controlCapabilities: ['cancel-run'], launchable: true, modifiesRepo: true },
        { runtime: 'opencode', executable: 'opencode', create: () => new MissingOpenCodeAdapter(), controlCapabilities: ['cancel-run', 'kill-process'], launchable: true, modifiesRepo: true },
      ],
    );
    const discovered = await hub.discover('C:/repo');
    const claude = discovered.find((entry) => entry.runtime === 'claude');
    const openCode = discovered.find((entry) => entry.runtime === 'opencode');

    expect(claude).toMatchObject({ runtime: 'claude', installed: true, launchable: true });
    expect(openCode).toMatchObject({
      runtime: 'opencode',
      installed: false,
      launchable: false,
      diagnostics: ['OpenCode executable unavailable'],
    });
  });

  it('includes opencode in default hub discovery along with claude, codex and agy', async () => {
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(bus, vi.fn());
    const discovered = await hub.discover('C:/repo');
    const runtimes = discovered.map((entry) => entry.runtime);
    expect(runtimes).toEqual(['claude', 'codex', 'agy', 'opencode']);
    const openCode = discovered.find((entry) => entry.runtime === 'opencode');
    expect(openCode?.startModifiesRepo).toBe(true);
  });

  it('registers agy as launchable with modifiesRepo: true and runsCommands: false', async () => {
    // Tarea 5.2 (D9, Opción B): Antigravity se lanza para leer y modificar archivos,
    // pero se declara con runsCommands: false.
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(
      bus,
      vi.fn(),
      () => '2026-07-26T00:05:00.000Z',
      [
        {
          runtime: 'agy',
          create: () => new FakeAdapter(),
          controlCapabilities: ['cancel-run', 'kill-process'],
          launchable: true,
          modifiesRepo: true,
          runsCommands: false,
        },
      ],
    );
    const discovered = await hub.discover('C:/repo');
    const agy = discovered.find((entry) => entry.runtime === 'agy');
    expect(agy).toBeDefined();
    expect(agy?.launchable).toBe(true);
    expect(agy?.startModifiesRepo).toBe(true);
    expect(agy?.startRunsCommands).toBe(false);
  });
});

describe.skipIf(process.platform !== 'win32')('installed runtimes through the real PATH', () => {
  it('lists a launchable runtime as installed when its .cmd shim resolves through the application PATH', async () => {
    // Medido: Node/libuv no encuentra `codex`/`opencode` porque solo intenta
    // `.com`/`.exe`; el shim real es un `.cmd`. Con la resolución compartida
    // del runner, el mismo registro default los descubre y los ofrece.
    const fixture = await hubFixtureDirectory();
    await fs.writeFile(path.join(fixture, 'codex.cmd'), '@echo codex-cli 0.143.0\r\n');
    await fs.writeFile(path.join(fixture, 'opencode.CMD'), '@echo 1.18.3\r\n');
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(bus, vi.fn());
    await withPath(`${fixture};${process.env.PATH}`, async () => {
      const discovered = await hub.discover(fixture);
      const codex = discovered.find((entry) => entry.runtime === 'codex');
      const openCode = discovered.find((entry) => entry.runtime === 'opencode');
      // La versión del fixture coincide con la referencia auditada, así que el
      // hub reporta la versión canónica del descriptor, no la salida cruda.
      expect(codex).toMatchObject({ installed: true, launchable: true, runtimeVersion: '0.143.0' });
      expect(openCode).toMatchObject({ installed: true, launchable: true, runtimeVersion: '1.18.3' });
    });
  });

  it('lists an installed-but-unresolvable runtime with the measured reason instead of omitting it', async () => {
    // Si el binario existe pero la app no puede lanzarlo (shim POSIX sin
    // extensión), el diagnóstico dice por qué y con qué entorno se buscó,
    // en vez de un genérico "no disponible".
    const fixture = await hubFixtureDirectory();
    await fs.writeFile(path.join(fixture, 'codex'), '#!/bin/sh\n');
    const bus = { registerSession: vi.fn(), unregisterSession: vi.fn() };
    const hub = new RuntimeSessionHub(bus, vi.fn());
    await withPath(fixture, async () => {
      const discovered = await hub.discover(fixture);
      const codex = discovered.find((entry) => entry.runtime === 'codex');
      expect(codex).toMatchObject({ installed: false, launchable: false });
      expect(codex?.diagnostics.join(' ')).toContain(path.join(fixture, 'codex'));
      expect(codex?.diagnostics.join(' ')).toMatch(/no launchable Windows form/);
      const openCode = discovered.find((entry) => entry.runtime === 'opencode');
      expect(openCode).toMatchObject({ installed: false, launchable: false });
      expect(openCode?.diagnostics.join(' ')).toMatch(/not found in the application environment PATH/);
    });
  });
});
