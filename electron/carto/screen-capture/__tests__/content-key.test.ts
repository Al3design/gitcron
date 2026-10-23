import { describe, expect, it } from 'vitest';
import { screenContentKey } from '../content-key';
import type { ScreenEntry } from '../../../../types/screen-map';

describe('screenContentKey', () => {
  const baseScreen: ScreenEntry = {
    id: 'route:/home',
    kind: 'route',
    name: 'Home',
    locator: '/home',
    declaredIn: 'app/home/page.tsx',
    description: null,
    files: [
      { path: 'app/home/page.tsx', role: 'screen', provenance: 'static', shared: false },
      { path: 'components/Header.tsx', role: 'component', provenance: 'static', shared: true },
    ],
    tags: [],
    primaryTag: null,
    stats: { byRole: {}, lastChangedAt: null },
  };

  const statMap: Record<string, { size: number; mtimeMs: number } | null> = {
    'app/home/page.tsx': { size: 1024, mtimeMs: 1700000000000 },
    'components/Header.tsx': { size: 512, mtimeMs: 1700000001000 },
  };

  it('cambia si cambia el tamaño de un archivo', async () => {
    const key1 = await screenContentKey(baseScreen, async (p) => statMap[p] ?? null);

    const changedStatMap: Record<string, { size: number; mtimeMs: number } | null> = {
      ...statMap,
      'app/home/page.tsx': { size: 1050, mtimeMs: 1700000000000 },
    };
    const key2 = await screenContentKey(baseScreen, async (p) => changedStatMap[p] ?? null);

    expect(key1).not.toBe(key2);
  });

  it('cambia si cambia la fecha de modificación de un archivo', async () => {
    const key1 = await screenContentKey(baseScreen, async (p) => statMap[p] ?? null);

    const changedStatMap: Record<string, { size: number; mtimeMs: number } | null> = {
      ...statMap,
      'components/Header.tsx': { size: 512, mtimeMs: 1700000099000 },
    };
    const key2 = await screenContentKey(baseScreen, async (p) => changedStatMap[p] ?? null);

    expect(key1).not.toBe(key2);
  });

  it('ignora los archivos con procedencia unknown', async () => {
    const keyWithoutUnknown = await screenContentKey(baseScreen, async (p) => statMap[p] ?? null);

    const screenWithUnknown: ScreenEntry = {
      ...baseScreen,
      files: [
        ...baseScreen.files,
        {
          path: 'lib/dynamic-import.ts',
          role: 'logic',
          provenance: 'unknown',
          shared: false,
          unresolved: 'import(`./${x}`)',
        },
      ],
    };
    const keyWithUnknown = await screenContentKey(screenWithUnknown, async (p) => statMap[p] ?? null);

    expect(keyWithUnknown).toBe(keyWithoutUnknown);
  });

  it('el orden de los archivos no altera la clave generada', async () => {
    const screen1 = baseScreen;
    const screen2: ScreenEntry = {
      ...baseScreen,
      files: [
        { path: 'components/Header.tsx', role: 'component', provenance: 'static', shared: true },
        { path: 'app/home/page.tsx', role: 'screen', provenance: 'static', shared: false },
      ],
    };

    const key1 = await screenContentKey(screen1, async (p) => statMap[p] ?? null);
    const key2 = await screenContentKey(screen2, async (p) => statMap[p] ?? null);

    expect(key1).toBe(key2);
  });
});
