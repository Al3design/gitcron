// Tareas 3.2 y 3.5 de modelos-en-casa: referencias {env:} y {file:} con las variables
// guardadas en GitCron, y advertencias contra el esquema empaquetado de OpenCode, con
// los parámetros abiertos que llegan al pedido (D4, D5).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseGitCronConfigText, resetGitCronConfigCacheForTesting, resolveUse, substituteReferences } from '../gitcron-config';
import { validateGitCronConfig } from '../gitcron-config-validate';
import { buildStreamRequestBody } from '../../text-client';

let dir: string;
let configPath: string;
const write = (config: unknown) => fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const noEnv = {} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  resetGitCronConfigCacheForTesting();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-secretos-'));
  configPath = path.join(dir, 'gitcron.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const provider = (options: Record<string, unknown>, models: Record<string, unknown> = { qwen: {} }) => ({
  provider: { casa: { name: 'Casa', options, models } },
  agent: { 'gitcron-commit': { model: 'casa/qwen' } },
});

describe('3.2 referencias y variables guardadas', () => {
  it('el sistema gana sobre la guardada, y la procedencia lo dice', () => {
    write(provider({ baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:CASA_KEY}' }));
    const stored = (name: string) => (name === 'CASA_KEY' ? 'guardada' : undefined);
    const fromSystem = resolveUse('gitcron-commit', { configPath, env: { CASA_KEY: 'sistema' } as unknown as NodeJS.ProcessEnv, stored });
    expect(fromSystem?.apiKey).toBe('sistema');
    expect(fromSystem?.provenance.auth).toBe('Bearer, de la variable CASA_KEY (del sistema)');
    expect(fromSystem?.variables).toEqual([{ name: 'CASA_KEY', source: 'system' }]);

    const fromStored = resolveUse('gitcron-commit', { configPath, env: noEnv, stored });
    expect(fromStored?.apiKey).toBe('guardada');
    expect(fromStored?.provenance.auth).toBe('Bearer, de la variable CASA_KEY (guardada en GitCron)');
    expect(fromStored?.variables).toEqual([{ name: 'CASA_KEY', source: 'stored' }]);
  });

  it('variable faltante: proveedor no disponible con el nombre, y nada viaja vacío', () => {
    write(provider({ baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:FALTA_KEY}' }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv, stored: () => undefined });
    expect(resolved?.available).toBe(false);
    expect(resolved?.unavailableReason).toBe('Variable de entorno FALTA_KEY no definida');
    expect(resolved?.apiKey).toBeUndefined();
    expect(resolved?.variables).toEqual([{ name: 'FALTA_KEY', source: 'missing' }]);
  });

  it('{env:} en baseURL: usa la dirección de la variable y el destino sale de ella', () => {
    write(provider({ baseURL: '{env:CASA_URL}' }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: { CASA_URL: 'http://localhost:1234/v1' } as unknown as NodeJS.ProcessEnv });
    expect(resolved?.baseURL).toBe('http://localhost:1234/v1');
    expect(resolved?.destination).toBe('this-machine');
    expect(resolved?.provenance.baseURL).toBe('provider.casa.options.baseURL (variable CASA_URL, del sistema)');
  });

  it('{env:} faltante en baseURL dice la variable, no «no declara baseURL»', () => {
    write(provider({ baseURL: '{env:CASA_URL}' }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv });
    expect(resolved?.available).toBe(false);
    expect(resolved?.unavailableReason).toBe('Variable de entorno CASA_URL no definida');
  });

  it('{file:} relativo a la carpeta del archivo de configuración, sin espacios de los bordes', () => {
    fs.writeFileSync(path.join(dir, 'clave.txt'), '  sk-de-archivo\n');
    write(provider({ baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{file:clave.txt}' }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv });
    expect(resolved?.apiKey).toBe('sk-de-archivo');
    expect(resolved?.provenance.auth).toBe('Bearer, de un archivo ({file:})');
    expect(resolved?.available).toBe(true);
  });

  it('{file:} con una ruta que no existe: no disponible y con la ruta', () => {
    write(provider({ baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{file:no-existe.txt}' }));
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv });
    expect(resolved?.available).toBe(false);
    expect(resolved?.unavailableReason).toBe('Archivo no-existe.txt no encontrado ({file:no-existe.txt})');
    expect(resolved?.apiKey).toBeUndefined();
  });

  it('{file:} con ~ es la carpeta de la persona', () => {
    const result = substituteReferences('{file:~/__gitcron_no_existe__.txt}', { env: noEnv });
    expect(result.missing).toEqual([{ kind: 'file', name: '~/__gitcron_no_existe__.txt' }]);
  });
});

describe('3.5 parámetros abiertos y precedencia (D4)', () => {
  const full = {
    provider: {
      casa: {
        options: { baseURL: 'http://192.168.1.7:8888/v1', nivel: 'proveedor', parametro_raro: 'del-proveedor', headers: { 'X-Uno': 'p', 'X-Dos': 'p' } },
        models: {
          qwen: {
            temperature: true,
            headers: { 'X-Dos': 'm' },
            options: { nivel: 'modelo', otro_raro: 42 },
            variants: {
              alta: { nivel: 'variante', reasoning_effort: 'high' },
              apagada: { disabled: true, nivel: 'nada' },
            },
          },
        },
      },
    },
    agent: { 'gitcron-commit': { model: 'casa/qwen', variant: 'alta', options: { nivel: 'agente' } } },
  };

  it('proveedor < modelo < variante < agente, y lo desconocido llega al cuerpo del pedido', () => {
    write(full);
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv })!;
    expect(resolved.available).toBe(true);
    expect(resolved.options).toEqual({
      nivel: 'agente',
      parametro_raro: 'del-proveedor',
      otro_raro: 42,
      reasoning_effort: 'high',
    });
    expect(resolved.provenance.options.reasoning_effort).toBe('provider.casa.models.qwen.variants.alta.reasoning_effort');
    expect(resolved.provenance.options.nivel).toBe('agent.gitcron-commit.options.nivel');

    const body = buildStreamRequestBody({
      model: resolved.modelId,
      system: 's',
      user: 'u',
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      options: resolved.options,
    });
    expect(body).toMatchObject({ parametro_raro: 'del-proveedor', otro_raro: 42, reasoning_effort: 'high', nivel: 'agente' });
  });

  it('el temperature sí/no del modelo no viaja como temperatura', () => {
    write(full);
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv })!;
    expect(resolved.temperature).toBeUndefined();
  });

  it('las cabeceras del modelo van encima de las del proveedor', () => {
    write(full);
    const resolved = resolveUse('gitcron-commit', { configPath, env: noEnv })!;
    expect(resolved.headers).toEqual({ 'X-Uno': 'p', 'X-Dos': 'm' });
    expect(resolved.provenance.headers['X-Dos']).toBe('provider.casa.models.qwen.headers.X-Dos');
  });

  it('una variante inexistente o apagada deja el uso no disponible y lo dice', () => {
    write({ ...full, agent: { 'gitcron-commit': { model: 'casa/qwen', variant: 'nueva' } } });
    expect(resolveUse('gitcron-commit', { configPath, env: noEnv })?.unavailableReason)
      .toBe('la variante «nueva» no existe en provider.casa.models.qwen.variants');
    write({ ...full, agent: { 'gitcron-commit': { model: 'casa/qwen', variant: 'apagada' } } });
    expect(resolveUse('gitcron-commit', { configPath, env: noEnv })?.unavailableReason)
      .toBe('la variante «apagada» está deshabilitada');
  });
});

describe('3.5 advertencias del esquema', () => {
  it('el ejemplo del repo y una configuración como la de Ale no tienen advertencias', () => {
    const example = fs.readFileSync(path.join(__dirname, '..', 'gitcron.example.jsonc'), 'utf8');
    const parsed = parseGitCronConfigText(example, 'gitcron.example.jsonc');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(validateGitCronConfig(parsed.config)).toEqual([]);

    const ale = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        unslothpc: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Unsloth CASA (túnel)',
          options: { baseURL: 'https://llm.example.dev/v1', apiKey: '{env:UNSLOTH_API_KEY}', headers: { 'CF-Access-Client-Id': '{env:CF_ACCESS_CLIENT_ID}' } },
          models: { 'unsloth/Qwen3.8-27B-GGUF': { name: 'Qwen 3.8 27B', limit: { context: 120000, output: 3000 }, options: { reasoning_effort: 'medium' } } },
        },
      },
      agent: { 'gitcron-commit': { description: 'GitCron: redacción', model: 'unslothpc/unsloth/Qwen3.8-27B-GGUF' } },
    };
    expect(validateGitCronConfig(ale)).toEqual([]);
  });

  it('advierte lo que el formato no conoce sin quitarlo, y nombra el archivo', () => {
    const config = {
      gitcron: { algo: 1 },
      provider: {
        casa: {
          raro: true,
          options: { baseURL: 'http://x/v1', libre: 'abierto' },
          models: { 'unsloth/Qwen3.8': { temperature: 0.7, limit: { context: 1, output: 2, extra: 3 }, desconocido: 1 } },
        },
      },
      agent: { 'gitcron-commit': { model: 'casa/unsloth/Qwen3.8', temperature: 'alta', clave_libre: 1 } },
    };
    const warnings = validateGitCronConfig(config as any, () => 'C:/repo/gitcron.json');
    expect(warnings).toEqual([
      { kind: 'unknown-key', segments: ['gitcron'], file: 'C:/repo/gitcron.json' },
      { kind: 'unknown-key', segments: ['provider', 'casa', 'raro'], file: 'C:/repo/gitcron.json' },
      { kind: 'unknown-key', segments: ['provider', 'casa', 'models', 'unsloth/Qwen3.8', 'desconocido'], file: 'C:/repo/gitcron.json' },
      { kind: 'model-temperature-number', segments: ['provider', 'casa', 'models', 'unsloth/Qwen3.8', 'temperature'], file: 'C:/repo/gitcron.json' },
      { kind: 'unknown-key', segments: ['provider', 'casa', 'models', 'unsloth/Qwen3.8', 'limit', 'extra'], file: 'C:/repo/gitcron.json' },
      { kind: 'wrong-type', segments: ['agent', 'gitcron-commit', 'temperature'], expected: 'number', file: 'C:/repo/gitcron.json' },
    ]);
    // Advertir no borra: el objeto sigue igual.
    expect(config.gitcron).toEqual({ algo: 1 });
  });
});
