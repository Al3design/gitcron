import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { removeTempDir } from '@/test-utils/temp-dir';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

/**
 * simple-git 4 rechaza toda variable GIT_* que se le pase sin declararla con
 * `allowEnvironment`, y lo hace antes de llamar a git. Las pruebas de push, pull
 * y clone simulan simple-git, así que el 2026-10-09 la actualización a la 4 pasó
 * la suite en verde con push/pull rotos. Estas pruebas usan git de verdad.
 */
describe('variables de entorno de git con simple-git 4', () => {
  let tempDir: string;
  let oldEditor: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-git-env-'));
    const git = simpleGit(tempDir);
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.name', 'GitCron Test');
    await git.addConfig('user.email', 'gitcron@example.test');
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'a', 'utf-8');
    await git.add('a.txt');
    await git.commit('base');
    await git.addRemote('origin', 'https://github.com/gitcron-test/repo.git');
    oldEditor = process.env.GIT_EDITOR;
  });

  afterEach(() => {
    if (oldEditor !== undefined) process.env.GIT_EDITOR = oldEditor;
    else delete process.env.GIT_EDITOR;
    removeTempDir(tempDir);
  });

  it('con token de GitHub, el git sin preguntas de push/pull/fetch arranca', async () => {
    const { withGitHubToken } = await import('../ipc/shared');
    const result = await withGitHubToken(tempDir, 'token-de-prueba', (g) => g.raw(['rev-parse', '--is-inside-work-tree']));
    expect(result.trim()).toBe('true');
  });

  it('un GIT_EDITOR heredado de la terminal no bloquea un comando con entorno propio', async () => {
    process.env.GIT_EDITOR = 'code --wait';
    const { processEnvWithoutGuardedGitVars } = await import('../ipc/shared');
    const env = processEnvWithoutGuardedGitVars();
    expect(env.GIT_EDITOR).toBeUndefined();
    const g = simpleGit({ baseDir: tempDir, allowEnvironment: ['GIT_TERMINAL_PROMPT'] })
      .env({ ...env, GIT_TERMINAL_PROMPT: '0' });
    expect((await g.raw(['rev-parse', '--is-inside-work-tree'])).trim()).toBe('true');
  });
});
