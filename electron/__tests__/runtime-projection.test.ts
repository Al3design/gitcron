import { describe, expect, it } from 'vitest';
import type { PipelineEventEnvelope, PipelineIdentity, RuntimeTelemetrySnapshot } from '../../types/pipeline';
import { coalescePersistedActivity, RuntimeProjectionBuilder } from '../pipeline/runtime/runtime-projection';

function identity(over: Partial<PipelineIdentity> = {}): PipelineIdentity {
  return {
    repoId: 'repo-1',
    repoPath: 'C:/repo',
    changeId: null,
    taskId: null,
    runId: 'run-1',
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    parentSessionId: null,
    agentId: 'agent-1',
    parentAgentId: null,
    orchestrationMode: 'direct',
    orchestratorRuntime: null,
    runtime: 'claude',
    provider: null,
    requestedModel: null,
    effectiveModel: null,
    reportedModel: null,
    role: 'builder',
    ...over,
  };
}

function event(
  kind: string,
  payload: unknown = {},
  over: Partial<PipelineEventEnvelope> = {},
): PipelineEventEnvelope {
  return {
    schemaVersion: '1.0',
    eventId: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    sequence: 1,
    sequenceScope: 'instance-1',
    emittedAt: null,
    observedAt: '2026-07-26T00:00:00.000Z',
    identity: identity(),
    kind,
    source: { adapterId: 'claude-code', instanceId: 'instance-1', transport: 'stream-json', protocolVersion: null },
    payload,
    provenance: 'runtime',
    evidenceStatus: 'verified',
    evidenceRefs: [],
    redactionVersion: '1',
    ...over,
  };
}

function builder() {
  return new RuntimeProjectionBuilder({
    repoId: 'repo-1',
    sessionId: 'session-1',
    runtime: 'claude',
    changeId: 'change-1',
    taskId: '1.1',
    role: 'builder',
    startedAt: '2026-07-26T00:00:00.000Z',
    controlCapabilities: ['cancel-run'],
  });
}

function unknownTelemetrySnapshot(over: Partial<RuntimeTelemetrySnapshot> = {}): RuntimeTelemetrySnapshot {
  const sample = (value: number | null) => ({
    metricId: 'm', identity: identity(), dimension: 'tokens' as const, metricName: 'tokens.input' as const,
    value, unit: 'tokens', classification: 'unknown' as const, periodStart: null, periodEnd: null,
    sourceRef: 'test', formula: null, pricingSource: null, pricingAsOf: null, dedupeScope: null,
    evidenceStatus: 'unknown' as const, evidenceRefs: [],
  });
  return {
    usage: {
      inputTokens: sample(null), outputTokens: sample(null), cacheReadTokens: sample(null),
      cacheWriteTokens: sample(null), reasoningTokens: sample(null),
    },
    context: {
      maxTokens: sample(null), currentTokens: sample(null),
      historicalTokens: sample(null), compactionCount: sample(null),
    },
    cost: { usd: sample(null), billingStatus: 'unknown' },
    reasoningVisibility: 'unavailable',
    ...over,
  };
}

