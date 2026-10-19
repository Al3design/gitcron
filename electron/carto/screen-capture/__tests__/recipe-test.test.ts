import { describe, expect, it } from 'vitest';
import { buildRecipeTest } from '../recipe-test';
import type { CaptureRecipes } from '../recipes';

describe('buildRecipeTest', () => {
  const dummyRecipes: CaptureRecipes = {
    version: 1,
    runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
    setup: [
      {
        evaluate: "async () => { await window.api.storageSet('activeRepoPath', '{{repoPath}}'); }",
      },
    ],
    screens: {
      'view:screen-1': {
        steps: [
          { click: { role: 'button', nameMatches: '^History' } },
          { waitFor: { testId: 'history-list' }, timeoutMs: 15000 },
        ],
      },
      'view:screen-2': {
        steps: [
          { click: { role: 'menuitem', name: 'Detalle con "comillas"' } },
          { waitFor: { text: 'Texto "especial"' } },
        ],
      },
    },
  };

  it('el código generado tiene un app.screenshot("cap-i") por pantalla y try/catch por pantalla', () => {
    const screens = [
      { id: 'view:screen-1', name: 'History' },
      { id: 'view:screen-2', name: 'Detalle' },
    ];
    const { code, shots } = buildRecipeTest(dummyRecipes, screens, 'C:/www/test-repo');

    expect(code).toContain('app.screenshot("cap-1")');
    expect(code).toContain('app.screenshot("cap-2")');

    const tryMatches = code.match(/try\s*\{/g);
    expect(tryMatches).toHaveLength(2);

    const catchMatches = code.match(/catch\s*\(err\)\s*\{/g);
    expect(catchMatches).toHaveLength(2);

    expect(shots).toEqual([
      { shot: 'cap-1', screenId: 'view:screen-1' },
      { shot: 'cap-2', screenId: 'view:screen-2' },
    ]);
  });

  it('{{repoPath}} reemplazado y escapado (una ruta con comilla simple no rompe el código)', () => {
    const screens = [{ id: 'view:screen-1', name: 'History' }];
    const repoWithQuotes = "C:\\repos\\user's-project";
    const { code } = buildRecipeTest(dummyRecipes, screens, repoWithQuotes);

    // Debe contener la ruta con comilla escapada \' y barras /
    expect(code).toContain("C:/repos/user\\'s-project");
  });

  it('nameMatches va como new RegExp(...)', () => {
    const screens = [{ id: 'view:screen-1', name: 'History' }];
    const { code } = buildRecipeTest(dummyRecipes, screens, 'C:/test');

    expect(code).toContain("new RegExp(\"^History\")");
  });

  it('los textos van con JSON.stringify', () => {
    const screens = [{ id: 'view:screen-2', name: 'Detalle' }];
    const { code } = buildRecipeTest(dummyRecipes, screens, 'C:/test');

    // Deben haberse escapado las comillas internas con JSON.stringify
    expect(code).toContain(JSON.stringify('Detalle con "comillas"'));
    expect(code).toContain(JSON.stringify('Texto "especial"'));
  });

  it('shots coincide con la lista de pantallas', () => {
    const screens = [
      { id: 'view:a', name: 'A' },
      { id: 'view:b', name: 'B' },
      { id: 'view:c', name: 'C' },
    ];
    const { shots } = buildRecipeTest(dummyRecipes, screens, 'C:/test');

    expect(shots).toEqual([
      { shot: 'cap-1', screenId: 'view:a' },
      { shot: 'cap-2', screenId: 'view:b' },
      { shot: 'cap-3', screenId: 'view:c' },
    ]);
  });

  it('ejecutado de verdad: una receta rota se anota y la prueba sigue con la siguiente pantalla', async () => {
    // Medido en la auditoría de carto-05d: el catch usaba una variable fuera de su alcance y la
    // primera receta rota cortaba la prueba entera. Acá se corre el código generado.
    const ts = await import('typescript');
    const { code } = buildRecipeTest(dummyRecipes, [
      { id: 'view:screen-1', name: 'Uno' },
      { id: 'view:screen-2', name: 'Dos' },
    ], 'C:/repos/x');
    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    let cuerpo: ((fx: unknown) => Promise<void>) | null = null;
    const fakeRequire = (mod: string) => mod === 'e2e'
      ? { expect: () => ({ toBeVisible: async () => undefined }) }
      : { test: (_n: string, _o: unknown, fn: (fx: unknown) => Promise<void>) => { cuerpo = fn; } };
    const logs: string[] = [];
    const fakeConsole = { log: (...a: unknown[]) => logs.push(a.map(String).join(' ')) };
    new Function('require', 'exports', 'console', 'setTimeout', js)(
      fakeRequire, {}, fakeConsole, (fn: () => void) => fn(),
    );

    const shots: string[] = [];
    let clicks = 0;
    const locator = { click: async () => { clicks++; if (clicks === 1) throw new Error('no está el botón'); } };
    await cuerpo!({
      app: { open: async () => undefined, screenshot: async (n: string) => { shots.push(n); } },
      browser: { evaluate: async () => undefined, reload: async () => undefined },
      screen: { getByRole: () => locator, getByTestId: () => locator, getByText: () => locator },
    });

    expect(logs.some((l) => l.includes('GITCRON_RECIPE_FAIL') && l.includes('view:screen-1') && l.includes('no está el botón'))).toBe(true);
    expect(shots).toEqual(['cap-2']);
    // Los avisos en vivo de cada pantalla, en orden (decisión 14).
    const marcas = logs.filter((l) => l.startsWith('GITCRON_RECIPE_')).map((l) => l.split(' ').slice(0, 2).join(' '));
    expect(marcas).toEqual([
      'GITCRON_RECIPE_START view:screen-1',
      'GITCRON_RECIPE_FAIL view:screen-1',
      'GITCRON_RECIPE_START view:screen-2',
      'GITCRON_RECIPE_DONE view:screen-2',
    ]);
  });
});