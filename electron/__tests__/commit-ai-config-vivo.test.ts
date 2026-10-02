// commit-ai:resolved-model con el gitcron.json del repositorio, su error con datos,
// y el aviso cuando el archivo cambia (tareas 3.1 y 3.4 de modelos-en-casa).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    }),
  },
}));

import {
  getWatchedConfigReposForTesting,
  registerCommitMessageAiHandlers,
  resetCommitAiConfigWatcherForTesting,
  setCommitAiConfigPathForTesting,
} from '../ipc/commit-message-ai';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';

const GLOBAL = JSON.stringify({
  provider: { unslothpc: { name: 'Unsloth CASA', options: { baseURL: 'http://localhost:1234/v1' } } },
  agent: { 'gitcron-commit': { model: 'unslothpc/qwen' } },
}, null, 2);

describe('commit-ai:resolved-model con el archivo vivo', () => {
  let dir: string;
  let globalPath: string;
  let repoPath: string;
  let sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };

  const waitFor = async (check: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('no llegó el aviso');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  beforeEach(() => {
    handlers.clear();
    resetGitCronConfigCacheForTesting();
    authorizedRepoStore.clear();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-ipc-vivo-')));
    globalPath = path.join(dir, 'global', 'gitcron.json');
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, GLOBAL);
    repoPath = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
    setCommitAiConfigPathForTesting(globalPath);
    registerCommitMessageAiHandlers();
    sender = { isDestroyed: () => false, send: vi.fn() };
  });

  afterEach(() => {
    resetCommitAiConfigWatcherForTesting();
    setCommitAiConfigPathForTesting(null);
    authorizedRepoStore.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('con un repositorio abierto, su gitcron.json se mezcla y la respuesta lo nombra', async () => {
    authorizedRepoStore.authorizeRepo(repoPath);
    const repoFile = path.join(repoPath, 'gitcron.json');
    fs.writeFileSync(repoFile, JSON.stringify({ agent: { 'gitcron-commit': { temperature: 0.7 } } }));
    const res = await handlers.get('commit-ai:resolved-model')!({ sender }, repoPath);
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ status: 'resolved', sourceFile: globalPath, repoSourceFile: repoFile });
    expect(res.data.configFiles).toEqual([
      { path: globalPath, scope: 'global', exists: true },
      { path: repoFile, scope: 'repo', exists: true },
    ]);
  });

  it('una ruta que no es una pestaña abierta se rechaza', async () => {
    const res = await handlers.get('commit-ai:resolved-model')!({ sender }, repoPath);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unauthorized repository path/);
  });

  it('archivo roto sin versión anterior: error con datos para traducirlo', async () => {
    fs.writeFileSync(globalPath, '{ "agent": { "gitcron-commit": { "model": "a/b" } "x": 1 } }');
    const res = await handlers.get('commit-ai:resolved-model')!({ sender });
    expect(res.data).toMatchObject({
      status: 'error',
      sourceFile: globalPath,
      parseError: { file: globalPath, line: 1, code: 'CommaExpected' },
    });
  });

  it('archivo roto después de leerlo bien: resuelve con la versión anterior y lo marca', async () => {
    await handlers.get('commit-ai:resolved-model')!({ sender });
    fs.writeFileSync(globalPath, GLOBAL.replace('"Unsloth CASA",', '"Unsloth CASA"'));
    const res = await handlers.get('commit-ai:resolved-model')!({ sender });
    expect(res.data.status).toBe('resolved');
    expect(res.data.configFiles[0]).toMatchObject({ usingLastValid: true, error: { code: 'CommaExpected' } });
  });

  it('guardar a mano avisa a la pantalla que preguntó, y cerrar la pestaña deja de observar el repositorio', async () => {
    authorizedRepoStore.authorizeRepo(repoPath);
    await handlers.get('commit-ai:resolved-model')!({ sender }, repoPath);
    expect(getWatchedConfigReposForTesting()).toEqual([repoPath]);

    fs.writeFileSync(path.join(repoPath, 'gitcron.json'), JSON.stringify({ agent: { 'gitcron-commit': { temperature: 0.1 } } }));
    await waitFor(() => sender.send.mock.calls.some(([channel, payload]) => channel === 'gitcron-config:changed' && payload.repoPath === repoPath));

    fs.writeFileSync(globalPath, GLOBAL.replace('Unsloth CASA', 'Unsloth OTRA'));
    await waitFor(() => sender.send.mock.calls.some(([channel, payload]) => channel === 'gitcron-config:changed' && payload.repoPath === null));

    authorizedRepoStore.deauthorizeRepo(repoPath);
    expect(getWatchedConfigReposForTesting()).toEqual([]);
  });
});
