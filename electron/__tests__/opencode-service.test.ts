// electron/__tests__/opencode-service.test.ts
//
// Pruebas del servicio compartido de OpenCode (tarea 5.3 segunda parte, D8).
//
// - Si `service status` dice que corre, NO se llama `service start`.
// - Si no corre, se llama `service start` con el entorno completo (se comprueba que una variable propia llegó).
// - Subcomandos como `reload` corren con el entorno reducido (sin pasar variables adicionales al runner).

import { describe, expect, it } from 'vitest';
import { ensureOpenCodeService, reloadOpenCode, buildFullEnvironment } from '../ai/config/opencode-service';
import type { RuntimeProcessRunner, RuntimeProcessSpec, RuntimeProcessResult } from '../pipeline/runtime-adapters/process-runner';

describe('opencode-service', () => {
  const mockResult = (overrides: Partial<RuntimeProcessResult> = {}): RuntimeProcessResult => ({
    processId: 'test-proc',
    exitCode: 0,
    signal: null,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    durationMs: 10,
    timedOut: false,
    aborted: false,
    outputLimit: null,
    ...overrides,
  });

  it('buildFullEnvironment filtra variables válidas y excluye bytes nulos', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      SAFE_VAR: 'hello',
      EMPTY_VAR: '',
      NULL_BYTE_VAR: 'bad\0value',
    };
    const built = buildFullEnvironment(env);
    expect(built.SAFE_VAR).toBe('hello');
    expect(built.EMPTY_VAR).toBe('');
    expect(built.NULL_BYTE_VAR).toBeUndefined();
  });

  it('si service status dice que corre, no se llama service start', async () => {
    const executedSpecs: RuntimeProcessSpec[] = [];
    const fakeRunner = {
      run: async (spec: RuntimeProcessSpec) => {
        executedSpecs.push(spec);
        if (spec.args[0] === 'service' && spec.args[1] === 'status') {
          return mockResult({ stdout: Buffer.from('http://127.0.0.1:4096\n') });
        }
        return mockResult();
      },
    } as unknown as RuntimeProcessRunner;

    const res = await ensureOpenCodeService({ runner: fakeRunner, cwd: 'c:\\repo' });
    expect(res).toEqual({ running: true, started: false });
    expect(executedSpecs).toHaveLength(1);
    expect(executedSpecs[0].args).toEqual(['service', 'status']);
    // Status corre con entorno reducido (sin overrides)
    expect(executedSpecs[0].env).toBeUndefined();
  });

  it('un service status que no imprime una dirección no cuenta como «corre»: se arranca', async () => {
    for (const stdout of ['Service is not running\n', 'stopped\n', 'http://\n']) {
      const executed: string[] = [];
      const fakeRunner = {
        run: async (spec: RuntimeProcessSpec) => {
          executed.push(spec.args.join(' '));
          return mockResult({ exitCode: 0, stdout: Buffer.from(spec.args[1] === 'status' ? stdout : 'ok\n') });
        },
      } as unknown as RuntimeProcessRunner;
      const res = await ensureOpenCodeService({ runner: fakeRunner, cwd: 'c:\\repo', env: { NODE_ENV: 'test', PATH: 'x' } });
      expect(executed).toEqual(['service status', 'service start']);
      expect(res.started).toBe(true);
    }
  });

  it('si service status no corre, se llama service start con el entorno completo', async () => {
    const executedSpecs: RuntimeProcessSpec[] = [];
    const testCustomEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: 'C:\\Windows\\system32',
      MI_VARIABLE_DE_PRUEBA: 'secreto_en_entorno_123',
    };

    const fakeRunner = {
      run: async (spec: RuntimeProcessSpec) => {
        executedSpecs.push(spec);
        if (spec.args[0] === 'service' && spec.args[1] === 'status') {
          return mockResult({ exitCode: 1, stdout: Buffer.from('') });
        }
        if (spec.args[0] === 'service' && spec.args[1] === 'start') {
          return mockResult({ exitCode: 0, stdout: Buffer.from('Started service\n') });
        }
        return mockResult();
      },
    } as unknown as RuntimeProcessRunner;

    const res = await ensureOpenCodeService({
      runner: fakeRunner,
      cwd: 'c:\\repo',
      env: testCustomEnv,
    });

    expect(res).toEqual({ running: true, started: true });
    expect(executedSpecs).toHaveLength(2);
    expect(executedSpecs[0].args).toEqual(['service', 'status']);
    expect(executedSpecs[0].env).toBeUndefined(); // Reducido

    expect(executedSpecs[1].args).toEqual(['service', 'start']);
    expect(executedSpecs[1].env).toBeDefined();
    // La prueba mira que una variable propia de la prueba llegó al start
    expect(executedSpecs[1].env?.MI_VARIABLE_DE_PRUEBA).toBe('secreto_en_entorno_123');
  });

  it('reloadOpenCode asegura el servicio y ejecuta reload con el entorno reducido', async () => {
    const executedSpecs: RuntimeProcessSpec[] = [];
    const fakeRunner = {
      run: async (spec: RuntimeProcessSpec) => {
        executedSpecs.push(spec);
        if (spec.args[0] === 'service' && spec.args[1] === 'status') {
          return mockResult({ stdout: Buffer.from('http://127.0.0.1:4096\n') });
        }
        if (spec.args[0] === 'reload') {
          return mockResult({ exitCode: 0 });
        }
        return mockResult();
      },
    } as unknown as RuntimeProcessRunner;

    const res = await reloadOpenCode('c:\\repo', fakeRunner);
    expect(res).toEqual({ ok: true });
    expect(executedSpecs).toHaveLength(2);
    expect(executedSpecs[0].args).toEqual(['service', 'status']);
    expect(executedSpecs[1].args).toEqual(['reload']);
    // reload sigue con el entorno reducido
    expect(executedSpecs[1].env).toBeUndefined();
  });
});
