// Tareas 4.1 y 4.1b de modelos-en-casa: los modelos de cada proveedor por el
// estándar de OpenAI con la capa opcional de LM Studio, y los valores de parámetros
// contra el estándar (D11b).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGitCronConfig, resetGitCronConfigCacheForTesting, resolveUse } from '../gitcron-config';
import { addModelToConfig, listProviderModels, type FetchFn } from '../provider-models';
import { checkStandardParam } from '../standard-params';
import { buildCompleteRequestBody, buildStreamRequestBody } from '../../text-client';

let dir: string;
let configPath: string;
const noEnv = {} as unknown as NodeJS.ProcessEnv;
const write = (config: unknown) => fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

beforeEach(() => {
  resetGitCronConfigCacheForTesting();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-proveedores-'));
  configPath = path.join(dir, 'gitcron.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const casa = (extra: Record<string, unknown> = {}) => ({
  provider: {
    casa: {
      options: { baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:CASA_KEY}', headers: { 'CF-Access-Client-Id': 'abc' } },
      models: { 'unsloth/Qwen3.8-27B-GGUF': { name: 'Qwen 3.8', limit: { context: 110000, output: 16384 } } },
      ...extra,
    },
  },
  agent: { 'gitcron-commit': { model: 'casa/unsloth/Qwen3.8-27B-GGUF' } },
});

/** Un servidor simulado: qué responde en cada ruta y qué cabeceras recibió. */
function server(routes: Record<string, unknown | number>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    // La ruta más específica primero: /api/v1/models también termina en /v1/models.
    const route = Object.keys(routes).sort((x, y) => y.length - x.length).find((r) => String(url).endsWith(r));
    if (route === undefined) return new Response('no', { status: 404 });
    const body = routes[route];
    if (typeof body === 'number') return new Response('err', { status: body });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn, calls };
}

describe('4.1 modelos de cada proveedor', () => {
  it('servidor que sólo habla el estándar: declarados y reportados, sin estado de carga', async () => {
    write(casa());
    const { fetchFn, calls } = server({ '/v1/models': { object: 'list', data: [{ id: 'unsloth/Qwen3.8-27B-GGUF' }, { id: 'unsloth/gemma-4-12B' }] } });
    const list = await listProviderModels('casa', { configPath, env: { CASA_KEY: 'k' } as unknown as NodeJS.ProcessEnv, fetchFn });
    expect(list.status).toBe('ok');
    expect(list.lmstudioLayer).toBe(false);
    expect(list.models).toEqual([
      { id: 'unsloth/Qwen3.8-27B-GGUF', name: 'Qwen 3.8', declared: true, reported: true, limit: { context: 110000, output: 16384 } },
      { id: 'unsloth/gemma-4-12B', declared: false, reported: true },
    ]);
    // Bearer y las cabeceras del proveedor, como en el estándar.
    expect(calls[0].url).toBe('http://192.168.1.7:8888/v1/models');
    expect(calls[0].headers).toMatchObject({ authorization: 'Bearer k', 'CF-Access-Client-Id': 'abc' });
  });

  it('con la capa de LM Studio: suma estado y deja afuera lo que no es llm', async () => {
    write(casa());
    const { fetchFn } = server({
      '/v1/models': { data: [{ id: 'unsloth/Qwen3.8-27B-GGUF' }, { id: 'text-embedding-nomic' }] },
      '/api/v1/models': {
        models: [
          { key: 'unsloth/Qwen3.8-27B-GGUF', display_name: 'Qwen', type: 'llm', max_context_length: 262144, loaded_instances: [{ id: 'i1', config: { context_length: 65536 } }] },
          { key: 'text-embedding-nomic', display_name: 'Nomic', type: 'embedding' },
        ],
      },
    });
    const list = await listProviderModels('casa', { configPath, env: { CASA_KEY: 'k' } as unknown as NodeJS.ProcessEnv, fetchFn });
    expect(list.lmstudioLayer).toBe(true);
    expect(list.models.map((m) => m.id)).toEqual(['unsloth/Qwen3.8-27B-GGUF']);
    expect(list.models[0].lmstudio).toEqual({ kind: 'llm', loaded: true, loadedContextLength: 65536, maxContextLength: 262144 });
  });

  it('servidor que no responde: se dice, y los declarados quedan sin confirmar', async () => {
    write(casa());
    const fetchFn: FetchFn = async () => { throw new Error('connect ECONNREFUSED'); };
    const list = await listProviderModels('casa', { configPath, env: { CASA_KEY: 'k' } as unknown as NodeJS.ProcessEnv, fetchFn });
    expect(list.status).toBe('unreachable');
    expect(list.detail).toContain('ECONNREFUSED');
    expect(list.models).toEqual([
      { id: 'unsloth/Qwen3.8-27B-GGUF', name: 'Qwen 3.8', declared: true, reported: false, limit: { context: 110000, output: 16384 } },
    ]);
  });

  it('sin poder preguntar (falta la variable) no llama al servidor', async () => {
    write(casa());
    const { fetchFn, calls } = server({});
    const list = await listProviderModels('casa', { configPath, env: noEnv, fetchFn });
    expect(list.status).toBe('unavailable');
    expect(list.detail).toBe('Variable de entorno CASA_KEY no definida');
    expect(calls).toEqual([]);
  });

  it('los CLI listan por su lado', async () => {
    write(casa());
    expect((await listProviderModels('codex', { configPath })).status).toBe('cli');
  });

  it('«agregar al archivo» lo declara en el archivo que declara al proveedor', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    write({ agent: {} });
    fs.writeFileSync(path.join(repo, 'gitcron.json'), JSON.stringify(casa(), null, 2));
    const loaded = loadGitCronConfig({ globalPath: configPath, repoPath: repo });
    const result = addModelToConfig({ providerId: 'casa', modelId: 'unsloth/gemma-4-12B', name: 'Gemma 12B', loaded });
    expect(result.ok).toBe(true);
    const repoConfig = JSON.parse(fs.readFileSync(path.join(repo, 'gitcron.json'), 'utf8'));
    expect(repoConfig.provider.casa.models['unsloth/gemma-4-12B']).toEqual({ name: 'Gemma 12B' });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ agent: {} });
  });
});

