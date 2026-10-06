import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'jsonc-parser';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  ipcMain: { handle: vi.fn((channel: string, handler: any) => handlers.set(channel, handler)) },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { registerAiUseHandlers } from '../ipc/ai-use';
import { resetCommitAiConfigWatcherForTesting, setCommitAiConfigPathForTesting } from '../ipc/commit-message-ai';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { clearToolModelsCacheForTesting, setToolModelsExecutorsForTesting } from '../ai/config/tool-models';
import { spawn as realSpawn } from 'node:child_process';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/modelos-en-casa');

describe('ai-use:choose y ai-use:models (tarea 4.5)', () => {
  let dir: string;
  let globalConfigPath: string;
  let repoDir: string;
  let repoConfigPath: string;
  const sender = { isDestroyed: () => false, send: vi.fn() };

  beforeEach(() => {
    handlers.clear();
    clearToolModelsCacheForTesting();
    resetGitCronConfigCacheForTesting();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-choose-global-')));
    globalConfigPath = path.join(dir, 'gitcron.json');
    setCommitAiConfigPathForTesting(globalConfigPath);

    repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-choose-repo-')));
    fs.mkdirSync(path.join(repoDir, '.git'));
    repoConfigPath = path.join(repoDir, 'gitcron.json');
    authorizedRepoStore.authorizeRepo(repoDir);

    // Mock executables using fixtures
    const debugModelsJson = fs.readFileSync(path.join(FIXTURES_DIR, 'codex-0.144.4-debug-models.json'), 'utf8');
    const agyModelsTxt = fs.readFileSync(path.join(FIXTURES_DIR, 'agy-1.2.13-models.txt'), 'utf8');

    setToolModelsExecutorsForTesting(
      async (name) => ({ file: `C:/tools/${name}.cmd`, viaShell: true }),
      ((_file: string, args: string[]) => {
        let stdout = '';
        if (args.includes('debug') && args.includes('models')) {
          stdout = debugModelsJson;
        } else if (args.includes('models')) {
          stdout = agyModelsTxt;
        }
        const listeners: Record<string, ((...a: any[]) => void)[]> = {};
        const child: any = {
          stdout: { on: (event: string, cb: any) => { (listeners[event] ??= []).push(cb); } },
          stderr: { on: vi.fn() },
          on: (event: string, cb: any) => { (listeners[event] ??= []).push(cb); },
          kill: vi.fn(),
        };
        setTimeout(() => {
          for (const cb of listeners.data ?? []) cb(Buffer.from(stdout));
          for (const cb of listeners.close ?? []) cb(0);
        }, 10);
        return child;
      }) as any,
    );

    registerAiUseHandlers();
  });

  afterEach(() => {
    resetCommitAiConfigWatcherForTesting();
    setToolModelsExecutorsForTesting(null, null);
    clearToolModelsCacheForTesting();
    resetGitCronConfigCacheForTesting();
    setCommitAiConfigPathForTesting(null);
    authorizedRepoStore.clear();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('ai-use:models devuelve la lista de proveedores, modelos y niveles', async () => {
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify(
        {
          provider: {
            casa: {
              name: 'Mi Casa',
              models: {
                qwen: {
                  name: 'Qwen 2.5',
                  variants: {
                    alta: { reasoning_effort: 'high' },
                    deshabilitada: { disabled: true },
                  },
                },
              },
            },
          },
          agent: {
            'gitcron-commit': {
              model: 'codex/gpt-5.6-sol',
              options: { reasoning_effort: 'ultra' },
            },
          },
        },
        null,
        2,
      ),
    );

    const modelsHandler = handlers.get('ai-use:models')!;
    const res = await modelsHandler({ sender }, { use: 'gitcron-commit' });
    expect(res.success).toBe(true);
    expect(res.data.use).toBe('gitcron-commit');

    const providerIds = res.data.providers.map((p: any) => p.id);
    expect(providerIds).toContain('codex');
    expect(providerIds).toContain('antigravity');
    expect(providerIds).toContain('claude-code');
    expect(providerIds).toContain('casa');

    // Variantes de qwen
    const casa = res.data.providers.find((p: any) => p.id === 'casa')!;
    const qwen = casa.models.find((m: any) => m.id === 'qwen')!;
    expect(qwen.variants).toEqual(['alta']); // deshabilitada se filtra

    // Elección actual
    expect(res.data.current).toEqual({
      providerId: 'codex',
      modelId: 'gpt-5.6-sol',
      fullModelRef: 'codex/gpt-5.6-sol',
      effort: 'ultra',
      variant: undefined,
      sourceFile: globalConfigPath,
      scope: 'global',
    });
  });

  it('ai-use:choose rechaza un modelo que no está en la lista sin tocar el archivo', async () => {
    const initialText = '{\n  // comentario que debe conservarse\n  "provider": {}\n}\n';
    fs.writeFileSync(globalConfigPath, initialText, 'utf8');

    const chooseHandler = handlers.get('ai-use:choose')!;
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      model: 'codex/gpt-6.1-sol', // de la caché, no del catálogo vivo
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no está en la lista/);
    expect(fs.readFileSync(globalConfigPath, 'utf8')).toBe(initialText);
  });

  it('ai-use:choose rechaza un nivel que el modelo no admite sin tocar el archivo', async () => {
    const initialText = '{\n  /* comentario */\n  "provider": {}\n}\n';
    fs.writeFileSync(globalConfigPath, initialText, 'utf8');

    const chooseHandler = handlers.get('ai-use:choose')!;
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      model: 'codex/gpt-5.5',
      effort: 'ultra', // gpt-5.5 sólo llega a xhigh
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no está admitido/);
    expect(fs.readFileSync(globalConfigPath, 'utf8')).toBe(initialText);
  });

  it('ai-use:choose escribe el modelo y el nivel con escritura puntual conservando comentarios', async () => {
    const initialText = '{\n  // Mi configuracion personal\n  "provider": {}\n}\n';
    fs.writeFileSync(globalConfigPath, initialText, 'utf8');

    const chooseHandler = handlers.get('ai-use:choose')!;
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      model: 'codex/gpt-5.6-sol',
      effort: 'ultra',
    });

    expect(res.success).toBe(true);
    expect(res.data.written).toBe(true);
    expect(res.data.file).toBe(globalConfigPath);

    const writtenText = fs.readFileSync(globalConfigPath, 'utf8');
    expect(writtenText).toContain('// Mi configuracion personal');
    const parsed = parse(writtenText);
    expect(parsed.agent['gitcron-commit']).toEqual({
      model: 'codex/gpt-5.6-sol',
      options: { reasoning_effort: 'ultra' },
    });
  });

  it('quitar el nivel no deja un objeto options vacío', async () => {
    const initialText = JSON.stringify(
      {
        agent: {
          'gitcron-commit': {
            model: 'codex/gpt-5.6-sol',
            options: { reasoning_effort: 'ultra' },
          },
        },
      },
      null,
      2,
    );
    fs.writeFileSync(globalConfigPath, initialText, 'utf8');

    const chooseHandler = handlers.get('ai-use:choose')!;
    // Elegir el de por omisión (sin effort)
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      model: 'codex/gpt-5.6-sol',
    });

    expect(res.success).toBe(true);
    const writtenText = fs.readFileSync(globalConfigPath, 'utf8');
    const parsed = JSON.parse(writtenText);
    expect(parsed.agent['gitcron-commit']).toEqual({
      model: 'codex/gpt-5.6-sol',
    });
    expect(parsed.agent['gitcron-commit']).not.toHaveProperty('options');
  });

  it('quitar el nivel conserva otras claves en options', async () => {
    const initialText = JSON.stringify(
      {
        agent: {
          'gitcron-commit': {
            model: 'codex/gpt-5.6-sol',
            options: {
              temperature: 0.2,
              reasoning_effort: 'ultra',
            },
          },
        },
      },
      null,
      2,
    );
    fs.writeFileSync(globalConfigPath, initialText, 'utf8');

    const chooseHandler = handlers.get('ai-use:choose')!;
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      model: 'codex/gpt-5.6-sol',
    });

    expect(res.success).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(parsed.agent['gitcron-commit']).toEqual({
      model: 'codex/gpt-5.6-sol',
      options: {
        temperature: 0.2,
      },
    });
  });

  it('respeta el archivo del repositorio si ahí estaba la entrada (D2)', async () => {
    // Global sin la entrada
    fs.writeFileSync(globalConfigPath, JSON.stringify({ provider: {} }, null, 2), 'utf8');
    // Repositorio con la entrada
    fs.writeFileSync(
      repoConfigPath,
      JSON.stringify(
        {
          agent: {
            'gitcron-commit': {
              model: 'codex/gpt-5.5',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const chooseHandler = handlers.get('ai-use:choose')!;
    const res = await chooseHandler({ sender }, {
      use: 'gitcron-commit',
      repoPath: repoDir,
      model: 'codex/gpt-5.6-sol',
      effort: 'low',
    });

    expect(res.success).toBe(true);
    expect(res.data.file).toBe(repoConfigPath);

    // El del repositorio se actualizó
    const repoParsed = JSON.parse(fs.readFileSync(repoConfigPath, 'utf8'));
    expect(repoParsed.agent['gitcron-commit']).toEqual({
      model: 'codex/gpt-5.6-sol',
      options: { reasoning_effort: 'low' },
    });

    // El global no se tocó
    const globalParsed = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(globalParsed).not.toHaveProperty('agent');
  });

  it('un CLI que no está instalado no se puede guardar, aunque su lista sea fija (Claude Code)', async () => {
    fs.writeFileSync(globalConfigPath, '{}', 'utf8');
    clearToolModelsCacheForTesting();
    setToolModelsExecutorsForTesting(
      async (name) => {
        if (name === 'claude') throw new Error("Runtime executable 'claude' was not found");
        return { file: `C:/tools/${name}.cmd`, viaShell: true };
      },
      null,
    );
    const res = await handlers.get('ai-use:choose')!({ sender }, { use: 'gitcron-commit', model: 'claude-code/haiku', effort: 'high' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no existe o no está disponible/);
    expect(fs.readFileSync(globalConfigPath, 'utf8')).toBe('{}');
  });

  it('canales con gitcron-sdd: status y models funcionan, choose escribe donde está la elección que vale, y last-request rechaza', async () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'codex/gpt-5.6-sol',
          options: { reasoning_effort: 'high' },
        },
      },
    }, null, 2));
    fs.writeFileSync(repoConfigPath, JSON.stringify({
      model: 'claude-code/sonnet',
    }, null, 2));

    // 1. ai-use:status con gitcron-sdd devuelve motor, herramientas, modelo y esfuerzo
    const statusRes = await handlers.get('ai-use:status')!({ sender }, { use: 'gitcron-sdd', repoPath: repoDir });
    expect(statusRes.success).toBe(true);
    expect(statusRes.data).toMatchObject({
      status: 'resolved',
      use: 'gitcron-sdd',
      modelId: 'gpt-5.6-sol',
      providerId: 'codex',
      runtime: 'codex',
      toolsExecutor: 'Codex',
      effort: 'high',
    });

    // 2. ai-use:models con gitcron-sdd trae modelos anotados con agentRuntime y toolsExecutor
    const modelsRes = await handlers.get('ai-use:models')!({ sender }, { use: 'gitcron-sdd', repoPath: repoDir });
    expect(modelsRes.success).toBe(true);
    const codexProvider = modelsRes.data.providers.find((p: any) => p.id === 'codex');
    expect(codexProvider).toMatchObject({
      agentRuntime: 'codex',
      toolsExecutor: 'Codex',
    });

    // 3. ai-use:choose con gitcron-sdd, como los otros usos: sin entrada del uso en el repositorio, al global
    const chooseRes = await handlers.get('ai-use:choose')!({ sender }, {
      use: 'gitcron-sdd',
      repoPath: repoDir,
      model: 'codex/gpt-5.6-sol',
      effort: 'medium',
    });
    expect(chooseRes.success).toBe(true);
    expect(chooseRes.data.file).toBe(globalConfigPath);

    const globalContent = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(globalContent.agent['gitcron-sdd'].options.reasoning_effort).toBe('medium');

    const repoContent = JSON.parse(fs.readFileSync(repoConfigPath, 'utf8'));
    expect(repoContent).not.toHaveProperty('agent');

    // 3b. Si el repositorio declara la entrada del agente, ésa es la que vale: se escribe ahí,
    // porque escribir en el global no cambiaría nada.
    fs.writeFileSync(repoConfigPath, JSON.stringify({ agent: { 'gitcron-sdd': { model: 'claude-code/sonnet' } } }, null, 2));
    const chooseRepo = await handlers.get('ai-use:choose')!({ sender }, {
      use: 'gitcron-sdd',
      repoPath: repoDir,
      model: 'codex/gpt-5.6-sol',
    });
    expect(chooseRepo.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(repoConfigPath, 'utf8')).agent['gitcron-sdd'].model).toBe('codex/gpt-5.6-sol');

    // 4. ai-use:last-request sigue rechazando gitcron-sdd
    const lastReqRes = await handlers.get('ai-use:last-request')!({ sender }, { use: 'gitcron-sdd' });
    expect(lastReqRes.success).toBe(false);
  });
});

