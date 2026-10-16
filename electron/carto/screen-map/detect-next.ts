// electron/carto/screen-map/detect-next.ts
//
// Descubre pantallas por rutas de Next.js (App Router y Pages Router) solo
// a partir de las rutas relativas de los archivos, sin leer su contenido ni
// ejecutar el repositorio (tarea 1.2, mapear-pantallas-y-su-codigo).

import type { ScreenKind, ScreenLinkProvenance, ScreenFileRole } from '../../../types/screen-map';

export interface DetectedScreen {
  id: string; // `route:/settings` o `view:<variable>=<valor>` o `view:<variable>:default`
  kind: ScreenKind;
  name: string;
  locator: string;
  declaredIn: string;
  /** Archivos de entrada de la pantalla, con su procedencia y símbolo opcional si se resuelve al mismo archivo. */
  entryFiles: { path: string; provenance: ScreenLinkProvenance; role: ScreenFileRole; symbol?: string }[];
}

/**
 * Convierte una ruta en un nombre legible:
 * el último segmento con espacios y la primera en mayúscula.
 * `/ajustes/perfil` → «Perfil»; `/` → «Inicio»; `[id]` → «Detalle».
 */
export function formatRouteScreenName(route: string): string {
  const clean = route.replace(/^\/+|\/+$/g, '');
  if (!clean) return 'Inicio';

  const segments = clean.split('/');
  const last = segments[segments.length - 1];
  if (!last) return 'Inicio';

  if (/^\[.*\]$/.test(last)) {
    return 'Detalle';
  }

  const spaced = last.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return 'Inicio';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const PAGE_FILE_RE = /^(?:src\/)?app\/(?:(.+)\/)?page\.(?:tsx|jsx|ts|js)$/;
const APP_LAYOUT_EXTS = ['.tsx', '.jsx', '.ts', '.js'];

/**
 * Detecta pantallas del App Router de Next.js:
 * cada `(src/)?app/<carpetas>/page.{tsx,jsx,ts,js}` es una pantalla.
 * La ruta sale de las carpetas (los grupos `(algo)` no cuentan, `[id]` queda como `[id]`,
 * `app/page.tsx` es `/`).
 * `entryFiles`: el `page` (rol `screen`, `static`) y cada `layout.*` de la cadena de carpetas
 * hasta la raíz (rol `component`, `static`).
 */
export function detectNextAppRouterScreens(paths: string[]): DetectedScreen[] {
  const normalizedPaths = paths.map((p) => p.replace(/\\/g, '/'));
  const pathSet = new Set(normalizedPaths);
  const screens: DetectedScreen[] = [];

  for (const filePath of normalizedPaths) {
    const match = PAGE_FILE_RE.exec(filePath);
    if (!match) continue;

    const dirPart = match[1] ?? '';
    const rawSegments = dirPart ? dirPart.split('/') : [];
    const routeSegments = rawSegments.filter((seg) => !/^\(.*\)$/.test(seg));
    const route = routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;

    const appRoot = filePath.startsWith('src/app/') ? 'src/app' : 'app';
    const entryFiles: { path: string; provenance: ScreenLinkProvenance; role: ScreenFileRole }[] = [
      { path: filePath, provenance: 'static', role: 'screen' },
    ];

    // Cadena de carpetas desde la raíz de app hasta la carpeta del page
    const dirChain: string[] = [appRoot];
    let currentDir = appRoot;
    for (const seg of rawSegments) {
      currentDir = `${currentDir}/${seg}`;
      dirChain.push(currentDir);
    }

    for (const folder of dirChain) {
      for (const ext of APP_LAYOUT_EXTS) {
        const layoutCandidate = `${folder}/layout${ext}`;
        if (pathSet.has(layoutCandidate)) {
          entryFiles.push({
            path: layoutCandidate,
            provenance: 'static',
            role: 'component',
          });
          break;
        }
      }
    }

    screens.push({
      id: `route:${route}`,
      kind: 'route',
      name: formatRouteScreenName(route),
      locator: route,
      declaredIn: filePath,
      entryFiles,
    });
  }

  return screens;
}

const PAGES_FILE_RE = /^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js)$/;
const PAGES_EXCLUDED_ROOT_NAMES = new Set(['_app', '_document', '_error']);

/**
 * Detecta pantallas del Pages Router de Next.js:
 * cada `(src/)?pages/<carpetas>/<archivo>.{tsx,jsx,ts,js}`, salvo `_app`, `_document`, `_error`
 * y todo lo de `pages/api/`. `index` es la carpeta.
 * `_app.*` entra como `component` `static` en todas las pantallas.
 */
export function detectNextPagesRouterScreens(paths: string[]): DetectedScreen[] {
  const normalizedPaths = paths.map((p) => p.replace(/\\/g, '/'));
  const screens: DetectedScreen[] = [];

  // Buscar `_app` en pages o src/pages
  const appComponentPath = normalizedPaths.find((p) =>
    /^(?:src\/)?pages\/_app\.(?:tsx|jsx|ts|js)$/.test(p),
  );

  for (const filePath of normalizedPaths) {
    const match = PAGES_FILE_RE.exec(filePath);
    if (!match) continue;

    const insidePages = match[1];
    // Excluir api/
    if (insidePages.startsWith('api/') || insidePages === 'api') continue;

    const segments = insidePages.split('/');
    const fileNameWithoutExt = segments[segments.length - 1];

    // Excluir _app, _document, _error en la raíz de pages
    if (segments.length === 1 && PAGES_EXCLUDED_ROOT_NAMES.has(fileNameWithoutExt)) {
      continue;
    }

    // Ruta correspondiente
    let route: string;
    if (insidePages === 'index') {
      route = '/';
    } else if (insidePages.endsWith('/index')) {
      route = `/${insidePages.slice(0, -'/index'.length)}`;
    } else {
      route = `/${insidePages}`;
    }

    const entryFiles: { path: string; provenance: ScreenLinkProvenance; role: ScreenFileRole }[] = [
      { path: filePath, provenance: 'static', role: 'screen' },
    ];

    if (appComponentPath) {
      entryFiles.push({
        path: appComponentPath,
        provenance: 'static',
        role: 'component',
      });
    }

    screens.push({
      id: `route:${route}`,
      kind: 'route',
      name: formatRouteScreenName(route),
      locator: route,
      declaredIn: filePath,
      entryFiles,
    });
  }

  return screens;
}

/**
 * Detecta todas las pantallas de Next.js (App Router y Pages Router) ordenadas por ruta.
 */
export function detectNextScreens(paths: string[]): DetectedScreen[] {
  const appScreens = detectNextAppRouterScreens(paths);
  const pagesScreens = detectNextPagesRouterScreens(paths);

  const byId = new Map<string, DetectedScreen>();
  for (const screen of [...appScreens, ...pagesScreens]) {
    if (!byId.has(screen.id)) {
      byId.set(screen.id, screen);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.locator.localeCompare(b.locator));
}
