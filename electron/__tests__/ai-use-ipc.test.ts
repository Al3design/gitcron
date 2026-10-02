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

describe('ai-use:status y ai-use:adopt', () => {
  let dir: string;
  let configPath: string;
  const sender = { isDestroyed: () => false, send: vi.fn() };

  beforeEach(() => {
    handlers.clear();
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
    expect((await status({ sender }, { use: 'gitcron-sdd' })).success).toBe(false);
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
});
