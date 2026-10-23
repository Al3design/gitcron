// electron/carto/screen-map/build.ts
//
// Construye el mapa de pantallas de un repositorio (tarea 1.4, base).
// Descubre pantallas con los detectores, recorre sus dependencias estáticas
// en el índice de CodeGraph (hasta 4 niveles y 200 archivos por pantalla),
// marca archivos compartidos y calcula la cobertura observable.
//
// Nunca ejecuta código del repositorio ni abre una aplicación externa.

import type {
  ManualScreenData,
  PendingManualEntry,
  ScreenEntry,
  ScreenFileLink,
  ScreenFileRole,
  ScreenMap,
  ScreenMapCoverage,
} from '../../../types/screen-map';
import {
  detectNextAppRouterScreens,
  detectNextPagesRouterScreens,
  type DetectedScreen,
} from './detect-next';
import { detectStateViews } from './detect-state-views';
import { roleOf } from './file-roles';
import { isExcluded } from './manual';
import { screenTags } from './screen-tags';

export interface ScreenMapDeps {
  listFiles(): Promise<{ paths: string[]; truncated: boolean }>;
  readFile(relPath: string): Promise<string | null>;
  statFile(relPath: string): Promise<{ mtimeMs: number } | null>;
  fileDependencies(relPath: string): string[] | null; // null = índice no listo
  headSha(): Promise<string | null>;
  now(): string;
  readManual?(): Promise<ManualScreenData | null>;
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

function isExcludedFileForScreen(filePath: string, screenEntryInElectron: boolean): boolean {
  const norm = filePath.replace(/\\/g, '/');
  // Archivos de prueba: __tests__/, .test., .spec., .e2e.
  if (norm.includes('__tests__/') || /\.(?:test|spec|e2e)\.[^/]+$/.test(norm)) {
    return true;
  }
  // scripts/
  if (norm.startsWith('scripts/') || norm.includes('/scripts/')) {
    return true;
  }
  // Proceso principal: si la entrada no está en electron/, nada de electron/
  if (!screenEntryInElectron && (norm.startsWith('electron/') || norm.includes('/electron/'))) {
    return true;
  }
  return false;
}

interface BuildContext {
  fileContentCache: Map<string, string | null>;
  statCache: Map<string, { mtimeMs: number } | null>;
  totalExclusions: number;
  totalUnresolved: number;
  indexNotReady: boolean;
  hasSymbolFallback: boolean;
  manualBroken: boolean;
}

interface ScanResult {
  scan: { paths: string[]; truncated: boolean };
  manualData: ManualScreenData | null | undefined;
  normalizedPaths: string[];
}

// 1. listar y excluir
async function scanAndExclude(deps: ScreenMapDeps): Promise<ScanResult> {
  const scan = await deps.listFiles();
  const manualData = deps.readManual ? await deps.readManual() : undefined;
  const excluded = manualData?.exclude;
  const normalizedPaths = scan.paths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => !isExcluded(p, excluded));
  return { scan, manualData, normalizedPaths };
}

interface DetectionResult {
  detectors: string[];
  detectedScreens: DetectedScreen[];
}

// 2. detectar pantallas (rutas y vistas)
async function detectScreens(
  normalizedPaths: string[],
  deps: ScreenMapDeps,
  ctx: BuildContext,
): Promise<DetectionResult> {
  const detectors: string[] = [];
  const appScreens = detectNextAppRouterScreens(normalizedPaths);
  const pagesScreens = detectNextPagesRouterScreens(normalizedPaths);

  if (appScreens.length > 0) detectors.push('next-app-router');
  if (pagesScreens.length > 0) detectors.push('next-pages-router');

  const uiCandidates = normalizedPaths.filter((p) => p.endsWith('.tsx') || p.endsWith('.jsx'));
  const stateViewInputFiles: { path: string; text: string }[] = [];

  for (const relPath of uiCandidates) {
    const content = await deps.readFile(relPath);
    ctx.fileContentCache.set(relPath, content);
    if (!content) continue;

    const byteLen = Buffer.byteLength(content, 'utf8');
    if (byteLen > MAX_READ_BYTES) {
      ctx.totalExclusions++;
      continue;
    }
    stateViewInputFiles.push({ path: relPath, text: content });
  }

  const stateScreens = detectStateViews(stateViewInputFiles, normalizedPaths);
  if (stateScreens.length > 0) {
    detectors.push('state-views');
  }

  const screensById = new Map<string, DetectedScreen>();
  for (const s of [...appScreens, ...pagesScreens, ...stateScreens]) {
    if (!screensById.has(s.id)) {
      screensById.set(s.id, s);
    }
  }
  return {
    detectors,
    detectedScreens: Array.from(screensById.values()),
  };
}

