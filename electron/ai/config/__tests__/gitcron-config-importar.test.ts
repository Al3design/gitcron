// Tareas 3.6, 3.6b y 3.7 de modelos-en-casa: importar desde OpenCode, mcp.json con
// sus importaciones (D12) y el archivo inicial (D10). Las formas son copias saneadas
// de los archivos de Ale medidos el 2026-10-01.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseGitCronConfigText, resetGitCronConfigCacheForTesting, resolveUse } from '../gitcron-config';
import { validateGitCronConfig } from '../gitcron-config-validate';
import { applyOpenCodeImport, planOpenCodeImport } from '../opencode-import';
import {
  applyMcpImport,
  convertOpenCodeMcpServer,
  getRepoMcpPath,
  loadMcpConfig,
  planMcpImport,
  resetMcpConfigCacheForTesting,
  updateMcpServer,
} from '../mcp-config';
import { createGitCronConfigWatcher } from '../gitcron-config-watcher';
import { buildInitialGitCronConfig, migrateGitCronConfigIfMissing, type MigrationSources } from '../gitcron-config-migration';

// La forma del opencode.json de Ale (proveedores, agente y los seis MCP), saneada.
const OPENCODE = {
  $schema: 'https://opencode.ai/config.json',
  mcp: {
    fallow: { type: 'local', command: ['npx', '-y', '--package', 'fallow', 'fallow-mcp'], enabled: false },
    github: {
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-github'],
      environment: { GITHUB_PERSONAL_ACCESS_TOKEN: '{env:GITHUB_PAT}' },
      enabled: false,
    },
    supabase: { type: 'remote', url: 'https://mcp.supabase.com/mcp?project_ref=EJEMPLO', enabled: false },
    'netlify-mcp': { type: 'remote', url: 'https://netlify-mcp.netlify.app/mcp', enabled: false },
    'netlify-local-mcp': { type: 'local', command: ['npx', '-y', '@netlify/mcp'], environment: {}, enabled: false },
    vercel: { type: 'remote', url: 'https://mcp.vercel.com', enabled: false },
  },
  agent: { tanda: { description: 'Solo edicion de archivos', model: 'unslothpc/unsloth/Qwen3.8-27B-GGUF', tools: { read: true, bash: false } } },
  provider: {
    lmstudio: { npm: '@ai-sdk/openai-compatible', name: 'LM Studio', options: { baseURL: 'http://127.0.0.1:1234/v1' }, models: { 'tu-modelo-local': { name: 'qwen/qwen3.5-9b' } } },
    unslothpc: {
      name: 'Unsloth CASA',
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: 'https://llm.example.dev/v1',
        apiKey: '{env:UNSLOTH_API_KEY}',
        headers: { 'CF-Access-Client-Id': '{env:CF_ACCESS_CLIENT_ID}', 'CF-Access-Client-Secret': '{env:CF_ACCESS_CLIENT_SECRET}' },
      },
      models: { 'unsloth/Qwen3.8-27B-GGUF': { name: 'Qwen 3.8 27B · XL', reasoning: true, options: { reasoning_effort: 'high' }, limit: { context: 110000, output: 16384 } } },
    },
    unslothpclocal: {
      name: 'Unsloth CASA Local',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:UNSLOTH_API_KEY}' },
      models: { 'unsloth/Qwen3.8-27B-GGUF': { name: 'Qwen 3.8 27B · XL · local', limit: { context: 110000, output: 16384 } } },
    },
  },
  compaction: { auto: true },
};

let dir: string;
let opencodePath: string;
let gitcronPath: string;
let mcpPath: string;
const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

