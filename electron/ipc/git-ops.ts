// electron/ipc/git-ops.ts
// Operaciones git locales: log/status/branches, checkout, merge/rebase,
// tags, stash, staging, diffs, clean y archivos del working tree.
// Ninguna de estas operaciones toca la red (eso vive en git-sync.ts).

import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { simpleGit } from 'simple-git';
import type {
  StatusFile, CommitData, BranchData, StashEntry, SubmoduleEntry,
  BranchTrackingInfo, WorktreeEntry, FileHistoryEntry,
} from '../../types/electron';
import { parseGitBlamePorcelain } from '../../lib/blame-parse';
import { parseRemoteDefaultBranch } from '../../lib/branch-upstream';
import { parseBranchTracking } from './branch-tracking';
import { isBranchMerged } from './branch-merge';
import { parseUnifiedDiff, type ApplyHunkOptions } from '../../lib/hunk-patch';
import { withRepoLock } from '../git/repo-queue';
import { errMsg, processEnvWithoutGuardedGitVars, resolveRepoRelativePath, sanitizeForLog } from './shared';

// Resuelve la branch por defecto del repo para consultas de "merged": primero
// el symbolic-ref de origin/HEAD, luego main/master locales, y como último
// recurso la branch actual. Solo lee refs locales (sin red).
async function resolveDefaultBranch(g: ReturnType<typeof simpleGit>): Promise<string> {
  try {
    const ref = (await g.raw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (ref) return ref.replace(/^origin\//, '');
  } catch {
    /* no origin/HEAD configured */
  }
  try {
    const local = await g.branchLocal();
    if (local.all.includes('main')) return 'main';
    if (local.all.includes('master')) return 'master';
    return local.current || 'main';
  } catch {
    return 'main';
  }
}

function isSafeMaterializedRestoreRef(value: string, expectedPrefix: 'imagined/' | 'flight/'): boolean {
  return (
    typeof value === 'string'
    && value.startsWith(expectedPrefix)
    && !value.startsWith('-')
    && !/[\0\r\n\s]/.test(value)
    && !value.includes('..')
    && !value.includes('@{')
  );
}

function parseGitCleanDryRun(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Would remove '))
    .map((line) => line.slice('Would remove '.length).trim())
    .filter(Boolean);
}

function isSafeReadOnlyRevision(value: string): boolean {
  return (
    typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && !value.startsWith('-')
    && !/[\0\r\n]/.test(value)
  );
}

function buildSyntheticUntrackedDiff(repoRoot: string, filePath: string): string {
  const fullPath = path.join(repoRoot, filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  return [
    `diff --git a/${filePath} b/${filePath}`,
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n');
}

function assertPatchMatchesFile(hunkPatch: string, filePath: string): void {
  const parsed = parseUnifiedDiff(hunkPatch);
  const touchedPaths = new Set([parsed.filePath, parsed.oldPath, parsed.newPath].filter(Boolean));
  if (!touchedPaths.has(filePath)) {
    throw new Error('Patch file does not match requested path');
  }
  if (parsed.hunks.length !== 1) {
    throw new Error('Patch must contain exactly one hunk');
  }
}

async function applyPatchFile(repoRoot: string, hunkPatch: string, options: ApplyHunkOptions): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-hunk-'));
  const patchPath = path.join(tempDir, 'hunk.patch');
  try {
    fs.writeFileSync(patchPath, hunkPatch, 'utf-8');
    const args = ['apply'];
    if (options.cached) args.push('--cached');
    if (options.reverse) args.push('-R');
    args.push(patchPath);
    await simpleGit(repoRoot).raw(args);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Resuelve el directorio git de un repositorio SIN spawnear un proceso de git
 * (`revparse` es caro y acá buscamos lo contrario). Para el caso común
 * (`<repo>/.git` es un directorio) se devuelve directo; para un `.git` archivo
 * (worktree) se lee su línea `gitdir:`. Devuelve `null` si no hay `.git`.
 */
function resolveGitDir(targetPath: string): string | null {
  const dotGit = path.join(targetPath, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (st.isDirectory()) return dotGit;
  try {
    const match = fs.readFileSync(dotGit, 'utf8').trim().match(/^gitdir:\s*(.+)$/);
    if (!match) return null;
    const dir = match[1].trim();
    return path.isAbsolute(dir) ? dir : path.join(targetPath, dir);
  } catch {
    return null;
  }
}

export function registerGitOpsHandlers(): void {
  ipcMain.handle('git:command', async (_event, targetPath: string, args: string[]) => withRepoLock(targetPath, async () => {
    try {
      console.log('Executing git command:', targetPath, sanitizeForLog(args));
      const scopedGit = simpleGit(targetPath);
      let result;
      const command = args[0];

      switch (command) {
        case 'status': result = await scopedGit.status(); break;
        case 'commit': {
          // The renderer sends ['commit', '-m', message]. simple-git's
          // git.commit() treats an array as multiple message lines, so passing
          // args.slice(1) made the message become "-m\n<actual text>". Extract
          // the real message and pass it as a plain string.
          const mIdx = args.indexOf('-m');
          const message = mIdx >= 0 && args[mIdx + 1] !== undefined
            ? args[mIdx + 1]
            : args.slice(1).filter((a) => a !== '-m').join('\n');
          if (!message || !message.trim()) {
            throw new Error('Mensaje de commit vacío');
          }
          result = await scopedGit.commit(message);
          break;
        }
        case 'merge': result = await scopedGit.merge(args.slice(1)); break;
        case 'revert':
          result = await scopedGit.revert(args[1], args.slice(2).reduce((acc, curr) => ({ ...acc, [curr]: true }), {}));
          break;
        case 'stash': result = await scopedGit.stash(args.slice(1)); break;
        case 'restore': result = await scopedGit.raw(['restore', args[1]]); break;
        default: result = await scopedGit.raw(args);
      }
      return { success: true, data: typeof result === 'string' ? result : JSON.stringify(result) };
    } catch (error: any) {
      console.error('Git Command Error:', sanitizeForLog(error));
      return { success: false, error: errMsg(error) };
    }
  }));

  ipcMain.handle('git:log', async (_event, targetPath: string, opts?: { allBranches?: boolean }) => {
    try {
      const g = simpleGit(targetPath);
      // Use --decorate to get branch/tag refs at each commit
      const allBranches = opts?.allBranches !== false;
      const args = ['log'];
      if (allBranches) args.push('--all');
      args.push('--max-count=500', '--date-order', '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D');
      const raw = await g.raw(args);

      const commits: CommitData[] = raw
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const [hash, parentsRaw, an, ae, date, msg, decoration] = line.split('\x1f');
          const parents = (parentsRaw || '').split(' ').filter(Boolean);
          const refs = (decoration || '')
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
            .map((r) => r.replace(/^HEAD -> /, ''));
          return {
            hash,
            shortHash: hash.slice(0, 7),
            message: msg ?? '',
            authorName: an ?? '',
            authorEmail: ae ?? '',
            date: date ?? '',
            parents,
            refs,
          };
        });

      return { success: true, data: commits };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:status', async (_event, targetPath: string) => {
    try {
      const g = simpleGit(targetPath);
      const status = await g.status();

      const raw: StatusFile[] = [
        ...status.conflicted.map((p) => ({ path: p, status: 'modified' as const, staged: false, conflicted: true })),
        ...status.modified.map((p) => ({ path: p, status: 'modified' as const, staged: false, conflicted: status.conflicted.includes(p) })),
        ...status.created.map((p) => ({ path: p, status: 'added' as const, staged: false, conflicted: status.conflicted.includes(p) })),
        ...status.deleted.map((p) => ({ path: p, status: 'deleted' as const, staged: false, conflicted: status.conflicted.includes(p) })),
        ...status.not_added.map((p) => ({ path: p, status: 'untracked' as const, staged: false, conflicted: status.conflicted.includes(p) })),
        ...status.staged.map((p) => ({ path: p, status: 'modified' as const, staged: true, conflicted: status.conflicted.includes(p) })),
        ...status.renamed.map((r) => ({
          path: r.to, oldPath: r.from, status: 'renamed' as const, staged: true, conflicted: status.conflicted.includes(r.to) || status.conflicted.includes(r.from),
        })),
      ];

      const seen = new Map<string, StatusFile>();
      for (const f of raw) {
        const existing = seen.get(f.path);
        if (!existing || f.staged || f.conflicted) {
          seen.set(f.path, {
            ...f,
            conflicted: f.conflicted || existing?.conflicted,
          });
        } else if (existing) {
          existing.conflicted = existing.conflicted || f.conflicted;
        }
      }

      let mergeInProgress = false;
      let rebaseInProgress = false;
      try {
        const gitDir = (await g.revparse(['--git-dir'])).trim();
        const mergeHeadPath = path.isAbsolute(gitDir) ? path.join(gitDir, 'MERGE_HEAD') : path.join(targetPath, gitDir, 'MERGE_HEAD');
        mergeInProgress = fs.existsSync(mergeHeadPath);

        const rebaseMergeDir = path.isAbsolute(gitDir) ? path.join(gitDir, 'rebase-merge') : path.join(targetPath, gitDir, 'rebase-merge');
        const rebaseApplyDir = path.isAbsolute(gitDir) ? path.join(gitDir, 'rebase-apply') : path.join(targetPath, gitDir, 'rebase-apply');
        rebaseInProgress = fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir);
      } catch (e) {
        console.error('Error checking merge/rebase progress:', e);
      }

      return { success: true, data: Array.from(seen.values()), mergeInProgress, rebaseInProgress };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Firma barata del `.git/index` (mtime, tamaño, inodo) para la guardia del
  // latido de respaldo: si no cambió desde la última lectura, se saltea el
  // `git status` completo. Cuesta ~16 µs (medido), frente a 42–74 ms del status.
  // No cubre ediciones del árbol sin preparar (no tocan el index): ésas las
  // informa chokidar, y la cadencia adaptativa acota la staleness residual.
  ipcMain.handle('git:index-signature', (_event, targetPath: string) => {
    try {
      const gitDir = resolveGitDir(targetPath);
      if (!gitDir) return { success: true, data: null };
      const st = fs.statSync(path.join(gitDir, 'index'));
      return { success: true, data: { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino } };
    } catch {
      // Sin .git o sin index (repo recién creado, aún sin commits): la guardia
      // no puede comparar, así que devuelve null y el latido lee.
      return { success: true, data: null };
    }
  });

  ipcMain.handle('git:branches', async (_event, targetPath: string) => {
    try {
      const g = simpleGit(targetPath);
      const local = await g.branchLocal();
      const remotes = await g.branch(['-r']);

      // Use `git for-each-ref` to get ahead/behind for ALL local branches in one shot.
      // Format: <name>|<upstream>|<track>   where track looks like "[ahead 1, behind 3]" or "[gone]" or ""
      // El parseo del estado local/remoto vive en parseBranchTracking (puro + testeable).
      let tracking: Record<string, BranchTrackingInfo> = {};
      try {
        const raw = await g.raw([
          'for-each-ref',
          '--format=%(refname:short)|%(upstream:short)|%(upstream:track)',
          'refs/heads',
        ]);
        tracking = parseBranchTracking(raw);
      } catch {
        /* ignore - tracking is best-effort */
      }

      const branchData: BranchData = {
        local: local.all,
        remote: remotes.all,
        current: local.current,
        tracking,
      };
      return { success: true, data: branchData };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Rama por defecto del remoto, sin red: `git symbolic-ref --short
  // refs/remotes/<remote>/HEAD` (p. ej. `origin/main`). Se devuelve el nombre
  // corto (`main`) para comparar contra el objetivo del borrado remoto, o null
  // si el HEAD del remoto no está resuelto localmente (clone/fetch sin set-head).
  ipcMain.handle('git:default-branch', async (_event, targetPath: string, remote: string) => {
    try {
      const raw = await simpleGit(targetPath).raw([
        'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`,
      ]);
      return { success: true, data: parseRemoteDefaultBranch(raw, remote) };
    } catch {
      return { success: true, data: null };
    }
  });

  // ── git worktree list ──
  ipcMain.handle('git:worktrees', async (_event, targetPath: string) => {
    try {
      const raw = await simpleGit(targetPath).raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeEntry[] = [];
      let current: Partial<WorktreeEntry> | null = null;
      for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current && current.path) worktrees.push(current as WorktreeEntry);
          current = { path: line.slice('worktree '.length).trim() };
        } else if (current && line.startsWith('HEAD ')) {
          current.head = line.slice('HEAD '.length).trim();
        } else if (current && line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length).trim().replace('refs/heads/', '');
        } else if (current && line.trim() === 'bare') {
          current.bare = true;
        } else if (current && line.trim() === 'detached') {
          current.detached = true;
        }
      }
      if (current && current.path) worktrees.push(current as WorktreeEntry);
      return { success: true, data: worktrees };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:worktree-add', async (_event, repoPath: string, path: string, branch: string) => {
    try {
      await simpleGit(repoPath).raw(['worktree', 'add', path, branch]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  /**
   * Cuántas entradas quedaron en el directorio, para poder decirlo antes de
   * borrarlo. Se cuenta con un techo: la cifra es para que la persona dimensione
   * lo que va a perder, y recorrer 40.000 archivos para distinguir «muchos» de
   * «muchísimos» no aporta nada y bloquea el proceso principal.
   */
  const COUNT_LIMIT = 5_000;
  function countPathEntries(target: string): number {
    let total = 0;
    const pending = [target];
    while (pending.length > 0 && total < COUNT_LIMIT) {
      const dir = pending.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // Sin permiso o ya borrado: no puede tumbar el conteo.
      }
      for (const entry of entries) {
        total += 1;
        if (total >= COUNT_LIMIT) break;
        if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
      }
    }
    return total;
  }

  /**
   * Borra el directorio de un worktree y poda el registro.
   *
   * Es la salida del caso `DIR_NOT_EMPTY`: `git worktree remove --force` no
   * borra lo que Git no gestiona, así que un worktree con dependencias
   * instaladas nunca se puede quitar por la vía de Git.
   *
   * Es **destructivo y sin vuelta**: borra el directorio completo. Por eso vive
   * en su propio canal y no como una bandera del anterior — quien lo llama tuvo
   * que pedirlo explícitamente, con su propia confirmación.
   */
  ipcMain.handle('git:worktree-purge', async (_event, repoPath: string, worktreePath: string) => {
    try {
      // Que el camino esté dentro del repositorio: este canal borra un árbol
      // entero, y no puede aceptar una ruta arbitraria de quien lo llame.
      const registered = await simpleGit(repoPath).raw(['worktree', 'list', '--porcelain']);
      const normalized = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '');
      const known = registered
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim().replace(/\\/g, '/').replace(/\/+$/, ''));
      if (!known.includes(normalized)) {
        return { success: false, error: 'NOT_A_WORKTREE' };
      }

      fs.rmSync(worktreePath, { recursive: true, force: true });
      await simpleGit(repoPath).raw(['worktree', 'prune']);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:worktree-remove', async (_event, repoPath: string, worktreePath: string, force?: boolean) => {
    try {
      if (fs.existsSync(worktreePath)) {
        try {
          const status = await simpleGit(worktreePath).status();
          const hasChanges = status.files.length > 0;
          if (hasChanges && !force) {
            return { success: false, error: 'HAS_CHANGES' };
          }
        } catch (statusError) {
          console.warn('Failed to check status in worktree path:', worktreePath, statusError);
        }
      }

      const args = ['worktree', 'remove'];
      if (force) {
        args.push('--force');
      }
      args.push(worktreePath);
      try {
        await simpleGit(repoPath).raw(args);
      } catch (removeError) {
        // «Directory not empty» después de un `--force` significa una cosa
        // concreta: quedaron archivos que Git no gestiona. En un proyecto
        // JavaScript eso es `node_modules`, y no es el caso raro sino el normal
        // —cualquier worktree donde alguien haya corrido `pnpm install`—. Ale lo
        // encontró con uno de 40.707 archivos.
        //
        // Se distingue del resto de los fallos porque tiene una salida propia:
        // borrar el directorio entero y podar el registro. Devolverlo como un
        // error crudo más dejaba a la persona con el mensaje de Git y sin nada
        // que hacer.
        const detail = removeError instanceof Error ? removeError.message : String(removeError);
        if (/not empty/i.test(detail)) {
          const leftover = countPathEntries(worktreePath);
          return { success: false, error: 'DIR_NOT_EMPTY', data: { worktreePath, leftover } };
        }
        throw removeError;
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:checkout', async (_event, targetPath: string, branch: string) => {
    try {
      const g = simpleGit(targetPath);
      const remotes = await g.branch(['-r']);
      if (remotes.all.includes(branch)) {
        const slashIdx = branch.indexOf('/');
        const localName = slashIdx !== -1 ? branch.substring(slashIdx + 1) : branch;
        const localResult = await g.branchLocal();
        const existsLocally = localResult.all.includes(localName);
        if (existsLocally) {
          await g.checkout(localName);
        } else {
          await g.checkout(['-t', branch]);
        }
        return { success: true, data: { checkedOut: localName } };
      }

      await g.checkout(branch);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:create-branch', async (_event, targetPath: string, name: string, fromHash?: string) => {
    try {
      const g = simpleGit(targetPath);
      if (fromHash) await g.checkoutBranch(name, fromHash);
      else await g.checkoutLocalBranch(name);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle(
    'git:restore-materialized-branch',
    async (_event, targetPath: string, branchName: string, sourceTag: string) => {
      try {
        if (!targetPath) return { success: false, error: 'No repo path' };
        if (!isSafeMaterializedRestoreRef(branchName, 'imagined/')) {
          return { success: false, error: 'Invalid materialized branch name' };
        }
        if (!isSafeMaterializedRestoreRef(sourceTag, 'flight/')) {
          return { success: false, error: 'Invalid materialization source tag' };
        }

        const g = simpleGit(targetPath);
        const branches = await g.branchLocal();
        if (branches.all.includes(branchName)) {
          return { success: false, error: `Branch "${branchName}" already exists` };
        }

        const tags = await g.tags();
        if (!tags.all.includes(sourceTag)) {
          return { success: false, error: `Tag "${sourceTag}" does not exist` };
        }

        // Restore the ref without checkout. This does not touch HEAD or the working tree.
        await g.raw(['branch', branchName, sourceTag]);
        return { success: true, data: { branchName, sourceTag } };
      } catch (error: any) {
        return { success: false, error: errMsg(error) };
      }
    },
  );

  // ── Merge a branch INTO the current branch ──
  ipcMain.handle('git:merge-branch', async (_event, targetPath: string, sourceBranch: string) => {
    try {
      const g = simpleGit(targetPath);
      const result = await g.merge([sourceBranch]);
      // Detect "Already up to date." — git exits 0 but nothing changed
      const alreadyUpToDate = /already up.to.date/i.test(result.result ?? '');
      return { success: true, data: { ...result, alreadyUpToDate } };
    } catch (error: any) {
      // simple-git throws on merge conflict — extract useful info
      const msg = sanitizeForLog(error.message || String(error));
      const isConflict = /conflict|automatic merge failed/i.test(msg);
      return { success: false, error: msg, data: { conflict: isConflict } };
    }
  });

  // ── Rebase the current branch onto another ──
  ipcMain.handle('git:rebase', async (_event, targetPath: string, ontoBranch: string) => {
    try {
      const g = simpleGit(targetPath);
      const result = await g.rebase([ontoBranch]);
      return { success: true, data: result };
    } catch (error: any) {
      const msg = sanitizeForLog(error.message || String(error));
      const isConflict = /conflict|could not apply/i.test(msg);
      return { success: false, error: msg, data: { conflict: isConflict } };
    }
  });

  // ── Fast-forward: bring a branch up to a target (only if no divergence) ──
  // Strategy: checkout the target branch, then `git merge --ff-only <from>`
  // We avoid touching the current branch state if possible.
  ipcMain.handle('git:fast-forward', async (_event, targetPath: string, branch: string, toRef: string) => {
    try {
      const g = simpleGit(targetPath);
      // Use git update-ref directly: this works without switching branches
      // First make sure the merge would be fast-forward
      const mergeBase = (await g.raw(['merge-base', branch, toRef])).trim();
      const branchSha = (await g.raw(['rev-parse', branch])).trim();
      if (mergeBase !== branchSha) {
        return { success: false, error: 'No se puede hacer fast-forward: las branches divergieron' };
      }
      // Safe to fast-forward
      await g.raw(['update-ref', `refs/heads/${branch}`, toRef]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Rename a branch (works for the current branch too) ──
  ipcMain.handle('git:rename-branch', async (_event, targetPath: string, oldName: string, newName: string) => {
    try {
      await simpleGit(targetPath).raw(['branch', '-m', oldName, newName]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Delete a local branch. `force=true` uses -D (even if unmerged) ──
  ipcMain.handle('git:delete-branch', async (_event, targetPath: string, branch: string, force: boolean = false) => {
    try {
      const g = simpleGit(targetPath);
      const flag = force ? '-D' : '-d';

      // If it's an imagined branch, we want to find and delete the companion flight tag pointing to the same commit
      if (branch.startsWith('imagined/')) {
        try {
          const commitSha = (await g.revparse([branch])).trim();
          const tagsResult = await g.tags();
          for (const t of tagsResult.all) {
            if (t.startsWith('flight/')) {
              const tagSha = (await g.revparse([t])).trim();
              if (tagSha === commitSha) {
                await g.raw(['tag', '-d', t]);
              }
            }
          }
        } catch (tagErr) {
          console.error('Error finding/deleting companion tag for branch:', tagErr);
        }
      }

      await g.raw(['branch', flag, branch]);
      return { success: true };
    } catch (error: any) {
      const msg = sanitizeForLog(error.message || String(error));
      // Detect "not fully merged" so renderer can offer force delete
      const notMerged = /not fully merged|not yet merged/i.test(msg);
      return { success: false, error: msg, data: { notMerged } };
    }
  });

  // ── Is a local branch fully merged into the default branch? ──
  // Read-only (no network). Se usa para decidir -d vs -D y el texto del diálogo.
  ipcMain.handle('git:is-branch-merged', async (_event, targetPath: string, branch: string, base?: string) => {
    try {
      const g = simpleGit(targetPath);
      const baseBranch = base || (await resolveDefaultBranch(g));
      const raw = await g.raw(['branch', '--merged', baseBranch]);
      return { success: true, data: { merged: isBranchMerged(branch, raw), base: baseBranch } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Delete a tag. runs git tag -d <tag> ──
  ipcMain.handle('git:delete-tag', async (_event, targetPath: string, tagName: string) => {
    try {
      await simpleGit(targetPath).raw(['tag', '-d', tagName]);
      return { success: true };
    } catch (error: any) {
      const msg = sanitizeForLog(error.message || String(error));
      return { success: false, error: msg };
    }
  });

  // ── Create a tag ──
  ipcMain.handle('git:create-tag', async (_event, targetPath: string, tagName: string, commitHash: string, message?: string) => {
    try {
      const g = simpleGit(targetPath);
      if (message && message.trim() !== '') {
        await g.raw(['tag', '-a', tagName, '-m', message, commitHash]);
      } else {
        await g.raw(['tag', tagName, commitHash]);
      }
      return { success: true };
    } catch (error: any) {
      const msg = sanitizeForLog(error.message || String(error));
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('git:stage', async (_event, targetPath: string, filePath: string) => withRepoLock(targetPath, async () => {
    try {
      await simpleGit(targetPath).add(filePath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  }));

  ipcMain.handle('git:unstage', async (_event, targetPath: string, filePath: string) => {
    try {
      await simpleGit(targetPath).raw(['restore', '--staged', filePath]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Batch stage/unstage: single git command for N files.
  // Critical for "Stage all" — running N parallel `git add` commands
  // causes index.lock collisions because they all try to write to .git/index.
  ipcMain.handle('git:stage-batch', async (_event, targetPath: string, filePaths: string[], force = false) => withRepoLock(targetPath, async () => {
    try {
      if (!filePaths || filePaths.length === 0) return { success: true };
      await simpleGit(targetPath).raw(['add', ...(force ? ['--force'] : []), '--', ...filePaths]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  }));

  ipcMain.handle('git:unstage-batch', async (_event, targetPath: string, filePaths: string[]) => {
    try {
      if (!filePaths || filePaths.length === 0) return { success: true };
      await simpleGit(targetPath).raw(['restore', '--staged', ...filePaths]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Add a path to the repo's .gitignore (creates the file if needed) ──
  ipcMain.handle('git:add-to-gitignore', async (_event, targetPath: string, filePath: string) => {
    try {
      const gitignorePath = path.join(targetPath, '.gitignore');
      let current = '';
      if (fs.existsSync(gitignorePath)) {
        current = fs.readFileSync(gitignorePath, 'utf-8');
      }
      // Check if the path is already there (line-by-line, ignoring blanks/comments)
      const lines = current.split('\n').map((l) => l.trim());
      if (lines.includes(filePath)) {
        return { success: true, data: { alreadyIgnored: true } };
      }
      // Append with proper newline handling
      const needsNewline = current.length > 0 && !current.endsWith('\n');
      const updated = current + (needsNewline ? '\n' : '') + filePath + '\n';
      fs.writeFileSync(gitignorePath, updated);

      // If the file is currently tracked, also untrack it so the .gitignore takes effect
      try {
        const g = simpleGit(targetPath);
        const status = await g.status();
        const isTracked = !status.not_added.includes(filePath);
        if (isTracked) {
          // --cached preserves the working copy, just untracks
          await g.raw(['rm', '--cached', '--ignore-unmatch', filePath]);
        }
      } catch {
        /* if the file wasn't tracked we silently skip */
      }

      return { success: true, data: { alreadyIgnored: false } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Reset ALL changes: discards working tree + staged + untracked ──
  // Equivalent to: git reset --hard HEAD && git clean -fd
  ipcMain.handle('git:reset-all', async (_event, targetPath: string) => {
    try {
      const g = simpleGit(targetPath);
      await g.reset(['--hard', 'HEAD']);
      await g.clean('f', ['-d']);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Clean untracked files/directories safely ──
  ipcMain.handle('git:clean', async (_event, targetPath: string, files?: string[]) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const g = simpleGit(repoRoot);
      const dryRunRaw = await g.raw(['-c', 'core.quotePath=false', 'clean', '-n', '-d']);
      const cleanableFiles = parseGitCleanDryRun(dryRunRaw);

      if (!files) {
        return { success: true, data: { files: cleanableFiles } };
      }

      const cleanable = new Set(cleanableFiles);
      const uniqueFiles = Array.from(new Set(files));
      const rejected = uniqueFiles.filter((filePath) => !cleanable.has(filePath));
      if (rejected.length > 0) {
        return {
          success: false,
          error: `Solo se pueden limpiar archivos untracked detectados por git clean: ${rejected.join(', ')}`,
        };
      }

      const deleted: string[] = [];
      for (const filePath of uniqueFiles) {
        const resolved = resolveRepoRelativePath(repoRoot, filePath);
        if (!resolved) return { success: false, error: 'Path traversal blocked' };

        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(resolved);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          fs.rmSync(resolved, { recursive: true, force: true });
        } else {
          fs.unlinkSync(resolved);
        }
        deleted.push(filePath);
      }

      return { success: true, data: { files: cleanableFiles, deleted } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:read-file', async (_event, targetPath: string, relativeFilePath: string) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const resolved = resolveRepoRelativePath(repoRoot, relativeFilePath);
      if (!resolved) return { success: false, error: 'Path traversal blocked' };

      const stat = fs.lstatSync(resolved);
      if (!stat.isFile()) return { success: false, error: 'Solo se pueden leer archivos comunes' };

      return { success: true, data: fs.readFileSync(resolved, 'utf-8') };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:resolve-conflict-file', async (_event, targetPath: string, relativeFilePath: string, content: string) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const resolved = resolveRepoRelativePath(repoRoot, relativeFilePath);
      if (!resolved) return { success: false, error: 'Path traversal blocked' };
      if (/^<{7}|^={7}|^>{7}/m.test(content)) {
        return { success: false, error: 'La resolución todavía contiene marcadores de conflicto' };
      }

      const stat = fs.lstatSync(resolved);
      if (!stat.isFile()) return { success: false, error: 'Solo se pueden resolver archivos comunes' };

      fs.writeFileSync(resolved, content, 'utf-8');
      await simpleGit(repoRoot).add(relativeFilePath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Reset to specific commit: supports soft, mixed, and hard modes ──
  ipcMain.handle('git:reset-commit', async (_event, targetPath: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard') => {
    try {
      const g = simpleGit(targetPath);
      await g.reset([`--${mode}`, commitHash]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ── Stash a single file (or set of files) ──
  ipcMain.handle('git:stash-file', async (_event, targetPath: string, filePath: string) => {
    try {
      await simpleGit(targetPath).stash(['push', '--include-untracked', '--', filePath]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Remove a stuck .git/index.lock file. Useful when a previous operation
  // crashed or was interrupted, leaving the lock behind.
  ipcMain.handle('git:remove-lock', async (_event, targetPath: string) => {
    try {
      const lockPath = path.join(targetPath, '.git', 'index.lock');
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        return { success: true, data: { removed: true } };
      }
      return { success: true, data: { removed: false } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Amend the last commit. If `newMessage` is provided, replaces the message;
  // otherwise keeps the existing one (`--no-edit`). Staged changes (if any) are
  // folded into the amended commit either way. Refuses to amend a commit that
  // has already been pushed unless the caller has accepted the risk (the UI
  // shows a confirmation modal mentioning that pushed commits should not be
  // amended without force-pushing).
  ipcMain.handle('git:amend', async (_event, targetPath: string, newMessage?: string) => {
    try {
      const g = simpleGit(targetPath);
      // Need at least one commit to amend.
      try {
        await g.revparse(['HEAD']);
      } catch {
        return { success: false, error: 'No hay commits que enmendar' };
      }
      const args = ['commit', '--amend'];
      if (newMessage && newMessage.trim()) {
        args.push('-m', newMessage.trim());
      } else {
        args.push('--no-edit');
      }
      await g.raw(args);
      // Return the new HEAD sha for the caller to display
      const newSha = (await g.revparse(['HEAD'])).trim();
      return { success: true, data: { hash: newSha, shortHash: newSha.slice(0, 7) } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Cherry-pick a single commit onto the current branch. Returns { success,
  // conflict? } so the renderer can react: a conflict leaves the working tree
  // with conflicted files that the user must resolve and then `git
  // cherry-pick --continue` (or abort) from the terminal. We don't auto-commit
  // on conflict because the user might want to inspect the merge first.
  ipcMain.handle('git:cherry-pick', async (_event, targetPath: string, hash: string) => {
    try {
      if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
        return { success: false, error: 'Hash inválido' };
      }
      const g = simpleGit(targetPath);
      await g.raw(['cherry-pick', hash]);
      return { success: true };
    } catch (error: any) {
      const msg = sanitizeForLog(error.message || String(error));
      const isConflict = /conflict|after resolving|could not apply/i.test(msg);
      return { success: false, error: msg, data: { conflict: isConflict } };
    }
  });

  // Squash the last N commits into one using `git reset --soft HEAD~N` + `git commit -m`.
  // Only works on commits that haven't been pushed (or the caller handles the force-push warning).
  ipcMain.handle('git:squash', async (_event, targetPath: string, n: number, message: string) => {
    try {
      if (n < 2 || n > 100) return { success: false, error: 'N debe estar entre 2 y 100' };
      if (!message.trim()) return { success: false, error: 'El mensaje del commit no puede estar vacío' };
      const g = simpleGit(targetPath);
      // Verify there are at least N commits
      const log = await g.log({ maxCount: n + 1 });
      if ((log.total ?? log.all.length) < n) {
        return { success: false, error: `No hay ${n} commits para combinar` };
      }
      // Soft-reset to HEAD~N: stages everything from those N commits
      await g.raw(['reset', '--soft', `HEAD~${n}`]);
      // Commit with the provided message
      await g.commit(message.trim());
      const newSha = (await g.revparse(['HEAD'])).trim();
      return { success: true, data: { hash: newSha, shortHash: newSha.slice(0, 7) } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Rebase helper script content written dynamically to .git/gitcron-rebase-helper.js
  const helperScriptContent = `const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // 'sequence' or 'editor'
const targetFile = process.argv[process.argv.length - 1]; // The file to edit
const planPath = process.env.GITCRON_REBASE_PLAN_PATH;

if (!planPath || !fs.existsSync(planPath)) {
  process.exit(0);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

if (mode === 'sequence') {
  const todoContent = fs.readFileSync(targetFile, 'utf8');
  const lines = todoContent.split('\\n');
  const actionLines = [];
  const otherLines = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      otherLines.push(line);
      return;
    }
    const match = trimmed.match(/^(\\w+)\\s+([0-9a-fA-F]+)\\s+(.*)$/);
    if (match) {
      actionLines.push({
        action: match[1],
        sha: match[2],
        subject: match[3],
        originalLine: line
      });
    } else {
      otherLines.push(line);
    }
  });

  const newTodoLines = [];
  plan.forEach(planItem => {
    const targetSha = planItem.hash.toLowerCase();
    const matched = actionLines.find(al => targetSha.startsWith(al.sha.toLowerCase()) || al.sha.toLowerCase().startsWith(targetSha));
    if (matched) {
      if (planItem.action !== 'drop') {
        newTodoLines.push(\`\${planItem.action} \${matched.sha} \${matched.subject}\`);
      } else {
        newTodoLines.push(\`# drop \${matched.sha} \${matched.subject}\`);
      }
    }
  });

  const result = newTodoLines.join('\\n') + '\\n' + otherLines.join('\\n');
  fs.writeFileSync(targetFile, result, 'utf8');
  process.exit(0);

} else if (mode === 'editor') {
  const gitDir = path.dirname(targetFile);
  const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
  if (fs.existsSync(rebaseMergeDir)) {
    const donePath = path.join(rebaseMergeDir, 'done');
    if (fs.existsSync(donePath)) {
      const doneContent = fs.readFileSync(donePath, 'utf8').trim();
      const doneLines = doneContent.split('\\n').filter(Boolean);
      if (doneLines.length > 0) {
        const lastLine = doneLines[doneLines.length - 1];
        const match = lastLine.match(/^(\\w+)\\s+([0-9a-fA-F]+)/);
        if (match) {
          const currentSha = match[2];
          const planItem = plan.find(item => item.hash.toLowerCase().startsWith(currentSha.toLowerCase()) || currentSha.toLowerCase().startsWith(item.hash.toLowerCase()));
          if (planItem && planItem.newMessage) {
            fs.writeFileSync(targetFile, planItem.newMessage, 'utf8');
            process.exit(0);
          }
        }
      }
    }
  }
  process.exit(0);
}
`;

  function cleanupRebaseFiles(repoPath: string, gitDir: string) {
    try {
      const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repoPath, gitDir);
      const helperPath = path.join(absoluteGitDir, 'gitcron-rebase-helper.js');
      const planPath = path.join(absoluteGitDir, 'gitcron-rebase-plan.json');
      if (fs.existsSync(helperPath)) fs.unlinkSync(helperPath);
      if (fs.existsSync(planPath)) fs.unlinkSync(planPath);
    } catch (e) {
      console.error('Error cleaning up rebase helper files:', e);
    }
  }

  async function isRebaseInProgress(g: any, targetPath: string): Promise<boolean> {
    try {
      const gitDir = (await g.revparse(['--git-dir'])).trim();
      const rebaseMergeDir = path.isAbsolute(gitDir) ? gitDir : path.join(targetPath, gitDir, 'rebase-merge');
      const rebaseApplyDir = path.isAbsolute(gitDir) ? gitDir : path.join(targetPath, gitDir, 'rebase-apply');
      return fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir);
    } catch (e) {
      return false;
    }
  }

  // Prepares the list of commits to rebase and checks their pushed status
  ipcMain.handle('git:rebase-prepare', async (_event, targetPath: string, commitHash: string) => {
    try {
      if (!/^[0-9a-f]{7,40}$/i.test(commitHash)) {
        return { success: false, error: 'Hash inválido' };
      }
      const g = simpleGit(targetPath);
      
      let logLines: string[] = [];
      try {
        // Check if commitHash~1 exists to define range
        await g.revparse([`${commitHash}~1`]);
        const output = await g.raw(['log', '--format=%H|%h|%an|%ad|%s', `${commitHash}~1..HEAD`]);
        logLines = output.trim().split('\n').filter(Boolean);
      } catch (e) {
        // Root commit: fetch all commits up to HEAD
        const output = await g.raw(['log', '--format=%H|%h|%an|%ad|%s', 'HEAD']);
        logLines = output.trim().split('\n').filter(Boolean);
      }

      const commits = logLines.map(line => {
        const [hash, shortHash, author, date, subject] = line.split('|');
        return {
          hash,
          shortHash,
          author,
          date,
          subject,
          isPushed: false
        };
      });

      // Find local-only commits to determine pushed status
      const localOnlyShas = new Set<string>();
      try {
        const upstream = (await g.revparse(['--abbrev-ref', '@{upstream}'])).trim();
        if (upstream && upstream !== '@{upstream}') {
          const localOnlyOutput = await g.raw(['log', '--format=%H', `${upstream}..HEAD`]);
          localOnlyOutput.split('\n').forEach(sha => {
            const trimmed = sha.trim().toLowerCase();
            if (trimmed) localOnlyShas.add(trimmed);
          });
        }
      } catch (e) {
        // No upstream, all commits are local-only
      }

      commits.forEach(c => {
        c.isPushed = !localOnlyShas.has(c.hash.toLowerCase());
      });

      return { success: true, data: commits };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Starts the visual interactive rebase
  ipcMain.handle('git:rebase-start', async (_event, targetPath: string, baseHash: string, plan: any[]) => {
    let gitDir = '.git';
    try {
      const g = simpleGit({
        baseDir: targetPath,
        unsafe: {
          allowUnsafeEditor: true
        },
        // simple-git 4: las variables GIT_* que GitCron pone se declaran.
        allowEnvironment: ['GIT_SEQUENCE_EDITOR', 'GIT_EDITOR'],
      });
      gitDir = (await g.revparse(['--git-dir'])).trim();
      const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(targetPath, gitDir);
      
      const helperPath = path.join(absoluteGitDir, 'gitcron-rebase-helper.js');
      const planPath = path.join(absoluteGitDir, 'gitcron-rebase-plan.json');

      // 1. Create safety backup ref and tag
      const timestamp = Date.now();
      const backupTagName = `gitcron/pre-rebase/${timestamp}`;
      await g.raw(['tag', backupTagName, 'HEAD']);
      await g.raw(['update-ref', 'refs/gitcron/pre-rebase', 'HEAD']);

      // 2. Write helper files
      fs.writeFileSync(helperPath, helperScriptContent, 'utf8');
      fs.writeFileSync(planPath, JSON.stringify(plan), 'utf8');

      // 3. Execute git rebase -i baseHash
      const rebaseEnv = {
        ...processEnvWithoutGuardedGitVars(),
        GIT_SEQUENCE_EDITOR: `node "${helperPath}" sequence`,
        GIT_EDITOR: `node "${helperPath}" editor`,
        GITCRON_REBASE_PLAN_PATH: planPath
      };

      await g.env(rebaseEnv).raw(['rebase', '-i', baseHash]);

      // If rebase finishes immediately with no errors, clean up helper files
      cleanupRebaseFiles(targetPath, gitDir);
      return { success: true };

    } catch (error: any) {
      const g = simpleGit(targetPath);
      const isPaused = await isRebaseInProgress(g, targetPath);
      if (isPaused) {
        // Paused for conflicts. Keep helper files so rebase --continue works!
        const msg = sanitizeForLog(error.message || String(error));
        return { success: false, data: { conflict: true }, error: msg };
      } else {
        // Complete failure, clean up immediately
        cleanupRebaseFiles(targetPath, gitDir);
        return { success: false, error: errMsg(error) };
      }
    }
  });

  // Continues the rebase after conflict resolution
  ipcMain.handle('git:rebase-continue', async (_event, targetPath: string) => {
    let gitDir = '.git';
    try {
      const g = simpleGit({
        baseDir: targetPath,
        unsafe: {
          allowUnsafeEditor: true
        },
        // simple-git 4: las variables GIT_* que GitCron pone se declaran.
        allowEnvironment: ['GIT_SEQUENCE_EDITOR', 'GIT_EDITOR'],
      });
      gitDir = (await g.revparse(['--git-dir'])).trim();
      const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(targetPath, gitDir);
      
      const helperPath = path.join(absoluteGitDir, 'gitcron-rebase-helper.js');
      const planPath = path.join(absoluteGitDir, 'gitcron-rebase-plan.json');

      if (!fs.existsSync(helperPath) || !fs.existsSync(planPath)) {
        return { success: false, error: 'Rebase helper files not found' };
      }

      const rebaseEnv = {
        ...processEnvWithoutGuardedGitVars(),
        GIT_SEQUENCE_EDITOR: `node "${helperPath}" sequence`,
        GIT_EDITOR: `node "${helperPath}" editor`,
        GITCRON_REBASE_PLAN_PATH: planPath
      };

      // Run continue rebase
      await g.env(rebaseEnv).raw(['rebase', '--continue']);

      // Finished rebase successfully, clean up
      cleanupRebaseFiles(targetPath, gitDir);
      return { success: true };

    } catch (error: any) {
      const g = simpleGit(targetPath);
      const isPaused = await isRebaseInProgress(g, targetPath);
      if (isPaused) {
        const msg = sanitizeForLog(error.message || String(error));
        return { success: false, data: { conflict: true }, error: msg };
      } else {
        cleanupRebaseFiles(targetPath, gitDir);
        return { success: false, error: errMsg(error) };
      }
    }
  });

  // Aborts the current rebase
  ipcMain.handle('git:rebase-abort', async (_event, targetPath: string) => {
    let gitDir = '.git';
    try {
      const g = simpleGit(targetPath);
      gitDir = (await g.revparse(['--git-dir'])).trim();
      await g.raw(['rebase', '--abort']);
      cleanupRebaseFiles(targetPath, gitDir);
      return { success: true };
    } catch (error: any) {
      cleanupRebaseFiles(targetPath, gitDir);
      return { success: false, error: errMsg(error) };
    }
  });

  // Resets branch back to pre-rebase state
  ipcMain.handle('git:rebase-undo', async (_event, targetPath: string, targetRef: string) => {
    try {
      if (!/^[a-zA-Z0-9_/.-]+$/.test(targetRef)) {
        return { success: false, error: 'Ref inválido' };
      }
      const g = simpleGit(targetPath);
      await g.raw(['reset', '--hard', targetRef]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });


  // Returns the list of files changed in a specific commit (for the commit detail panel).
  // Uses `git diff-tree` which is fast and doesn't require a worktree checkout.
  ipcMain.handle('git:show-files', async (_event, targetPath: string, hash: string) => {
    try {
      if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
        return { success: false, error: 'Hash inválido' };
      }
      const g = simpleGit(targetPath);
      // diff-tree -r: recursive, shows files not just top-level dirs
      // --name-status: shows M/A/D/R + path (same format as git status)
      // --no-commit-id: don't print the commit hash in the output
      const raw = await g.raw(['diff-tree', '--no-commit-id', '-r', '--name-status', hash]);
      const files = raw.trim().split('\n').filter(Boolean).map((line) => {
        const parts = line.split('\t');
        const statusChar = parts[0]?.[0] ?? 'M'; // first char handles R100 → R
        const filePath = parts[2] ?? parts[1] ?? ''; // renamed: old\tnew; else: path
        const oldPath = parts[2] ? parts[1] : undefined;
        const statusMap: Record<string, string> = {
          M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'modified', U: 'modified',
        };
        return {
          path: filePath,
          status: (statusMap[statusChar] ?? 'modified') as 'modified' | 'added' | 'deleted' | 'renamed',
          staged: true,  // all files in a commit are "staged" conceptually
          oldPath,
        };
      });
      return { success: true, data: files };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Returns the diff for a specific file AT a specific commit hash.
  ipcMain.handle('git:diff-at-commit', async (_event, targetPath: string, filePath: string, hash: string) => {
    try {
      const g = simpleGit(targetPath);
      // Use diff between commit and its parent for the actual diff
      const diffOutput = await g.raw(['diff', `${hash}^`, hash, '--', filePath]).catch(() => '');
      return { success: true, data: diffOutput };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:diff', async (_event, targetPath: string, filePath: string, staged: boolean = false) => {
    try {
      const g = simpleGit(targetPath);
      const status = await g.status();
      const isUntracked = status.not_added.includes(filePath);

      let diff: string;
      if (isUntracked) {
        const fullPath = path.join(targetPath, filePath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          diff =
            `diff --git a/${filePath} b/${filePath}\n` +
            `--- /dev/null\n+++ b/${filePath}\n` +
            `@@ -0,0 +1,${lines.length} @@\n` +
            lines.map((l) => `+${l}`).join('\n');
        } catch {
          diff = '';
        }
      } else if (staged) {
        diff = await g.diff(['--cached', '--', filePath]);
      } else {
        diff = await g.diff(['HEAD', '--', filePath]);
      }

      return { success: true, data: diff };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:file-history', async (_event, targetPath: string, filePath: string, limit: number = 100) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const resolved = resolveRepoRelativePath(repoRoot, filePath);
      if (!resolved) return { success: false, error: 'Path traversal blocked' };

      const safeLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
      const raw = await simpleGit(repoRoot).raw([
        '-c',
        'core.quotePath=false',
        'log',
        '--follow',
        `--max-count=${safeLimit}`,
        '--date-order',
        '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D',
        '--',
        filePath,
      ]);

      const entries: FileHistoryEntry[] = raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [hash, parentsRaw, an, ae, date, msg, decoration] = line.split('\x1f');
          const parents = (parentsRaw || '').split(' ').filter(Boolean);
          const refs = (decoration || '')
            .split(',')
            .map((ref) => ref.trim())
            .filter(Boolean)
            .map((ref) => ref.replace(/^HEAD -> /, ''));

          return {
            hash,
            shortHash: hash.slice(0, 7),
            message: msg ?? '',
            authorName: an ?? '',
            authorEmail: ae ?? '',
            date: date ?? '',
            parents,
            refs,
            filePath,
          };
        });

      return { success: true, data: entries };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:blame', async (_event, targetPath: string, filePath: string, rev?: string) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const resolved = resolveRepoRelativePath(repoRoot, filePath);
      if (!resolved) return { success: false, error: 'Path traversal blocked' };
      if (rev !== undefined && !isSafeReadOnlyRevision(rev)) {
        return { success: false, error: 'Invalid revision' };
      }

      const args = ['-c', 'core.quotePath=false', 'blame', '--line-porcelain'];
      if (rev) args.push(rev);
      args.push('--', filePath);

      const raw = await simpleGit(repoRoot).raw(args);
      return { success: true, data: parseGitBlamePorcelain(raw) };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:diff-hunks', async (_event, targetPath: string, filePath: string, staged: boolean = false) => {
    try {
      const repoRoot = path.resolve(targetPath);
      const resolved = resolveRepoRelativePath(repoRoot, filePath);
      if (!resolved) return { success: false, error: 'Path traversal blocked' };

      const g = simpleGit(repoRoot);
      const status = await g.status();
      const isUntracked = status.not_added.includes(filePath);

      let diff: string;
      if (isUntracked) {
        const stat = fs.lstatSync(resolved);
        if (!stat.isFile()) return { success: false, error: 'Solo se pueden mostrar hunks de archivos comunes' };
        diff = buildSyntheticUntrackedDiff(repoRoot, filePath);
      } else if (staged) {
        diff = await g.diff(['--cached', '--', filePath]);
      } else {
        diff = await g.diff(['HEAD', '--', filePath]);
      }

      return { success: true, data: parseUnifiedDiff(diff) };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle(
    'git:apply-hunk',
    async (_event, targetPath: string, filePath: string, hunkPatch: string, options: ApplyHunkOptions = {}) => {
      try {
        const repoRoot = path.resolve(targetPath);
        const resolved = resolveRepoRelativePath(repoRoot, filePath);
        if (!resolved) return { success: false, error: 'Path traversal blocked' };
        if (!hunkPatch.trim()) return { success: false, error: 'Patch vacío' };

        assertPatchMatchesFile(hunkPatch, filePath);
        await applyPatchFile(repoRoot, hunkPatch, {
          reverse: options.reverse === true,
          cached: options.cached === true,
        });
        return { success: true };
      } catch (error: any) {
        return { success: false, error: errMsg(error) };
      }
    },
  );

  ipcMain.handle('git:stash-list', async (_event, targetPath: string) => {
    try {
      const g = simpleGit(targetPath);
      const list = await g.stashList();
      const stashes: StashEntry[] = list.all.map((entry, idx) => ({
        index: idx,
        message: entry.message,
        hash: entry.hash,
        date: entry.date,
      }));
      return { success: true, data: stashes };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:stash-push', async (_event, targetPath: string, message?: string) => {
    try {
      const args = ['push'];
      const trimmed = message?.trim();
      if (trimmed) args.push('-m', trimmed);
      await simpleGit(targetPath).stash(args);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:tags', async (_event, targetPath: string) => {
    try {
      const tags = await simpleGit(targetPath).tags();
      return { success: true, data: tags.all };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:submodules', async (_event, targetPath: string) => {
    try {
      const raw = await simpleGit(targetPath).raw(['submodule', 'status']).catch(() => '');
      const submodules: SubmoduleEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const match = line.match(/^[\s+\-U]?([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?/);
        if (!match) continue;
        submodules.push({ hash: match[1], path: match[2], describe: match[3] || undefined });
      }
      return { success: true, data: submodules };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:submodule-update', async (_event, repoPath: string, path?: string, init?: boolean) => {
    try {
      const args = ['submodule', 'update'];
      if (init) {
        args.push('--init');
      }
      args.push('--recursive');
      if (path) {
        args.push('--', path);
      }
      await simpleGit(repoPath).raw(args);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:submodule-add', async (_event, repoPath: string, url: string, path: string) => {
    try {
      await simpleGit(repoPath).raw(['submodule', 'add', url, path]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:submodule-sync', async (_event, repoPath: string) => {
    try {
      await simpleGit(repoPath).raw(['submodule', 'sync', '--recursive']);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:stash-apply', async (_event, targetPath: string, stashIndex: number) => {
    try {
      await simpleGit(targetPath).stash(['apply', `stash@{${stashIndex}}`]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:stash-pop', async (_event, targetPath: string, stashIndex: number) => {
    try {
      await simpleGit(targetPath).stash(['pop', `stash@{${stashIndex}}`]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:stash-drop', async (_event, targetPath: string, stashIndex: number) => {
    try {
      await simpleGit(targetPath).stash(['drop', `stash@{${stashIndex}}`]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('git:stash-preview', async (_event, targetPath: string, stashIndex: number) => {
    try {
      const ref = `stash@{${stashIndex}}`;
      const g = simpleGit(targetPath);
      const [filesRaw, diff] = await Promise.all([
        g.raw(['stash', 'show', '--name-only', ref]),
        g.raw(['stash', 'show', '-p', ref]),
      ]);
      const files = filesRaw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return { success: true, data: { files, diff } };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Drop ALL stashes at once (git stash clear)
  ipcMain.handle('git:stash-clear', async (_event, targetPath: string) => {
    try {
      await simpleGit(targetPath).stash(['clear']);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });
}
