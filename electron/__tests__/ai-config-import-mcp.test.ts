// electron/__tests__/ai-config-import-mcp.test.ts
// Canales de importar desde OpenCode y de servidores MCP (tarea 6.1, segunda parte).
// La regla que se prueba: ningún valor escrito a mano en opencode.json ni en `env` o
// `headers` de un servidor MCP llega a la pantalla ni a un archivo de GitCron; va al
// baúl y el archivo recibe la referencia. Las rutas las decide el proceso principal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-import-mcp-test-'));
const handlers = new Map<string, (_event: unknown, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(tempDir, 'userData');
      return tempDir;
    }),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(() => {}),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(`enc:${str}`)),
    decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
  },
}));

import {
  registerAiConfigHandlers,
  setAiConfigPathForTesting,
  setMcpImportSourcePathForTesting,
  setMcpPathForTesting,
  setOpenCodePathForTesting,
} from '../ipc/ai-config';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { resetMcpConfigCacheForTesting } from '../ai/config/mcp-config';
import * as keyStore from '../ai/key-store';
import { authorizedRepoStore } from '../ipc/authorized-repos';

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const call = (channel: string, args?: unknown) => handlers.get(channel)!({}, args);
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
};

let dir: string;
let gitcronPath: string;
let opencodePath: string;
let mcpPath: string;
let cursorPath: string;
let lmstudioPath: string;

beforeEach(() => {
  handlers.clear();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-tanda18-')));
  gitcronPath = path.join(dir, 'gitcron', 'gitcron.json');
  opencodePath = path.join(dir, 'opencode', 'opencode.json');
  mcpPath = path.join(dir, 'gitcron', 'mcp.json');
  cursorPath = path.join(dir, 'cursor', 'mcp.json');
  lmstudioPath = path.join(dir, 'lmstudio', 'mcp.json');

  fs.mkdirSync(path.join(tempDir, 'userData'), { recursive: true });
  fs.rmSync(path.join(tempDir, 'userData', 'ai-keys.enc'), { force: true });
  // Como en la app: al arrancar, la migración (D10) deja creada la carpeta de gitcron.json,
  // que es también la del mcp.json global.
  fs.mkdirSync(path.dirname(gitcronPath), { recursive: true });

  setAiConfigPathForTesting(gitcronPath);
  setOpenCodePathForTesting(opencodePath);
  setMcpPathForTesting(mcpPath);
  setMcpImportSourcePathForTesting('cursor', cursorPath);
  setMcpImportSourcePathForTesting('lmstudio', lmstudioPath);
  setMcpImportSourcePathForTesting('opencode', opencodePath);
  resetGitCronConfigCacheForTesting();
  resetMcpConfigCacheForTesting();

  registerAiConfigHandlers();
});

