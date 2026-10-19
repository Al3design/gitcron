import { describe, expect, it } from 'vitest';
import { parseGitRemotes, parseFilesFromPullOutput } from '../../electron/ipc/git-sync';

describe('parseGitRemotes', () => {
  it('parses typical git remote -v output correctly', () => {
    const raw = [
      'origin\thttps://github.com/Al3design/gitcron.git (fetch)',
      'origin\thttps://github.com/Al3design/gitcron.git (push)',
      'upstream\tgit@github.com:another/repo.git (fetch)',
      'upstream\tgit@github.com:another/repo.git (push)',
    ].join('\n');

    expect(parseGitRemotes(raw)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/Al3design/gitcron.git',
        pushUrl: 'https://github.com/Al3design/gitcron.git',
      },
      {
        name: 'upstream',
        fetchUrl: 'git@github.com:another/repo.git',
        pushUrl: 'git@github.com:another/repo.git',
      },
    ]);
  });

  it('handles remotes with missing push or fetch URLs', () => {
    const raw = [
      'origin\thttps://github.com/Al3design/gitcron.git (fetch)',
      'only-push\tgit@github.com:another/repo.git (push)',
    ].join('\n');

    expect(parseGitRemotes(raw)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/Al3design/gitcron.git',
        pushUrl: undefined,
      },
      {
        name: 'only-push',
        fetchUrl: undefined,
        pushUrl: 'git@github.com:another/repo.git',
      },
    ]);
  });

  it('handles remote lines without explicit fetch/push suffix', () => {
    const raw = 'origin\thttps://github.com/Al3design/gitcron.git';
    expect(parseGitRemotes(raw)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/Al3design/gitcron.git',
        pushUrl: 'https://github.com/Al3design/gitcron.git',
      },
    ]);
  });
});

describe('parseFilesFromPullOutput', () => {
  it('parses files from git pull diffstat output', () => {
    const raw = [
      'Updating 4059fe1..8828943',
      'Fast-forward',
      ' app/globals.css                                  |   2 +-',
      ' app/page.tsx                                     |   5 +-',
      ' components/PageToasts.tsx                        |  10 +-',
      ' hooks/git-actions/remote.ts                      |   4 +-',
      ' path/to/image.png                                | Bin 1024 -> 2048 bytes',
      ' ... (other files) ...',
      ' 5 files changed, 12 insertions(+), 10 deletions(-)'
    ].join('\n');

    expect(parseFilesFromPullOutput(raw)).toEqual([
      'app/globals.css',
      'app/page.tsx',
      'components/PageToasts.tsx',
      'hooks/git-actions/remote.ts',
      'path/to/image.png'
    ]);
  });

  it('returns empty array when there are no changes', () => {
    expect(parseFilesFromPullOutput('Already up to date.')).toEqual([]);
  });
});
