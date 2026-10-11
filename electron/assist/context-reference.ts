/**
 * Resolvedor de referencias de contexto (proceso principal).
 *
 * Recibe del renderer la ruta del repo abierto y lo que la persona tiene
 * seleccionado, y decide si esa referencia se puede usar: si el repo está
 * autorizado, si la ruta queda dentro del repo y si la selección sigue vigente
 * contra el HEAD actual. No lee el contenido de nada: sólo comprueba que lo
 * señalado existe, y nunca toca nada fuera del repo.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { authorizedRepoRoot, isContainedWithin } from '../ipc/authorized-repos';
import { withRepoLock } from '../git/repo-queue';

/** Lo que la persona tiene seleccionado en una vista, con el HEAD en el que lo tomó. */
export type ContextSelection =
  | { kind: 'none' }
  | { kind: 'commit'; sha: string }
  | { kind: 'file'; path: string; at: 'worktree' | string; takenAtHead: string }
  | { kind: 'change'; changeId: string; taskId?: string }
  | { kind: 'temporal-idea'; runId: string; branchId: string }
  | { kind: 'carto-node'; nodeId: string; takenAtHead: string };

export interface CheckoutHead {
  sha: string;
  /** `null` con HEAD separado. */
  branch: string | null;
}

export type ContextResolution =
  | { status: 'ok'; checkoutPath: string; head: CheckoutHead; selection: ContextSelection }
  | { status: 'stale'; reason: 'head-moved' | 'target-missing'; checkoutPath: string; head: CheckoutHead; selection: ContextSelection }
  | { status: 'rejected'; reason: 'repo-not-authorized' | 'invalid-selection' | 'path-outside-checkout' };

