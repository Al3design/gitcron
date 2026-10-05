// electron/__tests__/pipeline-runtime-start.test.ts
// `pipeline:runtime:start` (tarea 5.1): el motor y el modelo salen del uso `gitcron-sdd`
// de gitcron.json, los resuelve el proceso principal, y se lanza sólo lo que la pantalla
// mostró (`expectedModel` = la `launchKey` de la línea del uso).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

// La lista de OpenCode se simula (la corrida real la hace la auditoría contra el OpenCode instalado).
const fetchOpenCodeModelList = vi.hoisted(() => vi.fn());
vi.mock('../ai/config/opencode-models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/config/opencode-models')>()),
  fetchOpenCodeModelList,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => handlers.set(channel, handler)),
  },
}));

import { authorizedRepoStore } from '../ipc/authorized-repos';
import { registerPipelineRuntimeHandlers } from '../ipc/pipeline-runtime';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { setUseConfigPathForTesting } from '../ai/use-resolution';

const key = (modelRef: string, effort: string | null = null) => JSON.stringify([modelRef, effort]);

describe('pipeline:runtime:start (tarea 5.1)', () => {
  let tempDir: string;
  let repoDir: string;
  let globalPath: string;
  let repoConfigPath: string;
  let hubDiscoverSpy: ReturnType<typeof vi.fn>;
  let hubStartSpy: ReturnType<typeof vi.fn>;

  const start = (payload: Record<string, unknown>) =>
    handlers.get('pipeline:runtime:start')!(null, { repoPath: repoDir, instruction: 'hacer algo seguro', ...payload });
  const writeRepo = (config: unknown) => fs.writeFileSync(repoConfigPath, JSON.stringify(config));

  beforeEach(() => {
    handlers.clear();
    authorizedRepoStore.clear();

    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-start-test-')));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    repoConfigPath = path.join(repoDir, 'gitcron.json');
    // Un global de prueba: nunca el ~/.config/gitcron/gitcron.json de la máquina.
    globalPath = path.join(tempDir, 'global', 'gitcron.json');
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, '{}');
    setUseConfigPathForTesting(globalPath);
    resetGitCronConfigCacheForTesting();

    authorizedRepoStore.authorizeRepo(repoDir);

    hubDiscoverSpy = vi.fn(async () => [
      { runtime: 'codex', installed: true, launchable: true, diagnostics: [] },
      { runtime: 'claude', installed: true, launchable: true, diagnostics: [] },
      { runtime: 'agy', installed: true, launchable: true, diagnostics: [] },
    ]);
    hubStartSpy = vi.fn(async () => ({ ok: true, sessionId: 'sess-123' }));

    const mockHub = {
      discover: hubDiscoverSpy,
      get: vi.fn(() => null),
      history: vi.fn(() => []),
      start: hubStartSpy,
      stop: vi.fn(async () => ({ stopped: true })),
    };
    const mockService = {
      resolveBinding: vi.fn(async (p: string) => ({ repoId: 'repo-1', canonicalPath: fs.realpathSync(p) })),
    };
    registerPipelineRuntimeHandlers(mockHub as never, mockService as never);
  });

  afterEach(() => {
    setUseConfigPathForTesting(null);
    fetchOpenCodeModelList.mockReset();
    resetGitCronConfigCacheForTesting();
    authorizedRepoStore.clear();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('con codex/gpt-5.6-sol y nivel high, el hub recibe codex, ese modelo y ese nivel aunque la pantalla mande otro runtime u otro requestedModel', async () => {
    writeRepo({ agent: { 'gitcron-sdd': { model: 'codex/gpt-5.6-sol', options: { reasoning_effort: 'high' } } } });

    const res = await start({
      runtime: 'claude',
      requestedModel: 'claude-3-7-sonnet',
      expectedModel: key('codex/gpt-5.6-sol', 'high'),
    });

    expect(res).toEqual({ success: true, data: { sessionId: 'sess-123' } });
    expect(hubStartSpy).toHaveBeenCalledTimes(1);
    expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'codex',
      requestedModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      instruction: 'hacer algo seguro',
    }));
  });

  it('la elección general del gitcron.json global en uso alcanza: Claude con su modelo', async () => {
    fs.writeFileSync(globalPath, JSON.stringify({ model: 'claude-code/opus' }));
    resetGitCronConfigCacheForTesting();

    const res = await start({ expectedModel: key('claude-code/opus') });

    expect(res.success).toBe(true);
    expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'claude', requestedModel: 'opus', reasoningEffort: null }));
  });

  it('sin expectedModel, o con uno distinto, se rechaza con model_mismatch y no se lanza nada', async () => {
    writeRepo({ agent: { 'gitcron-sdd': { model: 'codex/gpt-5.6-sol', options: { reasoning_effort: 'high' } } } });

    expect(await start({})).toEqual({ success: false, error: 'model_mismatch' });
    expect(await start({ expectedModel: key('codex/gpt-5.6-sol') })).toEqual({ success: false, error: 'model_mismatch' });
    expect(await start({ expectedModel: key('claude-code/opus') })).toEqual({ success: false, error: 'model_mismatch' });
    expect(hubStartSpy).not.toHaveBeenCalled();
  });

  it('con unslothpclocal/unsloth/Qwen3.8-27B-GGUF y nivel high, el hub recibe opencode y unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high', async () => {
    writeRepo({
      provider: {
        unslothpclocal: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://localhost:8888/v1' },
          models: { 'unsloth/Qwen3.8-27B-GGUF': {} },
        },
      },
      agent: {
        'gitcron-sdd': {
          model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
          options: { reasoning_effort: 'high' },
        },
      },
    });

    hubDiscoverSpy.mockResolvedValue([
      { runtime: 'opencode', installed: true, launchable: true, diagnostics: [] },
    ]);
    fetchOpenCodeModelList.mockResolvedValue(({
      installed: true,
      models: [
        {
          providerId: 'unslothpclocal',
          id: 'unsloth/Qwen3.8-27B-GGUF',
          name: 'Qwen 3.8 27B',
          variantIds: ['low', 'medium', 'high'],
          contextLimit: 110000,
          enabled: true,
          status: 'active',
        },
      ],
    }));

    const res = await start({
      expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', 'high'),
    });

    expect(res).toEqual({ success: true, data: { sessionId: 'sess-123' } });
    expect(hubStartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'opencode',
        requestedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high',
        reasoningEffort: null,
      }),
    );
  });

  it('un modelo que OpenCode no conoce, OpenCode sin instalar y una launchKey vieja se rechazan con su código y no se lanza nada', async () => {
    writeRepo({
      provider: {
        unslothpclocal: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://localhost:8888/v1' },
          models: { 'unsloth/Qwen3.8-27B-GGUF': {} },
        },
      },
      agent: {
        'gitcron-sdd': {
          model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
          options: { reasoning_effort: 'high' },
        },
      },
    });

    // 1. OpenCode no conoce el modelo
    hubDiscoverSpy.mockResolvedValue([
      { runtime: 'opencode', installed: true, launchable: true, diagnostics: [] },
    ]);
    fetchOpenCodeModelList.mockResolvedValue(({
      installed: true,
      models: [], // Lista vacía
    }));
    expect(await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', 'high') })).toEqual({
      success: false,
      error: 'opencode_unknown_model',
    });
    expect(hubStartSpy).not.toHaveBeenCalled();

    // 2. OpenCode sin instalar
    hubDiscoverSpy.mockResolvedValue([
      { runtime: 'opencode', installed: false, launchable: false, diagnostics: ['no encontrado'] },
    ]);
    fetchOpenCodeModelList.mockResolvedValue(({
      installed: false,
      models: [],
    }));
    expect(await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', 'high') })).toEqual({
      success: false,
      error: 'opencode_not_installed',
    });
    expect(hubStartSpy).not.toHaveBeenCalled();

    // 3. LaunchKey vieja (mismatch)
    hubDiscoverSpy.mockResolvedValue([
      { runtime: 'opencode', installed: true, launchable: true, diagnostics: [] },
    ]);
    fetchOpenCodeModelList.mockResolvedValue(({
      installed: true,
      models: [
        {
          providerId: 'unslothpclocal',
          id: 'unsloth/Qwen3.8-27B-GGUF',
          name: 'Qwen 3.8 27B',
          variantIds: ['low', 'medium', 'high'],
          contextLimit: 110000,
          enabled: true,
          status: 'active',
        },
      ],
    }));
    expect(await start({ expectedModel: 'launchKey-vieja' })).toEqual({
      success: false,
      error: 'model_mismatch',
    });
    expect(hubStartSpy).not.toHaveBeenCalled();
  });

  describe('OpenCode', () => {
    const provider = { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://localhost:8888/v1' }, models: { 'unsloth/Qwen3.8-27B-GGUF': { variants: { low: {}, medium: {}, high: {} } } } };
    const QWEN = { providerId: 'unslothpclocal', id: 'unsloth/Qwen3.8-27B-GGUF', name: 'Qwen 3.8 27B', variantIds: ['low', 'medium', 'high'], contextLimit: 110000, enabled: true, status: 'active' };
    beforeEach(() => {
      hubDiscoverSpy.mockResolvedValue([{ runtime: 'opencode', installed: true, launchable: true, diagnostics: [] }]);
    });

    it('la variante explícita de agent.gitcron-sdd.variant viaja y le gana al nivel', async () => {
      writeRepo({ provider: { unslothpclocal: provider }, agent: { 'gitcron-sdd': { model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF', variant: 'medium', options: { reasoning_effort: 'high' } } } });
      fetchOpenCodeModelList.mockResolvedValue({ installed: true, models: [QWEN] });

      const res = await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', 'medium') });

      expect(res.success).toBe(true);
      expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'opencode', requestedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF#medium' }));
    });

    it('un nivel que OpenCode no declara como variante de ese modelo no se manda', async () => {
      writeRepo({ provider: { unslothpclocal: provider }, agent: { 'gitcron-sdd': { model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF', options: { reasoning_effort: 'xhigh' } } } });
      fetchOpenCodeModelList.mockResolvedValue({ installed: true, models: [QWEN] });

      const res = await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', null) });

      expect(res.success).toBe(true);
      expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF' }));
    });

    it('si OpenCode no contesta la lista no se dice que no conoce el modelo: se rechaza con opencode_list_failed y no se lanza nada', async () => {
      writeRepo({ provider: { unslothpclocal: provider }, agent: { 'gitcron-sdd': { model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF' } } });
      fetchOpenCodeModelList.mockResolvedValue({ installed: true, models: [], error: 'opencode_api_failed' });

      expect(await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', null) })).toEqual({ success: false, error: 'opencode_list_failed' });
      expect(hubStartSpy).not.toHaveBeenCalled();
    });

    it('un modelo inactivo o deshabilitado en OpenCode no se lanza', async () => {
      writeRepo({ provider: { unslothpclocal: provider }, agent: { 'gitcron-sdd': { model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF' } } });
      for (const changed of [{ enabled: false }, { status: 'deprecated' }]) {
        fetchOpenCodeModelList.mockResolvedValue({ installed: true, models: [{ ...QWEN, ...changed }] });
        expect(await start({ expectedModel: key('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', null) })).toEqual({ success: false, error: 'opencode_unknown_model' });
      }
      expect(hubStartSpy).not.toHaveBeenCalled();
    });
  });

  it('con un modelo de Antigravity se lanza como runtime agy con su modelo', async () => {
    writeRepo({ agent: { 'gitcron-sdd': { model: 'antigravity/gemini-3.8-flash' } } });

    const res = await start({ expectedModel: key('antigravity/gemini-3.8-flash') });
    expect(res.success).toBe(true);
    expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'agy',
      requestedModel: 'gemini-3.8-flash',
    }));
  });

  it('sin modelo se rechaza con no_model, y apagado con disabled; no se lanza nada', async () => {
    writeRepo({ provider: {} });
    expect(await start({})).toEqual({ success: false, error: 'no_model' });

    writeRepo({ agent: { 'gitcron-sdd': { disable: true, model: 'codex/gpt-5.6-sol' } } });
    resetGitCronConfigCacheForTesting();
    expect(await start({})).toEqual({ success: false, error: 'disabled' });
    expect(hubStartSpy).not.toHaveBeenCalled();
  });

  it('con el motor no instalado o no lanzable se rechaza con código estable', async () => {
    writeRepo({ agent: { 'gitcron-sdd': { model: 'claude-code/opus' } } });

    hubDiscoverSpy.mockResolvedValueOnce([{ runtime: 'claude', installed: false, launchable: false, diagnostics: ['no encontrado'] }]);
    expect(await start({ expectedModel: key('claude-code/opus') })).toEqual({ success: false, error: 'runtime_not_installed' });

    hubDiscoverSpy.mockResolvedValueOnce([{ runtime: 'claude', installed: true, launchable: false, diagnostics: ['sesión expirada'] }]);
    expect(await start({ expectedModel: key('claude-code/opus') })).toEqual({ success: false, error: 'runtime_not_launchable' });
    expect(hubStartSpy).not.toHaveBeenCalled();
  });
});
