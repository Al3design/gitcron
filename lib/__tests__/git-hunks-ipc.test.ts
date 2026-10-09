import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import { simpleGit } from 'simple-git';
import { buildHunkPatch, type FileDiff } from '../hunk-patch';

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

describe('git hunk IPC handlers', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockIpc.handlers.clear();
    mockIpc.handle.mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-hunk-ipc-'));
    const { registerGitOpsHandlers } = await import('../../electron/ipc/git-ops');
    registerGitOpsHandlers();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('round-trips stage, unstage, and discard for a single hunk', async () => {
    const repoPath = await createRepoWithSeparatedChanges(tempDir);
    const diffHunks = handler('git:diff-hunks');
    const applyHunk = handler('git:apply-hunk');

    const diffResult = await diffHunks(null, repoPath, 'sample.txt', false) as {
      success: boolean;
      data: FileDiff;
      error?: string;
    };
    expect(diffResult.success).toBe(true);
    expect(diffResult.data.hunks).toHaveLength(2);

    const firstHunkPatch = buildHunkPatch(diffResult.data, 0);
    await expect(applyHunk(null, repoPath, 'sample.txt', firstHunkPatch, { cached: true })).resolves.toMatchObject({
      success: true,
    });

    const git = simpleGit(repoPath);
    const stagedDiff = await git.diff(['--cached', '--', 'sample.txt']);
    expect(stagedDiff).toContain('+line 02 staged candidate');
    expect(stagedDiff).not.toContain('+line 10 remains unstaged');
    expect(await git.diff(['--', 'sample.txt'])).toContain('+line 10 remains unstaged');

    await expect(applyHunk(null, repoPath, 'sample.txt', firstHunkPatch, { cached: true, reverse: true })).resolves.toMatchObject({
      success: true,
    });
    expect(await git.diff(['--cached', '--', 'sample.txt'])).toBe('');

    await expect(applyHunk(null, repoPath, 'sample.txt', firstHunkPatch, { reverse: true })).resolves.toMatchObject({
      success: true,
    });

    const content = fs.readFileSync(path.join(repoPath, 'sample.txt'), 'utf-8');
    expect(content).toContain('line 02');
    expect(content).not.toContain('line 02 staged candidate');
    expect(content).toContain('line 10 remains unstaged');
  }, 20_000);

  it('stages only selected lines from a hunk', async () => {
    const repoPath = await createRepoWithInsertedLines(tempDir);
    const diffHunks = handler('git:diff-hunks');
    const applyHunk = handler('git:apply-hunk');

    const diffResult = await diffHunks(null, repoPath, 'insertions.txt', false) as {
      success: boolean;
      data: FileDiff;
      error?: string;
    };
    expect(diffResult.success).toBe(true);
    expect(diffResult.data.hunks).toHaveLength(1);

    const firstAddedLine = diffResult.data.hunks[0].lines.find((line) => line.type === 'add' && line.content === 'beta');
    expect(firstAddedLine).toBeDefined();

    const partialPatch = buildHunkPatch(diffResult.data, 0, { selectedLines: [firstAddedLine!.index] });
    await expect(applyHunk(null, repoPath, 'insertions.txt', partialPatch, { cached: true })).resolves.toMatchObject({
      success: true,
    });

    const git = simpleGit(repoPath);
    const stagedDiff = await git.diff(['--cached', '--', 'insertions.txt']);
    const unstagedDiff = await git.diff(['--', 'insertions.txt']);
    expect(stagedDiff).toContain('+beta');
    expect(stagedDiff).not.toContain('+bonus');
    expect(unstagedDiff).toContain('+bonus');
  });

  it('returns followed file history without modifying the worktree', async () => {
    const repoPath = await createRepoWithRenamedFile(tempDir);
    const fileHistory = handler('git:file-history');
    const git = simpleGit(repoPath);

    const beforeStatus = await git.status();
    const result = await fileHistory(null, repoPath, 'renamed.txt', 10) as {
      success: boolean;
      data: Array<{ filePath: string; message: string; shortHash: string }>;
      error?: string;
    };
    const afterStatus = await git.status();

    expect(result.success).toBe(true);
    expect(result.data.map((entry) => entry.message)).toEqual(['rename file', 'initial file']);
    expect(result.data.every((entry) => entry.filePath === 'renamed.txt')).toBe(true);
    expect(result.data.every((entry) => entry.shortHash.length === 7)).toBe(true);
    expect(afterStatus.isClean()).toBe(beforeStatus.isClean());
    expect(afterStatus.files).toEqual(beforeStatus.files);
  });

  it('blocks file-history path traversal', async () => {
    const repoPath = await createRepoWithRenamedFile(tempDir);
    const fileHistory = handler('git:file-history');

    await expect(fileHistory(null, repoPath, '../outside.txt', 10)).resolves.toMatchObject({
      success: false,
      error: 'Path traversal blocked',
    });
  });

  it('returns blame lines without modifying the worktree', async () => {
    const repoPath = await createRepoWithBlameData(tempDir);
    const blame = handler('git:blame');
    const git = simpleGit(repoPath);

    const beforeStatus = await git.status();
    const result = await blame(null, repoPath, 'blame.txt') as {
      success: boolean;
      data: Array<{ lineNo: number; content: string; summary: string; isUncommitted: boolean }>;
      error?: string;
    };
    const afterStatus = await git.status();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data.map((line) => line.lineNo)).toEqual([1, 2]);
    expect(result.data.map((line) => line.content)).toEqual(['first line', 'second line changed']);
    expect(result.data.map((line) => line.summary)).toEqual(['initial blame file', 'change second line']);
    expect(result.data.every((line) => line.isUncommitted === false)).toBe(true);
    expect(afterStatus.isClean()).toBe(beforeStatus.isClean());
    expect(afterStatus.files).toEqual(beforeStatus.files);
  });

  it('blocks blame path traversal and unsafe revisions', async () => {
    const repoPath = await createRepoWithBlameData(tempDir);
    const blame = handler('git:blame');

    await expect(blame(null, repoPath, '../outside.txt')).resolves.toMatchObject({
      success: false,
      error: 'Path traversal blocked',
    });
    await expect(blame(null, repoPath, 'blame.txt', '--all')).resolves.toMatchObject({
      success: false,
      error: 'Invalid revision',
    });
  });
});

