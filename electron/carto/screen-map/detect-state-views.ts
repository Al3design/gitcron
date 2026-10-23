// electron/carto/screen-map/detect-state-views.ts
//
// Detecta vistas sin dirección propia (por estado / early returns) como las que
// usa GitCron en RepoMainView (tarea 1.3, mapear-pantallas-y-su-codigo).
//
// La existencia de la vista es una deducción por regla: el detector trata la
// procedencia de la pantalla como inferred (el contrato ScreenEntry no tiene
// un campo de procedencia a nivel pantalla, pero sus archivos sí lo reflejan).
// Nunca ejecuta código del repositorio.

import * as path from 'node:path';
import type { DetectedScreen } from './detect-next';

export function formatValueName(val: string): string {
  // Separa camelCase, kebab-case y snake_case en palabras
  const spaced = val
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const words = spaced.split(/\s+/).filter(Boolean);
  if (words.length === 0) return val;
  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      return idx === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

export function formatFlagName(flag: string): string {
  const stripped = flag.replace(/(?:Active|Open|Mode)$/, '');
  if (!stripped) return flag;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function formatDefaultComponentName(componentName: string): string {
  const stripped = componentName.replace(/(?:TabView|View|Panel|Workspace|Page|StartScreen|Screen)$/, '');
  if (!stripped) return componentName;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

interface ImportBinding {
  componentName: string;
  source: string;
}
/**
 * Extrae los imports de componentes en el archivo para resolver de dónde provienen.
 */
function parseBracedNamedImports(insideBraces: string, source: string, bindings: ImportBinding[]): void {
  const items = insideBraces.split(',').map((s) => s.trim()).filter(Boolean);
  for (const item of items) {
    if (item.startsWith('type ')) continue;
    const asParts = item.split(/\s+as\s+/);
    const local = (asParts[1] ?? asParts[0]).trim();
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
      bindings.push({ componentName: local, source });
    }
  }
}

function parseDefaultOrNamespaceImport(beforeBrace: string, source: string, bindings: ImportBinding[]): void {
  if (!beforeBrace) return;
  const nsMatch = /\*\s+as\s+([a-zA-Z0-9_$]+)/.exec(beforeBrace);
  if (nsMatch) {
    const local = nsMatch[1].trim();
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
      bindings.push({ componentName: local, source });
    }
    return;
  }
  const defMatch = /^([a-zA-Z0-9_$]+)/.exec(beforeBrace);
  if (defMatch) {
    const local = defMatch[1].trim();
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
      bindings.push({ componentName: local, source });
    }
  }
}

function parseImportClause(clause: string, source: string, bindings: ImportBinding[]): void {
  const braceMatch = /\{([\s\S]*?)\}/.exec(clause);
  if (braceMatch) {
    parseBracedNamedImports(braceMatch[1], source, bindings);
  }
  const beforeBrace = braceMatch ? clause.slice(0, braceMatch.index).trim().replace(/,$/, '').trim() : clause;
  parseDefaultOrNamespaceImport(beforeBrace, source, bindings);
}

function extractImports(fileText: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(fileText)) !== null) {
    const clause = match[1].trim();
    const source = match[2].trim();
    parseImportClause(clause, source, bindings);
  }

  return bindings;
}

const CANDIDATE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function resolveImportPath(
  declaringFile: string,
  source: string,
  knownPathsSet: Set<string>,
): string | null {
  let base: string;
  const declDir = path.posix.dirname(declaringFile.replace(/\\/g, '/'));

  if (source.startsWith('@/')) {
    base = source.slice(2);
  } else if (source.startsWith('./') || source.startsWith('../')) {
    base = path.posix.normalize(path.posix.join(declDir, source));
  } else {
    // Un paquete externo (lucide-react, react…): no es un archivo del proyecto.
    return null;
  }

  // Si ya tiene extensión reconocida
  if (/\.(?:tsx|jsx|ts|js)$/.test(base)) {
    return base;
  }

  // Probar candidatos contra los archivos conocidos
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (knownPathsSet.has(candidate)) {
      return candidate;
    }
  }

  // Por omisión en proyectos React/TypeScript
  return `${base}.tsx`;
}

