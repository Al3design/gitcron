import { describe, expect, it } from 'vitest';
import {
  clearDescription,
  clearLink,
  emptyManualData,
  readManualData,
  serializeManualData,
  setDescription,
  setLink,
  validateManualData,
  isExcluded,
} from '../manual';

describe('manual.ts - correcciones a mano en .gitcron/pantallas.json', () => {
  it('archivo ausente da datos vacíos', async () => {
    const res = await readManualData(async () => null);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual(emptyManualData());
      expect(res.data.version).toBe(1);
      expect(res.data.links).toEqual([]);
      expect(res.data.descriptions).toEqual({});
    }
  });

  it('validación rechaza ruta con .., texto vacío, nombre largo y action inválida con su motivo', () => {
    // 1. Ruta con ..
    const invalidPath = {
      version: 1,
      links: [{ screenId: 'view:settings', path: '../secret.ts', action: 'add', createdAt: '2026-10-20' }],
      descriptions: {},
    };
    const resPath = validateManualData(invalidPath);
    expect(resPath.ok).toBe(false);
    if (!resPath.ok) {
      expect(resPath.error).toMatch(/path debe ser una ruta relativa válida/i);
    }

    // 2. Texto vacío
    const invalidText = {
      version: 1,
      links: [],
      descriptions: {
        'view:settings': { text: '', updatedAt: '2026-10-20' },
      },
    };
    const resText = validateManualData(invalidText);
    expect(resText.ok).toBe(false);
    if (!resText.ok) {
      expect(resText.error).toMatch(/text debe tener entre 1 y 2000 caracteres/i);
    }

    // 3. Nombre largo (> 40 caracteres)
    const invalidName = {
      version: 1,
      links: [],
      descriptions: {
        'view:settings': {
          text: 'Descripción válida',
          name: 'Este es un nombre excesivamente largo que supera los cuarenta caracteres permitidos',
          updatedAt: '2026-10-20',
        },
      },
    };
    const resName = validateManualData(invalidName);
    expect(resName.ok).toBe(false);
    if (!resName.ok) {
      expect(resName.error).toMatch(/name no puede superar los 40 caracteres/i);
    }

    // 4. Action inválida
    const invalidAction = {
      version: 1,
      links: [{ screenId: 'view:settings', path: 'lib/store.ts', action: 'modify', createdAt: '2026-10-20' }],
      descriptions: {},
    };
    const resAction = validateManualData(invalidAction);
    expect(resAction.ok).toBe(false);
    if (!resAction.ok) {
      expect(resAction.error).toMatch(/action debe ser "add" o "remove"/i);
    }
  });

  it('setLink reemplaza el par pantalla-archivo anterior', () => {
    let data = emptyManualData();
    data = setLink(data, 'view:home', 'components/Nav.tsx', 'add', '2026-10-20T10:00:00Z');
    expect(data.links).toHaveLength(1);
    expect(data.links[0].action).toBe('add');

    // Mismo par, cambia action y fecha
    data = setLink(data, 'view:home', 'components/Nav.tsx', 'remove', '2026-10-20T11:00:00Z');
    expect(data.links).toHaveLength(1);
    expect(data.links[0].action).toBe('remove');
    expect(data.links[0].createdAt).toBe('2026-10-20T11:00:00Z');

    // Otro par
    data = setLink(data, 'view:home', 'components/Other.tsx', 'add', '2026-10-20T12:00:00Z');
    expect(data.links).toHaveLength(2);
  });

  it('serializeManualData devuelve null al quedar vacío y JSON con salto de línea si tiene datos', () => {
    const empty = emptyManualData();
    expect(serializeManualData(empty)).toBeNull();

    let data = setLink(empty, 'view:home', 'lib/a.ts', 'add', '2026-10-20T10:00:00Z');
    const serialized = serializeManualData(data);
    expect(serialized).not.toBeNull();
    expect(serialized?.endsWith('\n')).toBe(true);

    // Al limpiar vuelve a ser null
    data = clearLink(data, 'view:home', 'lib/a.ts');
    expect(serializeManualData(data)).toBeNull();

    // Con descripción
    data = setDescription(data, 'view:home', 'Mi pantalla', 'Inicio', '2026-10-20T10:00:00Z');
    expect(serializeManualData(data)).not.toBeNull();
    data = clearDescription(data, 'view:home');
    expect(serializeManualData(data)).toBeNull();
  });

  describe('exclude (decisión 17)', () => {
    const base = { version: 1, links: [], descriptions: {} };

    it('normaliza las carpetas válidas', () => {
      const res = validateManualData({ ...base, exclude: ['docs', 'scripts\\legacy/', './tmp'] });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.exclude).toEqual(['docs/', 'scripts/legacy/', 'tmp/']);
    });

    it('rechaza .., rutas absolutas y más de 100 carpetas', () => {
      expect(validateManualData({ ...base, exclude: ['../afuera'] }).ok).toBe(false);
      expect(validateManualData({ ...base, exclude: ['/abs'] }).ok).toBe(false);
      expect(validateManualData({ ...base, exclude: ['C:/abs'] }).ok).toBe(false);
      expect(validateManualData({ ...base, exclude: Array.from({ length: 101 }, (_, i) => `d${i}`) }).ok).toBe(false);
    });

    it('un archivo con solo exclude no se considera vacío', () => {
      expect(serializeManualData({ version: 1, links: [], descriptions: {}, exclude: ['docs/'] })).not.toBeNull();
    });

    it('isExcluded mira el comienzo de la ruta', () => {
      expect(isExcluded('docs/a.md', ['docs/'])).toBe(true);
      expect(isExcluded('docsite/a.md', ['docs/'])).toBe(false);
      expect(isExcluded('a/docs/b.md', ['docs/'])).toBe(false);
    });
  });
});