function addUsedFilesFromSymbol(
  usedFiles: string[],
  fileLinksMap: Map<string, ScreenFileLink>,
  visited: Set<string>,
  queue: { path: string; depth: number }[],
  viewChainFiles: Set<string>,
  ownChain: string | null,
  screenEntryInElectron: boolean,
): number {
  let screenExclusions = 0;
  for (const rawDep of usedFiles) {
    const depPath = rawDep.replace(/\\/g, '/');
    if (isExcludedFileForScreen(depPath, screenEntryInElectron)) {
      continue;
    }
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
      const isForeignChain = viewChainFiles.has(depPath) && depPath !== ownChain;
      if (!isForeignChain && 1 < MAX_DEPTH) {
        queue.push({ path: depPath, depth: 1 });
      }
    }
  }
  return screenExclusions;
}

function processStaticEntry(
  entry: DetectedScreen['entryFiles'][number],
  normEntryPath: string,
  fileLinksMap: Map<string, ScreenFileLink>,
  queue: { path: string; depth: number }[],
  visited: Set<string>,
  viewChainFiles: Set<string>,
  ownChain: string | null,
  screenEntryInElectron: boolean,
  ctx: BuildContext,
): number {
  visited.add(normEntryPath);
  if (!entry.symbol) {
    queue.push({ path: normEntryPath, depth: 0 });
    return 0;
  }

  const usedFiles = entry.usedFiles ?? [];
  if (usedFiles.length === 0) {
    ctx.hasSymbolFallback = true;
    queue.push({ path: normEntryPath, depth: 0 });
    return 0;
  }

  return addUsedFilesFromSymbol(
    usedFiles,
    fileLinksMap,
    visited,
    queue,
    viewChainFiles,
    ownChain,
    screenEntryInElectron,
  );
}

function addEntryFilesToLinks(
  ds: DetectedScreen,
  fileLinksMap: Map<string, ScreenFileLink>,
  queue: { path: string; depth: number }[],
  visited: Set<string>,
  viewChainFiles: Set<string>,
  ownChain: string | null,
  screenEntryInElectron: boolean,
  ctx: BuildContext,
): number {
  let screenExclusions = 0;
  for (const entry of ds.entryFiles) {
    const normEntryPath = entry.path.replace(/\\/g, '/');
    if (entry.provenance === 'unknown') {
      ctx.totalUnresolved++;
    }
    fileLinksMap.set(normEntryPath, {
      path: normEntryPath,
      role: entry.role,
      provenance: entry.provenance,
      shared: false,
    });

    if (entry.provenance === 'static') {
      screenExclusions += processStaticEntry(
        entry,
        normEntryPath,
        fileLinksMap,
        queue,
        visited,
        viewChainFiles,
        ownChain,
        screenEntryInElectron,
        ctx,
      );
    }
  }
  return screenExclusions;
}

