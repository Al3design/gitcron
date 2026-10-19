import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { runViewCaptures, viewRunnerAvailable } from '../view-runner';
import type { CaptureRecipes } from '../recipes';

describe('view-runner', () => {
  const root = path.resolve('/mock/project');
  const dummyRecipes: CaptureRecipes = {
    version: 1,
    runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
    setup: [],
    screens: {
      'view:graph': { steps: [] },
      'view:history': { steps: [] },
    },
  };

  it('viewRunnerAvailable comprueba la existencia de bin.js y config', () => {
    const existing = new Set<string>();
    const fakeFs = {
      existsSync: (p: string) => existing.has(path.normalize(p)),
    };

    expect(viewRunnerAvailable(root, dummyRecipes, { fs: fakeFs as any })).toBe(false);

    existing.add(path.normalize(path.join(root, 'node_modules', 'e2e', 'dist', 'cli', 'bin.js')));
    expect(viewRunnerAvailable(root, dummyRecipes, { fs: fakeFs as any })).toBe(false);

    existing.add(path.normalize(path.join(root, dummyRecipes.runner.config)));
    expect(viewRunnerAvailable(root, dummyRecipes, { fs: fakeFs as any })).toBe(true);
  });

  function createFakeHarness() {
    const files = new Map<string, Buffer | string>();
    const dirs = new Set<string>();
    const unlinked: string[] = [];

    const fakeFs = {
      existsSync: (p: string) => {
        const norm = path.normalize(p);
        return files.has(norm) || dirs.has(norm);
      },
      mkdirSync: (p: string) => {
        dirs.add(path.normalize(p));
      },
      writeFileSync: (p: string, data: string | Buffer) => {
        files.set(path.normalize(p), data);
      },
      unlinkSync: (p: string) => {
        const norm = path.normalize(p);
        unlinked.push(norm);
        files.delete(norm);
      },
      readdirSync: (p: string, opts?: { withFileTypes?: boolean }) => {
        const norm = path.normalize(p);
        const results: any[] = [];
        for (const f of files.keys()) {
          if (path.dirname(f) === norm) {
            const base = path.basename(f);
            results.push(opts?.withFileTypes ? { name: base, isDirectory: () => false } : base);
          }
        }
        for (const d of dirs) {
          if (path.dirname(d) === norm && d !== norm) {
            const base = path.basename(d);
            results.push(opts?.withFileTypes ? { name: base, isDirectory: () => true } : base);
          }
        }
        return results;
      },
      statSync: (p: string) => {
        const norm = path.normalize(p);
        const isDir = dirs.has(norm);
        return {
          mtimeMs: 1000,
          isDirectory: () => isDir,
        };
      },
      readFileSync: (p: string) => {
        const val = files.get(path.normalize(p));
        if (!val) throw new Error(`File not found: ${p}`);
        return typeof val === 'string' ? Buffer.from(val) : val;
      },
    };

    return { fakeFs, files, dirs, unlinked };
  }

  it('la prueba temporal se borra también si el proceso falla', async () => {
    const { fakeFs, unlinked } = createFakeHarness();

    const fakeSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      // Fallo inmediato con código 1
      setTimeout(() => {
        child.emit('close', 1);
      }, 10);

      return child;
    };

    const screens = [{ id: 'view:graph', name: 'Graph' }];
    const res = await runViewCaptures(
      root,
      dummyRecipes,
      screens,
      {},
      { spawn: fakeSpawn as any, fs: fakeFs as any },
    );

    // Debe haberse borrado el archivo temporal
    expect(unlinked.length).toBe(1);
    expect(unlinked[0]).toMatch(/zz-gitcron-capturas-.*\.e2e\.ts$/);
    expect(res.images.size).toBe(0);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0].screenId).toBe('view:graph');
  });

  it('las líneas GITCRON_RECIPE_FAIL van a failed', async () => {
    const { fakeFs } = createFakeHarness();

    const fakeSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      setTimeout(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            'GITCRON_RECIPE_FAIL "view:graph" paso 2: no se encontró el botón "Graph"\n',
          ),
        );
        child.emit('close', 0);
      }, 10);

      return child;
    };

    const screens = [{ id: 'view:graph', name: 'Graph' }];
    const res = await runViewCaptures(
      root,
      dummyRecipes,
      screens,
      {},
      { spawn: fakeSpawn as any, fs: fakeFs as any },
    );

    expect(res.failed).toContainEqual({
      screenId: 'view:graph',
      detail: 'paso 2: no se encontró el botón "Graph"',
    });
  });

  it('las imágenes se asocian por cap-<i>', async () => {
    const { fakeFs, files, dirs } = createFakeHarness();

    const screens = [
      { id: 'view:graph', name: 'Graph' },
      { id: 'view:history', name: 'History' },
    ];

    const fakeSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      setTimeout(() => {
        // Encontrar el nombre del archivo temporal generado
        let tempBase = 'zz-gitcron-capturas';
        for (const k of files.keys()) {
          const match = k.match(/(zz-gitcron-capturas-[a-f0-9]+)\.e2e\.ts$/);
          if (match) {
            tempBase = match[1];
            break;
          }
        }

        // Crear carpetas y capturas en los artefactos
        const configDir = path.dirname(path.resolve(root, dummyRecipes.runner.config));
        const artDir = path.join(configDir, '.e2e', 'artifacts', tempBase, 'default', 'attempt-0', 'screenshots');

        dirs.add(path.normalize(path.join(configDir, '.e2e')));
        dirs.add(path.normalize(path.join(configDir, '.e2e', 'artifacts')));
        dirs.add(path.normalize(path.join(configDir, '.e2e', 'artifacts', tempBase)));
        dirs.add(path.normalize(path.join(configDir, '.e2e', 'artifacts', tempBase, 'default')));
        dirs.add(path.normalize(path.join(configDir, '.e2e', 'artifacts', tempBase, 'default', 'attempt-0')));
        dirs.add(path.normalize(artDir));

        files.set(path.normalize(path.join(artDir, '001-cap-1.png')), Buffer.from('png-graph'));
        files.set(path.normalize(path.join(artDir, '002-cap-2.png')), Buffer.from('png-history'));

        child.emit('close', 0);
      }, 20);

      return child;
    };

    const res = await runViewCaptures(
      root,
      dummyRecipes,
      screens,
      {},
      { spawn: fakeSpawn as any, fs: fakeFs as any },
    );

    expect(res.images.get('view:graph')).toEqual(Buffer.from('png-graph'));
    expect(res.images.get('view:history')).toEqual(Buffer.from('png-history'));
    expect(res.failed).toHaveLength(0);
  });
});
