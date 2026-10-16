import { describe, expect, it, vi } from 'vitest';
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
      symbolDependencies() { return []; },
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
      symbolDependencies() { return []; },
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
      symbolDependencies() { return []; },
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
      symbolDependencies() { return []; },
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
      symbolDependencies() { return []; },
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
      symbolDependencies() { return []; },
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

  // Cadena con la forma real que reconoce el detector (tres o más «if (…) return <Componente»).
  const chainFile = `
import { ViewA } from './ViewA';
import { ViewB } from './ViewB';
import { ViewC } from './ViewC';
export function Tabs() {
  if (tab === 'a') return <ViewA />;
  if (tab === 'b') return <ViewB />;
  if (tab === 'c') return <ViewC />;
  return <ViewA />;
}
`;

  it('con corte de cadena de vistas, una ruta que llega al archivo de la vista no arrastra los archivos de las vistas', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': "import { Tabs } from '@/components/Tabs';",
      'components/Tabs.tsx': chainFile,
      'components/ViewA.tsx': 'export function ViewA() { return <div>A</div>; }',
      'components/ViewB.tsx': 'export function ViewB() { return <div>B</div>; }',
      'components/ViewC.tsx': 'export function ViewC() { return <div>C</div>; }',
    };
    const depsMap: Record<string, string[]> = {
      'app/page.tsx': ['components/Tabs.tsx'],
      'components/Tabs.tsx': ['components/ViewA.tsx', 'components/ViewB.tsx', 'components/ViewC.tsx'],
    };
    const deps: ScreenMapDeps = {
      async listFiles() { return { paths: Object.keys(files), truncated: false }; },
      async readFile(p) { return files[p] ?? null; },
      fileDependencies(p) { return depsMap[p] ?? []; },
      symbolDependencies() { return []; },
      async headSha() { return 'sha-chain'; },
      now() { return '2026-10-16T12:00:00.000Z'; },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    const route = map.screens.find((s) => s.kind === 'route')!;
    const routeFiles = route.files.map((f) => f.path);
    // La ruta llega al archivo de la cadena (lo lista) pero no entra: las vistas no son suyas.
    expect(routeFiles).toContain('components/Tabs.tsx');
    expect(routeFiles).not.toContain('components/ViewB.tsx');
    expect(routeFiles).not.toContain('components/ViewC.tsx');
    // Y cada vista se queda con lo suyo.
    const viewB = map.screens.find((s) => s.name === 'B')!;
    expect(viewB.files.map((f) => f.path)).toContain('components/ViewB.tsx');
  });

  it('vista en el mismo archivo usa symbolDependencies y si es null cae a fallback con cobertura partial', async () => {
    const sameFile = `
export function Screens(view: string) {
  if (view === 'a') return <ScreenA />;
  if (view === 'b') return <ScreenB />;
  if (view === 'c') return <ScreenC />;
  return <ScreenA />;
}
function ScreenA() { return <Uno />; }
function ScreenB() { return <Dos />; }
function ScreenC() { return <div />; }
`;
    const files: Record<string, string> = {
      'components/Screens.tsx': sameFile,
      'components/Uno.tsx': 'export function Uno() { return <div />; }',
      'components/Dos.tsx': 'export function Dos() { return <div />; }',
    };
    const fileDeps: Record<string, string[]> = { 'components/Screens.tsx': ['components/Uno.tsx', 'components/Dos.tsx'] };
    const symbolCalls = vi.fn((_file: string, symbol: string): string[] | null => {
      if (symbol === 'ScreenA') return ['components/Uno.tsx'];
      if (symbol === 'ScreenB') return ['components/Dos.tsx'];
      return null; // ScreenC: el índice no lo encuentra
    });
    const deps: ScreenMapDeps = {
      async listFiles() { return { paths: Object.keys(files), truncated: false }; },
      async readFile(p) { return files[p] ?? null; },
      fileDependencies(p) { return fileDeps[p] ?? []; },
      symbolDependencies: symbolCalls,
      async headSha() { return 'sha-same'; },
      now() { return '2026-10-16T12:00:00.000Z'; },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    const a = map.screens.find((s) => s.name === 'A')!;
    const b = map.screens.find((s) => s.name === 'B')!;
    const c = map.screens.find((s) => s.name === 'C')!;
    // A y B toman lo que usa su componente, no todo el archivo.
    expect(a.files.map((f) => f.path)).toContain('components/Uno.tsx');
    expect(a.files.map((f) => f.path)).not.toContain('components/Dos.tsx');
    expect(b.files.map((f) => f.path)).toContain('components/Dos.tsx');
    expect(b.files.map((f) => f.path)).not.toContain('components/Uno.tsx');
    // C cae al archivo entero y la cobertura lo dice.
    expect(c.files.map((f) => f.path)).toEqual(expect.arrayContaining(['components/Uno.tsx', 'components/Dos.tsx']));
    expect(map.coverage.state).toBe('partial');
    if (map.coverage.state === 'partial') {
      expect(map.coverage.errors).toContain('Algunas vistas muestran todo el archivo que las declara: el índice no encontró su componente.');
    }
  });
});