function processDirectDeps(
  directDeps: string[],
  currentDepth: number,
  fileLinksMap: Map<string, ScreenFileLink>,
  visited: Set<string>,
  queue: { path: string; depth: number }[],
  excluded: string[] | undefined,
  viewChainFiles: Set<string>,
  ownChain: string | null,
  screenEntryInElectron: boolean,
): number {
  let screenExclusions = 0;
  for (const rawDep of directDeps) {
    const depPath = rawDep.replace(/\\/g, '/');
    if (isExcludedFileForScreen(depPath, screenEntryInElectron) || isExcluded(depPath, excluded)) {
      continue;
    }

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
      const isForeignChain = viewChainFiles.has(depPath) && depPath !== ownChain;
      if (!isForeignChain && currentDepth + 1 < MAX_DEPTH) {
        queue.push({ path: depPath, depth: currentDepth + 1 });
      }
    }
  }
  return screenExclusions;
}

function traverseDependenciesBfs(
  queue: { path: string; depth: number }[],
  fileLinksMap: Map<string, ScreenFileLink>,
  visited: Set<string>,
  deps: ScreenMapDeps,
  excluded: string[] | undefined,
  viewChainFiles: Set<string>,
  ownChain: string | null,
  screenEntryInElectron: boolean,
  ctx: BuildContext,
): number {
  let screenExclusions = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= MAX_DEPTH) continue;

    const directDeps = deps.fileDependencies(current.path);
    if (directDeps === null) {
      ctx.indexNotReady = true;
      continue;
    }

    screenExclusions += processDirectDeps(
      directDeps,
      current.depth,
      fileLinksMap,
      visited,
      queue,
      excluded,
      viewChainFiles,
      ownChain,
      screenEntryInElectron,
    );
  }
  return screenExclusions;
}

