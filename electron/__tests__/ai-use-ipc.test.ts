// Canales ai-use:* (tarea 4.3 de modelos-en-casa): qué modelo usa cada uso de texto
// según gitcron.json y «usar lo que tenías», sin valores secretos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  ipcMain: { handle: vi.fn((channel: string, handler: any) => handlers.set(channel, handler)) },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { registerAiUseHandlers, setLegacySourcesForTesting } from '../ipc/ai-use';
import { resetCommitAiConfigWatcherForTesting, setCommitAiConfigPathForTesting } from '../ipc/commit-message-ai';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { clearLastRequestsForTesting, setLastRequestForUse } from '../ai/text-use';
import { clearCanLoadCacheForTesting, setCanLoadFetchForTesting } from '../ai/config/provider-models';

describe('ai-use:status y ai-use:adopt', () => {
  let dir: string;
  let configPath: string;
  const sender = { isDestroyed: () => false, send: vi.fn() };

  beforeEach(() => {
    handlers.clear();
    clearLastRequestsForTesting();
    clearCanLoadCacheForTesting();
    resetGitCronConfigCacheForTesting();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-ai-use-')));
    configPath = path.join(dir, 'gitcron.json');
    setCommitAiConfigPathForTesting(configPath);
    setLegacySourcesForTesting(() => ({
      hasOpenRouterKey: true,
      hasAnthropicKey: false,
      temporalProvider: null,
      cartography: { enabled: true, mode: 'online', model: 'deepseek/deepseek-v4-pro' },
    }));
    registerAiUseHandlers();
  });

  afterEach(() => {
    clearLastRequestsForTesting();
    setCanLoadFetchForTesting(null);
    clearCanLoadCacheForTesting();
    resetCommitAiConfigWatcherForTesting();
    setCommitAiConfigPathForTesting(null);
    setLegacySourcesForTesting(null);
    authorizedRepoStore.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sin modelo: lo dice y ofrece la elección de antes; escribirla deja el uso resuelto', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: {} }, null, 2));
    const status = handlers.get('ai-use:status')!;
    const before = await status({ sender }, { use: 'gitcron-cartography' });
    expect(before).toEqual({
      success: true,
      data: {
        status: 'unset',
        use: 'gitcron-cartography',
        offer: { modelRef: 'openrouter/deepseek/deepseek-v4-pro', label: 'OpenRouter · deepseek/deepseek-v4-pro', addsProvider: 'openrouter', file: configPath },
        canLoad: false,
      },
    });

    expect(await handlers.get('ai-use:adopt')!({ sender }, { use: 'gitcron-cartography' }))
      .toEqual({ success: true, data: { written: true, modelRef: 'openrouter/deepseek/deepseek-v4-pro' } });

    const after = await status({ sender }, { use: 'gitcron-cartography' }, {});
    expect(after.data).toMatchObject({
      status: 'resolved',
      providerName: 'OpenRouter',
      modelId: 'deepseek/deepseek-v4-pro',
      destination: 'external-service',
      modelSource: 'agent',
    });
    // Ningún valor de clave viaja: sólo nombres y archivo.
    expect(JSON.stringify(after)).not.toContain('apiKey');

    // Escribir otra vez no hace nada: el uso ya tiene modelo.
    expect((await handlers.get('ai-use:adopt')!({ sender }, { use: 'gitcron-cartography' })).success).toBe(false);
  });

  it('el selector de la pantalla entra en la oferta, no en la resolución', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: {} }, null, 2));
    const res = await handlers.get('ai-use:status')!({ sender }, { use: 'gitcron-commit', screenModel: 'google/gemma-4-12b' });
    expect(res.data).toMatchObject({ status: 'unset', offer: { modelRef: 'lmstudio/google/gemma-4-12b', addsProvider: 'lmstudio' } });
  });

  it('un uso desconocido o un repositorio que no es una pestaña abierta se rechazan', async () => {
    fs.writeFileSync(configPath, '{}');
    const status = handlers.get('ai-use:status')!;
    expect((await status({ sender }, { use: 'desconocido' })).success).toBe(false);
    expect((await handlers.get('ai-use:last-request')!({ sender }, { use: 'gitcron-sdd' })).success).toBe(false);
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    expect(await status({ sender }, { use: 'gitcron-temporal', repoPath: repo }))
      .toMatchObject({ success: false, error: expect.stringMatching(/unauthorized repository path/) });
    expect(await handlers.get('ai-use:adopt')!({ sender }, { use: 'gitcron-temporal', repoPath: repo }))
      .toMatchObject({ success: false });
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{}');
  });

  it('archivo roto sin versión anterior: el error con su línea, sin ofrecer nada', async () => {
    fs.writeFileSync(configPath, '{ "agent": { "gitcron-temporal": { "model": "a/b" } "x": 1 } }');
    const res = await handlers.get('ai-use:status')!({ sender }, { use: 'gitcron-temporal' });
    expect(res.data).toMatchObject({ status: 'error', parseError: { file: configPath, line: 1, code: 'CommaExpected' } });
  });

  it('ai-use:last-request devuelve el último pedido guardado por uso y aísla los usos entre sí', async () => {
    const lastRequest = handlers.get('ai-use:last-request')!;
    expect(await lastRequest({ sender }, { use: 'gitcron-cartography' })).toEqual({ success: true, data: null });

    const reqCarto = {
      kind: 'openai-compatible' as const,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: { value: 'deepseek/deepseek-v4-pro', provenance: 'agent.gitcron-cartography.model' },
      headers: [{ name: 'Authorization', provenance: 'environment (OPENROUTER_API_KEY)' }],
      parameters: { temperature: { value: 0.2, provenance: 'default' } },
      timestamp: 123456789,
    };
    setLastRequestForUse('gitcron-cartography', reqCarto);

    const resCarto = await lastRequest({ sender }, { use: 'gitcron-cartography' });
    expect(resCarto).toEqual({ success: true, data: reqCarto });

    // Aislamiento: temporal no ve el pedido de cartografía
    const resTemporal = await lastRequest({ sender }, { use: 'gitcron-temporal' });
    expect(resTemporal).toEqual({ success: true, data: null });

    // Uso desconocido falla
    const resBad = await lastRequest({ sender }, { use: 'gitcron-unknown' });
    expect(resBad.success).toBe(false);
  });

  it('ai-use:status devuelve canLoad, serverUrl, sourceDir y isException cuando corresponde', async () => {
    setCanLoadFetchForTesting(async (url) => {
      if (url.includes('127.0.0.1:1234')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    fs.writeFileSync(configPath, JSON.stringify({
      model: 'lmstudio/deepseek-r1',
      provider: {
        lmstudio: {
          type: 'openai-compatible',
          options: { baseURL: 'http://127.0.0.1:1234/v1' },
          models: { 'deepseek-r1': {} },
        },
        openrouter: {
          type: 'openai-compatible',
          options: { baseURL: 'https://openrouter.ai/api/v1' },
          models: { 'claude-3-haiku': {} },
        },
      },
      agent: {
        'gitcron-cartography': {
          model: 'openrouter/claude-3-haiku',
        },
      },
    }, null, 2));

    const status = handlers.get('ai-use:status')!;

    // gitcron-commit usa el server local -> canLoad true, serverUrl http://127.0.0.1:1234
    const resCommit = await status({ sender }, { use: 'gitcron-commit' });
    expect(resCommit.success).toBe(true);
    expect(resCommit.data).toMatchObject({
      status: 'resolved',
      canLoad: true,
      serverUrl: 'http://127.0.0.1:1234',
      sourceDir: path.dirname(configPath),
      isException: false,
    });

    // gitcron-cartography es excepción y va a OpenRouter -> canLoad false
    const resCarto = await status({ sender }, { use: 'gitcron-cartography' });
    expect(resCarto.success).toBe(true);
    expect(resCarto.data).toMatchObject({
      status: 'resolved',
      canLoad: false,
      sourceDir: path.dirname(configPath),
      isException: true,
    });
  });
});