/** Lo que el resolvedor necesita del mundo. Se inyecta para poder probarlo sin git ni disco. */
export interface ContextReferenceDeps {
  authorizedRoot(repoPath: unknown): string | null;
  currentHead(root: string): Promise<CheckoutHead>;
  commitExists(root: string, sha: string): Promise<boolean>;
  /** Ruta real (symlinks resueltos) o `null` si no existe. */
  realpath(absolutePath: string): Promise<string | null>;
  isFile(absolutePath: string): Promise<boolean>;
  changeExists(root: string, changeId: string): Promise<boolean>;
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const CHANGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TASK_ID_PATTERN = /^\d+(\.\d+)*$/;
const GIT_TIMEOUT_MS = 10_000;
/** Tope de longitud para identificadores opacos (runId, branchId, nodeId). */
const MAX_ID_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA_PATTERN.test(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/** Un commit existente, o el worktree. `null` si no es un `at` válido. */
function parseAt(value: unknown): 'worktree' | string | null {
  if (value === 'worktree') return 'worktree';
  return isSha(value) ? value : null;
}

/**
 * Ruta relativa dentro del checkout: sin carácter nulo, sin tramos `..` y sin
 * rutas absolutas ni con letra de unidad. `null` si no cumple.
 */
function parseRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.includes('\u0000')) return null;
  if (path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return null;
  if (value.split(/[\\/]/).some((segment) => segment === '..')) return null;
  return value;
}

function parseCommitSelection(input: Record<string, unknown>): ContextSelection | null {
  const sha = input.sha;
  if (!isSha(sha)) return null;
  return { kind: 'commit', sha };
}

function parseFileSelection(input: Record<string, unknown>): ContextSelection | null {
  const relativePath = parseRelativePath(input.path);
  const at = parseAt(input.at);
  const takenAtHead = input.takenAtHead;
  if (relativePath === null || at === null || !isSha(takenAtHead)) return null;
  return { kind: 'file', path: relativePath, at, takenAtHead };
}

function parseChangeSelection(input: Record<string, unknown>): ContextSelection | null {
  const changeId = input.changeId;
  if (typeof changeId !== 'string' || !CHANGE_ID_PATTERN.test(changeId)) return null;
  const taskId = input.taskId;
  if (taskId !== undefined && !(typeof taskId === 'string' && TASK_ID_PATTERN.test(taskId))) return null;
  const change: { kind: 'change'; changeId: string; taskId?: string } = { kind: 'change', changeId };
  if (typeof taskId === 'string') change.taskId = taskId;
  return change;
}

function parseTemporalIdeaSelection(input: Record<string, unknown>): ContextSelection | null {
  const runId = input.runId;
  const branchId = input.branchId;
  if (!isBoundedText(runId) || !isBoundedText(branchId)) return null;
  return { kind: 'temporal-idea', runId, branchId };
}

function parseCartoNodeSelection(input: Record<string, unknown>): ContextSelection | null {
  const nodeId = input.nodeId;
  const takenAtHead = input.takenAtHead;
  if (!isBoundedText(nodeId) || !isSha(takenAtHead)) return null;
  return { kind: 'carto-node', nodeId, takenAtHead };
}

/** Valida la forma de lo que manda el renderer. `null` si no es una selección válida. */
export function parseContextSelection(input: unknown): ContextSelection | null {
  if (!isRecord(input)) return null;
  switch (input.kind) {
    case 'none':
      return { kind: 'none' };
    case 'commit':
      return parseCommitSelection(input);
    case 'file':
      return parseFileSelection(input);
    case 'change':
      return parseChangeSelection(input);
    case 'temporal-idea':
      return parseTemporalIdeaSelection(input);
    case 'carto-node':
      return parseCartoNodeSelection(input);
    default:
      return null;
  }
}

function gitIn(root: string) {
  return simpleGit(root, { timeout: { block: GIT_TIMEOUT_MS } });
}

async function currentHead(root: string): Promise<CheckoutHead> {
  return withRepoLock(root, async () => {
    const git = gitIn(root);
    const sha = (await git.raw(['rev-parse', 'HEAD'])).trim();
    const name = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return { sha, branch: name === 'HEAD' ? null : name };
  });
}

async function commitExists(root: string, sha: string): Promise<boolean> {
  try {
    await withRepoLock(root, async () => {
      await gitIn(root).raw(['cat-file', '-e', `${sha}^{commit}`]);
    });
    return true;
  } catch {
    return false;
  }
}

async function realpath(absolutePath: string): Promise<string | null> {
  try {
    return await fs.realpath(absolutePath);
  } catch {
    return null;
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    return (await fs.stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Un change archivado vive en `openspec/changes/archive/<AAAA-MM-DD>-<id>`. Se
 * compara el id entero después de la fecha: con un «termina en -<id>», `sdd`
 * habría encontrado `2026-10-11-modularizar-sdd`.
 */
async function changeIsArchived(root: string, changeId: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(root, 'openspec', 'changes', 'archive'));
  } catch {
    return false;
  }
  return entries.some((entry) => /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(entry)?.[1] === changeId);
}

async function changeExists(root: string, changeId: string): Promise<boolean> {
  if (await isDirectory(path.join(root, 'openspec', 'changes', changeId))) return true;
  return changeIsArchived(root, changeId);
}

export const defaultContextReferenceDeps: ContextReferenceDeps = {
  authorizedRoot: authorizedRepoRoot,
  currentHead,
  commitExists,
  realpath,
  isFile,
  changeExists,
};

/** El contexto ya validado contra el que se comprueba cada tipo de selección. */
interface ResolutionContext {
  root: string;
  head: CheckoutHead;
  deps: ContextReferenceDeps;
}

function rejected(reason: 'repo-not-authorized' | 'invalid-selection' | 'path-outside-checkout'): ContextResolution {
  return { status: 'rejected', reason };
}

function ok(ctx: ResolutionContext, selection: ContextSelection): ContextResolution {
  return { status: 'ok', checkoutPath: ctx.root, head: ctx.head, selection };
}

function stale(
  reason: 'head-moved' | 'target-missing',
  ctx: ResolutionContext,
  selection: ContextSelection,
): ContextResolution {
  return { status: 'stale', reason, checkoutPath: ctx.root, head: ctx.head, selection };
}

/** La ruta absoluta de una selección de archivo, o `null` para los otros tipos. */
function absoluteInCheckout(root: string, selection: ContextSelection): string | null {
  if (selection.kind !== 'file') return null;
  return path.resolve(root, selection.path);
}

async function resolveCommitSelection(
  selection: { kind: 'commit'; sha: string },
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  if (!(await ctx.deps.commitExists(ctx.root, selection.sha))) return stale('target-missing', ctx, selection);
  return ok(ctx, selection);
}

/** Archivo tomado en el worktree: su vigencia es el HEAD en el que se tomó. */
async function resolveWorktreeFile(
  selection: { kind: 'file'; path: string; at: 'worktree' | string; takenAtHead: string },
  absolutePath: string,
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  if (selection.takenAtHead !== ctx.head.sha) return stale('head-moved', ctx, selection);
  const real = await ctx.deps.realpath(absolutePath);
  if (real === null) return stale('target-missing', ctx, selection);
  // Un symlink que apunta fuera del checkout sigue fuera de scope, aunque exista.
  if (!isContainedWithin(ctx.root, real)) return rejected('path-outside-checkout');
  if (!(await ctx.deps.isFile(real))) return stale('target-missing', ctx, selection);
  return ok(ctx, selection);
}

/**
 * Archivo tomado en un commit: en esta tanda alcanza con que el commit exista;
 * el contenido del archivo dentro del commit se revisa más adelante.
 */
async function resolveCommittedFile(
  selection: { kind: 'file'; path: string; at: 'worktree' | string; takenAtHead: string },
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  if (!(await ctx.deps.commitExists(ctx.root, selection.at))) return stale('target-missing', ctx, selection);
  return ok(ctx, selection);
}

async function resolveFileSelection(
  selection: { kind: 'file'; path: string; at: 'worktree' | string; takenAtHead: string },
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  const absolutePath = absoluteInCheckout(ctx.root, selection);
  if (absolutePath === null) return rejected('invalid-selection');
  if (selection.at === 'worktree') return resolveWorktreeFile(selection, absolutePath, ctx);
  return resolveCommittedFile(selection, ctx);
}

async function resolveChangeSelection(
  selection: { kind: 'change'; changeId: string; taskId?: string },
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  if (!(await ctx.deps.changeExists(ctx.root, selection.changeId))) return stale('target-missing', ctx, selection);
  return ok(ctx, selection);
}

async function resolveCartoNodeSelection(
  selection: { kind: 'carto-node'; nodeId: string; takenAtHead: string },
  ctx: ResolutionContext,
): Promise<ContextResolution> {
  if (selection.takenAtHead !== ctx.head.sha) return stale('head-moved', ctx, selection);
  return ok(ctx, selection);
}

/** Decide si la referencia se puede usar. */
export async function resolveContextReference(
  repoPath: unknown,
  rawSelection: unknown,
  deps: ContextReferenceDeps = defaultContextReferenceDeps,
): Promise<ContextResolution> {
  const root = deps.authorizedRoot(repoPath);
  if (root === null) return rejected('repo-not-authorized');

  const selection = parseContextSelection(rawSelection);
  if (selection === null) return rejected('invalid-selection');

  // La ruta fuera del checkout se rechaza antes de leer el HEAD y antes de tocar el disco.
  const earlyPath = absoluteInCheckout(root, selection);
  if (earlyPath !== null && !isContainedWithin(root, earlyPath)) return rejected('path-outside-checkout');

  const head = await deps.currentHead(root);
  const ctx: ResolutionContext = { root, head, deps };

  switch (selection.kind) {
    case 'none':
    case 'temporal-idea':
      // Sin destino que comprobar; la vigencia de una idea temporal se revisa en la tarea que la conecte.
      return ok(ctx, selection);
    case 'commit':
      return resolveCommitSelection(selection, ctx);
    case 'file':
      return resolveFileSelection(selection, ctx);
    case 'change':
      return resolveChangeSelection(selection, ctx);
    case 'carto-node':
      return resolveCartoNodeSelection(selection, ctx);
    default:
      return rejected('invalid-selection');
  }
}
