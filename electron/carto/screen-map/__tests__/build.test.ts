import { describe, expect, it } from 'vitest';
import { buildScreenMap, type ScreenMapDeps } from '../build';

describe('buildScreenMap', () => {
  it('marca shared: true en archivos usados por dos o más pantallas y preserva roles', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': "import { SharedNav } from '@/components/SharedNav';",
      'app/settings/page.tsx': "import { SharedNav } from '@/components/SharedNav';",
      'components/SharedNav.tsx': 'export function SharedNav() { return <nav />; }',
    };

    const depsMap: Record<string, string[]> = {
      'app/page.tsx': ['components/SharedNav.tsx'],
      'app/settings/page.tsx': ['components/SharedNav.tsx'],
      'components/SharedNav.tsx': [],
    };

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies(p) {
        return depsMap[p] ?? [];
      },
      async headSha() {
        return 'abc1234';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);

    expect(map.screens).toHaveLength(2);
    expect(map.detectors).toContain('next-app-router');
    expect(map.coverage).toEqual({ state: 'complete' });

    const home = map.screens.find((s) => s.locator === '/')!;
    const settings = map.screens.find((s) => s.locator === '/settings')!;

    const homeShared = home.files.find((f) => f.path === 'components/SharedNav.tsx')!;
    const settingsShared = settings.files.find((f) => f.path === 'components/SharedNav.tsx')!;

    expect(homeShared).toBeDefined();
    expect(settingsShared).toBeDefined();
    expect(homeShared.shared).toBe(true);
    expect(settingsShared.shared).toBe(true);
    expect(homeShared.role).toBe('component');
    expect(homeShared.provenance).toBe('static');
  });

  it('un import dinámico no resuelto import(`./${x}`) genera un vínculo unknown y cobertura partial', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': "export default function Page() { const x = 'widget'; import(`./${x}`); return null; }",
    };

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies() {
        return [];
      },
      async headSha() {
        return 'sha1';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.screens).toHaveLength(1);

    const screen = map.screens[0];
    const unknownLink = screen.files.find((f) => f.provenance === 'unknown');
    expect(unknownLink).toBeDefined();
    expect(unknownLink?.unresolved).toContain('import(`./${x}`)');

    expect(map.coverage.state).toBe('partial');
    if (map.coverage.state === 'partial') {
      expect(map.coverage.unresolved).toBeGreaterThanOrEqual(1);
    }
  });

  it('el tope de 200 archivos por pantalla cuenta excluidos', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': 'export default function Page() { return null; }',
    };

    // Generar 220 dependencias directas
    const manyDeps: string[] = [];
    for (let i = 0; i < 220; i++) {
      const depPath = `lib/module-${i}.ts`;
      manyDeps.push(depPath);
      files[depPath] = 'export const x = 1;';
    }

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies(p) {
        if (p === 'app/page.tsx') return manyDeps;
        return [];
      },
      async headSha() {
        return 'sha2';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.screens).toHaveLength(1);
    expect(map.screens[0].files.length).toBeLessThanOrEqual(200);

    expect(map.coverage.state).toBe('partial');
    if (map.coverage.state === 'partial') {
      expect(map.coverage.excluded).toBeGreaterThan(0);
    }
  });

  it('índice no listo devuelve cobertura partial con mensaje de error específico', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': 'export default function Page() { return null; }',
    };

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies() {
        return null; // índice no listo
      },
      async headSha() {
        return 'sha3';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.coverage).toEqual({
      state: 'partial',
      unresolved: 0,
      excluded: 0,
      errors: ['El índice de Cartografía todavía no está listo: faltan los archivos que usa cada pantalla.'],
    });
  });

  it('repo sin interfaz devuelve cobertura unsupported no-ui', async () => {
    const files: Record<string, string> = {
      'lib/math.ts': 'export const add = (a: number, b: number) => a + b;',
      'README.md': '# Backend service',
    };

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies() {
        return [];
      },
      async headSha() {
        return 'sha4';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.screens).toHaveLength(0);
    expect(map.coverage).toEqual({
      state: 'unsupported',
      reason: 'no-ui',
    });
  });

  it('repo con interfaz pero sin detector compatible devuelve unsupported unknown-stack', async () => {
    const files: Record<string, string> = {
      'src/App.vue': '<template><div>Vue</div></template>',
    };

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      async readFile(p) {
        return files[p] ?? null;
      },
      fileDependencies() {
        return [];
      },
      async headSha() {
        return 'sha5';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.screens).toHaveLength(0);
    expect(map.coverage).toEqual({
      state: 'unsupported',
      reason: 'unknown-stack',
    });
  });
});
