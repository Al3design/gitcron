// electron/__tests__/opencode-models.test.ts
// Pruebas de parseo, búsqueda y variantes de modelos conocidos por OpenCode (tarea 5.3).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fetchOpenCodeModelList,
  findOpenCodeModel,
  parseOpenCodeModelListJson,
  resolveOpenCodeVariant,
} from '../ai/config/opencode-models';
import type { RuntimeProcessResult, RuntimeProcessSpec } from '../pipeline/runtime-adapters/process-runner';
import type { RuntimeProcessRunner } from '../pipeline/runtime-adapters';

describe('opencode-models — parseo seguro y resolución de variantes', () => {
  const parsed = (raw: string) => {
    const models = parseOpenCodeModelListJson(raw);
    expect(models).not.toBeNull();
    return models!;
  };
  const fixturePath = path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-model-list.json');
  const rawFixture = fs.readFileSync(fixturePath, 'utf8');

  it('parsea la lista del fixture extrayendo únicamente los campos seguros', () => {
    const models = parsed(rawFixture);
    expect(models.length).toBeGreaterThan(0);

    const qwen = models.find((m) => m.providerId === 'unslothpclocal' && m.id === 'unsloth/Qwen3.8-27B-GGUF');
    expect(qwen).toBeDefined();
    expect(qwen).toEqual({
      providerId: 'unslothpclocal',
      id: 'unsloth/Qwen3.8-27B-GGUF',
      name: 'Qwen 3.8 27B · XL · local',
      variantIds: ['low', 'medium', 'high'],
      contextLimit: 110000,
      enabled: true,
      status: 'active',
    });
  });

  it('invariante de seguridad: ni headers, ni settings ni la cadena «<valor resuelto por OpenCode>» aparecen en lo extraído', () => {
    // El fixture crudo contiene múltiples ocurrencias de esa marca
    expect(rawFixture).toContain('<valor resuelto por OpenCode>');
    expect(rawFixture).toContain('CF-Access-Client-Id');
    expect(rawFixture).toContain('apiKey');

    const models = parsed(rawFixture);
    const serialized = JSON.stringify(models);

    // En los modelos procesados no queda rastro alguno
    expect(serialized).not.toContain('<valor resuelto por OpenCode>');
    expect(serialized).not.toContain('CF-Access-Client-Id');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('settings');
    expect(serialized).not.toContain('headers');
  });

  it('findOpenCodeModel encuentra modelos activos y habilitados, y descarta desconocidos o inactivos', () => {
    const models = parsed(rawFixture);

    // Conocido y activo
    const found = findOpenCodeModel(models, 'unslothpclocal', 'unsloth/Qwen3.8-27B-GGUF');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('unsloth/Qwen3.8-27B-GGUF');

    // Proveedor desconocido
    expect(findOpenCodeModel(models, 'proveedor_inexistente', 'unsloth/Qwen3.8-27B-GGUF')).toBeNull();

    // Modelo desconocido
    expect(findOpenCodeModel(models, 'unslothpclocal', 'modelo-inexistente')).toBeNull();

    // Modelo deshabilitado o inactivo
    const fakeModels = [
      {
        providerId: 'p1',
        id: 'm1',
        name: 'M1',
        variantIds: [],
        contextLimit: 8192,
        enabled: false,
        status: 'active',
      },
      {
        providerId: 'p1',
        id: 'm2',
        name: 'M2',
        variantIds: [],
        contextLimit: 8192,
        enabled: true,
        status: 'error',
      },
    ];
    expect(findOpenCodeModel(fakeModels, 'p1', 'm1')).toBeNull();
    expect(findOpenCodeModel(fakeModels, 'p1', 'm2')).toBeNull();
  });

  it('resolveOpenCodeVariant resuelve según prioridad: variante explícita > nivel si coincide con declaradas > null', () => {
    const declaredVariants = ['low', 'medium', 'high'];

    // 1. Variante explícita prevalece
    expect(resolveOpenCodeVariant({ explicitVariant: 'custom-variant', effort: 'high', declaredVariants })).toBe('custom-variant');
    expect(resolveOpenCodeVariant({ explicitVariant: 'low', effort: 'high', declaredVariants })).toBe('low');

    // 2. Sin variante explícita, pero esfuerzo coincide con variantes declaradas de OpenCode
    expect(resolveOpenCodeVariant({ effort: 'high', declaredVariants })).toBe('high');
    expect(resolveOpenCodeVariant({ effort: 'low', declaredVariants })).toBe('low');

    // 3. Esfuerzo no coincide con ninguna variante declarada -> null
    expect(resolveOpenCodeVariant({ effort: 'max', declaredVariants })).toBeNull();
    expect(resolveOpenCodeVariant({ effort: 'o3-high', declaredVariants })).toBeNull();

    // 4. Sin variantes ni esfuerzo -> null
    expect(resolveOpenCodeVariant({ declaredVariants })).toBeNull();
    expect(resolveOpenCodeVariant({})).toBeNull();
  });

  it('lo que no tiene la forma de la lista no es «una lista vacía»: es null', () => {
    expect(parseOpenCodeModelListJson('')).toBeNull();
    expect(parseOpenCodeModelListJson('{"location":{},"data":')).toBeNull();
    expect(parseOpenCodeModelListJson('{"error":"x"}')).toBeNull();
    expect(parseOpenCodeModelListJson('<!doctype html><html></html>')).toBeNull();
    expect(parseOpenCodeModelListJson('{"data":[]}')).toEqual([]);
  });
});

