// electron/__tests__/pipeline-runtime-start.test.ts
// `pipeline:runtime:start` (tarea 5.1): el motor y el modelo salen del uso `gitcron-sdd`
// de gitcron.json, los resuelve el proceso principal, y se lanza sólo lo que la pantalla
// mostró (`expectedModel` = la `launchKey` de la línea del uso).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

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

  it('con un modelo de servidor se rechaza con unsupported_runtime_opencode y no se lanza nada', async () => {
    writeRepo({
      provider: { unslothpc: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://localhost:8888/v1' }, models: { 'qwen-3': {} } } },
      agent: { 'gitcron-sdd': { model: 'unslothpc/qwen-3' } },
    });

    expect(await start({ expectedModel: key('unslothpc/qwen-3') })).toEqual({ success: false, error: 'unsupported_runtime_opencode' });
    expect(hubStartSpy).not.toHaveBeenCalled();
  });

  it('con un modelo de Antigravity se rechaza con unsupported_runtime_agy y no se lanza nada', async () => {
    writeRepo({ agent: { 'gitcron-sdd': { model: 'antigravity/gemini-3.8-flash' } } });

    expect(await start({ expectedModel: key('antigravity/gemini-3.8-flash') })).toEqual({ success: false, error: 'unsupported_runtime_agy' });
    expect(hubStartSpy).not.toHaveBeenCalled();
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
