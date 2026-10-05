// electron/__tests__/opencode-adapter.test.ts
// Pruebas del adaptador de OpenCode mediante `opencode run` (tarea 5.3).

import { describe, expect, it, vi } from 'vitest';
import {
  buildOpenCodeArgs,
  createOpenCodeRuntimeAdapter,
  isValidOpenCodeModelArg,
  isValidOpenCodeSessionId,
  OPENCODE_DESCRIPTOR,
  type OpenCodeStartRequest,
} from '../pipeline/runtime-adapters/opencode-adapter';

function makeRequest(overrides: Partial<OpenCodeStartRequest> = {}): OpenCodeStartRequest {
  return {
    repoId: 'repo-1',
    canonicalRepoPath: '/path/to/repo',
    changeId: null,
    taskId: null,
    runId: 'run-1',
    attemptId: 'att-1',
    parentSessionId: null,
    parentAgentId: null,
    orchestrationMode: 'direct',
    orchestratorRuntime: null,
    provider: null,
    requestedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
    reasoningEffort: null,
    role: 'builder',
    instruction: 'crear archivo seguro',
    ...overrides,
  };
}

describe('opencode-adapter — validación y argumentos', () => {
  it('valida identificadores seguros de modelo y variante', () => {
    expect(isValidOpenCodeModelArg('unslothpclocal/unsloth/Qwen3.8-27B-GGUF')).toBe(true);
    expect(isValidOpenCodeModelArg('unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high')).toBe(true);
    expect(isValidOpenCodeModelArg('lmstudio/qwen-2.5-coder-7b:latest')).toBe(true);
    expect(isValidOpenCodeModelArg('openai/gpt-4.1-mini@exp')).toBe(true);

    // Inválidos
    expect(isValidOpenCodeModelArg('')).toBe(false);
    expect(isValidOpenCodeModelArg(null)).toBe(false);
    expect(isValidOpenCodeModelArg('model; rm -rf /')).toBe(false);
    expect(isValidOpenCodeModelArg('model with spaces')).toBe(false);
    expect(isValidOpenCodeModelArg('model#variant#extra')).toBe(false);
    expect(isValidOpenCodeModelArg('model#')).toBe(false);
    expect(isValidOpenCodeModelArg('model$foo')).toBe(false);
    expect(isValidOpenCodeModelArg('model"quote')).toBe(false);
  });

  it('valida identificadores seguros de sesión', () => {
    expect(isValidOpenCodeSessionId('sess-123.45_abc')).toBe(true);
    expect(isValidOpenCodeSessionId('session:1')).toBe(true);
    expect(isValidOpenCodeSessionId('')).toBe(false);
    expect(isValidOpenCodeSessionId(null)).toBe(false);
    expect(isValidOpenCodeSessionId('sess; echo')).toBe(false);
    expect(isValidOpenCodeSessionId('sess with spaces')).toBe(false);
  });

  it('construye argumentos exactos sin variante: run, -m, --format json, --auto; nunca la instrucción', () => {
    const req = makeRequest({ requestedModel: 'unslothpclocal/qwen-3' });
    const args = buildOpenCodeArgs(req);
    expect(args).toEqual(['run', '-m', 'unslothpclocal/qwen-3', '--format', 'json', '--auto']);
    expect(args).not.toContain('crear archivo seguro');
  });

  it('construye argumentos exactos con variante', () => {
    const req = makeRequest({ requestedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high' });
    const args = buildOpenCodeArgs(req);
    expect(args).toEqual(['run', '-m', 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high', '--format', 'json', '--auto']);
  });

  it('incluye --session si hay resumeSessionId válido', () => {
    const req = makeRequest({ resumeSessionId: 'sess-open-42' });
    const args = buildOpenCodeArgs(req);
    expect(args).toEqual([
      'run',
      '-m',
      'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
      '--format',
      'json',
      '--auto',
      '--session',
      'sess-open-42',
    ]);
  });

  it('rechaza con invalid_model_identifier si el modelo contiene caracteres fuera del patrón', () => {
    const req = makeRequest({ requestedModel: 'malicious/model; echo hi' });
    expect(() => buildOpenCodeArgs(req)).toThrow('invalid_model_identifier');
  });

  it('rechaza con invalid_session_identifier si la sesión contiene caracteres fuera del patrón', () => {
    const req = makeRequest({ resumeSessionId: 'bad; session' });
    expect(() => buildOpenCodeArgs(req)).toThrow('invalid_session_identifier');
  });

  it('al iniciar sesión: pasa la instrucción por stdin y rechaza antes de lanzar si el modelo es inválido', async () => {
    let capturedSpec: any = null;
    const mockRunner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: Buffer.from('2.0.20'), stderr: Buffer.from(''), timedOut: false, durationMs: 5 })),
      start: vi.fn(async (spec: any) => {
        capturedSpec = spec;
        return {
          processId: 'p-1',
          result: Promise.resolve({ exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
          terminate: vi.fn(),
        };
      }),
    };

    const adapter = createOpenCodeRuntimeAdapter('/path/to/repo', mockRunner as any);

    // Descubrimiento correcto
    const disc = await adapter.discover();
    expect(disc.installed).toBe(true);

    // Con modelo inválido: no lanza el proceso
    await expect(adapter.start(makeRequest({ requestedModel: 'invalido $(cmd)' }))).rejects.toThrow('invalid_model_identifier');
    expect(mockRunner.start).not.toHaveBeenCalled();

    // Con modelo válido: pasa la instrucción por stdin, nunca en args
    await adapter.start(makeRequest({ instruction: 'instruccion secreta para el agente' }));
    expect(mockRunner.start).toHaveBeenCalledTimes(1);
    expect(capturedSpec.args).toEqual([
      'run',
      '-m',
      'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
      '--format',
      'json',
      '--auto',
    ]);
    expect(capturedSpec.stdin).toBe('instruccion secreta para el agente');
  });
});