function handler(channel: string): IpcHandler {
  const ipcHandler = mockIpc.handlers.get(channel);
  if (!ipcHandler) throw new Error(`Missing IPC handler: ${channel}`);
  return ipcHandler;
}

async function createRepoWithSeparatedChanges(parentDir: string): Promise<string> {
  const { git, repoPath } = await createTestRepo(parentDir);

  const original = Array.from({ length: 14 }, (_, index) => `line ${String(index + 1).padStart(2, '0')}`);
  fs.writeFileSync(path.join(repoPath, 'sample.txt'), `${original.join('\n')}\n`, 'utf-8');
  await git.add('sample.txt');
  await git.commit('initial');

  const changed = [...original];
  changed[1] = 'line 02 staged candidate';
  changed[9] = 'line 10 remains unstaged';
  fs.writeFileSync(path.join(repoPath, 'sample.txt'), `${changed.join('\n')}\n`, 'utf-8');

  return repoPath;
}

async function createRepoWithInsertedLines(parentDir: string): Promise<string> {
  const { git, repoPath } = await createTestRepo(parentDir);

  fs.writeFileSync(path.join(repoPath, 'insertions.txt'), 'alpha\ngamma\n', 'utf-8');
  await git.add('insertions.txt');
  await git.commit('initial');

  fs.writeFileSync(path.join(repoPath, 'insertions.txt'), 'alpha\nbeta\nbonus\ngamma\n', 'utf-8');

  return repoPath;
}

async function createRepoWithRenamedFile(parentDir: string): Promise<string> {
  const { git, repoPath } = await createTestRepo(parentDir);

  fs.writeFileSync(path.join(repoPath, 'original.txt'), 'alpha\n', 'utf-8');
  await git.add('original.txt');
  await git.commit('initial file');
  fs.renameSync(path.join(repoPath, 'original.txt'), path.join(repoPath, 'renamed.txt'));
  await git.raw(['add', '-A']);
  await git.commit('rename file');

  return repoPath;
}

async function createRepoWithBlameData(parentDir: string): Promise<string> {
  const { git, repoPath } = await createTestRepo(parentDir);

  fs.writeFileSync(path.join(repoPath, 'blame.txt'), 'first line\nsecond line\n', 'utf-8');
  await git.add('blame.txt');
  await git.commit('initial blame file');
  fs.writeFileSync(path.join(repoPath, 'blame.txt'), 'first line\nsecond line changed\n', 'utf-8');
  await git.add('blame.txt');
  await git.commit('change second line');

  return repoPath;
}

async function createTestRepo(parentDir: string): Promise<{ git: ReturnType<typeof simpleGit>; repoPath: string }> {
  const repoPath = path.join(parentDir, 'repo');
  fs.mkdirSync(repoPath);
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.name', 'GitCron Test');
  await git.addConfig('user.email', 'gitcron@example.test');
  return { git, repoPath };
}