describe('4.1b pedidos con el estándar', () => {
  it('stream va siempre explícito: true en streaming, false en una sola respuesta', () => {
    const opts = { model: 'm', system: 's', user: 'u' };
    expect(buildStreamRequestBody(opts).stream).toBe(true);
    expect(buildCompleteRequestBody(opts).stream).toBe(false);
  });

  it('reasoning_effort "High": se advierte con el valor esperado y se manda como está escrito', () => {
    write(casa({ models: { 'unsloth/Qwen3.8-27B-GGUF': { options: { reasoning_effort: 'High', top_k: 40 } } } }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: { CASA_KEY: 'k' } as unknown as NodeJS.ProcessEnv })!;
    expect(resolved.paramWarnings).toEqual([
      {
        key: 'reasoning_effort',
        value: 'High',
        expected: 'minimal | low | medium | high',
        suggestion: 'high',
        segments: ['provider', 'casa', 'models', 'unsloth/Qwen3.8-27B-GGUF', 'options', 'reasoning_effort'],
        file: configPath,
      },
    ]);
    // Sin aceptación, viaja lo escrito; y un parámetro abierto (top_k) viaja sin advertencia.
    const body = buildStreamRequestBody({ model: resolved.modelId, system: 's', user: 'u', options: resolved.options });
    expect(body.reasoning_effort).toBe('High');
    expect(body.top_k).toBe(40);
  });

  it('valores del estándar: lo que cumple no se advierte', () => {
    expect(checkStandardParam('reasoning_effort', 'low')).toBeNull();
    expect(checkStandardParam('temperature', 0.7)).toBeNull();
    expect(checkStandardParam('temperature', 3)).toMatchObject({ expected: 'un número entre 0 y 2' });
    expect(checkStandardParam('max_tokens', 1.5)).toMatchObject({ expected: 'un entero mayor que 0' });
    expect(checkStandardParam('stop', ['a', 'b', 'c', 'd', 'e'])).not.toBeNull();
    expect(checkStandardParam('reasoning_effort', 'altísimo')).not.toHaveProperty('suggestion');
    expect(checkStandardParam('parametro_libre', 'cualquiera')).toBeNull();
  });

  it('proveedor openai: OPENAI_API_KEY y la dirección pública si el archivo no las trae', () => {
    write({ provider: { openai: {} }, agent: { 'gitcron-commit': { model: 'openai/gpt-5.1' } } });
    const resolved = resolveUse('gitcron-commit', { configPath, env: { OPENAI_API_KEY: 'sk-x' } as unknown as NodeJS.ProcessEnv })!;
    expect(resolved.apiKey).toBe('sk-x');
    expect(resolved.baseURL).toBe('https://api.openai.com/v1');
    expect(resolved.provenance.auth).toBe('Bearer, de la variable OPENAI_API_KEY (del sistema)');
    expect(resolved.provenance.baseURL).toBe('dirección pública de la API de OpenAI (sin options.baseURL ni OPENAI_BASE_URL)');

    const viaEnv = resolveUse('gitcron-commit', {
      configPath,
      env: { OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'http://localhost:9000/v1' } as unknown as NodeJS.ProcessEnv,
    })!;
    expect(viaEnv.baseURL).toBe('http://localhost:9000/v1');
    expect(viaEnv.provenance.baseURL).toBe('provider.openai.options.baseURL (variable OPENAI_BASE_URL, del sistema)');

    const sinClave = resolveUse('gitcron-commit', { configPath, env: noEnv })!;
    expect(sinClave.available).toBe(false);
    expect(sinClave.unavailableReason).toBe('Variable de entorno OPENAI_API_KEY no definida');
  });
});