afterEach(() => {
  setAiConfigPathForTesting(null);
  setOpenCodePathForTesting(null);
  setMcpPathForTesting(null);
  setMcpImportSourcePathForTesting('cursor', null);
  setMcpImportSourcePathForTesting('lmstudio', null);
  setMcpImportSourcePathForTesting('opencode', null);
  resetGitCronConfigCacheForTesting();
  resetMcpConfigCacheForTesting();
  authorizedRepoStore.clear();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('importar desde OpenCode', () => {
  const HANDWRITTEN_KEY = 'sk-literal-super-secret-123456789';

  it('la clave escrita a mano no viaja, va al baúl y gitcron.json recibe {env:}; opencode.json no cambia; reimportar es «igual»', async () => {
    writeJson(opencodePath, {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        mycustom: {
          npm: '@ai-sdk/openai-compatible',
          name: 'My Custom OpenAI Server',
          options: {
            baseURL: 'https://api.custom.example.com/v1',
            apiKey: HANDWRITTEN_KEY,
            headers: { 'X-Custom-Token': '{env:MY_HEADER_TOKEN}' },
          },
          models: { 'gpt-custom-1': { name: 'Custom Model 1' } },
        },
      },
      agent: { tanda: { model: 'mycustom/gpt-custom-1' } },
    });
    writeJson(gitcronPath, { $schema: 'https://opencode.ai/config.json', provider: {} });
    const hashBefore = sha256(opencodePath);

    const plan = await call('ai-config:plan-opencode-import');
    expect(plan.success).toBe(true);
    expect(JSON.stringify(plan.data)).not.toContain(HANDWRITTEN_KEY);
    const provider = plan.data.entries.find((e: any) => e.id === 'mycustom');
    expect(provider.status).toBe('new');
    expect(provider).not.toHaveProperty('value');
    expect(provider.variables).toEqual([
      { name: 'MYCUSTOM_API_KEY', status: 'fromFile' },
      { name: 'MY_HEADER_TOKEN', status: 'missing' },
    ]);

    const applied = await call('ai-config:apply-opencode-import', {
      entries: [{ kind: 'provider', id: 'mycustom' }, { kind: 'agent', id: 'tanda' }],
    });
    expect(applied).toEqual({ success: true, data: { count: 2 } });

    const written = fs.readFileSync(gitcronPath, 'utf8');
    expect(written).not.toContain(HANDWRITTEN_KEY);
    expect(written).toContain('{env:MYCUSTOM_API_KEY}');
    expect(written).toContain('{env:MY_HEADER_TOKEN}');
    expect(keyStore.getStoredEnvVar('MYCUSTOM_API_KEY')).toBe(HANDWRITTEN_KEY);
    expect(sha256(opencodePath)).toBe(hashBefore);

    resetGitCronConfigCacheForTesting();
    const again = await call('ai-config:plan-opencode-import');
    expect(again.data.entries.find((e: any) => e.id === 'mycustom').status).toBe('same');
    expect(again.data.entries.find((e: any) => e.id === 'mycustom').variables[0]).toEqual({ name: 'MYCUSTOM_API_KEY', status: 'stored' });
  });

  it('los cambios muestran los valores de los campos comunes y esconden un secreto escrito a mano en gitcron.json', async () => {
    const IN_GITCRON = 'sk-handwritten-in-gitcron-555';
    writeJson(gitcronPath, {
      provider: {
        other: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:1234/v1', apiKey: IN_GITCRON } },
        third: { npm: '@ai-sdk/openai-compatible' },
      },
    });
    writeJson(opencodePath, {
      provider: {
        other: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:8888/v1', apiKey: '{env:OTHER_KEY}' } },
        // `options` aparece entero, con una clave y una cabecera escritas a mano
        third: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'sk-third-777', headers: { 'X-Team': 'team-secret-888' } } },
      },
    });

    const plan = await call('ai-config:plan-opencode-import');
    const json = JSON.stringify(plan.data);
    for (const secret of [IN_GITCRON, 'sk-third-777', 'team-secret-888']) expect(json).not.toContain(secret);

    const other = plan.data.entries.find((e: any) => e.id === 'other');
    expect(other.changes).toContainEqual({ segments: ['options', 'baseURL'], before: 'http://127.0.0.1:1234/v1', after: 'http://127.0.0.1:8888/v1' });
    expect(other.changes).toContainEqual({ segments: ['options', 'apiKey'], beforeHidden: true, after: '{env:OTHER_KEY}' });

    const third = plan.data.entries.find((e: any) => e.id === 'third');
    expect(third.changes).toContainEqual({ segments: ['options', 'apiKey'], after: '{env:THIRD_API_KEY}' });
    expect(third.changes).toContainEqual({ segments: ['options', 'headers', 'X-Team'], after: '{env:THIRD_X_TEAM}' });
  });

  it('un nombre ocupado con otro valor (en el baúl, en el sistema o en el mismo plan) no se pisa: lleva sufijo', async () => {
    keyStore.setEnvVar('MYCUSTOM_API_KEY', 'valor-que-ya-estaba');
    process.env.GCTEST_ZETA_API_KEY = 'valor-del-sistema';
    try {
      writeJson(opencodePath, {
        provider: {
          mycustom: { options: { apiKey: 'sk-mycustom-nueva' } },
          gctest_zeta: { options: { apiKey: 'sk-zeta-nueva' } },
          // Dos cabeceras con el mismo nombre y valores distintos en dos proveedores
          alfa: { options: { headers: { Authorization: 'Bearer alfa-111' } } },
          beta: { options: { headers: { Authorization: 'Bearer beta-222' } } },
        },
      });

      const plan = await call('ai-config:plan-opencode-import');
      const varsOf = (id: string) => plan.data.entries.find((e: any) => e.id === id).variables.map((v: any) => v.name);
      expect(varsOf('mycustom')).toEqual(['MYCUSTOM_API_KEY_2']);
      expect(varsOf('gctest_zeta')).toEqual(['GCTEST_ZETA_API_KEY_2']);
      expect(varsOf('alfa')).toEqual(['ALFA_AUTHORIZATION']);
      expect(varsOf('beta')).toEqual(['BETA_AUTHORIZATION']);

      await call('ai-config:apply-opencode-import', {
        entries: ['mycustom', 'gctest_zeta', 'alfa', 'beta'].map((id) => ({ kind: 'provider', id })),
      });
      expect(keyStore.getStoredEnvVar('MYCUSTOM_API_KEY')).toBe('valor-que-ya-estaba');
      expect(keyStore.getStoredEnvVar('MYCUSTOM_API_KEY_2')).toBe('sk-mycustom-nueva');
      expect(keyStore.getStoredEnvVar('GCTEST_ZETA_API_KEY_2')).toBe('sk-zeta-nueva');
      expect(keyStore.getStoredEnvVar('ALFA_AUTHORIZATION')).toBe('Bearer alfa-111');
      expect(keyStore.getStoredEnvVar('BETA_AUTHORIZATION')).toBe('Bearer beta-222');
    } finally {
      delete process.env.GCTEST_ZETA_API_KEY;
    }
  });

  it('una ruta que mande la pantalla no se usa: se lee el opencode.json de siempre', async () => {
    const elsewhere = path.join(dir, 'otro', 'opencode.json');
    writeJson(elsewhere, { provider: { ajeno: { options: { baseURL: 'http://ajeno' } } } });
    writeJson(opencodePath, { provider: { propio: { options: { baseURL: 'http://propio' } } } });

    const plan = await call('ai-config:plan-opencode-import', { opencodePath: elsewhere });
    expect(plan.data.source.path).toBe(opencodePath);
    expect(plan.data.entries.map((e: any) => e.id)).toEqual(['propio']);
  });

  it('sin opencode.json lo dice como ausente, con la ruta', async () => {
    const plan = await call('ai-config:plan-opencode-import');
    expect(plan.data.source).toEqual({ status: 'absent', path: opencodePath });
    expect(plan.data.entries).toEqual([]);
  });
});

