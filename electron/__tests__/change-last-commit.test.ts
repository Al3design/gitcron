import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { simpleGit, type SimpleGit } from 'simple-git';
import { removeTempDir } from '@/test-utils/temp-dir';
import { defaultChangeCommits, defaultChangeLastCommit } from '../pipeline/repo-evidence-reader';

/** Último commit de un cambio para la tarjeta «Dónde quedaste», con git de verdad. */
describe('último commit de un cambio', () => {
  let repo: string;
  let git: SimpleGit;

  async function commitFile(relative: string, message: string, date: string) {
    const full = path.join(repo, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${message}\n`, 'utf-8');
    await git.add(relative);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))) as Record<string, string>;
    await git.env({ ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }).commit(message);
  }

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-last-commit-'));
    git = simpleGit({ baseDir: repo, allowEnvironment: ['GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'] });
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.name', 'GitCron Test');
    await git.addConfig('user.email', 'gitcron@example.test');
    await commitFile('README.md', 'base', '2026-09-01T10:00:00Z');
    await git.branch(['master']); // una master vieja que quedó atrás
    await commitFile('openspec/changes/mi-cambio/proposal.md', 'docs: propuesta de mi-cambio', '2026-09-20T10:00:00Z');
    await commitFile('CHANGELOG.md', 'docs: otra cosa en main', '2026-10-09T10:00:00Z');
  });

  afterEach(() => removeTempDir(repo));

  it('con una master vieja y la rama del cambio sin commits propios, es el último que tocó el cambio', async () => {
    await git.branch(['change/mi-cambio']);
    const commit = await defaultChangeLastCommit(repo, 'mi-cambio');
    expect(commit?.message).toBe('docs: propuesta de mi-cambio');
  });

  it('con un commit propio en la rama del cambio, es ese', async () => {
    await git.checkoutLocalBranch('change/mi-cambio');
    await commitFile('src/codigo.ts', 'feat: primer paso de mi-cambio', '2026-10-09T12:00:00Z');
    const commit = await defaultChangeLastCommit(repo, 'mi-cambio');
    expect(commit?.message).toBe('feat: primer paso de mi-cambio');
  });

  it('sin commits que lo toquen, no hay', async () => {
    expect(await defaultChangeLastCommit(repo, 'otro-cambio')).toBeNull();
  });

  it('defaultChangeCommits devuelve los commits del cambio y los posteriores a tasks.md', async () => {
    await git.checkoutLocalBranch('change/mi-cambio');
    await commitFile('openspec/changes/mi-cambio/tasks.md', 'feat: marcar tarea 1.1 hecha', '2026-10-09T11:00:00Z');
    await commitFile('src/nuevo.ts', 'feat: avance en tarea 1.2', '2026-10-09T13:00:00Z');

    const result = await defaultChangeCommits(repo, 'mi-cambio');
    expect(result.recentCommits.length).toBeGreaterThanOrEqual(2);
    expect(result.recentCommits[0].message).toBe('feat: avance en tarea 1.2');
    expect(result.recentCommits[1].message).toBe('feat: marcar tarea 1.1 hecha');

    // commitsAfterLastTask sólo incluye el commit posterior a tasks.md
    expect(result.commitsAfterLastTask.length).toBe(1);
    expect(result.commitsAfterLastTask[0].message).toBe('feat: avance en tarea 1.2');
  });
});