async function inspectDynamicImports(
  fileLinksMap: Map<string, ScreenFileLink>,
  screenEntryInElectron: boolean,
  deps: ScreenMapDeps,
  ctx: BuildContext,
): Promise<void> {
  for (const link of Array.from(fileLinksMap.values())) {
    if (link.provenance === 'unknown') continue;
    if (isExcludedFileForScreen(link.path, screenEntryInElectron)) continue;

    let fileText = ctx.fileContentCache.get(link.path);
    if (fileText === undefined) {
      fileText = await deps.readFile(link.path);
      ctx.fileContentCache.set(link.path, fileText);
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
          ctx.totalUnresolved++;
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
}

async function buildSingleScreenLinks(
  ds: DetectedScreen,
  deps: ScreenMapDeps,
  excluded: string[] | undefined,
  viewChainFiles: Set<string>,
  ctx: BuildContext,
): Promise<ScreenEntry> {
  const fileLinksMap = new Map<string, ScreenFileLink>();
  const ownChain = ds.kind === 'view' ? ds.declaredIn.replace(/\\/g, '/') : null;
  const screenEntryInElectron = ds.entryFiles.some((e) => e.path.replace(/\\/g, '/').startsWith('electron/'));

  const queue: { path: string; depth: number }[] = [];
  const visited = new Set<string>();

  const entryExclusions = addEntryFilesToLinks(
    ds,
    fileLinksMap,
    queue,
    visited,
    viewChainFiles,
    ownChain,
    screenEntryInElectron,
    ctx,
  );

  const bfsExclusions = traverseDependenciesBfs(
    queue,
    fileLinksMap,
    visited,
    deps,
    excluded,
    viewChainFiles,
    ownChain,
    screenEntryInElectron,
    ctx,
  );

  ctx.totalExclusions += entryExclusions + bfsExclusions;

  await inspectDynamicImports(fileLinksMap, screenEntryInElectron, deps, ctx);

  return {
    id: ds.id,
    kind: ds.kind,
    name: ds.name,
    locator: ds.locator,
    declaredIn: ds.declaredIn,
    files: Array.from(fileLinksMap.values()),
    description: null,
    tags: [],
    primaryTag: null,
    stats: { byRole: {}, lastChangedAt: null },
    removedByHand: [],
  };
}

// 3. armar los vínculos de cada pantalla (punto de entrada y recorrido de dependencias)
async function buildScreenLinks(
  detectedScreens: DetectedScreen[],
  deps: ScreenMapDeps,
  excluded: string[] | undefined,
  ctx: BuildContext,
): Promise<ScreenEntry[]> {
  const viewChainFiles = new Set(
    detectedScreens.filter((s) => s.kind === 'view').map((s) => s.declaredIn.replace(/\\/g, '/')),
  );

  const screens: ScreenEntry[] = [];
  for (const ds of detectedScreens) {
    screens.push(await buildSingleScreenLinks(ds, deps, excluded, viewChainFiles, ctx));
  }
  return screens;
}

function applyManualLinks(
  links: ManualScreenData['links'],
  screensById: Map<string, ScreenEntry>,
  repoFiles: Set<string>,
  pending: PendingManualEntry[],
): void {
  for (const link of links) {
    const screen = screensById.get(link.screenId);
    if (!screen) {
      pending.push({
        kind: 'link',
        screenId: link.screenId,
        path: link.path,
        reason: 'screen-missing',
      });
      continue;
    }

    if (link.action === 'remove') {
      screen.files = screen.files.filter((f) => f.path !== link.path);
      if (!screen.removedByHand) {
        screen.removedByHand = [];
      }
      if (!screen.removedByHand.includes(link.path)) {
        screen.removedByHand.push(link.path);
      }
    } else if (link.action === 'add') {
      if (repoFiles.has(link.path)) {
        if (!screen.files.some((f) => f.path === link.path)) {
          screen.files.push({
            path: link.path,
            role: roleOf(link.path),
            provenance: 'manual',
            shared: false,
          });
        }
      } else {
        pending.push({
          kind: 'link',
          screenId: link.screenId,
          path: link.path,
          reason: 'file-missing',
        });
      }
    }
  }
}

function applyManualDescriptions(
  descriptions: ManualScreenData['descriptions'],
  screensById: Map<string, ScreenEntry>,
  pending: PendingManualEntry[],
): void {
  for (const [screenId, desc] of Object.entries(descriptions)) {
    const screen = screensById.get(screenId);
    if (!screen) {
      pending.push({
        kind: 'description',
        screenId,
        reason: 'screen-missing',
      });
    } else {
      screen.description = {
        text: desc.text,
        source: 'manual',
        citedFiles: [],
        createdAt: desc.updatedAt,
      };
      if (desc.name) {
        screen.name = desc.name;
      }
    }
  }
}

// 4. aplicar correcciones a mano
function applyManualCorrections(
  screens: ScreenEntry[],
  manualData: ManualScreenData | null | undefined,
  normalizedPaths: string[],
  ctx: BuildContext,
): PendingManualEntry[] {
  const pending: PendingManualEntry[] = [];
  if (manualData === undefined) return pending;
  if (manualData === null) {
    ctx.manualBroken = true;
    return pending;
  }

  const repoFiles = new Set(normalizedPaths);
  const screensById = new Map(screens.map((s) => [s.id, s]));

  applyManualLinks(manualData.links, screensById, repoFiles, pending);
  applyManualDescriptions(manualData.descriptions, screensById, pending);

  return pending;
}

// 5. marcar compartidos
function markSharedFiles(screens: ScreenEntry[]): void {
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
}

async function ensureScreenFilesCached(
  screens: ScreenEntry[],
  deps: ScreenMapDeps,
  ctx: BuildContext,
): Promise<void> {
  for (const screen of screens) {
    for (const link of screen.files) {
      if (link.provenance !== 'unknown' && !ctx.fileContentCache.has(link.path)) {
        const text = await deps.readFile(link.path);
        ctx.fileContentCache.set(link.path, text);
      }
    }
  }
}

async function computeScreenStats(
  screen: ScreenEntry,
  deps: ScreenMapDeps,
  ctx: BuildContext,
): Promise<{ byRole: Partial<Record<ScreenFileRole, number>>; lastChangedAt: string | null }> {
  const byRole: Partial<Record<ScreenFileRole, number>> = {};
  let maxMtime: number | null = null;

  for (const link of screen.files) {
    byRole[link.role] = (byRole[link.role] ?? 0) + 1;

    if (link.provenance !== 'unknown') {
      let st = ctx.statCache.get(link.path);
      if (st === undefined) {
        st = await deps.statFile(link.path);
        ctx.statCache.set(link.path, st);
      }
      if (st && typeof st.mtimeMs === 'number') {
        if (maxMtime === null || st.mtimeMs > maxMtime) {
          maxMtime = st.mtimeMs;
        }
      }
    }
  }

  return {
    byRole,
    lastChangedAt: maxMtime !== null ? new Date(maxMtime).toISOString() : null,
  };
}

// 6. temas y estadísticas
async function computeThemesAndStats(
  screens: ScreenEntry[],
  deps: ScreenMapDeps,
  ctx: BuildContext,
): Promise<void> {
  await ensureScreenFilesCached(screens, deps, ctx);

  const contentOf = (p: string) => ctx.fileContentCache.get(p) ?? null;

  for (const screen of screens) {
    const { tags, primaryTag } = screenTags(screen.files, contentOf, screen.name);
    screen.tags = tags;
    screen.primaryTag = primaryTag;
    screen.stats = await computeScreenStats(screen, deps, ctx);
  }
}

// 7. cobertura
function computeCoverage(
  screens: ScreenEntry[],
  normalizedPaths: string[],
  scanTruncated: boolean,
  ctx: BuildContext,
): ScreenMapCoverage {
  const coverageErrors: string[] = [];
  if (ctx.indexNotReady) {
    coverageErrors.push('El índice de Cartografía todavía no está listo: faltan los archivos que usa cada pantalla.');
  }
  if (ctx.hasSymbolFallback) {
    coverageErrors.push('Algunas vistas muestran todo el archivo que las declara: el índice no encontró su componente.');
  }
  if (ctx.manualBroken) {
    coverageErrors.push('El archivo .gitcron/pantallas.json tiene un error y no se pudo leer.');
  }

  if (screens.length === 0) {
    const hasUI = normalizedPaths.some((p) => /\.(?:tsx|jsx|vue|svelte)$/i.test(p));
    return hasUI
      ? { state: 'unsupported', reason: 'unknown-stack' }
      : { state: 'unsupported', reason: 'no-ui' };
  }

  if (coverageErrors.length > 0 || ctx.totalUnresolved > 0 || ctx.totalExclusions > 0 || scanTruncated) {
    return {
      state: 'partial',
      unresolved: ctx.totalUnresolved,
      excluded: ctx.totalExclusions,
      errors: coverageErrors,
    };
  }

  return { state: 'complete' };
}

export async function buildScreenMap(repoPath: string, deps: ScreenMapDeps): Promise<ScreenMap> {
  const ctx: BuildContext = {
    fileContentCache: new Map(),
    statCache: new Map(),
    totalExclusions: 0,
    totalUnresolved: 0,
    indexNotReady: false,
    hasSymbolFallback: false,
    manualBroken: false,
  };

  // 1. listar y excluir
  const { scan, manualData, normalizedPaths } = await scanAndExclude(deps);

  // 2. detectar pantallas (rutas y vistas)
  const { detectors, detectedScreens } = await detectScreens(normalizedPaths, deps, ctx);

  // 3. armar los vínculos de cada pantalla (punto de entrada y recorrido de dependencias)
  const screens = await buildScreenLinks(detectedScreens, deps, manualData?.exclude, ctx);

  // 4. aplicar correcciones a mano
  const pending = applyManualCorrections(screens, manualData, normalizedPaths, ctx);

  // 5. marcar compartidos
  markSharedFiles(screens);

  // 6. temas y estadísticas
  await computeThemesAndStats(screens, deps, ctx);

  // 7. cobertura
  const coverage = computeCoverage(screens, normalizedPaths, scan.truncated, ctx);

  return {
    repoPath,
    headSha: await deps.headSha(),
    detectors,
    screens,
    coverage,
    pending,
    readAt: deps.now(),
  };
}
