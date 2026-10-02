// Tarea 4.3 de modelos-en-casa: `resolveModelFor(uso)` y los cuatro usos de texto
// leyendo gitcron.json, sin proveedores fijos (D6, D7), y «usar lo que tenías»
// (decisión de Ale del 2026-10-01).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { loadGitCronConfig, resetGitCronConfigCacheForTesting } from '../config/gitcron-config';
import { adoptLegacyOffer, legacyOfferFor, type LegacyChoiceSources } from '../config/legacy-choice';
import { resolveModelFor, TEXT_USES, type TextUse } from '../config/resolve-model-for';
import { clearLastRequestsForTesting, getLastRequestForUse, probeTextUse, runTextUse, TextUseError, type TextUseDeps } from '../text-use';
import { loadServerFor, setUseConfigPathForTesting } from '../use-resolution';
import { createCartoProvider } from '../carto/provider';
import { createTemporalProvider } from '../predict';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => os.tmpdir()), getAppPath: vi.fn(() => process.cwd()) } }));

let dir: string;
let configPath: string;
const env = { CASA_KEY: 'k-casa', ANTHROPIC_API_KEY: 'sk-ant-test' } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  resetGitCronConfigCacheForTesting();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-usos-'));
  configPath = path.join(dir, 'gitcron.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (config: unknown) => fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const PROVIDERS = {
  casa: {
    npm: '@ai-sdk/openai-compatible',
    name: 'Unsloth CASA',
    options: { baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:CASA_KEY}' },
    models: { 'qwen-27b': { name: 'Qwen 27B' } },
  },
  anthropic: { npm: '@ai-sdk/anthropic', name: 'Anthropic', options: { apiKey: '{env:ANTHROPIC_API_KEY}' } },
};

/** Un servidor simulado que anota a quién se llamó y con qué. */
function server(answer: (url: string, body: any) => unknown = () => ({ choices: [{ message: { content: 'respuesta' }, finish_reason: 'stop' }] })) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body });
    const reply = answer(String(url), body);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/** Un CLI simulado que contesta en el formato de cada uno. */
function cli(text: string) {
  const runs: Array<{ file: string; args: string[]; stdin: string }> = [];
  const spawnFn = ((file: string, args: string[]) => {
    const run = { file, args, stdin: '' };
    runs.push(run);
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on('data', (d: Buffer) => { run.stdin += d.toString('utf8'); });
    child.stdin.on('finish', () => {
      const out = file.includes('claude')
        ? JSON.stringify({ type: 'result', is_error: false, result: text, usage: { input_tokens: 5, output_tokens: 2 } })
        : [JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } })].join('\n');
      child.stdout.end(out);
      child.stderr.end();
      child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
      child.stdout.resume();
    });
    return child;
  }) as any;
  const deps: TextUseDeps = { spawnFn, resolveExecutable: async (name) => ({ file: `C:/tools/${name}.exe`, viaShell: false }) };
  return { runs, deps };
}

const resolveFor = (use: TextUse, extra: { screenModel?: string } = {}) =>
  resolveModelFor(use, { configPath, env, ...extra });

