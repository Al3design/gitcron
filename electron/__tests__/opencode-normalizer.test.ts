// electron/__tests__/opencode-normalizer.test.ts
// Pruebas del normalizador de eventos de `opencode run` (tarea 5.3).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeProjectionBuilder } from '../pipeline/runtime/runtime-projection';
import type { PipelineIdentity } from '../../types/pipeline';
import { OPENCODE_DESCRIPTOR } from '../pipeline/runtime-adapters/opencode-adapter';
import { OpencodeStreamNormalizer } from '../pipeline/runtime-adapters/opencode-normalizer';
import type { EventNormalizationContext } from '../pipeline/runtime-adapters/normalization';

function makeIdentity(): PipelineIdentity {
  return {
    repoId: 'repo-test',
    repoPath: null,
    changeId: null,
    taskId: null,
    runId: 'run-test',
    attemptId: 'att-test',
    sessionId: 'session-initial',
    parentSessionId: null,
    agentId: 'agent-1',
    parentAgentId: null,
    orchestrationMode: 'direct',
    orchestratorRuntime: null,
    provider: null,
    requestedModel: null,
    effectiveModel: null,
    reportedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
    role: 'builder',
    runtime: 'opencode',
  };
}

function makeContext(identity: PipelineIdentity, seq = 1): EventNormalizationContext {
  return {
    identity,
    descriptor: OPENCODE_DESCRIPTOR,
    instanceId: 'inst-test',
    observedAt: '2026-10-04T12:00:00.000Z',
    sequence: seq,
    sourceEventId: null,
  };
}

