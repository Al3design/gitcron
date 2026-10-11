import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import {
  defaultContextReferenceDeps,
  parseContextSelection,
  resolveContextReference,
  type CheckoutHead,
  type ContextReferenceDeps,
} from '../assist/context-reference';

const ROOT = path.resolve('/repo');
const HEAD: CheckoutHead = { sha: 'a'.repeat(40), branch: 'main' };

interface FakeOptions {
  /** Raíz autorizada que devuelve el doble; por omisión, la propia ROOT. */
  authorized?: string | null;
  head?: CheckoutHead;
  commits?: string[];
  realpaths?: Record<string, string | null>;
  files?: string[];
  changes?: string[];
}

/** Doble de `ContextReferenceDeps` sin git ni disco, que registra cada llamada. */
function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];
  const deps: ContextReferenceDeps = {
    authorizedRoot: (repoPath) => {
      calls.push('authorizedRoot');
      if (options.authorized !== undefined) return options.authorized;
      return repoPath === ROOT ? ROOT : null;
    },
    currentHead: async () => {
      calls.push('currentHead');
      return options.head ?? HEAD;
    },
    commitExists: async (root, sha) => {
      calls.push(`commitExists:${sha}`);
      return root === ROOT && (options.commits?.includes(sha) ?? false);
    },
    realpath: async (absolutePath) => {
      calls.push(`realpath:${absolutePath}`);
      return options.realpaths?.[absolutePath] ?? null;
    },
    isFile: async (absolutePath) => {
      calls.push(`isFile:${absolutePath}`);
      return options.files?.includes(absolutePath) ?? false;
    },
    changeExists: async (root, changeId) => {
      calls.push(`changeExists:${changeId}`);
      return root === ROOT && (options.changes?.includes(changeId) ?? false);
    },
  };
  return { calls, deps };
}

/** Sondas de disco que hizo el resolvedor, con la ruta que miró. */
function diskProbes(calls: string[]): string[] {
  return calls
    .filter((call) => call.startsWith('realpath:') || call.startsWith('isFile:'))
    .map((call) => call.slice(call.indexOf(':') + 1));
}