describe('fetchOpenCodeModelList — la consulta a OpenCode', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'modelos-en-casa', 'opencode-2.0.20-model-list.json'), 'utf8');
  const result = (over: Partial<RuntimeProcessResult>): RuntimeProcessResult =>
    ({ exitCode: 0, timedOut: false, stdout: Buffer.from(''), stderr: Buffer.from(''), ...over }) as RuntimeProcessResult;
  const runnerOf = (run: (spec: RuntimeProcessSpec) => Promise<RuntimeProcessResult>) => ({ run }) as unknown as RuntimeProcessRunner;
  const repo = path.join(__dirname, '..', '..');

  it('pide la lista con la carpeta del repositorio como único argumento variable y devuelve lo seguro', async () => {
    let seen: RuntimeProcessSpec | null = null;
    const res = await fetchOpenCodeModelList(repo, runnerOf(async (spec) => { seen = spec; return result({ stdout: Buffer.from(fixture) }); }), { retryDelayMs: 0 });

    expect(seen!.executable).toBe('opencode');
    expect(seen!.args).toEqual(['api', 'model.list', '--param', `location[directory]=${repo}`]);
    expect(res.error).toBeUndefined();
    expect(res.installed).toBe(true);
    expect(res.models.map((m) => `${m.providerId}/${m.id}`)).toContain('unslothpclocal/unsloth/Qwen3.8-27B-GGUF');
    expect(JSON.stringify(res)).not.toContain('valor resuelto');
  });

  it('una respuesta vacía, cortada o que no es la lista es un fallo, no «no conoce ningún modelo»', async () => {
    for (const stdout of ['', '{"data":', '<!doctype html>']) {
      const res = await fetchOpenCodeModelList(repo, runnerOf(async () => result({ stdout: Buffer.from(stdout) })));
      expect(res).toEqual({ installed: true, models: [], error: 'opencode_api_failed' });
    }
    expect(await fetchOpenCodeModelList(repo, runnerOf(async () => result({ exitCode: 1 })))).toMatchObject({ error: 'opencode_api_failed' });
    expect(await fetchOpenCodeModelList(repo, runnerOf(async () => result({ timedOut: true })))).toMatchObject({ error: 'opencode_api_failed' });
  });

  it('la primera consulta de una carpeta nueva viene vacía: se reintenta y trae los modelos', async () => {
    let calls = 0;
    const res = await fetchOpenCodeModelList(repo, runnerOf(async () => {
      calls++;
      return result({ stdout: Buffer.from(calls < 3 ? '{"data":[]}' : fixture) });
    }), { retryDelayMs: 0 });
    expect(calls).toBe(3);
    expect(res.error).toBeUndefined();
    expect(res.models.length).toBeGreaterThan(0);
  });

  it('si sigue vacía tras los reintentos es un fallo de la consulta, no «no conoce el modelo»', async () => {
    let calls = 0;
    const res = await fetchOpenCodeModelList(repo, runnerOf(async () => { calls++; return result({ stdout: Buffer.from('{"data":[]}') }); }), { attempts: 3, retryDelayMs: 0 });
    expect(calls).toBe(3);
    expect(res).toEqual({ installed: true, models: [], error: 'opencode_api_failed' });
  });

  it('un fallo real no se reintenta', async () => {
    let calls = 0;
    await fetchOpenCodeModelList(repo, runnerOf(async () => { calls++; return result({ exitCode: 1 }); }), { retryDelayMs: 0 });
    expect(calls).toBe(1);
  });

  it('sin OpenCode instalado lo dice; otro error de lanzamiento es un fallo de la consulta', async () => {
    const notFound = await fetchOpenCodeModelList(repo, runnerOf(async () => { throw new Error("Runtime executable 'opencode' was not found in the application environment PATH"); }));
    expect(notFound).toEqual({ installed: false, models: [], error: 'opencode_not_installed' });
    const other = await fetchOpenCodeModelList(repo, runnerOf(async () => { throw new Error('Runtime arg is not safe for the shell'); }));
    expect(other).toEqual({ installed: true, models: [], error: 'opencode_api_failed' });
  });
});