describe('RuntimeProjectionBuilder', () => {
  it('starts with reasoning visibility unknown, not unavailable', () => {
    // Antes de que el runtime diga nada no sabemos si expone razonamiento.
    // `unavailable` sería una afirmación sobre el runtime que nadie hizo.
    expect(builder().snapshot().reasoningVisibility).toBe('unknown');
  });

  it('reports reasoning as emitted as soon as the stream carries one', () => {
    const projection = builder();
    projection.ingest(event('reasoning.delta', { reasoning: 'pensando', visibility: 'emitted' }));
    expect(projection.snapshot().reasoningVisibility).toBe('emitted');
  });

  it('keeps telemetry null while the run is still open', () => {
    const projection = builder();
    projection.ingest(event('agent.message', { text: 'hola' }));
    expect(projection.snapshot().telemetry).toBeNull();
  });

  it('never turns a missing metric into zero', () => {
    const projection = builder();
    projection.setTelemetry(unknownTelemetrySnapshot());
    const { telemetry } = projection.snapshot();
    expect(telemetry?.inputTokens).toBeNull();
    expect(telemetry?.costUsd).toBeNull();
    expect(telemetry?.contextMaxTokens).toBeNull();
  });

  it('routes each event kind to its channel', () => {
    const projection = builder();
    projection.ingest(event('agent.message', { text: 'hola' }));
    projection.ingest(event('reasoning.delta', { reasoning: 'pensando' }));
    projection.ingest(event('tool.started', { name: 'Read' }));
    projection.ingest(event('run.completed', { success: true }));
    expect(projection.snapshot().activity.map((entry) => entry.channel))
      .toEqual(['narrative', 'reasoning', 'tool', 'system']);
  });

  // Los normalizadores redactan las rutas antes de llegar acá, así que deducir
  // "archivo" del nombre de la herramienta afirmaría una escritura que nadie
  // observó: una llamada pedida no es un archivo tocado.
  it('never infers the file channel from a tool name', () => {
    const projection = builder();
    projection.ingest(event('tool.started', { name: 'Write' }));
    projection.ingest(event('tool.started', { name: 'Edit' }));
    expect(projection.snapshot().activity.every((entry) => entry.channel === 'tool')).toBe(true);
  });

  it('drops entries with no readable text instead of logging empty nodes', () => {
    const projection = builder();
    projection.ingest(event('tool.input.delta', { byteLength: 12 }));
    expect(projection.snapshot().activity).toHaveLength(0);
  });

  it('redacts secrets that reach the log through free text', () => {
    const projection = builder();
    projection.ingest(event('agent.message', { text: 'usa sk-abcdefghijklmnopqrstuvwxyz123456 para entrar' }));
    expect(projection.snapshot().activity[0].text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(projection.snapshot().activity[0].text).toContain('[REDACTED_SECRET]');
  });

  it('carries the observed hierarchy without deriving one', () => {
    const projection = builder();
    projection.ingest(event('agent.started', {}, { identity: identity({ agentId: 'root' }) }));
    projection.ingest(event('agent.started', {}, { identity: identity({ agentId: 'child', parentAgentId: 'root' }) }));
    const agents = projection.snapshot().agents;
    expect(agents.map((agent) => [agent.agentId, agent.parentAgentId]))
      .toEqual([['root', null], ['child', 'root']]);
  });

  it('leaves an agent unknown when the stream stopped before it finished', () => {
    const projection = builder();
    projection.ingest(event('agent.started'));
    projection.close('2026-07-26T00:01:00.000Z', 'completed');
    // Dejamos de observarlo, que no es lo mismo que verlo terminar.
    expect(projection.snapshot().agents[0].state).toBe('unknown');
  });

  it('marks agents failed only when the process actually failed', () => {
    const projection = builder();
    projection.ingest(event('agent.started'));
    projection.close('2026-07-26T00:01:00.000Z', 'failed');
    expect(projection.snapshot().agents[0].state).toBe('failed');
  });

  it('closes an agent as done when it reported its own completion', () => {
    const projection = builder();
    projection.ingest(event('agent.started'));
    projection.ingest(event('agent.completed'));
    projection.close('2026-07-26T00:01:00.000Z', 'completed');
    expect(projection.snapshot().agents[0].state).toBe('done');
  });

  it('marks agent state failed when runtime.process.completed has non-zero exitCode and not aborted', () => {
    // 1. exitCode: 1 y aborted: false -> failed
    const proj1 = builder();
    proj1.ingest(event('agent.started'));
    proj1.ingest(event('run.completed', { success: true }));
    expect(proj1.snapshot().agents[0].state).toBe('done');
    proj1.ingest(event('runtime.process.completed', { exitCode: 1, aborted: false }));
    expect(proj1.snapshot().agents[0].state).toBe('failed');

    // 2. exitCode: 0 -> done
    const proj2 = builder();
    proj2.ingest(event('agent.started'));
    proj2.ingest(event('run.completed', { success: true }));
    proj2.ingest(event('runtime.process.completed', { exitCode: 0, aborted: false }));
    expect(proj2.snapshot().agents[0].state).toBe('done');

    // 3. aborted: true -> no cambia el desenlace (permanece done)
    const proj3 = builder();
    proj3.ingest(event('agent.started'));
    proj3.ingest(event('run.completed', { success: true }));
    proj3.ingest(event('runtime.process.completed', { exitCode: 1, aborted: true }));
    expect(proj3.snapshot().agents[0].state).toBe('done');
  });

  it('formats runtime.error with message when present, or bare kind when absent', () => {
    const proj1 = builder();
    proj1.ingest(event('runtime.error', { message: 'token revocado' }));
    expect(proj1.snapshot().activity[0].text).toBe('runtime.error · token revocado');

    const proj2 = builder();
    proj2.ingest(event('runtime.error', { message: '' }));
    expect(proj2.snapshot().activity[0].text).toBe('runtime.error');

    const proj3 = builder();
    proj3.ingest(event('runtime.error', {}));
    expect(proj3.snapshot().activity[0].text).toBe('runtime.error');
  });

  it('counts what the bounded buffer dropped instead of truncating silently', () => {
    const projection = builder();
    for (let index = 0; index < 2_050; index += 1) {
      projection.ingest(event('agent.message', { text: `delta ${index}` }));
    }
    const snapshot = projection.snapshot();
    expect(snapshot.activity).toHaveLength(2_000);
    expect(snapshot.droppedActivity).toBe(50);
  });

  it('records stream degradation as a diagnostic', () => {
    const projection = builder();
    projection.ingest(event('runtime.schema.degraded', { reason: 'record_not_object' }));
    expect(projection.snapshot().diagnostics[0]).toContain('runtime.schema.degraded');
  });
});

/**
 * Un runtime que emite mensajes parciales manda el texto en fragmentos. Sin
 * acumularlos, la actividad mostraba un mensaje partido en varias entradas que
 * empezaban a mitad de palabra.
 */
describe('RuntimeProjectionBuilder - narrativa coalescida', () => {
  it('une los deltas consecutivos de un mismo agente en una entrada', () => {
    const projection = builder();
    for (const piece of ['Voy a ', 'leer el ', 'archivo.']) {
      projection.ingest(event('agent.message.delta', { text: piece }));
    }
    const narrative = projection.snapshot().activity.filter((entry) => entry.channel === 'narrative');
    expect(narrative).toHaveLength(1);
    expect(narrative[0].text).toBe('Voy a leer el archivo.');
  });

  it('cierra la acumulacion cuando llega un evento de otra clase', () => {
    const projection = builder();
    projection.ingest(event('agent.message.delta', { text: 'antes' }));
    projection.ingest(event('tool.started', { name: 'Read' }));
    projection.ingest(event('agent.message.delta', { text: 'despues' }));

    const texts = projection.snapshot().activity.map((entry) => entry.text);
    // El orden observado se conserva: el evento intermedio no queda absorbido.
    expect(texts).toEqual(['antes', 'Read', 'despues']);
  });

  it('no mezcla el texto de dos agentes distintos', () => {
    const projection = builder();
    projection.ingest(event('agent.message.delta', { text: 'del uno' }, { identity: identity({ agentId: 'agent-1' }) }));
    projection.ingest(event('agent.message.delta', { text: 'del dos' }, { identity: identity({ agentId: 'agent-2' }) }));

    const narrative = projection.snapshot().activity.filter((entry) => entry.channel === 'narrative');
    expect(narrative).toHaveLength(2);
    expect(narrative[0].text).toBe('del uno');
    expect(narrative[1].text).toBe('del dos');
  });

  it('no absorbe un mensaje completo dentro de una corriente de deltas', () => {
    const projection = builder();
    projection.ingest(event('agent.message.delta', { text: 'parcial' }));
    projection.ingest(event('agent.message', { text: 'completo' }));

    const narrative = projection.snapshot().activity.filter((entry) => entry.channel === 'narrative');
    expect(narrative.map((entry) => entry.text)).toEqual(['parcial', 'completo']);
  });
});

/**
 * Las sesiones guardadas antes de que existiera la acumulacion conservan el
 * mensaje partido. Se reparan al cargarlas: la proyeccion se persiste tal cual
 * y volver a correr la sesion costaria una inferencia paga.
 */
describe('coalescePersistedActivity', () => {
  const entry = (over = {}) => ({
    entryId: 'e', channel: 'narrative' as const, text: '', at: null, agentId: 'agent-1', ...over,
  });

  it('une los fragmentos de narrativa consecutivos del mismo agente', () => {
    const repaired = coalescePersistedActivity([
      entry({ entryId: 'e1', text: 'enido ' }),
      entry({ entryId: 'e2', text: 'central se ' }),
      entry({ entryId: 'e3', text: 'reacomoda' }),
    ]);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].text).toBe('enido central se reacomoda');
    // Conserva el id del primero: la deduplicacion aguas abajo sigue funcionando.
    expect(repaired[0].entryId).toBe('e1');
  });

  it('no une a traves de otro canal ni entre agentes distintos', () => {
    const repaired = coalescePersistedActivity([
      entry({ entryId: 'e1', text: 'uno' }),
      entry({ entryId: 'e2', channel: 'tool', text: 'Read' }),
      entry({ entryId: 'e3', text: 'dos' }),
      entry({ entryId: 'e4', text: 'de otro', agentId: 'agent-2' }),
    ]);
    expect(repaired.map((item) => item.text)).toEqual(['uno', 'Read', 'dos', 'de otro']);
  });

  it('deja intacta una actividad que ya llega entera', () => {
    const entries = [entry({ entryId: 'e1', text: 'mensaje completo' })];
    expect(coalescePersistedActivity(entries)).toEqual(entries);
  });
});

