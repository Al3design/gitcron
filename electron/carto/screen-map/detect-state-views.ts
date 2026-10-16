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
function extractImports(fileText: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(fileText)) !== null) {
    const clause = match[1].trim();
    const source = match[2].trim();

    // Import por omisión o con nombre: `import Foo, { Bar as Baz } from '...'`
    // Cláusula entre llaves `{ ... }`
    const braceMatch = /\{([\s\S]*?)\}/.exec(clause);
    if (braceMatch) {
      const insideBraces = braceMatch[1];
      const items = insideBraces.split(',').map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        // Ignorar `type Foo`
        if (item.startsWith('type ')) continue;
        const asParts = item.split(/\s+as\s+/);
        const local = (asParts[1] ?? asParts[0]).trim();
        if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
          bindings.push({ componentName: local, source });
        }
      }
    }

    // Parte fuera de llaves (import default o namespace)
    const beforeBrace = braceMatch ? clause.slice(0, braceMatch.index).trim().replace(/,$/, '').trim() : clause;
    if (beforeBrace) {
      const nsMatch = /\*\s+as\s+([a-zA-Z0-9_$]+)/.exec(beforeBrace);
      if (nsMatch) {
        const local = nsMatch[1].trim();
        if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
          bindings.push({ componentName: local, source });
        }
      } else {
        const defMatch = /^([a-zA-Z0-9_$]+)/.exec(beforeBrace);
        if (defMatch) {
          const local = defMatch[1].trim();
          if (/^[A-Z][a-zA-Z0-9_]*$/.test(local)) {
            bindings.push({ componentName: local, source });
          }
        }
      }
    }
  }

  return bindings;
}

const CANDIDATE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function resolveImportPath(
  declaringFile: string,
  source: string,
  knownPathsSet: Set<string>,
): string {
  let base: string;
  const declDir = path.posix.dirname(declaringFile.replace(/\\/g, '/'));

  if (source.startsWith('@/')) {
    base = source.slice(2);
  } else if (source.startsWith('./') || source.startsWith('../')) {
    base = path.posix.normalize(path.posix.join(declDir, source));
  } else {
    base = source;
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
    return [{ path: resolveImportPath(normPath, impSource, knownPathsSet), provenance: 'static', role: 'screen' }];
  }
  // Definido en el mismo archivo (en RepoMainView, HistoryTabView y CommitWorkspaceView).
  if (new RegExp(`(?:function|const|let|class)\\s+${componentName}\\b`).test(text)) {
    return [{ path: normPath, provenance: 'static', role: 'screen', symbol: componentName }];
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

    const text = file.text;
    const imports = extractImports(text);
    const importSourceByComponent = new Map<string, string>();
    for (const imp of imports) {
      if (!importSourceByComponent.has(imp.componentName)) {
        importSourceByComponent.set(imp.componentName, imp.source);
      }
    }

    const matches: EarlyReturnMatch[] = [];

    // Buscar condiciones if (...) seguidas a no más de 200 caracteres de <Componente
    const ifRegex = /if\s*\(([^)]+)\)/g;
    let ifMatch: RegExpExecArray | null;

    while ((ifMatch = ifRegex.exec(text)) !== null) {
      const cond = ifMatch[1].trim();
      const ifEndPos = ifRegex.lastIndex;

      // Evaluar la condición
      let kind: 'equality' | 'flag' | null = null;
      let variable: string | undefined;
      let value: string | undefined;
      let flag: string | undefined;

      const eqMatch = /^([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*===\s*['"]([^'"]+)['"]$/.exec(cond);
      if (eqMatch) {
        kind = 'equality';
        variable = eqMatch[1];
        value = eqMatch[2];
      } else {
        const flagMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*(?:Active|Open|Mode))$/.exec(cond);
        if (flagMatch) {
          kind = 'flag';
          flag = flagMatch[1];
        }
      }

      if (!kind) continue;

      // Mirar hasta 200 caracteres siguientes buscando `return ... <Componente`
      const lookahead = text.slice(ifEndPos, ifEndPos + 200);
      const returnCompMatch = /^[\s\r\n{]*return\s*(?:\(\s*)?<([A-Z][a-zA-Z0-9_]*)/.exec(lookahead);
      if (!returnCompMatch) continue;

      const componentName = returnCompMatch[1];
      matches.push({
        kind,
        variable,
        value,
        flag,
        componentName,
        index: ifEndPos,
      });
    }

    // Regla: si un archivo tiene 3 o más de estos retornos, es una cadena de vistas
    if (matches.length < 3) continue;

    // Procesar los retornos encontrados
    for (const m of matches) {
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

      screens.push({
        // El archivo va en el id: dos cadenas de vistas pueden usar la misma variable o valor.
        id: `view:${normPath}#${locator}`,
        kind: 'view',
        name,
        locator,
        declaredIn: normPath,
        entryFiles,
      });
    }

    // Buscar la vista por omisión: el último return <Componente que aparece después de esos retornos
    const lastMatchIndex = matches[matches.length - 1].index;
    // Solo hasta el cierre de la función (la primera llave al principio de una línea): más
    // allá hay otras funciones del archivo y su último return no es la vista por omisión.
    const afterChain = text.slice(lastMatchIndex);
    const functionEnd = afterChain.search(/\n\}/);
    const remainder = functionEnd === -1 ? afterChain : afterChain.slice(0, functionEnd);

    // Buscar el último `return ... <Componente` en el bloque siguiente
    const defaultRe = /return\s*(?:\(\s*)?<([A-Z][a-zA-Z0-9_]*)/g;
    let defMatch: RegExpExecArray | null;
    let lastDefaultComponent: string | null = null;

    while ((defMatch = defaultRe.exec(remainder)) !== null) {
      lastDefaultComponent = defMatch[1];
    }

    // Si la de omisión es una de las de la cadena, ya está: no se repite.
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
  }

  return screens;
}
