// electron/carto/screen-map/build.ts
//
// Construye el mapa de pantallas de un repositorio (tarea 1.4, base).
// Descubre pantallas con los detectores, recorre sus dependencias estáticas
// en el índice de CodeGraph (hasta 4 niveles y 200 archivos por pantalla),
// marca archivos compartidos y calcula la cobertura observable.
//
// Nunca ejecuta código del repositorio ni abre una aplicación externa.

import type {
  ScreenEntry,
  ScreenFileLink,
  ScreenMap,
  ScreenMapCoverage,
} from '../../../types/screen-map';
import {
  detectNextAppRouterScreens,
  detectNextPagesRouterScreens,
} from './detect-next';
import { detectStateViews } from './detect-state-views';
import { roleOf } from './file-roles';

export interface ScreenMapDeps {
  listFiles(): Promise<{ paths: string[]; truncated: boolean }>;
  readFile(relPath: string): Promise<string | null>;
  fileDependencies(relPath: string): string[] | null; // null = índice no listo
  symbolDependencies(relPath: string, symbolName: string): string[] | null;
  headSha(): Promise<string | null>;
  now(): string;
}

const MAX_DEPTH = 4;
const MAX_FILES_PER_SCREEN = 200;
const MAX_READ_BYTES = 400 * 1024; // 400 KB