describe('catálogo de un CLI que no contesta', () => {
  afterEach(() => {
    setToolModelsExecutorsForTesting(null, null);
    clearToolModelsCacheForTesting();
  });

  it('se corta por tiempo y no queda vivo ni lo que el CLI lanzó', async () => {
    const { fetchCodexModels } = await import('../ai/config/tool-models');
    let pid = 0;
    let grandchild = 0;
    const script = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)";
    setToolModelsExecutorsForTesting(
      async () => ({ file: process.execPath, viaShell: false }),
      ((_file: string, _args: string[], opts: any) => {
        const child = realSpawn(process.execPath, ['-e', script], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
        pid = child.pid!;
        child.stdout!.on('data', (d: Buffer) => { grandchild = Number(String(d).trim()) || grandchild; });
        return child;
      }) as any,
    );
    const alive = (n: number) => { try { process.kill(n, 0); return true; } catch { return false; } };
    const res = await fetchCodexModels({ timeoutMs: 1500, bypassCache: true });
    expect(res).toEqual({ ok: false, error: 'Tiempo agotado al consultar modelos' });
    await vi.waitFor(() => {
      expect(alive(pid)).toBe(false);
      if (process.platform === 'win32') {
        expect(grandchild).toBeGreaterThan(0);
        expect(alive(grandchild)).toBe(false);
      }
    }, { timeout: 5000 });
  }, 15_000);
});
