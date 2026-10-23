import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import { simpleGit } from 'simple-git';

type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockIpc = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  handle: vi.fn((channel: string, handler: IpcHandler) => {
    mockIpc.handlers.set(channel, handler);
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpc.handle,
  },
}));

describe('git remote IPC handlers', { timeout: 15_000 }, () => {
  let tempDir: string;
  let handler: (channel: string) => IpcHandler;

  beforeEach(async () => {
    mockIpc.handlers.clear();
    mockIpc.handle.mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-remote-ipc-'));
    const { registerGitSyncHandlers } = await import('../../electron/ipc/git-sync');
    registerGitSyncHandlers();
    handler = (channel: string) => {
      const h = mockIpc.handlers.get(channel);
      if (!h) throw new Error(`No handler registered for channel: ${channel}`);
      return h;
    };
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('manages remotes correctly', async () => {
    // 1. Initialize a new repo in tempDir
    const git = simpleGit(tempDir);
    await git.init(['--initial-branch=main']);
    // Git requires at least one commit to perform some actions, but remote management works on empty repos.

    const listRemotes = handler('git:remotes-list');
    const addRemote = handler('git:remote-add');
    const renameRemote = handler('git:remote-rename');
    const setRemoteUrl = handler('git:remote-set-url');
    const removeRemote = handler('git:remote-remove');

    // Start: no remotes
    const r0 = await listRemotes(null, tempDir) as { success: boolean; data: any[] };
    expect(r0.success).toBe(true);
    expect(r0.data).toEqual([]);

    // Add a remote
    const r1 = await addRemote(null, tempDir, 'origin', 'https://github.com/Al3design/gitcron.git') as { success: boolean };
    expect(r1.success).toBe(true);

    // List remotes
    const r2 = await listRemotes(null, tempDir) as { success: boolean; data: any[] };
    expect(r2.success).toBe(true);
    expect(r2.data).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/Al3design/gitcron.git',
        pushUrl: 'https://github.com/Al3design/gitcron.git',
      }
    ]);

    // Rename remote
    const r3 = await renameRemote(null, tempDir, 'origin', 'upstream') as { success: boolean };
    expect(r3.success).toBe(true);

    const r4 = await listRemotes(null, tempDir) as { success: boolean; data: any[] };
    expect(r4.data).toEqual([
      {
        name: 'upstream',
        fetchUrl: 'https://github.com/Al3design/gitcron.git',
        pushUrl: 'https://github.com/Al3design/gitcron.git',
      }
    ]);

    // Set Remote URL
    const r5 = await setRemoteUrl(null, tempDir, 'upstream', 'git@github.com:another/repo.git') as { success: boolean };
    expect(r5.success).toBe(true);

    const r6 = await listRemotes(null, tempDir) as { success: boolean; data: any[] };
    expect(r6.data).toEqual([
      {
        name: 'upstream',
        fetchUrl: 'git@github.com:another/repo.git',
        pushUrl: 'git@github.com:another/repo.git',
      }
    ]);

    // Remove remote
    const r7 = await removeRemote(null, tempDir, 'upstream') as { success: boolean };
    expect(r7.success).toBe(true);

    const r8 = await listRemotes(null, tempDir) as { success: boolean; data: any[] };
    expect(r8.data).toEqual([]);
  });

  /**
   * La guardia que impide borrar la rama por defecto del remoto.
   *
   * Existe porque el borrado remoto resuelve el upstream configurado, y una rama
   * local puede tener `origin/main` como upstream sin que su nombre lo delate:
   * Ale tenía dos así, `claude/exciting-wilbur-4fa8e1` y `claude/jolly-khayyam-2be14c`,
   * ambas apuntando a `origin/main`. Borrarlas le pedía a GitHub que borrara
   * `main`, y lo único que lo evitaba era la protección del servidor.
   *
   * Se prueba contra Git de verdad —repositorio bare como remoto, clon, y
   * `remote set-head` para que `refs/remotes/origin/HEAD` exista— porque lo que
   * hay que verificar es que la resolución del default funcione con la salida
   * real de `symbolic-ref`, no con la que suponemos.
   */
  it('nunca borra la rama por defecto del remoto, aunque se la pidan', async () => {
    const bare = path.join(tempDir, 'origin.git');
    const work = path.join(tempDir, 'work');
    fs.mkdirSync(bare, { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    await simpleGit(bare).init(['--bare', '--initial-branch=main']);

    const g = simpleGit(work);
    await g.init(['--initial-branch=main']);
    await g.addConfig('user.email', 'test@gitcron.local');
    await g.addConfig('user.name', 'GitCron Test');
    fs.writeFileSync(path.join(work, 'a.txt'), 'contenido');
    await g.add('.');
    await g.commit('primer commit');
    await g.addRemote('origin', bare);
    await g.push(['-u', 'origin', 'main']);
    await g.checkoutLocalBranch('descartable');
    await g.push(['-u', 'origin', 'descartable']);
    // Deja `refs/remotes/origin/HEAD` resuelto, que es de donde sale el default.
    await g.raw(['remote', 'set-head', 'origin', 'main']);

    const deleteRemote = handler('git:delete-remote-branch');

    // La rama por defecto: se rechaza SIN ejecutar el borrado.
    const bloqueada = await deleteRemote(null, work, 'origin', 'main') as {
      success: boolean; error?: string; data?: { defaultBranch?: string };
    };
    expect(bloqueada.success).toBe(false);
    expect(bloqueada.error).toBe('DEFAULT_BRANCH');
    expect(bloqueada.data?.defaultBranch).toBe('main');

    // Y `main` sigue existiendo en el remoto: la guardia corta antes del push,
    // no después. Sin esta comprobación el test pasaría igual con un borrado
    // que ocurre y después informa el error.
    const tras = await simpleGit(bare).raw(['branch', '--list', 'main']);
    expect(tras.trim()).toContain('main');

    // Una rama común no cae en la guardia.
    const permitida = await deleteRemote(null, work, 'origin', 'descartable') as {
      success: boolean; error?: string;
    };
    expect(permitida.error).not.toBe('DEFAULT_BRANCH');
  });
});
