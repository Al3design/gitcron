import { describe, expect, it } from 'vitest';
import {
  detectNextScreens,
  detectNextAppRouterScreens,
  detectNextPagesRouterScreens,
  formatRouteScreenName,
} from '../detect-next';

describe('detect-next', () => {
  it('formatea nombres de ruta legibles (/ -> Inicio, [id] -> Detalle, segmentos con mayúscula)', () => {
    expect(formatRouteScreenName('/')).toBe('Inicio');
    expect(formatRouteScreenName('')).toBe('Inicio');
    expect(formatRouteScreenName('/ajustes/perfil')).toBe('Perfil');
    expect(formatRouteScreenName('/users/[id]')).toBe('Detalle');
    expect(formatRouteScreenName('/dashboard/user-settings')).toBe('User settings');
  });

  it('detecta App Router con grupo (marketing), [id] y layouts heredados según la jerarquía', () => {
    const paths = [
      'app/layout.tsx', // Layout raíz
      'app/page.tsx', // Página /
      'app/(marketing)/layout.tsx', // Layout de grupo
      'app/(marketing)/about/page.tsx', // Página /about
      'app/users/page.tsx', // Página /users
      'app/users/[id]/page.tsx', // Página /users/[id]
    ];

    const screens = detectNextAppRouterScreens(paths);
    expect(screens).toHaveLength(4);

    // Página de inicio (/)
    const home = screens.find((s) => s.locator === '/');
    expect(home).toBeDefined();
    expect(home?.name).toBe('Inicio');
    expect(home?.declaredIn).toBe('app/page.tsx');
    expect(home?.entryFiles).toEqual([
      { path: 'app/page.tsx', provenance: 'static', role: 'screen' },
      { path: 'app/layout.tsx', provenance: 'static', role: 'component' },
    ]);

    // Página /about (dentro del grupo marketing)
    const about = screens.find((s) => s.locator === '/about');
    expect(about).toBeDefined();
    expect(about?.name).toBe('About');
    expect(about?.declaredIn).toBe('app/(marketing)/about/page.tsx');
    // Tiene layout raíz Y layout de (marketing)
    expect(about?.entryFiles).toEqual([
      { path: 'app/(marketing)/about/page.tsx', provenance: 'static', role: 'screen' },
      { path: 'app/layout.tsx', provenance: 'static', role: 'component' },
      { path: 'app/(marketing)/layout.tsx', provenance: 'static', role: 'component' },
    ]);

    // Página /users/[id]
    const userDetail = screens.find((s) => s.locator === '/users/[id]');
    expect(userDetail).toBeDefined();
    expect(userDetail?.name).toBe('Detalle');
    expect(userDetail?.id).toBe('route:/users/[id]');
    // Tiene layout raíz, pero NO el de (marketing)
    expect(userDetail?.entryFiles).toEqual([
      { path: 'app/users/[id]/page.tsx', provenance: 'static', role: 'screen' },
      { path: 'app/layout.tsx', provenance: 'static', role: 'component' },
    ]);
  });

  it('detecta Pages Router sin _document, _error ni api/, incluyendo _app en todas las páginas', () => {
    const paths = [
      'pages/_app.tsx',
      'pages/_document.tsx',
      'pages/_error.tsx',
      'pages/index.tsx',
      'pages/settings.tsx',
      'pages/api/hello.ts',
      'pages/api/auth/[...nextauth].ts',
      'pages/blog/[slug].tsx',
    ];

    const screens = detectNextPagesRouterScreens(paths);
    expect(screens).toHaveLength(3);

    const locators = screens.map((s) => s.locator).sort();
    expect(locators).toEqual(['/', '/blog/[slug]', '/settings']);

    const settings = screens.find((s) => s.locator === '/settings');
    expect(settings).toBeDefined();
    expect(settings?.name).toBe('Settings');
    expect(settings?.entryFiles).toEqual([
      { path: 'pages/settings.tsx', provenance: 'static', role: 'screen' },
      { path: 'pages/_app.tsx', provenance: 'static', role: 'component' },
    ]);
  });

  it('detectNextScreens combina y ordena por ruta', () => {
    const paths = [
      'app/page.tsx',
      'app/settings/page.tsx',
      'app/about/page.tsx',
    ];

    const screens = detectNextScreens(paths);
    expect(screens.map((s) => s.locator)).toEqual(['/', '/about', '/settings']);
  });
});