beforeEach(() => {
  resetGitCronConfigCacheForTesting();
  resetMcpConfigCacheForTesting();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-importar-'));
  opencodePath = path.join(dir, 'opencode', 'opencode.json');
  gitcronPath = path.join(dir, 'gitcron', 'gitcron.json');
  mcpPath = path.join(dir, 'gitcron', 'mcp.json');
  fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
  fs.mkdirSync(path.dirname(gitcronPath), { recursive: true });
  fs.writeFileSync(opencodePath, JSON.stringify(OPENCODE, null, 2));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('3.6 importar desde opencode.json', () => {
  it('plan: los bloques nuevos con sus variables, y aplicar copia las referencias sin tocar opencode.json', () => {
    const before = sha(opencodePath);
    const plan = planOpenCodeImport({ opencodePath, gitcronPath });
    expect(plan.source).toEqual({ status: 'ok', path: opencodePath });
    expect(plan.entries.map((e) => `${e.kind}:${e.id}:${e.status}`)).toEqual([
      'provider:lmstudio:new',
      'provider:unslothpc:new',
      'provider:unslothpclocal:new',
      'agent:tanda:new',
    ]);
    expect(plan.entries.find((e) => e.id === 'unslothpc')?.variables).toEqual([
      'CF_ACCESS_CLIENT_ID',
      'CF_ACCESS_CLIENT_SECRET',
      'UNSLOTH_API_KEY',
    ]);

    const elegidos = plan.entries.filter((e) => e.id === 'unslothpc' || e.id === 'unslothpclocal');
    const results = applyOpenCodeImport({ gitcronPath, entries: elegidos });
    expect(results.every((r) => r.result.ok)).toBe(true);

    const written = JSON.parse(fs.readFileSync(gitcronPath, 'utf8'));
    expect(written.$schema).toBe('https://opencode.ai/config.json');
    // Las referencias quedan como referencias, igual que en OpenCode.
    expect(written.provider.unslothpc).toEqual(OPENCODE.provider.unslothpc);
    expect(written.provider.unslothpclocal.options.apiKey).toBe('{env:UNSLOTH_API_KEY}');
    expect(written.provider.lmstudio).toBeUndefined();
    expect(sha(opencodePath)).toBe(before);

    // Y se resuelve como cualquier proveedor del archivo.
    fs.writeFileSync(gitcronPath, JSON.stringify({ ...written, agent: { 'gitcron-commit': { model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF' } } }));
    const resolved = resolveUse('gitcron-commit', { configPath: gitcronPath, env: { UNSLOTH_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv });
    expect(resolved?.baseURL).toBe('http://192.168.1.7:8888/v1');
  });

  it('reimportar: lo igual no se reescribe y lo distinto dice qué campos cambian', () => {
    fs.writeFileSync(gitcronPath, JSON.stringify({
      provider: {
        unslothpc: OPENCODE.provider.unslothpc,
        unslothpclocal: { ...OPENCODE.provider.unslothpclocal, options: { baseURL: 'http://192.168.1.99:8888/v1', apiKey: '{env:UNSLOTH_API_KEY}' } },
      },
    }, null, 2));
    const plan = planOpenCodeImport({ opencodePath, gitcronPath });
    const same = plan.entries.find((e) => e.id === 'unslothpc')!;
    const changed = plan.entries.find((e) => e.id === 'unslothpclocal')!;
    expect(same.status).toBe('same');
    expect(changed.status).toBe('changed');
    expect(changed.changes).toEqual([
      { segments: ['options', 'baseURL'], before: 'http://192.168.1.99:8888/v1', after: 'http://192.168.1.7:8888/v1' },
    ]);
    const textBefore = fs.readFileSync(gitcronPath, 'utf8');
    expect(applyOpenCodeImport({ gitcronPath, entries: [same] })).toEqual([]);
    expect(fs.readFileSync(gitcronPath, 'utf8')).toBe(textBefore);
  });

  it('ausente o ilegible se dicen distinto, sin afirmar que no hay proveedores', () => {
    const absent = planOpenCodeImport({ opencodePath: path.join(dir, 'no', 'opencode.json'), gitcronPath });
    expect(absent.source.status).toBe('absent');
    fs.writeFileSync(opencodePath, '{ "provider": { "x": 1 "y": 2 } }');
    const invalid = planOpenCodeImport({ opencodePath, gitcronPath });
    expect(invalid.source).toMatchObject({ status: 'invalid', error: { code: 'CommaExpected' } });
    expect(invalid.entries).toEqual([]);
  });

  it('con gitcron.json roto no se planea ni se escribe nada', () => {
    fs.writeFileSync(gitcronPath, '{ "a": 1 "b": 2 }');
    const plan = planOpenCodeImport({ opencodePath, gitcronPath });
    expect(plan.target.error?.code).toBe('CommaExpected');
    expect(plan.entries).toEqual([]);
  });
});

describe('3.6b mcp.json (D12)', () => {
  it('convierte los seis servidores de OpenCode: comando, entorno, remotos y referencias', () => {
    expect(convertOpenCodeMcpServer(OPENCODE.mcp.fallow)).toEqual({
      server: { command: 'npx', args: ['-y', '--package', 'fallow', 'fallow-mcp'] },
      disabled: true,
    });
    expect(convertOpenCodeMcpServer(OPENCODE.mcp.github)).toEqual({
      server: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:GITHUB_PAT}' } },
      disabled: true,
    });
    expect(convertOpenCodeMcpServer(OPENCODE.mcp.vercel)).toEqual({ server: { url: 'https://mcp.vercel.com' }, disabled: true });
    // Un entorno vacío no se escribe.
    expect(convertOpenCodeMcpServer(OPENCODE.mcp['netlify-local-mcp'])?.server).toEqual({ command: 'npx', args: ['-y', '@netlify/mcp'] });
    expect(convertOpenCodeMcpServer({ type: 'raro' })).toBeNull();
  });

  it('importar desde OpenCode: notación mcpServers, enabled:false como comentario y opencode.json igual', () => {
    const before = sha(opencodePath);
    const plan = planMcpImport({ source: 'opencode', sourcePath: opencodePath, targetPath: mcpPath });
    expect(plan.entries).toHaveLength(6);
    expect(plan.skipped).toEqual([]);
    applyMcpImport({ targetPath: mcpPath, entries: plan.entries });

    const text = fs.readFileSync(mcpPath, 'utf8');
    const parsed = parseGitCronConfigText(text, mcpPath);
    expect(parsed.kind).toBe('ok');
    const servers = (parsed.kind === 'ok' ? parsed.config : {}) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(servers.mcpServers)).toEqual(['fallow', 'github', 'supabase', 'netlify-mcp', 'netlify-local-mcp', 'vercel']);
    expect(servers.mcpServers.github).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:GITHUB_PAT}' },
    });
    // La referencia de OpenCode ({env:X}) no queda sin convertir.
    expect(text).not.toContain('"{env:GITHUB_PAT}"');
    // Una línea de comentario encima de cada servidor apagado.
    expect(text.match(/\/\/ enabled: false en OpenCode/g)).toHaveLength(6);
    expect(sha(opencodePath)).toBe(before);

    // Reimportar no duplica los comentarios.
    const again = planMcpImport({ source: 'opencode', sourcePath: opencodePath, targetPath: mcpPath });
    expect(again.entries.every((e) => e.status === 'same')).toBe(true);
    applyMcpImport({ targetPath: mcpPath, entries: again.entries });
    expect(fs.readFileSync(mcpPath, 'utf8').match(/\/\/ enabled: false en OpenCode/g)).toHaveLength(6);
  });

  it('desde Cursor y LM Studio se importa tal cual, y su archivo no cambia', () => {
    const cursorPath = path.join(dir, 'cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    const cursor = { mcpServers: { codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] }, vercel: { url: 'https://mcp.vercel.com' } } };
    fs.writeFileSync(cursorPath, JSON.stringify(cursor, null, 2));
    const before = sha(cursorPath);
    const plan = planMcpImport({ source: 'cursor', sourcePath: cursorPath, targetPath: mcpPath });
    expect(plan.entries.map((e) => [e.name, e.status, e.disabled])).toEqual([['codegraph', 'new', false], ['vercel', 'new', false]]);
    applyMcpImport({ targetPath: mcpPath, entries: plan.entries });
    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers).toEqual(cursor.mcpServers);
    expect(sha(cursorPath)).toBe(before);
  });

  it('global y del repositorio: el del repositorio pisa por nombre, y escribir uno deja el resto igual', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.gitcron'), { recursive: true });
    fs.writeFileSync(mcpPath, '{\n  // mis servidores\n  "mcpServers": {\n    "a": { "command": "uno" },\n    "b": { "url": "https://b" }\n  }\n}\n');
    fs.writeFileSync(getRepoMcpPath(repo), JSON.stringify({ mcpServers: { b: { url: 'https://b-del-repo' } } }));
    const loaded = loadMcpConfig({ globalPath: mcpPath, repoPath: repo });
    expect(loaded.servers).toEqual({ a: { command: 'uno' }, b: { url: 'https://b-del-repo' } });
    expect(loaded.origins.b).toBe(getRepoMcpPath(repo));

    updateMcpServer(mcpPath, 'c', { url: 'https://c' });
    const text = fs.readFileSync(mcpPath, 'utf8');
    expect(text).toContain('// mis servidores');
    expect(text).toContain('"a": { "command": "uno" }');
  });

  it('se observa <repo>/.gitcron/mcp.json', async () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.gitcron'), { recursive: true });
    const events: Array<string | null> = [];
    const watcher = createGitCronConfigWatcher({ globalPath: mcpPath, fileName: 'mcp.json', repoSubdir: '.gitcron', onChange: (r) => events.push(r), debounceMs: 30 });
    watcher.watchRepo(repo);
    try {
      fs.writeFileSync(getRepoMcpPath(repo), '{"mcpServers":{}}');
      const start = Date.now();
      while (!events.includes(repo)) {
        if (Date.now() - start > 3000) throw new Error('no llegó el aviso');
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      watcher.close();
    }
  });

  it('un bloque mcp dentro de gitcron.json se advierte', () => {
    expect(validateGitCronConfig({ mcp: { x: {} } } as never)).toEqual([{ kind: 'mcp-in-gitcron', segments: ['mcp'] }]);
  });
});

describe('3.7 archivo inicial (D10)', () => {
  const sources: MigrationSources = {
    hasOpenRouterKey: true,
    hasAnthropicKey: false,
    temporalProvider: null,
    cartography: { enabled: false, mode: 'local', model: '' },
  };

  it('crea el archivo con LM Studio, OpenRouter por referencia y la elección de cada uso', () => {
    const result = migrateGitCronConfigIfMissing({ configPath: gitcronPath, readSources: () => sources });
    expect(result).toEqual({ created: true, path: gitcronPath });
    const config = JSON.parse(fs.readFileSync(gitcronPath, 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.provider.lmstudio.options.baseURL).toBe('http://localhost:1234/v1');
    expect(config.provider.openrouter.options.apiKey).toBe('{env:OPENROUTER_API_KEY}');
    expect(config.agent['gitcron-temporal'].model).toBe('openrouter/anthropic/claude-sonnet-4.5');
    expect(config.agent['gitcron-cartography']).toMatchObject({ model: 'lmstudio/local-model', disable: true });
    // Sin agent.gitcron-commit: la redacción sigue por su camino de siempre.
    expect(config.agent['gitcron-commit']).toBeUndefined();
    // Es un archivo válido para el formato.
    expect(validateGitCronConfig(config)).toEqual([]);
    // Ningún secreto escrito.
    expect(fs.readFileSync(gitcronPath, 'utf8')).not.toMatch(/sk-/);
  });

  it('Agente Temporal con Anthropic y Cartografía online con su modelo', () => {
    const config = buildInitialGitCronConfig({
      hasOpenRouterKey: false,
      hasAnthropicKey: true,
      temporalProvider: 'claude',
      cartography: { enabled: true, mode: 'online', model: 'google/gemini-2.5-pro' },
    });
    expect(config.provider?.anthropic?.options?.apiKey).toBe('{env:ANTHROPIC_API_KEY}');
    expect(config.agent?.['gitcron-temporal']?.model).toBe('anthropic/claude-sonnet-4-5');
    expect(config.agent?.['gitcron-cartography']).toEqual({
      description: 'GitCron: explicaciones de Cartografía.',
      model: 'openrouter/google/gemini-2.5-pro',
    });
    expect(validateGitCronConfig(config)).toEqual([]);
  });

  it('si el archivo ya existe no se toca ni se leen los ajustes; la segunda corrida no cambia nada', () => {
    migrateGitCronConfigIfMissing({ configPath: gitcronPath, readSources: () => sources });
    const before = sha(gitcronPath);
    let leidos = 0;
    const again = migrateGitCronConfigIfMissing({ configPath: gitcronPath, readSources: () => { leidos++; return sources; } });
    expect(again.created).toBe(false);
    expect(leidos).toBe(0);
    expect(sha(gitcronPath)).toBe(before);
  });
});