describe('4.3 resolveModelFor: de dónde sale el modelo de cada uso', () => {
  it('la entrada del uso manda; sin ella, la elección general; sin ninguna, no hay modelo', () => {
    write({ model: 'casa/qwen-27b', provider: PROVIDERS, agent: { 'gitcron-temporal': { model: 'anthropic/claude-sonnet-4-5' } } });
    const temporal = resolveFor('gitcron-temporal');
    const carto = resolveFor('gitcron-cartography');
    expect(temporal).toMatchObject({ status: 'resolved', resolved: { providerId: 'anthropic', kind: 'anthropic', modelSource: 'agent' } });
    expect(carto).toMatchObject({ status: 'resolved', resolved: { providerId: 'casa', modelSource: 'general', destination: 'own-server' } });
    expect(carto.status === 'resolved' && carto.resolved.provenance.model).toBe('model (elección general)');

    write({ provider: PROVIDERS });
    expect(resolveFor('gitcron-cartography')).toEqual({ status: 'unset', use: 'gitcron-cartography' });
  });

  it('`disable: true` apaga el uso aunque haya elección general', () => {
    write({ model: 'casa/qwen-27b', provider: PROVIDERS, agent: { 'gitcron-cartography': { disable: true } } });
    expect(resolveFor('gitcron-cartography')).toMatchObject({ status: 'disabled' });
  });

  it('Anthropic: dirección pública y clave por x-api-key, con su procedencia', () => {
    write({ provider: PROVIDERS, agent: { 'gitcron-temporal': { model: 'anthropic/claude-sonnet-4-5' } } });
    const target = resolveFor('gitcron-temporal');
    expect(target.status === 'resolved' && target.resolved).toMatchObject({
      baseURL: 'https://api.anthropic.com/v1',
      destination: 'external-service',
      provenance: {
        baseURL: 'dirección pública de la API de Anthropic (sin options.baseURL)',
        auth: 'x-api-key, de la variable ANTHROPIC_API_KEY (del sistema)',
      },
    });
  });

  it('el selector de la pantalla vale sólo sin modelo en el archivo, y por el «lmstudio» que el archivo declare', () => {
    write({ provider: { lmstudio: { name: 'LM Studio', options: { baseURL: 'http://192.168.1.9:1234/v1' } } } });
    const screen = resolveFor('gitcron-commit', { screenModel: 'google/gemma-4-12b' });
    expect(screen.status === 'resolved' && screen.resolved).toMatchObject({
      providerId: 'lmstudio',
      modelId: 'google/gemma-4-12b',
      baseURL: 'http://192.168.1.9:1234/v1',
      modelSource: 'screen',
    });

    write({ provider: {} });
    const missing = resolveFor('gitcron-commit', { screenModel: 'google/gemma-4-12b' });
    expect(missing.status === 'resolved' && missing.resolved.available).toBe(false);

    write({ provider: PROVIDERS, agent: { 'gitcron-commit': { model: 'casa/qwen-27b' } } });
    expect(resolveFor('gitcron-commit', { screenModel: 'otro' })).toMatchObject({ resolved: { providerId: 'casa', modelSource: 'agent' } });
  });
});

