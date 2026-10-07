// electron/__tests__/agy-normalizer.test.ts
//
// Pruebas unitarias del normalizador de eventos para Antigravity (`agy`).
// Tarea 5.2 (Decisión D9, Opción B).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeProjectionBuilder } from '../pipeline/runtime/runtime-projection';
import { AgyStreamNormalizer } from '../pipeline/runtime-adapters/agy-normalizer';
import {
  createPipelineIdentity,
  type EventNormalizationContext,
} from '../pipeline/runtime-adapters/normalization';
import { AGY_DESCRIPTOR } from '../pipeline/runtime-adapters/agy-adapter';
import type { RuntimeStartRequest } from '../pipeline/runtime-adapters/runtime-adapter';

function makeContext(sessionId: string = 'test-session'): EventNormalizationContext {
  const req: RuntimeStartRequest = {
    repoId: 'repo-1',
    canonicalRepoPath: '/path/to/repo',
    changeId: 'change-1',
    taskId: '1.1',
    runId: 'run-1',
    attemptId: 'att-1',
    parentSessionId: null,
    parentAgentId: null,
    orchestrationMode: 'direct',
    orchestratorRuntime: null,
    provider: null,
    requestedModel: 'gemini-3.8-flash-low',
    reasoningEffort: null,
    role: 'builder',
    instruction: 'hacer algo',
  };
  const identity = createPipelineIdentity(req, AGY_DESCRIPTOR);
  identity.sessionId = sessionId;
  return {
    identity,
    descriptor: AGY_DESCRIPTOR,
    instanceId: 'inst-1',
    observedAt: '2026-10-05T12:00:00.000Z',
    sequence: 0,
    sourceEventId: null,
  };
}