describe('servidores MCP', () => {
  it('la lista no trae valores de env ni de cabeceras, ni argumentos ni la dirección completa', async () => {
    writeJson(mcpPath, {
      mcpServers: {
        postgres: {
          command: 'C:/tools/node/npx.cmd',
          args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://ale:pa55word@db.local/app'],
          env: { GITHUB_TOKEN: 'ghp_literalHandwrittenTokenNeverLeak999' },
        },
        remoto: {
          url: 'https://mcp.remote.example.com/sse?token=abc-query-secret',
          headers: { Authorization: 'Bearer header-secret-123' },
        },
      },
    });

    const status = await call('ai-config:get-mcp-status', {});
    expect(status.success).toBe(true);
    const json = JSON.stringify(status.data);
    for (const secret of ['ghp_literalHandwrittenTokenNeverLeak999', 'pa55word', 'abc-query-secret', 'header-secret-123']) {
      expect(json).not.toContain(secret);
    }
    const postgres = status.data.servers.find((s: any) => s.name === 'postgres');
    expect(postgres).toMatchObject({ kind: 'local', command: 'npx.cmd', envVarNames: ['GITHUB_TOKEN'], scope: 'global', disabled: false });
    const remoto = status.data.servers.find((s: any) => s.name === 'remoto');
    expect(remoto).toMatchObject({ kind: 'remote', host: 'mcp.remote.example.com', headerNames: ['Authorization'] });
    expect(status.data.files).toEqual([{ path: mcpPath, scope: 'global', exists: true }]);
  });

  it('«deshabilitado» se marca sólo en el servidor que lo estaba en OpenCode', async () => {
    writeJson(opencodePath, {
      mcp: {
        apagado: { type: 'local', command: ['npx', 'apagado'], enabled: false },
        prendido: { type: 'local', command: ['npx', 'prendido'] },
      },
    });
    await call('ai-config:apply-mcp-import', { source: 'opencode', entries: ['apagado', 'prendido'] });

    const status = await call('ai-config:get-mcp-status', {});
    const disabledOf = (name: string) => status.data.servers.find((s: any) => s.name === name).disabled;
    expect(disabledOf('apagado')).toBe(true);
    expect(disabledOf('prendido')).toBe(false);
  });

  it('quitar un servidor del mcp.json del repositorio pide el repositorio; sin él, el archivo no se acepta', async () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const repoRoot = authorizedRepoStore.authorizeRepo(repo)!;
    const repoMcp = path.join(repoRoot, '.gitcron', 'mcp.json');
    writeJson(repoMcp, { mcpServers: { delrepo: { command: 'npx' }, otro: { command: 'npx' } } });

    const status = await call('ai-config:get-mcp-status', { repoPath: repoRoot });
    const server = status.data.servers.find((s: any) => s.name === 'delrepo');
    expect(server).toMatchObject({ scope: 'repo', origin: repoMcp });

    const withoutRepo = await call('ai-config:remove-mcp-server', { filePath: repoMcp, name: 'delrepo' });
    expect(withoutRepo.success).toBe(false);

    const removed = await call('ai-config:remove-mcp-server', { filePath: repoMcp, name: 'delrepo', repoPath: repoRoot });
    expect(removed).toEqual({ success: true, data: { removed: true } });
    const left = JSON.parse(fs.readFileSync(repoMcp, 'utf8'));
    expect(Object.keys(left.mcpServers)).toEqual(['otro']);
  });

  it.each([
    ['cursor', () => cursorPath, (servers: unknown) => ({ mcpServers: servers })],
    ['lmstudio', () => lmstudioPath, (servers: unknown) => ({ mcpServers: servers })],
  ] as const)('importar desde %s: tokens de env y cabeceras al baúl, mcp.json con ${env:}, el origen igual', async (source, sourcePath, shape) => {
    writeJson(sourcePath(), shape({
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: `ghp_${source}_token` } },
      remoto: { url: 'https://mcp.example.com/mcp', headers: { Authorization: `Bearer ${source}-header` } },
    }));
    const hashBefore = sha256(sourcePath());

    const plan = await call('ai-config:plan-mcp-import', { source });
    expect(plan.success).toBe(true);
    const json = JSON.stringify(plan.data);
    expect(json).not.toContain(`ghp_${source}_token`);
    expect(json).not.toContain(`${source}-header`);
    expect(plan.data.target.path).toBe(mcpPath);
    expect(plan.data.entries.find((e: any) => e.name === 'github').fromFile).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
    expect(plan.data.entries.find((e: any) => e.name === 'remoto').fromFile).toEqual(['REMOTO_AUTHORIZATION']);

    const applied = await call('ai-config:apply-mcp-import', { source, entries: ['github', 'remoto'] });
    expect(applied).toEqual({ success: true, data: { count: 2 } });

    const written = fs.readFileSync(mcpPath, 'utf8');
    expect(written).not.toContain(`ghp_${source}_token`);
    expect(written).not.toContain(`${source}-header`);
    expect(written).toContain('${env:GITHUB_PERSONAL_ACCESS_TOKEN}');
    expect(written).toContain('${env:REMOTO_AUTHORIZATION}');
    expect(keyStore.getStoredEnvVar('GITHUB_PERSONAL_ACCESS_TOKEN')).toBe(`ghp_${source}_token`);
    expect(keyStore.getStoredEnvVar('REMOTO_AUTHORIZATION')).toBe(`Bearer ${source}-header`);
    expect(sha256(sourcePath())).toBe(hashBefore);
  });

  it('importar desde OpenCode: el token escrito a mano en `environment` va al baúl; los no convertibles se nombran', async () => {
    writeJson(opencodePath, {
      mcp: {
        github: { type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-github'], environment: { GITHUB_TOKEN: 'ghp_opencode_token' } },
        raro: { type: 'otro' },
      },
    });
    const hashBefore = sha256(opencodePath);

    const plan = await call('ai-config:plan-mcp-import', { source: 'opencode' });
    expect(JSON.stringify(plan.data)).not.toContain('ghp_opencode_token');
    expect(plan.data.skipped).toEqual(['raro']);

    await call('ai-config:apply-mcp-import', { source: 'opencode', entries: ['github'] });
    expect(fs.readFileSync(mcpPath, 'utf8')).toContain('${env:GITHUB_TOKEN}');
    expect(keyStore.getStoredEnvVar('GITHUB_TOKEN')).toBe('ghp_opencode_token');
    expect(sha256(opencodePath)).toBe(hashBefore);
  });

  it('importar va al mcp.json global aunque haya repositorio abierto y aunque la pantalla mande rutas', async () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const repoRoot = authorizedRepoStore.authorizeRepo(repo)!;
    const repoMcp = path.join(repoRoot, '.gitcron', 'mcp.json');
    const elsewhere = path.join(dir, 'fuera', 'mcp.json');
    writeJson(cursorPath, { mcpServers: { github: { command: 'npx' } } });

    const applied = await call('ai-config:apply-mcp-import', {
      source: 'cursor',
      entries: ['github'],
      repoPath: repoRoot,
      targetPath: elsewhere,
      sourcePath: elsewhere,
    });
    expect(applied.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers.github).toEqual({ command: 'npx' });
    expect(fs.existsSync(repoMcp)).toBe(false);
    expect(fs.existsSync(elsewhere)).toBe(false);
  });

  it('un origen desconocido se rechaza', async () => {
    const plan = await call('ai-config:plan-mcp-import', { source: 'vscode' });
    expect(plan.success).toBe(false);
  });
});