function extractComponentBody(componentName: string, text: string): string | null {
  const defRe = new RegExp(`(?:function\\s+${componentName}\\s*\\(|const\\s+${componentName}\\s*=)`);
  const match = defRe.exec(text);
  if (!match) return null;

  const afterMatch = text.slice(match.index);
  const lines = afterMatch.split(/\r?\n/);
  const bodyLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    bodyLines.push(lines[i]);
    if (i > 0 && /^\}\s*;?\s*$/.test(lines[i])) break;
  }
  return bodyLines.join('\n');
}

function collectFilesForJsxTag(
  tagName: string,
  normPath: string,
  text: string,
  importSourceByComponent: Map<string, string>,
  knownPathsSet: Set<string>,
  visited: Set<string>,
  seenFiles: Set<string>,
  usedFiles: string[],
): void {
  if (new RegExp(`(?:function|const|let|class)\\s+${tagName}\\b`).test(text)) {
    const inner = extractUsedFilesInComponent(tagName, normPath, text, importSourceByComponent, knownPathsSet, visited);
    for (const f of inner) {
      if (!seenFiles.has(f)) {
        seenFiles.add(f);
        usedFiles.push(f);
      }
    }
    return;
  }

  const impSource = importSourceByComponent.get(tagName);
  if (impSource) {
    const resolved = resolveImportPath(normPath, impSource, knownPathsSet);
    if (resolved && !seenFiles.has(resolved)) {
      seenFiles.add(resolved);
      usedFiles.push(resolved);
    }
  }
}

/**
 * Para un componente definido en el mismo archivo, busca su cuerpo y extrae
 * los archivos que usa según las etiquetas JSX que dibuja (<Componente />).
 */
function extractUsedFilesInComponent(
  componentName: string,
  normPath: string,
  text: string,
  importSourceByComponent: Map<string, string>,
  knownPathsSet: Set<string>,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(componentName)) return [];
  visited.add(componentName);

  const body = extractComponentBody(componentName, text);
  if (!body) return [];

  const jsxTagRe = /<([A-Z][a-zA-Z0-9_]*)/g;
  let tagMatch: RegExpExecArray | null;
  const seenTags = new Set<string>();
  const usedFiles: string[] = [];
  const seenFiles = new Set<string>();

  while ((tagMatch = jsxTagRe.exec(body)) !== null) {
    const tagName = tagMatch[1];
    if (seenTags.has(tagName)) continue;
    seenTags.add(tagName);
    collectFilesForJsxTag(tagName, normPath, text, importSourceByComponent, knownPathsSet, visited, seenFiles, usedFiles);
  }

  return usedFiles;
}

/** Archivo de un componente: por su import, o el mismo archivo si se define ahí; si no, desconocido. */
function entryFor(
  componentName: string,
  normPath: string,
  text: string,
  importSourceByComponent: Map<string, string>,
  knownPathsSet: Set<string>,
): DetectedScreen['entryFiles'] {
  const impSource = importSourceByComponent.get(componentName);
  if (impSource) {
    const resolved = resolveImportPath(normPath, impSource, knownPathsSet);
    return resolved
      ? [{ path: resolved, provenance: 'static', role: 'screen' }]
      : [{ path: componentName, provenance: 'unknown', role: 'screen' }];
  }
  if (new RegExp(`(?:function|const|let|class)\\s+${componentName}\\b`).test(text)) {
    const usedFiles = extractUsedFilesInComponent(
      componentName,
      normPath,
      text,
      importSourceByComponent,
      knownPathsSet,
    );
    return [{
      path: normPath,
      provenance: 'static',
      role: 'screen',
      symbol: componentName,
      usedFiles,
    }];
  }
  return [{ path: componentName, provenance: 'unknown', role: 'screen' }];
}

interface EarlyReturnMatch {
  kind: 'equality' | 'flag';
  variable?: string;
  value?: string;
  flag?: string;
  componentName: string;
  index: number;
}

