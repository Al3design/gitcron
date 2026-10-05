// electron/__tests__/runtime-agy.test.ts
//
// Pruebas del adaptador estructurado de Antigravity (`agy`).
// Tarea 5.2 (Decisión D9, Opción B).

import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeProcessRunner,
  createAgyRuntimeAdapter,
  validateRuntimeAdapterContract,
  type RuntimeProcessResult,
  type RuntimeProcessSpec,
} from '../pipeline/runtime-adapters';
import {
  buildAgyArgs,
  isValidAgyModelArg,
  isValidAgySessionId,
  type AgyStartRequest,
} from '../pipeline/runtime-adapters/agy-adapter';

class AgyTestRunner extends RuntimeProcessRunner {
  constructor(private readonly versionOutput: string, private readonly exitCode = 0) {
    super();
  }

  override async run(_spec: RuntimeProcessSpec): Promise<RuntimeProcessResult> {
    return {
      processId: 'version-probe',
      exitCode: this.exitCode,
      signal: null,
      stdout: Buffer.from(this.versionOutput),
      stderr: Buffer.alloc(0),
      durationMs: 1,
      timedOut: false,
      aborted: false,
      outputLimit: null,
    };
  }
}

function makeStartRequest(overrides: Partial<AgyStartRequest> = {}): AgyStartRequest {
  return {
    repoId: 'repo-1',
    canonicalRepoPath: 'C:\\fixture\\repo',
    changeId: null,
    taskId: null,
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
    instruction: 'leer y modificar archivos',
    ...overrides,
  };
}

describe('Antigravity (agy) structured adapter', () => {
  it('cumple con el contrato de adaptador de runtime', () => {
    const adapter = createAgyRuntimeAdapter('C:\\fixture\\repo');
    expect(validateRuntimeAdapterContract(adapter)).toEqual([]);
  });

  it('descubre la versión de referencia 1.2.13 como verificada', async () => {
    const runner = new AgyTestRunner('1.2.13\n');
    const adapter = createAgyRuntimeAdapter('C:\\fixture\\repo', runner, () => '2026-10-05T00:00:00.000Z');

    const discovery = await adapter.discover();
    expect(discovery).toMatchObject({
      installed: true,
      runtimeVersion: '1.2.13',
      evidenceStatus: 'verified',
    });
  });

  it('reporta la versión real observada fuera de la referencia como pending_fixture', async () => {
    const runner = new AgyTestRunner('1.2.17\n');
    const adapter = createAgyRuntimeAdapter('C:\\fixture\\repo', runner);

    const discovery = await adapter.discover();
    expect(discovery.runtimeVersion).toBe('1.2.17');
    expect(discovery.evidenceStatus).toBe('pending_fixture');
    expect(discovery.diagnostics).toContain('Runtime version not verified against a reference');
  });

  it('construye argumentos exactos: -p, instrucción, stream-json, accept-edits; sin --dangerously-skip-permissions', () => {
    const req = makeStartRequest();
    const args = buildAgyArgs(req);
    expect(args).toEqual([
      '-p',
      'leer y modificar archivos',
      '--output-format',
      'stream-json',
      '--mode',
      'accept-edits',
      '--model',
      'gemini-3.8-flash-low',
    ]);
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('agrega --effort y --print-timeout cuando están definidos', () => {
    const req = makeStartRequest({
      reasoningEffort: 'low',
      timeoutMs: 30_000,
    });
    const args = buildAgyArgs(req);
    expect(args).toEqual([
      '-p',
      'leer y modificar archivos',
      '--output-format',
      'stream-json',
      '--mode',
      'accept-edits',
      '--effort',
      'low',
      '--model',
      'gemini-3.8-flash-low',
      '--print-timeout',
      '30s',
    ]);
  });

  it('soporta reanudación con --conversation', () => {
    const req = makeStartRequest({
      resumeSessionId: 'conv-abc-123',
    });
    const args = buildAgyArgs(req);
    expect(args).toEqual([
      '-p',
      'leer y modificar archivos',
      '--output-format',
      'stream-json',
      '--mode',
      'accept-edits',
      '--model',
      'gemini-3.8-flash-low',
      '--conversation',
      'conv-abc-123',
    ]);
  });

  it('valida identificadores de modelo y sesión', () => {
    expect(isValidAgyModelArg('gemini-3.8-flash-low')).toBe(true);
    expect(isValidAgyModelArg('custom/gemini-pro@v1')).toBe(true);
    expect(isValidAgyModelArg('model; bad')).toBe(false);
    expect(isValidAgyModelArg('')).toBe(false);
    expect(isValidAgyModelArg(null)).toBe(false);

    expect(isValidAgySessionId('conv-123.45_abc')).toBe(true);
    expect(isValidAgySessionId('session:1')).toBe(true);
    expect(isValidAgySessionId('bad; session')).toBe(false);
    expect(isValidAgySessionId('')).toBe(false);
    expect(isValidAgySessionId(null)).toBe(false);
  });

  it('rechaza modelo o sesión inválidos al construir argumentos', () => {
    expect(() => buildAgyArgs(makeStartRequest({ requestedModel: 'invalido; cmd' }))).toThrow('invalid_model_identifier');
    expect(() => buildAgyArgs(makeStartRequest({ resumeSessionId: 'invalida; conv' }))).toThrow('invalid_session_identifier');
  });

  it('al iniciar sesión: arranca el runner con agy y los argumentos construidos', async () => {
    let capturedSpec: any = null;
    const mockRunner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: Buffer.from('1.2.13\n'), stderr: Buffer.alloc(0), timedOut: false, durationMs: 5 })),
      start: vi.fn(async (spec: any) => {
        capturedSpec = spec;
        return {
          processId: 'p-agy',
          result: Promise.resolve({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
          terminate: vi.fn(),
        };
      }),
    };

    const adapter = createAgyRuntimeAdapter('C:\\fixture\\repo', mockRunner as any);
    const session = await adapter.start(makeStartRequest());
    expect(session.identity.runtime).toBe('agy');
    expect(mockRunner.start).toHaveBeenCalledTimes(1);
    expect(capturedSpec.executable).toBe('agy');
    expect(capturedSpec.args).toEqual([
      '-p',
      'leer y modificar archivos',
      '--output-format',
      'stream-json',
      '--mode',
      'accept-edits',
      '--model',
      'gemini-3.8-flash-low',
    ]);
  });
});