describe('4.3 cada uso con cada familia', () => {
  const families = [
    { ref: 'casa/qwen-27b', family: 'estándar de OpenAI' },
    { ref: 'anthropic/claude-sonnet-4-5', family: 'Anthropic' },
    { ref: 'codex/gpt-5.5', family: 'CLI (Codex)' },
    { ref: 'claude-code/haiku', family: 'CLI (Claude Code)' },
  ];

  for (const use of TEXT_USES) {
    for (const { ref, family } of families) {
      it(`${use} con ${family}`, async () => {
        write({ provider: PROVIDERS, agent: { [use]: { model: ref } } });
        const srv = server((url) => (url.endsWith('/messages')
          ? { content: [{ type: 'text', text: 'respuesta' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 1 } }
          : { choices: [{ message: { content: 'respuesta' }, finish_reason: 'stop' }] }));
        const fake = cli('respuesta');
        const result = await runTextUse(resolveFor(use), { system: 's', user: 'u' }, { ...fake.deps, fetchFn: srv.fetchFn });
        expect(result.text).toBe('respuesta');

        if (ref.startsWith('casa/')) {
          expect(srv.calls.map((c) => c.url)).toEqual(['http://192.168.1.7:8888/v1/chat/completions']);
          expect(srv.calls[0].headers.authorization).toBe('Bearer k-casa');
          expect(fake.runs).toEqual([]);
        } else if (ref.startsWith('anthropic/')) {
          expect(srv.calls.map((c) => c.url)).toEqual(['https://api.anthropic.com/v1/messages']);
          expect(srv.calls[0].headers['x-api-key']).toBe('sk-ant-test');
          expect(srv.calls[0].headers.authorization).toBeUndefined();
          expect(srv.calls[0].body).toMatchObject({ model: 'claude-sonnet-4-5', system: 's', messages: [{ role: 'user', content: 'u' }] });
        } else {
          expect(srv.calls).toEqual([]);
          expect(fake.runs).toHaveLength(1);
          expect(fake.runs[0].file).toBe(ref.startsWith('codex/') ? 'C:/tools/codex.exe' : 'C:/tools/claude.exe');
          expect(fake.runs[0].stdin).toBe('s\n\nu');
        }
      });
    }
  }

  it('Cartografía y el Agente Temporal arman su pedido con el modelo de su entrada', async () => {
    write({
      provider: PROVIDERS,
      agent: {
        'gitcron-cartography': { model: 'casa/qwen-27b' },
        'gitcron-temporal': { model: 'codex/gpt-5.5' },
      },
    });
    const srv = server();
    const carto = createCartoProvider(resolveFor('gitcron-cartography'), { fetchFn: srv.fetchFn });
    expect(carto.label).toBe('Unsloth CASA · qwen-27b');
    const answer = await carto.ask('¿qué hace?', { lang: 'es' });
    expect(answer.provider).toBe('casa:qwen-27b');
    expect(srv.calls[0].body.model).toBe('qwen-27b');

    const fake = cli('{"branches":[{"id":"a","message":"Rama","description":"d","rationale":"r","reasoning":"x","agentPrompt":"p","type":"trend","confidence":0.5}]}');
    const temporal = createTemporalProvider(resolveFor('gitcron-temporal'), fake.deps);
    const prediction = await temporal.predictTimelines({ systemPrompt: 's', userPrompt: 'u', input: {} as never });
    expect(prediction.provider).toBe('codex:gpt-5.5');
    expect(prediction.branches.map((b) => b.message)).toEqual(['Rama']);
  });

  it('el modelo sin limit.output usa el techo del uso; con limit.output, el del modelo', async () => {
    write({ provider: PROVIDERS, agent: { 'gitcron-temporal': { model: 'casa/qwen-27b' } } });
    const srv = server();
    await runTextUse(resolveFor('gitcron-temporal'), { system: 's', user: 'u', maxTokens: 4096 }, { fetchFn: srv.fetchFn });
    expect(srv.calls[0].body.max_tokens).toBe(4096);

    write({
      provider: { ...PROVIDERS, casa: { ...PROVIDERS.casa, models: { 'qwen-27b': { limit: { output: 2000 } } } } },
      agent: { 'gitcron-temporal': { model: 'casa/qwen-27b' } },
    });
    resetGitCronConfigCacheForTesting();
    await runTextUse(resolveFor('gitcron-temporal'), { system: 's', user: 'u', maxTokens: 4096 }, { fetchFn: srv.fetchFn });
    expect(srv.calls[1].body.max_tokens).toBe(2000);
  });
});

describe('4.3 proveedor caído (D7)', () => {
  const twoRoutes = {
    provider: {
      casalocal: { name: 'Unsloth CASA Local', options: { baseURL: 'http://192.168.1.7:8888/v1' }, models: { 'qwen-27b': {} } },
      casatunel: { name: 'Unsloth CASA (túnel)', options: { baseURL: 'https://llm.example.dev/v1' }, models: { 'qwen-27b': {} } },
      otro: { name: 'Otro', options: { baseURL: 'http://10.0.0.2/v1' }, models: { 'qwen-27b': {}, 'gemma': {} } },
    },
    agent: { 'gitcron-cartography': { model: 'casalocal/qwen-27b' } },
  };

  it('falla con el motivo, nombra al que declara los mismos modelos y no lo llama', async () => {
    write(twoRoutes);
    const target = resolveFor('gitcron-cartography');
    expect(target.status === 'resolved' && target.alternatives).toEqual([
      { providerId: 'casatunel', providerName: 'Unsloth CASA (túnel)', destination: 'external-service' },
    ]);
    const srv = server(() => new Error('fetch failed ECONNREFUSED'));
    const failure = await runTextUse(target, { system: 's', user: 'u' }, { fetchFn: srv.fetchFn }).catch((e) => e);
    expect(failure).toBeInstanceOf(TextUseError);
    expect(failure.message).toBe('Unsloth CASA Local no responde en http://192.168.1.7:8888/v1. «Unsloth CASA (túnel)» declara los mismos modelos: se puede elegir en gitcron.json.');
    expect(failure.alternatives.map((a: { providerId: string }) => a.providerId)).toEqual(['casatunel']);
    expect(srv.calls.map((c) => c.url)).toEqual(['http://192.168.1.7:8888/v1/chat/completions']);
  });

  it('comprobar sin generar tampoco llama al otro', async () => {
    write(twoRoutes);
    const srv = server(() => new Error('fetch failed'));
    await expect(probeTextUse(resolveFor('gitcron-cartography'), { fetchFn: srv.fetchFn })).rejects.toThrow(/declara los mismos modelos/);
    expect(srv.calls.map((c) => c.url)).toEqual(['http://192.168.1.7:8888/v1/models']);
  });

  it('un uso sin modelo no llama a nadie', async () => {
    write({ provider: PROVIDERS });
    const srv = server();
    await expect(runTextUse(resolveFor('gitcron-temporal'), { system: 's', user: 'u' }, { fetchFn: srv.fetchFn }))
      .rejects.toMatchObject({ reason: 'unset', message: 'El Agente Temporal no tiene modelo en gitcron.json (ni agent.gitcron-temporal.model ni la elección general «model»).' });
    expect(srv.calls).toEqual([]);
  });
});

describe('4.3 «usar lo que tenías»', () => {
  const sources = (extra: Partial<LegacyChoiceSources> = {}): LegacyChoiceSources => ({
    hasOpenRouterKey: true,
    hasAnthropicKey: false,
    temporalProvider: null,
    cartography: { enabled: true, mode: 'online', model: 'deepseek/deepseek-v4-pro' },
    ...extra,
  });

  it('ofrece la elección vieja de cada uso, sólo si el uso no tiene modelo', () => {
    write({ provider: PROVIDERS, agent: { 'gitcron-commit': { model: 'casa/qwen-27b' } } });
    const loaded = loadGitCronConfig({ globalPath: configPath });
    expect(legacyOfferFor('gitcron-cartography', loaded, sources(), configPath)).toMatchObject({
      modelRef: 'openrouter/deepseek/deepseek-v4-pro',
      label: 'OpenRouter · deepseek/deepseek-v4-pro',
      addsProvider: { name: 'OpenRouter', options: { apiKey: '{env:OPENROUTER_API_KEY}' } },
    });
    expect(legacyOfferFor('gitcron-temporal', loaded, sources({ temporalProvider: 'claude' }), configPath))
      .toMatchObject({ modelRef: 'anthropic/claude-sonnet-4-5', addsProvider: null });
    expect(legacyOfferFor('gitcron-openspec-analysis', loaded, sources({ screenModel: 'google/gemma-4-12b' }), configPath))
      .toMatchObject({ modelRef: 'lmstudio/google/gemma-4-12b', addsProvider: { options: { baseURL: 'http://localhost:1234/v1' } } });
    // Con modelo, nada que ofrecer; sin elección en pantalla, tampoco.
    expect(legacyOfferFor('gitcron-commit', loaded, sources({ screenModel: 'x' }), configPath)).toBeNull();
    expect(legacyOfferFor('gitcron-openspec-analysis', loaded, sources(), configPath)).toBeNull();
  });

  it('escribir la oferta agrega el proveedor y el modelo, y no toca el resto del archivo', () => {
    const original = '{\n  // mi archivo\n  "$schema": "https://opencode.ai/config.json",\n  "provider": {\n    "casa": { "options": { "baseURL": "http://192.168.1.7:8888/v1" } }\n  },\n  "mcp": { "x": { "type": "local" } }\n}\n';
    fs.writeFileSync(configPath, original);
    const loaded = loadGitCronConfig({ globalPath: configPath });
    const offer = legacyOfferFor('gitcron-cartography', loaded, sources(), configPath)!;
    expect(adoptLegacyOffer(offer)).toEqual({ ok: true, created: false });

    const text = fs.readFileSync(configPath, 'utf8');
    expect(text).toContain('// mi archivo');
    expect(text).toContain('"mcp": { "x": { "type": "local" } }');
    resetGitCronConfigCacheForTesting();
    const after = loadGitCronConfig({ globalPath: configPath }).config!;
    expect(after.agent?.['gitcron-cartography']?.model).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(after.provider?.openrouter?.options?.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(after.provider?.casa).toEqual({ options: { baseURL: 'http://192.168.1.7:8888/v1' } });
  });
});

describe('4.3 sin proveedores fijos', () => {
  /** Los .ts del proceso principal, sin pruebas. */
  function sources(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        out.push(...sources(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
    return out;
  }
  const electronDir = path.resolve(__dirname, '..', '..');
  const rel = (f: string) => path.relative(electronDir, f).split(path.sep).join('/');

  it('no queda ninguna fábrica de proveedor fijo (createLmStudioConfig y compañía)', () => {
    const hits = sources(electronDir).filter((f) => /\bcreate(LmStudio|OpenRouter|Unsloth)Config\b/.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual([]);
  });

  it('las direcciones de los proveedores de antes viven sólo en el módulo de configuración', () => {
    const hits = sources(electronDir)
      .filter((f) => /['"`]https?:\/\/(localhost:1234|openrouter\.ai\/api|api\.anthropic\.com)/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(hits.every((f) => f.startsWith('ai/config/'))).toBe(true);
    expect(hits.sort()).toEqual(['ai/config/gitcron-config-migration.ts', 'ai/config/gitcron-config.ts']);
  });
});

describe('4.4 el pedido efectivo de cada uso (D14)', () => {
  const families = [
    { ref: 'casa/qwen-27b', endpoint: 'http://192.168.1.7:8888/v1/chat/completions', kind: 'openai-compatible' },
    { ref: 'anthropic/claude-sonnet-4-5', endpoint: 'https://api.anthropic.com/v1/messages', kind: 'anthropic' },
    { ref: 'codex/gpt-5.5', endpoint: 'codex exec --json', kind: 'cli' },
  ];

  for (const { ref, endpoint, kind } of families) {
    it(`${kind}: lo guardado es lo que viajó, sin clave, cabeceras secretas ni el pedido`, async () => {
      write({
        provider: {
          ...PROVIDERS,
          casa: { ...PROVIDERS.casa, options: { ...PROVIDERS.casa.options, headers: { 'CF-Access-Client-Secret': 'cf-secreto-valor' } } },
        },
        agent: { 'gitcron-cartography': { model: ref }, 'gitcron-temporal': { model: 'casa/qwen-27b' } },
      });
      clearLastRequestsForTesting();
      const srv = server((url) => (url.endsWith('/messages')
        ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
      const fake = cli('ok');
      await runTextUse(resolveFor('gitcron-cartography'), { system: 'SISTEMA-PRIVADO', user: 'CODIGO-DEL-REPO', maxTokens: 777 }, { ...fake.deps, fetchFn: srv.fetchFn });

      const saved = getLastRequestForUse('gitcron-cartography')!;
      expect(saved.kind).toBe(kind);
      expect(saved.endpoint.startsWith(endpoint)).toBe(true);
      if (kind !== 'cli') {
        expect(srv.calls[0].url).toBe(saved.endpoint);
        expect(saved.parameters.max_tokens.value).toBe(srv.calls[0].body.max_tokens);
      }
      const json = JSON.stringify(saved);
      for (const secret of ['k-casa', 'sk-ant-test', 'cf-secreto-valor', 'SISTEMA-PRIVADO', 'CODIGO-DEL-REPO']) {
        expect(json).not.toContain(secret);
      }
      // Un uso no ve el pedido de otro.
      expect(getLastRequestForUse('gitcron-temporal')).toBeNull();
    });
  }
});

describe('4.4 el servidor donde se cargan modelos, por uso', () => {
  it('cada uso va a su servidor; sin modelo, al «lmstudio» del archivo; sin él, el motivo y ninguna dirección', () => {
    setUseConfigPathForTesting(configPath);
    try {
      write({
        provider: {
          lmstudio: { options: { baseURL: 'http://127.0.0.1:1234/v1' } },
          casa: { options: { baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:GITCRON_TEST_CASA}' } },
        },
        agent: { 'gitcron-commit': { model: 'casa/qwen' }, 'gitcron-temporal': { model: 'codex/gpt-5.5' } },
      });
      process.env.GITCRON_TEST_CASA = 'k-casa';
      expect(loadServerFor('gitcron-commit')).toEqual({
        server: { serverUrl: 'http://192.168.1.7:8888', headers: { authorization: 'Bearer k-casa' } },
      });
      // El análisis no tiene modelo: el selector va por el «lmstudio» del archivo, no por el de la redacción.
      expect(loadServerFor('gitcron-openspec-analysis')).toEqual({ server: { serverUrl: 'http://127.0.0.1:1234', headers: {} } });
      expect(loadServerFor('gitcron-temporal')).toEqual({ error: 'Codex no es un servidor donde se carguen modelos.' });

      write({ provider: {} });
      resetGitCronConfigCacheForTesting();
      expect(loadServerFor('gitcron-openspec-analysis')).toMatchObject({ error: expect.stringContaining('no declara el proveedor «lmstudio»') });
    } finally {
      delete process.env.GITCRON_TEST_CASA;
      setUseConfigPathForTesting(null);
    }
  });
});
