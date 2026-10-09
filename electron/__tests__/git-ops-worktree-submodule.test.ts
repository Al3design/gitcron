import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
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

describe('git worktree and submodule IPC handlers', () => {
  let tempDir: string;
  let handler: (channel: string) => IpcHandler;

  // Los submódulos con ruta local están bloqueados por git desde 2022: un repo
  // malicioso podría usarlos para leer archivos del disco. La prueba los
  // habilita sólo para ella, con una configuración global temporal. simple-git 4
  // descarta las variables GIT_* del entorno, y el programa no debe habilitarlos.
  let oldHome: string | undefined;
  let oldUserProfile: string | undefined;

  beforeEach(async () => {
    mockIpc.handlers.clear();
    mockIpc.handle.mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-ops-ipc-'));
    oldHome = process.env.HOME;
    oldUserProfile = process.env.USERPROFILE;
    const fakeHome = path.join(tempDir, 'home');
    fs.mkdirSync(fakeHome);
    fs.writeFileSync(path.join(fakeHome, '.gitconfig'), '[protocol "file"]\n\tallow = always\n', 'utf-8');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    const { registerGitOpsHandlers } = await import('../../electron/ipc/git-ops');
    registerGitOpsHandlers();
    handler = (channel: string) => {
      const h = mockIpc.handlers.get(channel);
      if (!h) throw new Error(`No handler registered for channel: ${channel}`);
      return h;
    };
  });

  afterEach(() => {
    for (const [key, value] of [['HOME', oldHome], ['USERPROFILE', oldUserProfile]] as const) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
    removeTempDir(tempDir);
  });

  it('manages worktrees correctly', async () => {
    const mainRepoPath = path.join(tempDir, 'main-repo');
    fs.mkdirSync(mainRepoPath);
    const git = simpleGit(mainRepoPath);
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.name', 'GitCron Test');
    await git.addConfig('user.email', 'gitcron@example.test');

    // Make initial commit
    fs.writeFileSync(path.join(mainRepoPath, 'file.txt'), 'hello', 'utf-8');
    await git.add('file.txt');
    await git.commit('initial commit');

    // Create a branch to checkout in the worktree
    await git.branch(['feature-branch']);

    const worktreeAdd = handler('git:worktree-add');
    const worktreeRemove = handler('git:worktree-remove');
    const worktreeList = handler('git:worktrees');

    const worktreePath = path.join(tempDir, 'worktree-dir');

    // 1. Add worktree
    const addResult = await worktreeAdd(null, mainRepoPath, worktreePath, 'feature-branch') as { success: boolean; error?: string };
    if (!addResult.success) console.error('addResult error:', addResult.error);
    expect(addResult.success).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. List worktrees
    const listResult = await worktreeList(null, mainRepoPath) as { success: boolean; data: any[] };
    expect(listResult.success).toBe(true);
    expect(listResult.data).toHaveLength(2); // main-repo and worktree-dir
    const paths = listResult.data.map(w => path.resolve(w.path));
    expect(paths).toContain(path.resolve(mainRepoPath));
    expect(paths).toContain(path.resolve(worktreePath));

    // 3. Try removing with uncommitted changes (without force)
    fs.writeFileSync(path.join(worktreePath, 'new-file.txt'), 'some change', 'utf-8');
    const removeResult1 = await worktreeRemove(null, mainRepoPath, worktreePath, false) as { success: boolean; error?: string };
    expect(removeResult1.success).toBe(false);
    expect(removeResult1.error).toBe('HAS_CHANGES');

    // 4. Remove with force
    const removeResult2 = await worktreeRemove(null, mainRepoPath, worktreePath, true) as { success: boolean; error?: string };
    expect(removeResult2.success).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(false);
  }, 20_000);

  it('manages submodules correctly', async () => {
    const mainRepoPath = path.join(tempDir, 'main-repo-sub');
    const subRepoPath = path.join(tempDir, 'sub-repo');
    fs.mkdirSync(mainRepoPath);
    fs.mkdirSync(subRepoPath);

    // Setup sub-repo
    const gitSub = simpleGit(subRepoPath);
    await gitSub.init(['--initial-branch=main']);
    await gitSub.addConfig('user.name', 'GitCron Test');
    await gitSub.addConfig('user.email', 'gitcron@example.test');
    fs.writeFileSync(path.join(subRepoPath, 'subfile.txt'), 'sub-hello', 'utf-8');
    await gitSub.add('subfile.txt');
    await gitSub.commit('initial sub commit');

    // Setup main-repo
    const gitMain = simpleGit(mainRepoPath);
    await gitMain.init(['--initial-branch=main']);
    await gitMain.addConfig('user.name', 'GitCron Test');
    await gitMain.addConfig('user.email', 'gitcron@example.test');
    execSync('git config protocol.file.allow always', { cwd: mainRepoPath });
    fs.writeFileSync(path.join(mainRepoPath, 'mainfile.txt'), 'main-hello', 'utf-8');
    await gitMain.add('mainfile.txt');
    await gitMain.commit('initial main commit');

    const submoduleAdd = handler('git:submodule-add');
    const submoduleUpdate = handler('git:submodule-update');
    const submoduleSync = handler('git:submodule-sync');
    const submoduleList = handler('git:submodules');

    // 1. Add submodule (using local path to subRepoPath)
    // Convert path to use forward slashes for Git on Windows compatibility
    const normalizedSubPath = subRepoPath.replace(/\\/g, '/');
    const addSubResult = await submoduleAdd(null, mainRepoPath, normalizedSubPath, 'libs/sub') as { success: boolean; error?: string };
    if (!addSubResult.success) console.error('addSubResult error:', addSubResult.error);
    expect(addSubResult.success).toBe(true);
    expect(fs.existsSync(path.join(mainRepoPath, 'libs/sub', 'subfile.txt'))).toBe(true);

    // 2. List submodules
    const listSubResult = await submoduleList(null, mainRepoPath) as { success: boolean; data: any[] };
    expect(listSubResult.success).toBe(true);
    expect(listSubResult.data).toHaveLength(1);
    expect(listSubResult.data[0].path).toBe('libs/sub');

    // 3. Sync submodule
    const syncSubResult = await submoduleSync(null, mainRepoPath) as { success: boolean };
    expect(syncSubResult.success).toBe(true);

    // 4. Update submodule
    const updateSubResult = await submoduleUpdate(null, mainRepoPath, 'libs/sub', true) as { success: boolean };
    expect(updateSubResult.success).toBe(true);
  }, 20_000);

  it('force-stages only the requested file inside an ignored directory', async () => {
    const repoPath = path.join(tempDir, 'ignored-stage-repo');
    fs.mkdirSync(repoPath);
    const git = simpleGit(repoPath);
    await git.init(['--initial-branch=main']);

    fs.writeFileSync(path.join(repoPath, '.gitignore'), '.astro/\n', 'utf-8');
    fs.mkdirSync(path.join(repoPath, '.astro'));
    fs.writeFileSync(path.join(repoPath, '.astro', 'types.d.ts'), 'export {};\n', 'utf-8');
    fs.writeFileSync(path.join(repoPath, '.astro', 'unrelated.txt'), 'leave me ignored\n', 'utf-8');

    const stageBatch = handler('git:stage-batch');
    const regularResult = await stageBatch(null, repoPath, ['.astro/types.d.ts']) as { success: boolean };
    expect(regularResult.success).toBe(false);

    const forcedResult = await stageBatch(null, repoPath, ['.astro/types.d.ts'], true) as { success: boolean };
    expect(forcedResult.success).toBe(true);

    const stagedPaths = (await git.raw(['diff', '--cached', '--name-only']))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    expect(stagedPaths).toContain('.astro/types.d.ts');
    expect(stagedPaths).not.toContain('.astro/unrelated.txt');
  });
});