describe('RuntimeProjectionBuilder — campos de reanudación y modelo (tanda 27)', () => {
  it('captura runtimeSessionId del primer evento cuya identidad difiera del id de GitCron', () => {
    const b = new RuntimeProjectionBuilder({
      repoId: 'repo-1',
      sessionId: 'gitcron-session-uuid',
      runtime: 'opencode',
      changeId: null,
      taskId: null,
      role: 'builder',
      startedAt: '2026-10-07T00:00:00.000Z',
      controlCapabilities: [],
    });

    // Inicialmente es null
    expect(b.snapshot().runtimeSessionId).toBeNull();

    // Evento con el id propio de GitCron: no lo captura como runtimeSessionId
    b.ingest(event('agent.message', { text: 'hola' }, {
      identity: identity({ sessionId: 'gitcron-session-uuid', runtime: 'opencode' }),
    }));
    expect(b.snapshot().runtimeSessionId).toBeNull();

    // Evento con el id del runtime de la herramienta (ej. OpenCode ses_...)
    b.ingest(event('agent.message', { text: 'hola' }, {
      identity: identity({ sessionId: 'ses_tool_12345', runtime: 'opencode' }),
    }));
    expect(b.snapshot().runtimeSessionId).toBe('ses_tool_12345');
  });

  it('guarda requestedModel, reasoningEffort, continuesSessionId y preconfigura runtimeSessionId', () => {
    const b = new RuntimeProjectionBuilder({
      repoId: 'repo-1',
      sessionId: 'gitcron-new-session',
      runtime: 'agy',
      changeId: 'ch-1',
      taskId: '1.2',
      role: 'builder',
      startedAt: '2026-10-07T00:00:00.000Z',
      controlCapabilities: [],
      requestedModel: 'gemini-3.8-flash-low',
      reasoningEffort: 'low',
      continuesSessionId: 'gitcron-prev-session',
      runtimeSessionId: 'conv-agy-prev',
    });

    const snap = b.snapshot();
    expect(snap.requestedModel).toBe('gemini-3.8-flash-low');
    expect(snap.reasoningEffort).toBe('low');
    expect(snap.continuesSessionId).toBe('gitcron-prev-session');
    expect(snap.runtimeSessionId).toBe('conv-agy-prev');
  });
});
