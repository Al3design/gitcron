import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readRecipes, RECIPES_PATH } from '../recipes';

describe('readRecipes', () => {
  it('el .gitcron/capturas.json real del repo es válido', async () => {
    const realRoot = path.resolve(__dirname, '../../../../');
    const result = await readRecipes(async (rel) => {
      try {
        return await fs.readFile(path.join(realRoot, rel), 'utf8');
      } catch {
        return null;
      }
    });

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    if (result && result.ok) {
      expect(result.recipes.version).toBe(1);
      expect(result.recipes.runner.kind).toBe('e2e');
      expect(result.recipes.runner.config).toBe('e2e/e2e.config.ts');
      expect(result.recipes.setup.length).toBeGreaterThan(0);
      expect(Object.keys(result.recipes.screens).length).toBeGreaterThan(0);
    }
  });

  it('archivo ausente devuelve null', async () => {
    const result = await readRecipes(async () => null);
    expect(result).toBeNull();
  });

  it('un paso con dos claves da error con la pantalla y el paso', async () => {
    const invalidJson = JSON.stringify({
      version: 1,
      runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
      setup: [],
      screens: {
        'view:test-screen': {
          steps: [
            { pause: 1000 },
            { click: { role: 'button', name: 'OK' }, pause: 500 },
          ],
        },
      },
    });

    const result = await readRecipes(async (rel) => (rel === RECIPES_PATH ? invalidJson : null));
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error).toMatch(/view:test-screen/i);
      expect(result.error).toMatch(/paso 2/i);
    }
  });

  it('un pause fuera de rango da error con la pantalla y el paso', async () => {
    const invalidJson = JSON.stringify({
      version: 1,
      runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
      setup: [],
      screens: {
        'view:graph': {
          steps: [{ pause: 40000 }],
        },
      },
    });

    const result = await readRecipes(async (rel) => (rel === RECIPES_PATH ? invalidJson : null));
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error).toMatch(/view:graph/i);
      expect(result.error).toMatch(/paso 1/i);
      expect(result.error).toMatch(/pause/i);
    }
  });

  it('un runner.config con .. da error', async () => {
    const invalidJson = JSON.stringify({
      version: 1,
      runner: { kind: 'e2e', config: '../e2e.config.ts', testsDir: 'e2e/tests' },
      setup: [],
      screens: {},
    });

    const result = await readRecipes(async (rel) => (rel === RECIPES_PATH ? invalidJson : null));
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error).toMatch(/runner\.config/i);
      expect(result.error).toMatch(/relativa/i);
    }
  });
});
