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
      async statFile() {
        return null;
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
      async statFile() {
        return null;
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
      async statFile() {
        return null;
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
      async statFile() {
        return null;
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
      async statFile() {
        return null;
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
      async statFile() {
        return null;
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
      async statFile() { return null; },
      fileDependencies(p) { return depsMap[p] ?? []; },
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

  it('una vista con usedFiles toma esos archivos y sigue desde ahí; nunca entran archivos de prueba, scripts/ ni electron/ para una pantalla de components/; un import dinámico de un archivo excluido no aparece', async () => {
    const mainFile = `
import { ViewA } from '@/components/ViewA';
import { ViewB } from '@/components/ViewB';
import { ViewC } from '@/components/ViewC';
import { CommitGraph } from '@/components/CommitGraph';

export function Screens(tab: string) {
  if (tab === 'a') return <ViewA />;
  if (tab === 'b') return <ViewB />;
  if (tab === 'c') return <ViewC />;
  return <GraphTabView />;
}

function GraphTabView() {
  return <CommitGraph />;
}
`;
    const files: Record<string, string> = {
      'components/Screens.tsx': mainFile,
      'components/ViewA.tsx': 'export function ViewA() { return <div />; }',
      'components/ViewB.tsx': 'export function ViewB() { return <div />; }',
      'components/ViewC.tsx': 'export function ViewC() { return <div />; }',
      'components/CommitGraph.tsx': "import { Sub } from '@/components/Sub'; import { MainProc } from '@/electron/main'; import { runTest } from '@/components/__tests__/helper'; import { runScript } from '@/scripts/run';",
      'components/Sub.tsx': 'export function Sub() { return <span />; }',
      'electron/main.ts': "export function MainProc() { const dynamicMod = 'dyn'; import(`./${dynamicMod}`); }",
      'components/__tests__/helper.ts': "export function runTest() { import('./test-dyn'); }",
      'scripts/run.ts': "export function runScript() { import('./script-dyn'); }",
    };

    const fileDeps: Record<string, string[]> = {
      'components/Screens.tsx': ['components/ViewA.tsx', 'components/ViewB.tsx', 'components/ViewC.tsx', 'components/CommitGraph.tsx'],
      'components/CommitGraph.tsx': [
        'components/Sub.tsx',
        'electron/main.ts',
        'components/__tests__/helper.ts',
        'scripts/run.ts',
      ],
      'components/Sub.tsx': [],
      'electron/main.ts': [],
      'components/__tests__/helper.ts': [],
      'scripts/run.ts': [],
    };

    const deps: ScreenMapDeps = {
      async listFiles() { return { paths: Object.keys(files), truncated: false }; },
      async readFile(p) { return files[p] ?? null; },
      async statFile() { return null; },
      fileDependencies(p) { return fileDeps[p] ?? []; },
      async headSha() { return 'sha-excl'; },
      now() { return '2026-10-16T12:00:00.000Z'; },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    const graphScreen = map.screens.find((s) => s.name === 'Graph')!;
    expect(graphScreen).toBeDefined();

    const paths = graphScreen.files.map((f) => f.path);
    // Toma usedFiles (CommitGraph) y sigue desde ahí (Sub)
    expect(paths).toContain('components/CommitGraph.tsx');
    expect(paths).toContain('components/Sub.tsx');

    // Nunca entran archivos de prueba, scripts/ ni electron/
    expect(paths).not.toContain('electron/main.ts');
    expect(paths).not.toContain('components/__tests__/helper.ts');
    expect(paths).not.toContain('scripts/run.ts');

    // Tampoco aparecen imports dinámicos de los archivos excluidos
    const unknownImports = graphScreen.files
      .filter((f) => f.provenance === 'unknown')
      .map((f) => f.unresolved);
    expect(unknownImports.some((u) => u?.includes('dynamicMod'))).toBe(false);
    expect(unknownImports.some((u) => u?.includes('test-dyn'))).toBe(false);
    expect(unknownImports.some((u) => u?.includes('script-dyn'))).toBe(false);
  });

  it('vista en el mismo archivo con usedFiles vacío cae a fallback de archivo completo con cobertura partial', async () => {
    const sameFile = `
export function Screens(view: string) {
  if (view === 'a') return <ScreenA />;
  if (view === 'b') return <ScreenB />;
  if (view === 'c') return <ScreenC />;
  return <ScreenA />;
}
function ScreenA() { return <div />; }
function ScreenB() { return <div />; }
function ScreenC() { return <div />; }
`;
    const files: Record<string, string> = {
      'components/Screens.tsx': sameFile,
      'components/Uno.tsx': 'export function Uno() { return <div />; }',
    };
    const fileDeps: Record<string, string[]> = { 'components/Screens.tsx': ['components/Uno.tsx'] };
    const deps: ScreenMapDeps = {
      async listFiles() { return { paths: Object.keys(files), truncated: false }; },
      async readFile(p) { return files[p] ?? null; },
      async statFile() { return null; },
      fileDependencies(p) { return fileDeps[p] ?? []; },
      async headSha() { return 'sha-same'; },
      now() { return '2026-10-16T12:00:00.000Z'; },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    const a = map.screens.find((s) => s.name === 'A')!;
    // ScreenA dibuja <div />, por lo que usedFiles es []; cae al archivo entero y la cobertura lo dice.
    expect(a.files.map((f) => f.path)).toContain('components/Uno.tsx');
    expect(map.coverage.state).toBe('partial');
    if (map.coverage.state === 'partial') {
      expect(map.coverage.errors).toContain('Algunas vistas muestran todo el archivo que las declara: el índice no encontró su componente.');
    }
  });

  it('el mapa trae tags, primaryTag y stats (byRole y lastChangedAt con statFile falso), y cada archivo se lee una sola vez', async () => {
    const files: Record<string, string> = {
      'app/page.tsx': "import { FlowChart } from '@/components/FlowChart'; import { Nav } from '@/components/Nav';",
      'components/FlowChart.tsx': "import { ReactFlow } from '@xyflow/react';",
      'components/Nav.tsx': 'export function Nav() { return null; }',
    };

    const depsMap: Record<string, string[]> = {
      'app/page.tsx': ['components/FlowChart.tsx', 'components/Nav.tsx'],
      'components/FlowChart.tsx': [],
      'components/Nav.tsx': [],
    };

    const readFileSpy = vi.fn(async (p: string) => files[p] ?? null);
    const statFileSpy = vi.fn(async (p: string) => {
      if (p === 'components/FlowChart.tsx') return { mtimeMs: 1700000000000 };
      if (p === 'components/Nav.tsx') return { mtimeMs: 1600000000000 };
      if (p === 'app/page.tsx') return { mtimeMs: 1500000000000 };
      return null;
    });

    const deps: ScreenMapDeps = {
      async listFiles() {
        return { paths: Object.keys(files), truncated: false };
      },
      readFile: readFileSpy,
      statFile: statFileSpy,
      fileDependencies(p) {
        return depsMap[p] ?? [];
      },
      async headSha() {
        return 'sha-stats';
      },
      now() {
        return '2026-10-16T12:00:00.000Z';
      },
    };

    const map = await buildScreenMap('/mock/repo', deps);
    expect(map.screens).toHaveLength(1);
    const screen = map.screens[0];

    // Trae tags y primaryTag
    expect(screen.primaryTag).toBe('graphics');
    expect(screen.tags).toHaveLength(1);
    expect(screen.tags[0].tag).toBe('graphics');

    // Trae stats (byRole y lastChangedAt)
    expect(screen.stats).toBeDefined();
    expect(screen.stats.byRole.screen).toBe(1);
    expect(screen.stats.byRole.component).toBe(2);
    expect(screen.stats.lastChangedAt).toBe(new Date(1700000000000).toISOString());

    // Cada archivo se lee una sola vez
    const calls = readFileSpy.mock.calls.map((c) => c[0]);
    const uniqueCalls = new Set(calls);
    expect(calls.length).toBe(uniqueCalls.size);
  });

  describe('correcciones manuales en buildScreenMap', () => {
    const baseFiles: Record<string, string> = {
      'app/page.tsx': "import { Header } from '@/components/Header';",
      'components/Header.tsx': 'export function Header() { return <header />; }',
      'lib/extra.ts': 'export const extra = 42;',
    };
    const baseDepsMap: Record<string, string[]> = {
      'app/page.tsx': ['components/Header.tsx'],
      'components/Header.tsx': [],
      'lib/extra.ts': [],
    };

    const makeBaseDeps = (overrides?: Partial<ScreenMapDeps>): ScreenMapDeps => ({
      async listFiles() {
        return { paths: Object.keys(baseFiles), truncated: false };
      },
      async readFile(p) {
        return baseFiles[p] ?? null;
      },
      async statFile() {
        return null;
      },
      fileDependencies(p) {
        return baseDepsMap[p] ?? [];
      },
      async headSha() {
        return 'sha-manual';
      },
      now() {
        return '2026-10-20T12:00:00.000Z';
      },
      ...overrides,
    });

    it('un remove saca el vínculo y lo pone en removedByHand', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return {
            version: 1,
            links: [
              {
                screenId: 'route:/',
                path: 'components/Header.tsx',
                action: 'remove',
                createdAt: '2026-10-20T10:00:00Z',
              },
            ],
            descriptions: {},
          };
        },
      });

      const map = await buildScreenMap('/mock/repo', deps);
      const home = map.screens.find((s) => s.id === 'route:/')!;
      expect(home.files.some((f) => f.path === 'components/Header.tsx')).toBe(false);
      expect(home.removedByHand).toContain('components/Header.tsx');
    });

    it('un add de un archivo que existe entra como manual', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return {
            version: 1,
            links: [
              {
                screenId: 'route:/',
                path: 'lib/extra.ts',
                action: 'add',
                createdAt: '2026-10-20T10:00:00Z',
              },
            ],
            descriptions: {},
          };
        },
      });

      const map = await buildScreenMap('/mock/repo', deps);
      const home = map.screens.find((s) => s.id === 'route:/')!;
      const added = home.files.find((f) => f.path === 'lib/extra.ts')!;
      expect(added).toBeDefined();
      expect(added.provenance).toBe('manual');
      expect(added.role).toBe('logic');
    });

    it('un add de un archivo que no existe y una corrección de una pantalla que no existe van a pending sin reasignarse', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return {
            version: 1,
            links: [
              {
                screenId: 'route:/',
                path: 'lib/non-existent.ts',
                action: 'add',
                createdAt: '2026-10-20T10:00:00Z',
              },
              {
                screenId: 'route:/missing-screen',
                path: 'lib/extra.ts',
                action: 'add',
                createdAt: '2026-10-20T10:00:00Z',
              },
            ],
            descriptions: {
              'route:/other-missing': {
                text: 'Descripción huérfana',
                updatedAt: '2026-10-20T10:00:00Z',
              },
            },
          };
        },
      });

      const map = await buildScreenMap('/mock/repo', deps);
      expect(map.pending).toHaveLength(3);
      expect(map.pending).toContainEqual({
        kind: 'link',
        screenId: 'route:/',
        path: 'lib/non-existent.ts',
        reason: 'file-missing',
      });
      expect(map.pending).toContainEqual({
        kind: 'link',
        screenId: 'route:/missing-screen',
        path: 'lib/extra.ts',
        reason: 'screen-missing',
      });
      expect(map.pending).toContainEqual({
        kind: 'description',
        screenId: 'route:/other-missing',
        reason: 'screen-missing',
      });
    });

    it('la descripción a mano reemplaza y pone el nombre', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return {
            version: 1,
            links: [],
            descriptions: {
              'route:/': {
                text: 'Pantalla principal personalizada',
                name: 'Inicio Custom',
                updatedAt: '2026-10-20T10:00:00Z',
              },
            },
          };
        },
      });

      const map = await buildScreenMap('/mock/repo', deps);
      const home = map.screens.find((s) => s.id === 'route:/')!;
      expect(home.name).toBe('Inicio Custom');
      expect(home.description).toEqual({
        text: 'Pantalla principal personalizada',
        source: 'manual',
        citedFiles: [],
        createdAt: '2026-10-20T10:00:00Z',
      });
    });

    it('un archivo roto deja la cobertura partial y no aplica nada', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return null; // roto
        },
      });

      const map = await buildScreenMap('/mock/repo', deps);
      expect(map.coverage.state).toBe('partial');
      if (map.coverage.state === 'partial') {
        expect(map.coverage.errors).toContain(
          'El archivo .gitcron/pantallas.json tiene un error y no se pudo leer.',
        );
      }
      const home = map.screens.find((s) => s.id === 'route:/')!;
      expect(home.description).toBeNull();
      expect(home.removedByHand).toEqual([]);
    });

    it('releer el mapa conserva las correcciones: dos buildScreenMap seguidos dan lo mismo', async () => {
      const deps = makeBaseDeps({
        async readManual() {
          return {
            version: 1,
            links: [
              {
                screenId: 'route:/',
                path: 'lib/extra.ts',
                action: 'add',
                createdAt: '2026-10-20T10:00:00Z',
              },
            ],
            descriptions: {
              'route:/': {
                text: 'Descripción consistente',
                name: 'Home',
                updatedAt: '2026-10-20T10:00:00Z',
              },
            },
          };
        },
      });

      const map1 = await buildScreenMap('/mock/repo', deps);
      const map2 = await buildScreenMap('/mock/repo', deps);

      expect(map1.screens).toEqual(map2.screens);
      expect(map1.pending).toEqual(map2.pending);
      expect(map1.coverage).toEqual(map2.coverage);
    });
  });
});