describe('AgyStreamNormalizer', () => {
  const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/f03/fixtures');

  it('normaliza la captura real agy-1.2.13-stream: detecta denied_actions y concluye con success: false', () => {
    const filePath = path.join(FIXTURES_DIR, 'agy-1.2.13-stream.sanitized.jsonl');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext();

    const allEvents = [];
    for (const line of lines) {
      context.sequence++;
      const record = JSON.parse(line);
      const events = normalizer.normalize(record, context);
      allEvents.push(...events);
    }

    // 1. session.started emitido desde init
    const sessionStarted = allEvents.find((e) => e.kind === 'session.started');
    expect(sessionStarted).toBeDefined();
    expect(sessionStarted?.payload).toMatchObject({
      runtimeVersion: '1.2.13',
      model: 'gemini-3.8-flash-low',
      permissionMode: 'request-review',
    });
    expect(context.identity.sessionId).toBe('<redacted-id-1>');

    // 2. run.started emitido
    const runStarted = allEvents.find((e) => e.kind === 'run.started');
    expect(runStarted).toBeDefined();

    // 3. Herramientas view_file y write_to_file se iniciaron y completaron
    const toolStarts = allEvents.filter((e) => e.kind === 'tool.started');
    expect(toolStarts.map((e) => (e.payload as any).name)).toEqual([
      'view_file',
      'write_to_file',
      'run_command',
    ]);

    const toolCompleted = allEvents.filter((e) => e.kind === 'tool.completed');
    expect(toolCompleted.length).toBe(3);
    const viewFile = toolCompleted.find((e) => (e.payload as any).name === 'view_file');
    expect((viewFile?.payload as any).status).toBe('completed');
    expect((viewFile?.payload as any).output).toBe('2 lines, 28 bytes');

    const writeToFile = toolCompleted.find((e) => (e.payload as any).name === 'write_to_file');
    expect((writeToFile?.payload as any).status).toBe('completed');

    // 4. Herramienta run_command terminó con estado error
    const runCommand = toolCompleted.find((e) => (e.payload as any).name === 'run_command');
    expect((runCommand?.payload as any).status).toBe('error');
    expect((runCommand?.payload as any).error).toContain('permission check failed for command "git status --short"');

    // 5. REGLA D9: aunque result.status diga "SUCCESS", al tener denied_actions de comando
    // la corrida concluye con success: false y emite runtime.error con el motivo
    const runtimeError = allEvents.find((e) => e.kind === 'runtime.error');
    expect(runtimeError).toBeDefined();
    expect((runtimeError?.payload as any).message).toContain('permission check failed for command "git status --short"');

    const runCompleted = allEvents.find((e) => e.kind === 'run.completed');
    expect(runCompleted).toBeDefined();
    expect((runCompleted?.payload as any).success).toBe(false);
    expect((runCompleted?.payload as any).status).toBe('SUCCESS');
    expect((runCompleted?.payload as any).reason).toContain('permission check failed for command "git status --short"');
    expect((runCompleted?.payload as any).deniedActions).toEqual([{ action: 'command', display_name: 'RunCommand' }]);

    // 6. Telemetría reportada
    const telemetry = normalizer.telemetry(context.identity);
    expect(telemetry.usage.inputTokens.value).toBe(38324);
    expect(telemetry.usage.outputTokens.value).toBe(361);
    expect(telemetry.usage.reasoningTokens.value).toBe(0);
    expect(telemetry.usage.cacheReadTokens.value).toBe(0);
    expect(telemetry.cost.usd.value).toBeNull();
    expect(telemetry.cost.billingStatus).toBe('unknown');
    expect(telemetry.context.maxTokens.value).toBeNull();
  });

  it('normaliza la captura real agy-1.2.13-resume: conserva sessionId y concluye con success: true', () => {
    const filePath = path.join(FIXTURES_DIR, 'agy-1.2.13-resume.sanitized.jsonl');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext();

    const allEvents = [];
    for (const line of lines) {
      context.sequence++;
      const record = JSON.parse(line);
      const events = normalizer.normalize(record, context);
      allEvents.push(...events);
    }

    expect(context.identity.sessionId).toBe('<redacted-id-1>');

    // Mensajes emitidos
    const messages = allEvents.filter((e) => e.kind === 'agent.message');
    expect(messages.length).toBeGreaterThan(0);

    // Corrida exitosa
    const runCompleted = allEvents.find((e) => e.kind === 'run.completed');
    expect(runCompleted).toBeDefined();
    expect((runCompleted?.payload as any).success).toBe(true);

    const telemetry = normalizer.telemetry(context.identity);
    expect(telemetry.usage.inputTokens.value).toBe(51904);
    expect(telemetry.usage.outputTokens.value).toBe(365);
  });

  it('corrida exitosa limpia sin denied_actions: run.completed es success: true', () => {
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext();

    normalizer.normalize({ event: 'init', conversation_id: 'conv-clean', init: { model: 'gemini-3.8-flash' } }, context);
    normalizer.normalize({ event: 'step_update', step_update: { step_type: 'user_input', state: 'DONE' } }, context);
    normalizer.normalize({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'hola', state: 'DONE' } }, context);
    const resultEvents = normalizer.normalize({
      event: 'result',
      result: {
        conversation_id: 'conv-clean',
        status: 'SUCCESS',
        response: 'hola',
        duration_seconds: 5.2,
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 0, total_tokens: 125 },
        denied_actions: [],
      },
    }, context);

    const completed = resultEvents.find((e) => e.kind === 'run.completed');
    expect(completed).toBeDefined();
    expect((completed?.payload as any).success).toBe(true);
    expect((completed?.payload as any).status).toBe('SUCCESS');

    const telemetry = normalizer.telemetry(context.identity);
    expect(telemetry.usage.inputTokens.value).toBe(100);
    expect(telemetry.usage.outputTokens.value).toBe(20);
    expect(telemetry.usage.reasoningTokens.value).toBe(5);
    expect(telemetry.reasoningVisibility).toBe('summary');
  });

  it('corrida con fallo (status ERROR): emite runtime.error y run.completed con success: false', () => {
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext();

    normalizer.normalize({ event: 'init', conversation_id: 'conv-err', init: { model: 'gemini-3.8-flash' } }, context);
    const resultEvents = normalizer.normalize({
      event: 'result',
      result: {
        conversation_id: 'conv-err',
        status: 'ERROR',
        error: 'quota_exceeded',
        response: '',
        duration_seconds: 1,
        num_turns: 0,
      },
    }, context);

    const errorEvent = resultEvents.find((e) => e.kind === 'runtime.error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent?.payload as any).message).toBe('quota_exceeded');

    const completed = resultEvents.find((e) => e.kind === 'run.completed');
    expect(completed).toBeDefined();
    expect((completed?.payload as any).success).toBe(false);
    expect((completed?.payload as any).status).toBe('ERROR');
  });

  it('evento desconocido: no interrumpe la ejecución, cuenta el evento y emite runtime.schema.degraded', () => {
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext();

    const events = normalizer.normalize({ event: 'future_event_type', data: { foo: 'bar' } }, context);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('runtime.schema.degraded');
    expect((events[0].payload as any).sourceType).toBe('future_event_type');
    expect(normalizer.getUnknownEventCount()).toBe(1);
  });

  it('normaliza la captura real agy-1.2.13-resume: captura conversation_id y la identidad queda actualizada', () => {
    const filePath = path.join(FIXTURES_DIR, 'agy-1.2.13-resume.sanitized.jsonl');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const normalizer = new AgyStreamNormalizer();
    const context = makeContext('initial-id');
    const projection = new RuntimeProjectionBuilder({ repoId: context.identity.repoId, sessionId: context.identity.sessionId, runtime: 'agy', changeId: null, taskId: null, role: 'builder', startedAt: '2026-10-07T00:00:00.000Z', controlCapabilities: [] });

    for (const line of lines) {
      context.sequence++;
      const record = JSON.parse(line);
      for (const event of normalizer.normalize(record, context)) projection.ingest(event);
    }

    expect(context.identity.sessionId).toBe('<redacted-id-1>');
    expect(projection.snapshot().runtimeSessionId).toBe('<redacted-id-1>');
  });
});