describe('OpencodeStreamNormalizer', () => {
  it('procesa run-simple: step_start emite session.started, text emite agent.message, fin sin step_finish reporta telemetría unknown', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-run-simple.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);

    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();
    const envelopes = [];

    let seq = 0;
    for (const line of lines) {
      const record = JSON.parse(line);
      const res = normalizer.normalize(record, makeContext(identity, ++seq));
      envelopes.push(...res);
    }

    // Identidad capturada
    expect(identity.sessionId).toBe('ses_ef7c78f26ffeRDKn8BgJDsMc9R');

    // Eventos emitidos: session.started y agent.message
    expect(envelopes.map((e) => e.kind)).toEqual(['session.started', 'agent.message']);
    expect(envelopes[1].payload).toEqual({ text: 'hola' });

    // Fin sin step_finish: telemetría desconocida sin romper
    const telem = normalizer.telemetry(identity);
    expect(telem.usage.inputTokens.classification).toBe('unknown');
    expect(telem.usage.inputTokens.evidenceRefs).toEqual(['opencode:process.completed']);
    expect(normalizer.getUnknownEventCount()).toBe(0);
  });

  it('procesa run-lee-archivo: herramienta read con estado iniciado y completado, tokens de step_finish acumulados', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-run-lee-archivo.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);

    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();
    const envelopes = [];

    let seq = 0;
    for (const line of lines) {
      const record = JSON.parse(line);
      const res = normalizer.normalize(record, makeContext(identity, ++seq));
      envelopes.push(...res);
    }

    expect(identity.sessionId).toBe('ses_ef7c6fa79ffeLzhKcObfk1ENLW');

    const eventTypes = envelopes.map((e) => e.kind);
    expect(eventTypes).toEqual(['session.started', 'tool.started', 'tool.completed', 'agent.message']);

    // Herramienta read
    const toolStarted = envelopes.find((e) => e.kind === 'tool.started');
    expect(toolStarted?.payload).toEqual(expect.objectContaining({
      name: 'read',
      input: { path: 'C:\\repo\\nota.txt' },
    }));

    const toolCompleted = envelopes.find((e) => e.kind === 'tool.completed');
    expect(toolCompleted?.payload).toEqual(expect.objectContaining({
      name: 'read',
      status: 'completed',
    }));
    expect((toolCompleted?.payload as any)?.output).toContain('La clave del ejercicio es: pera.');

    // Mensaje de texto final
    const msg = envelopes.find((e) => e.kind === 'agent.message');
    expect(msg?.payload).toEqual({ text: 'Pera' });

    // Telemetría con tokens acumulados de step_finish
    const telem = normalizer.telemetry(identity);
    expect(telem.usage.inputTokens.classification).toBe('runtime_reported');
    expect(telem.usage.inputTokens.evidenceRefs).toEqual(['opencode:step_finish']);
    expect(telem.usage.inputTokens.value).toBe(14326);
    expect(telem.usage.outputTokens.value).toBe(132);
    expect(telem.usage.reasoningTokens.value).toBe(0);
  });

  it('un evento desconocido se cuenta en unknownCount y no interrumpe la ejecución ni descarta eventos posteriores', () => {
    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();

    // Evento inventado
    const unknownRes = normalizer.normalize({ type: 'future_opencode_event', foo: 'bar' }, makeContext(identity, 1));
    expect(unknownRes).toHaveLength(1);
    expect(unknownRes[0].kind).toBe('runtime.schema.degraded');
    expect(unknownRes[0].payload).toEqual({ sourceType: 'future_opencode_event', unknownCount: 1 });
    expect(normalizer.getUnknownEventCount()).toBe(1);

    // Evento posterior normal
    const textRes = normalizer.normalize({ type: 'text', part: { text: 'sigue funcionando' } }, makeContext(identity, 2));
    expect(textRes).toHaveLength(1);
    expect(textRes[0].kind).toBe('agent.message');
    expect(textRes[0].payload).toEqual({ text: 'sigue funcionando' });
  });

  it('procesa captura de sesión inicial: captura el sessionID y la proyección guarda runtimeSessionId', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-resume-inicial.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);

    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();
    const projection = new RuntimeProjectionBuilder({ repoId: identity.repoId, sessionId: identity.sessionId, runtime: 'opencode', changeId: null, taskId: null, role: 'builder', startedAt: '2026-10-07T00:00:00.000Z', controlCapabilities: [] });
    const envelopes = [];

    let seq = 0;
    for (const line of lines) {
      const record = JSON.parse(line);
      const res = normalizer.normalize(record, makeContext(identity, ++seq));
      envelopes.push(...res);
      for (const event of res) projection.ingest(event);
    }

    expect(identity.sessionId).toBe('ses_eee02d47effe6J6Faf58inqdZl');
    expect(projection.snapshot().runtimeSessionId).toBe('ses_eee02d47effe6J6Faf58inqdZl');
  });

  it('procesa captura de continuación: mantiene sessionID y emite mensajes', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-resume-continuacion.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);

    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();
    const envelopes = [];

    let seq = 0;
    for (const line of lines) {
      const record = JSON.parse(line);
      const res = normalizer.normalize(record, makeContext(identity, ++seq));
      envelopes.push(...res);
    }

    expect(identity.sessionId).toBe('ses_eee02d47effe6J6Faf58inqdZl');
    const msg = envelopes.find((e) => e.kind === 'agent.message');
    expect(msg?.payload).toEqual({ text: '7341' });
  });

  it('procesa captura de sesión inexistente: sale error con el mensaje original del proveedor sin traducir a sesión inexistente', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-resume-sesion-inexistente.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);

    const normalizer = new OpencodeStreamNormalizer();
    const identity = makeIdentity();
    const envelopes = [];

    let seq = 0;
    for (const line of lines) {
      const record = JSON.parse(line);
      const res = normalizer.normalize(record, makeContext(identity, ++seq));
      envelopes.push(...res);
    }

    expect(identity.sessionId).toBe('ses_noexiste000000000000000');
    const errEvent = envelopes.find((e) => e.kind === 'runtime.error');
    expect(errEvent).toBeDefined();
    expect((errEvent?.payload as any)?.message).toBe("Error from provider (Console): OpenCode's free tier can only be used from within OpenCode");
  });
});