function matchEarlyReturnCondition(cond: string): { kind: 'equality'; variable: string; value: string } | { kind: 'flag'; flag: string } | null {
  const eqMatch = /^([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*===\s*['"]([^'"]+)['"]$/.exec(cond);
  if (eqMatch) {
    return { kind: 'equality', variable: eqMatch[1], value: eqMatch[2] };
  }
  const flagMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*(?:Active|Open|Mode))$/.exec(cond);
  if (flagMatch) {
    return { kind: 'flag', flag: flagMatch[1] };
  }
  return null;
}

function findEarlyReturnMatches(text: string): EarlyReturnMatch[] {
  const matches: EarlyReturnMatch[] = [];
  const ifRegex = /if\s*\(([^)]+)\)/g;
  let ifMatch: RegExpExecArray | null;

  while ((ifMatch = ifRegex.exec(text)) !== null) {
    const cond = ifMatch[1].trim();
    const ifEndPos = ifRegex.lastIndex;

    const condition = matchEarlyReturnCondition(cond);
    if (!condition) continue;

    const lookahead = text.slice(ifEndPos, ifEndPos + 200);
    const returnCompMatch = /^[\s\r\n{]*return\s*(?:\(\s*)?<([A-Z][a-zA-Z0-9_]*)/.exec(lookahead);
    if (!returnCompMatch) continue;

    matches.push({
      ...condition,
      componentName: returnCompMatch[1],
      index: ifEndPos,
    });
  }
  return matches;
}

function findDefaultReturnComponent(text: string, lastMatchIndex: number): string | null {
  const afterChain = text.slice(lastMatchIndex);
  const functionEnd = afterChain.search(/\n\}/);
  const remainder = functionEnd === -1 ? afterChain : afterChain.slice(0, functionEnd);

  const defaultRe = /return\s*(?:\(\s*)?<([A-Z][a-zA-Z0-9_]*)/g;
  let defMatch: RegExpExecArray | null;
  let lastDefaultComponent: string | null = null;

  while ((defMatch = defaultRe.exec(remainder)) !== null) {
    lastDefaultComponent = defMatch[1];
  }
  return lastDefaultComponent;
}

function createViewFromEarlyReturn(
  m: EarlyReturnMatch,
  normPath: string,
  text: string,
  importSourceByComponent: Map<string, string>,
  knownPathsSet: Set<string>,
): DetectedScreen {
  let name: string;
  let locator: string;

  if (m.kind === 'equality') {
    name = formatValueName(m.value!);
    locator = `${m.variable}=${m.value}`;
  } else {
    name = formatFlagName(m.flag!);
    locator = m.flag!;
  }

  const entryFiles = entryFor(m.componentName, normPath, text, importSourceByComponent, knownPathsSet);

  return {
    id: `view:${normPath}#${locator}`,
    kind: 'view',
    name,
    locator,
    declaredIn: normPath,
    entryFiles,
  };
}

function detectFileStateViews(
  normPath: string,
  text: string,
  knownPathsSet: Set<string>,
): DetectedScreen[] {
  const imports = extractImports(text);
  const importSourceByComponent = new Map<string, string>();
  for (const imp of imports) {
    if (!importSourceByComponent.has(imp.componentName)) {
      importSourceByComponent.set(imp.componentName, imp.source);
    }
  }

  const matches = findEarlyReturnMatches(text);
  if (matches.length < 3) return [];

  const screens: DetectedScreen[] = [];
  for (const m of matches) {
    screens.push(createViewFromEarlyReturn(m, normPath, text, importSourceByComponent, knownPathsSet));
  }

  const lastDefaultComponent = findDefaultReturnComponent(text, matches[matches.length - 1].index);
  const chainComponents = new Set(matches.map((m) => m.componentName));
  if (lastDefaultComponent && !chainComponents.has(lastDefaultComponent)) {
    const defName = formatDefaultComponentName(lastDefaultComponent);
    const entryFiles = entryFor(lastDefaultComponent, normPath, text, importSourceByComponent, knownPathsSet);

    screens.push({
      id: `view:${normPath}#default`,
      kind: 'view',
      name: defName,
      locator: 'default',
      declaredIn: normPath,
      entryFiles,
    });
  }

  return screens;
}

/**
 * Detecta vistas elegidas por condiciones de estado y retornos tempranos.
 */
export function detectStateViews(
  files: { path: string; text: string }[],
  allPaths?: string[],
): DetectedScreen[] {
  const screens: DetectedScreen[] = [];
  const knownPathsSet = new Set<string>();

  if (allPaths) {
    for (const p of allPaths) knownPathsSet.add(p.replace(/\\/g, '/'));
  }
  for (const f of files) {
    knownPathsSet.add(f.path.replace(/\\/g, '/'));
  }

  for (const file of files) {
    const normPath = file.path.replace(/\\/g, '/');
    if (!normPath.endsWith('.tsx') && !normPath.endsWith('.jsx')) continue;
    screens.push(...detectFileStateViews(normPath, file.text, knownPathsSet));
  }

  return screens;
}