function insideRoot(target: string): boolean {
  const relative = path.relative(ROOT, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function fileSelection(overrides: Record<string, unknown> = {}) {
  return { kind: 'file', path: 'src/a.ts', at: 'worktree', takenAtHead: HEAD.sha, ...overrides };
}

describe('resolveContextReference', () => {
  it('rechaza un repo no autorizado sin llamar a nada más', async () => {
    const { calls, deps } = fakeDeps({ authorized: null });

    const result = await resolveContextReference(ROOT, { kind: 'none' }, deps);

    expect(result).toEqual({ status: 'rejected', reason: 'repo-not-authorized' });
    expect(calls).toEqual(['authorizedRoot']);
  });

  it('rechaza un kind desconocido sin leer el HEAD', async () => {
    const { calls, deps } = fakeDeps();

    const result = await resolveContextReference(ROOT, { kind: 'secret' }, deps);

    expect(result).toEqual({ status: 'rejected', reason: 'invalid-selection' });
    expect(calls).toEqual(['authorizedRoot']);
  });

  it('rechaza una ruta con .. antes de leer el HEAD', async () => {
    const { calls, deps } = fakeDeps();

    const result = await resolveContextReference(ROOT, fileSelection({ path: '../fuera.txt' }), deps);

    expect(result).toEqual({ status: 'rejected', reason: 'invalid-selection' });
    expect(calls).toEqual(['authorizedRoot']);
  });

  it('rechaza una ruta absoluta antes de leer el HEAD', async () => {
    const { calls, deps } = fakeDeps();

    const result = await resolveContextReference(ROOT, fileSelection({ path: path.resolve('/otro/x.ts') }), deps);

    expect(result).toEqual({ status: 'rejected', reason: 'invalid-selection' });
    expect(calls).toEqual(['authorizedRoot']);
  });

  it('acepta un archivo del worktree en el HEAD en que se tomó', async () => {
    const absolute = path.resolve(ROOT, 'src/a.ts');
    const { calls, deps } = fakeDeps({ realpaths: { [absolute]: absolute }, files: [absolute] });

    const result = await resolveContextReference(ROOT, fileSelection(), deps);

    expect(result).toEqual({ status: 'ok', checkoutPath: ROOT, head: HEAD, selection: fileSelection() });
    const probes = diskProbes(calls);
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) expect(insideRoot(probe)).toBe(true);
  });

  it('marca obsoleto un archivo del worktree tomado en otro HEAD, sin tocar el disco', async () => {
    const absolute = path.resolve(ROOT, 'src/a.ts');
    const takenAtHead = 'b'.repeat(40);
    const { calls, deps } = fakeDeps({ realpaths: { [absolute]: absolute }, files: [absolute] });

    const result = await resolveContextReference(ROOT, fileSelection({ takenAtHead }), deps);

    expect(result).toEqual({
      status: 'stale',
      reason: 'head-moved',
      checkoutPath: ROOT,
      head: HEAD,
      selection: fileSelection({ takenAtHead }),
    });
    expect(diskProbes(calls)).toEqual([]);
  });

  it('rechaza un symlink que sale del repo, sin mirar si es un archivo', async () => {
    const absolute = path.resolve(ROOT, 'link.ts');
    const outside = path.resolve('/otro/destino.ts');
    const { calls, deps } = fakeDeps({ realpaths: { [absolute]: outside }, files: [outside] });

    const result = await resolveContextReference(ROOT, fileSelection({ path: 'link.ts' }), deps);

    expect(result).toEqual({ status: 'rejected', reason: 'path-outside-checkout' });
    expect(calls).toContain(`realpath:${absolute}`);
    expect(diskProbes(calls)).toEqual([absolute]);
  });

  it('marca obsoleto un commit que ya no existe', async () => {
    const { calls, deps } = fakeDeps({ commits: [] });
    const sha = 'c'.repeat(40);

    const result = await resolveContextReference(ROOT, { kind: 'commit', sha }, deps);

    expect(result).toEqual({
      status: 'stale',
      reason: 'target-missing',
      checkoutPath: ROOT,
      head: HEAD,
      selection: { kind: 'commit', sha },
    });
    expect(calls).toEqual(['authorizedRoot', 'currentHead', `commitExists:${sha}`]);
  });

  it('acepta un change que existe y marca obsoleto el que no', async () => {
    const existente = await resolveContextReference(
      ROOT,
      { kind: 'change', changeId: 'retomar-trabajo-con-asistencia-contextual', taskId: '1.2' },
      fakeDeps({ changes: ['retomar-trabajo-con-asistencia-contextual'] }).deps,
    );
    expect(existente.status).toBe('ok');

    const { calls, deps } = fakeDeps({ changes: [] });
    const result = await resolveContextReference(ROOT, { kind: 'change', changeId: 'borrado' }, deps);

    expect(result).toEqual({
      status: 'stale',
      reason: 'target-missing',
      checkoutPath: ROOT,
      head: HEAD,
      selection: { kind: 'change', changeId: 'borrado' },
    });
    expect(calls).toEqual(['authorizedRoot', 'currentHead', 'changeExists:borrado']);
  });

  it('marca obsoleto un nodo de cartografía tomado en otro HEAD', async () => {
    const { deps } = fakeDeps();
    const takenAtHead = 'd'.repeat(40);

    const result = await resolveContextReference(ROOT, { kind: 'carto-node', nodeId: 'n-1', takenAtHead }, deps);

    expect(result).toEqual({
      status: 'stale',
      reason: 'head-moved',
      checkoutPath: ROOT,
      head: HEAD,
      selection: { kind: 'carto-node', nodeId: 'n-1', takenAtHead },
    });
  });
});

describe('parseContextSelection', () => {
  it('descarta los campos que no son del tipo', () => {
    expect(parseContextSelection({ kind: 'commit', sha: 'abcdef1', extra: 1 })).toEqual({
      kind: 'commit',
      sha: 'abcdef1',
    });
  });
});

describe('defaultContextReferenceDeps', () => {
  it('está completo: es el valor por omisión del resolvedor', () => {
    const names: (keyof ContextReferenceDeps)[] = [
      'authorizedRoot',
      'currentHead',
      'commitExists',
      'realpath',
      'isFile',
      'changeExists',
    ];
    for (const name of names) expect(typeof defaultContextReferenceDeps[name]).toBe('function');
  });
});

describe('changeExists de defaultContextReferenceDeps', () => {
  it('reconoce el archivado por el id entero, no por cómo termina el nombre', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-context-ref-'));
    try {
      fs.mkdirSync(path.join(root, 'openspec', 'changes', 'archive', '2026-10-11-modularizar-sdd'), { recursive: true });
      fs.mkdirSync(path.join(root, 'openspec', 'changes', 'retomar'), { recursive: true });
      expect(await defaultContextReferenceDeps.changeExists(root, 'modularizar-sdd')).toBe(true);
      expect(await defaultContextReferenceDeps.changeExists(root, 'sdd')).toBe(false);
      expect(await defaultContextReferenceDeps.changeExists(root, 'retomar')).toBe(true);
    } finally {
      removeTempDir(root);
    }
  });
});