function isStaticStringLiteral(expression: string): boolean {
  const trimmed = expression.trim();
  if (/^'[^']*'$/.test(trimmed)) return true;
  if (/^"[^"]*"$/.test(trimmed)) return true;
  // Template literal sin interpolación (${...})
  if (/^`[^`$]*`$/.test(trimmed)) return true;
  return false;
}

export async function buildScreenMap(repoPath: string, deps: ScreenMapDeps): Promise<ScreenMap> {
  const scan = await deps.listFiles();
  const normalizedPaths = scan.paths.map((p) => p.replace(/\\/g, '/'));

  const detectors: string[] = [];
  const appScreens = detectNextAppRouterScreens(normalizedPaths);
  const pagesScreens = detectNextPagesRouterScreens(normalizedPaths);

  if (appScreens.length > 0) detectors.push('next-app-router');
  if (pagesScreens.length > 0) detectors.push('next-pages-router');

  // Filtrar archivos UI (.tsx, .jsx) para el detector de vistas por estado
  const fileContentCache = new Map<string, string | null>();
  const uiCandidates = normalizedPaths.filter((p) => p.endsWith('.tsx') || p.endsWith('.jsx'));
  const stateViewInputFiles: { path: string; text: string }[] = [];
  let fileExclusionsCount = 0;

  for (const relPath of uiCandidates) {
    const content = await deps.readFile(relPath);
    fileContentCache.set(relPath, content);
    if (!content) continue;

    const byteLen = Buffer.byteLength(content, 'utf8');
    if (byteLen > MAX_READ_BYTES) {
      fileExclusionsCount++;
      continue;
    }

    stateViewInputFiles.push({ path: relPath, text: content });
  }

  const stateScreens = detectStateViews(stateViewInputFiles, normalizedPaths);
  if (stateScreens.length > 0) {
    detectors.push('state-views');
  }

  // Combinar pantallas detectadas (deduplicando por id si coincidiera alguno)
  const screensById = new Map<string, (typeof appScreens)[number]>();
  for (const s of [...appScreens, ...pagesScreens, ...stateScreens]) {
    if (!screensById.has(s.id)) {
      screensById.set(s.id, s);
    }
  }
  const detectedScreens = Array.from(screensById.values());

  // Archivos que declaran una cadena de vistas: el recorrido de otra pantalla no debe entrar en ellos
  const viewChainFiles = new Set(
    detectedScreens.filter((s) => s.kind === 'view').map((s) => s.declaredIn.replace(/\\/g, '/')),
  );

  let indexNotReady = false;
  let hasSymbolFallback = false;
  let totalExclusions = fileExclusionsCount;
  let totalUnresolved = 0;

  const screens: ScreenEntry[] = [];

  for (const ds of detectedScreens) {
    const fileLinksMap = new Map<string, ScreenFileLink>();
    let screenExclusions = 0;
    const ownChain = ds.kind === 'view' ? ds.declaredIn.replace(/\\/g, '/') : null;

    // 1. Agregar entryFiles conservando su rol y procedencia
    const queue: { path: string; depth: number }[] = [];
    const visited = new Set<string>();

    for (const entry of ds.entryFiles) {
      const normEntryPath = entry.path.replace(/\\/g, '/');
      if (entry.provenance === 'unknown') {
        totalUnresolved++;
      }
      fileLinksMap.set(normEntryPath, {
        path: normEntryPath,
        role: entry.role,
        provenance: entry.provenance,
        shared: false,
      });

      if (entry.provenance === 'static') {
        visited.add(normEntryPath);

        if (entry.symbol) {
          const symDeps = deps.symbolDependencies(normEntryPath, entry.symbol);
          if (symDeps === null) {
            hasSymbolFallback = true;
            queue.push({ path: normEntryPath, depth: 0 });
          } else {
            for (const rawDep of symDeps) {
              const depPath = rawDep.replace(/\\/g, '/');
              if (fileLinksMap.size >= MAX_FILES_PER_SCREEN) {
                screenExclusions++;
                continue;
              }

              if (!fileLinksMap.has(depPath)) {
                fileLinksMap.set(depPath, {
                  path: depPath,
                  role: roleOf(depPath),
                  provenance: 'static',
                  shared: false,
                });
              }

              if (!visited.has(depPath)) {
                visited.add(depPath);
                // Parada en las cadenas: no entrar en un archivo de otra cadena
                const isForeignChain = viewChainFiles.has(depPath) && depPath !== ownChain;
                if (!isForeignChain && 1 < MAX_DEPTH) {
                  queue.push({ path: depPath, depth: 1 });
                }
              }
            }
          }
        } else {
          queue.push({ path: normEntryPath, depth: 0 });
        }
      }
    }

    // 2. Recorrer dependencias BFS hasta 4 niveles y hasta 200 archivos por pantalla
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= MAX_DEPTH) continue;

      const directDeps = deps.fileDependencies(current.path);
      if (directDeps === null) {
        indexNotReady = true;
        continue;
      }

      for (const rawDep of directDeps) {
        const depPath = rawDep.replace(/\\/g, '/');

        if (fileLinksMap.size >= MAX_FILES_PER_SCREEN) {
          screenExclusions++;
          continue;
        }

        if (!fileLinksMap.has(depPath)) {
          fileLinksMap.set(depPath, {
            path: depPath,
            role: roleOf(depPath),
            provenance: 'static',
            shared: false,
          });
        }

        if (!visited.has(depPath)) {
          visited.add(depPath);
          // Parada en las cadenas: no entrar en un archivo que es declaredIn de una cadena de vistas, salvo la propia
          const isForeignChain = viewChainFiles.has(depPath) && depPath !== ownChain;
          if (!isForeignChain && current.depth + 1 < MAX_DEPTH) {
            queue.push({ path: depPath, depth: current.depth + 1 });
          }
        }
      }
    }

    totalExclusions += screenExclusions;

    // 3. Inspeccionar imports dinámicos en los archivos alcanzados
    for (const link of Array.from(fileLinksMap.values())) {
      if (link.provenance === 'unknown') continue;

      let fileText = fileContentCache.get(link.path);
      if (fileText === undefined) {
        fileText = await deps.readFile(link.path);
        fileContentCache.set(link.path, fileText);
      }
      if (!fileText) continue;

      const dynamicImportRe = /\bimport\s*\(([^)]+)\)/g;
      let dynMatch: RegExpExecArray | null;
      while ((dynMatch = dynamicImportRe.exec(fileText)) !== null) {
        const arg = dynMatch[1];
        if (!isStaticStringLiteral(arg)) {
          const rawMatch = dynMatch[0].trim();
          const fragment = rawMatch.slice(0, 80);
          const linkKey = `dynamic:${link.path}:${fragment}`;

          if (!fileLinksMap.has(linkKey)) {
            totalUnresolved++;
            fileLinksMap.set(linkKey, {
              path: fragment,
              role: 'other',
              provenance: 'unknown',
              shared: false,
              unresolved: fragment,
            });
          }
        }
      }
    }

    screens.push({
      id: ds.id,
      kind: ds.kind,
      name: ds.name,
      locator: ds.locator,
      declaredIn: ds.declaredIn,
      files: Array.from(fileLinksMap.values()),
      description: null,
    });
  }

  // 4. Calcular archivos compartidos (aparecen en 2 o más pantallas)
  const screenCountByPath = new Map<string, number>();
  for (const screen of screens) {
    for (const fileLink of screen.files) {
      screenCountByPath.set(fileLink.path, (screenCountByPath.get(fileLink.path) ?? 0) + 1);
    }
  }

  for (const screen of screens) {
    for (const fileLink of screen.files) {
      fileLink.shared = (screenCountByPath.get(fileLink.path) ?? 0) > 1;
    }
  }

  // 5. Determinar la cobertura
  const coverageErrors: string[] = [];
  if (indexNotReady) {
    coverageErrors.push('El índice de Cartografía todavía no está listo: faltan los archivos que usa cada pantalla.');
  }
  if (hasSymbolFallback) {
    coverageErrors.push('Algunas vistas muestran todo el archivo que las declara: el índice no encontró su componente.');
  }

  let coverage: ScreenMapCoverage;
  if (screens.length === 0) {
    const hasUI = normalizedPaths.some((p) => /\.(?:tsx|jsx|vue|svelte)$/i.test(p));
    coverage = hasUI
      ? { state: 'unsupported', reason: 'unknown-stack' }
      : { state: 'unsupported', reason: 'no-ui' };
  } else if (coverageErrors.length > 0 || totalUnresolved > 0 || totalExclusions > 0 || scan.truncated) {
    coverage = {
      state: 'partial',
      unresolved: totalUnresolved,
      excluded: totalExclusions,
      errors: coverageErrors,
    };
  } else {
    coverage = { state: 'complete' };
  }

  return {
    repoPath,
    headSha: await deps.headSha(),
    detectors,
    screens,
    coverage,
    readAt: deps.now(),
  };
}
