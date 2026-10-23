import { describe, expect, it } from 'vitest';
import { buildScreenMap, type ScreenMapDeps } from '../build';
import type { ManualScreenData } from '../../../../types/screen-map';

/**
 * Medida sobre un proyecto grande de mentira (decisión 17): 5000 archivos, 60 rutas de Next,
 * 400 componentes encadenados y el resto en lib/, docs/ y scripts/. Todo en memoria.
 */
function fakeRepo() {
  const files = new Map<string, string>();
  const deps = new Map<string, string[]>();
  const ROUTES = 60;
  const COMPONENTS = 400;

  for (let c = 0; c < COMPONENTS; c++) {
    const next = `components/C${(c + 1) % COMPONENTS}.tsx`;
    const lib = `lib/l${c % 200}.ts`;
    files.set(`components/C${c}.tsx`, `import { x } from '../${lib}';\nexport function C${c}() { return <div />; }\n`);
    deps.set(`components/C${c}.tsx`, c % 5 === 4 ? [lib] : [next, lib]);
  }
  for (let r = 0; r < ROUTES; r++) {
    const used = [0, 1, 2].map((k) => `components/C${(r * 6 + k) % COMPONENTS}.tsx`);
    files.set(`app/r${r}/page.tsx`, `export default function Page() { return null; }\n`);
    deps.set(`app/r${r}/page.tsx`, used);
  }
  let filler = 0;
  while (files.size < 5000) {
    const folder = filler % 3 === 0 ? 'lib' : filler % 3 === 1 ? 'docs' : 'scripts';
    const ext = folder === 'docs' ? 'md' : 'ts';
    files.set(`${folder}/f${filler}.${ext}`, `// ${folder} ${filler}\n`);
    filler++;
  }
  for (let l = 0; l < 200; l++) {
    if (!files.has(`lib/l${l}.ts`)) files.set(`lib/l${l}.ts`, `export const x = ${l};\n`);
  }
  return { files, deps, ROUTES };
}

function makeDeps(repo: ReturnType<typeof fakeRepo>, manual: ManualScreenData | null) {
  const reads = new Map<string, number>();
  const deps: ScreenMapDeps = {
    async listFiles() {
      return { paths: [...repo.files.keys()], truncated: false };
    },
    async readFile(rel: string) {
      reads.set(rel, (reads.get(rel) ?? 0) + 1);
      return repo.files.get(rel) ?? null;
    },
    fileDependencies(rel: string) {
      return repo.deps.get(rel) ?? [];
    },
    async statFile() {
      return { mtimeMs: 1 };
    },
    async headSha() {
      return 'sha-grande';
    },
    now: () => '2026-10-21T12:00:00Z',
    async readManual() {
      return manual;
    },
  } as ScreenMapDeps;
  return { deps, reads };
}

describe('buildScreenMap sobre un proyecto de 5000 archivos', () => {
  it('sale en menos de 5 segundos, con 60 pantallas y sin leer un archivo dos veces', async () => {
    const repo = fakeRepo();
    expect(repo.files.size).toBeGreaterThanOrEqual(5000);
    const { deps, reads } = makeDeps(repo, { version: 1, links: [], descriptions: {} });

    const t0 = performance.now();
    const map = await buildScreenMap('C:/repo-grande', deps);
    const ms = Math.round(performance.now() - t0);
    console.log('medida', ms, 'ms para', repo.files.size, 'archivos;', reads.size, 'leídos');

    expect(map.screens.filter((s) => s.kind === 'route')).toHaveLength(repo.ROUTES);
    expect(ms).toBeLessThan(5000);
    const repetidos = [...reads.entries()].filter(([, n]) => n > 1);
    expect(repetidos).toEqual([]);
  });

  it('con exclude: [docs/], ninguna ruta de docs/ se lee', async () => {
    const repo = fakeRepo();
    // Una ruta dentro de docs/ que también se excluye como pantalla.
    repo.files.set('docs/guia/page.tsx', 'export default function P() { return null; }\n');
    const { deps, reads } = makeDeps(repo, { version: 1, links: [], descriptions: {}, exclude: ['docs/'] });

    const map = await buildScreenMap('C:/repo-grande', deps);

    expect([...reads.keys()].filter((p) => p.startsWith('docs/'))).toEqual([]);
    expect(map.screens.some((s) => s.declaredIn.startsWith('docs/'))).toBe(false);
  });
});
