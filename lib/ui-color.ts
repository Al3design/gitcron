import fs from 'node:fs';
import path from 'node:path';

export interface OffPaletteDeclaration {
  line: number;
  value: string;
  raw: string;
  source: 'css' | 'tailwind' | 'js-constant-hex' | 'js-constant-func' | 'fallback-literal' | 'dangling-token';
}

export interface BaselineRecord {
  [filePath: string]: {
    [colorValue: string]: number;
  };
}

export interface BaselineFileStructure {
  exento?: BaselineRecord;
  pendiente?: BaselineRecord;
  [key: string]: any;
}

export interface BaselineComparisonResult {
  passed: boolean;
  newViolations: Array<{ file: string; value: string; count: number }>;
  increasedViolations: Array<{ file: string; value: string; actual: number; expected: number }>;
  missingViolations: Array<{ file: string; value: string; actual: number; expected: number }>;
  errorMessage?: string;
}

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_PATTERN = /^(?:rgba?|hsla?|hwb|oklch|oklab)\s*\([^)]*\)$/i;

const HEX_REGEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNC_COLOR_REGEX = /(?:rgba?|hsla?|hwb|oklch|oklab)\s*\([^)]*\)/gi;

const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'purple', 'gray', 'grey',
  'cyan', 'magenta', 'lime', 'orange', 'pink', 'teal', 'indigo', 'violet',
  'brown', 'amber', 'emerald', 'sky', 'rose', 'slate', 'zinc', 'neutral', 'stone'
]);

// Palabras clave y valores válidos de CSS que no son colores literales fuera de paleta
const ALLOWED_CSS_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'none'
]);

/**
 * Retorna el conjunto canónico de tokens CSS declarados en la aplicación
 * (globales de app/globals.css y variables dinámicas del sistema).
 */
export function getDeclaredTokens(globalsCssContent?: string): Set<string> {
  const tokens = new Set<string>();

  // Tokens estándar canónicos
  const canonical = [
    '--color-bg-base', '--color-bg-surface', '--color-bg-overlay',
    '--color-border-subtle',
    '--color-text-primary', '--color-text-secondary',
    '--color-primary', '--color-secondary',
    '--color-error', '--color-warning',
    '--color-git-add', '--color-git-delete', '--color-git-mod',
    '--color-accent-purple',
    '--color-ai', '--color-ai-violet', '--color-ai-blue', '--color-ai-teal', '--color-ai-rose',
    '--ai-gradient',
    '--font-size-xs', '--font-size-sm', '--font-size-base', '--font-size-md',
    '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl',
    '--font-sans', '--font-mono',
    '--radius-sm', '--radius-default', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl', '--radius-full',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12', '--space-16',
    '--focus-ring', '--focus-offset', '--sdd-body-width', '--sdd-body-gutter',
    '--spacing-panel-gap', '--spacing-container-padding', '--spacing-element-gap', '--spacing-list-item-y',
    '--opacity-glass-bg', '--opacity-glass-header', '--opacity-glass-sticky',
    '--backdrop-blur-glass-md', '--backdrop-blur-glass-xl',
    '--color-graph-branch-1', '--color-graph-branch-2', '--color-graph-branch-3', '--color-graph-branch-4', '--color-graph-branch-5',
    '--color-carto-canvas', '--color-carto-grid', '--color-carto-text', '--color-carto-text-muted',
    '--color-carto-accent', '--color-carto-link', '--color-carto-link-active', '--color-carto-dir',
    '--color-carto-file', '--color-carto-role',
    // Dynamic runtime variables
    '--carto-role-color', '--carto-role-bg',
    '--path-count', '--path-progress',
    '--lane-color', '--branch-color', '--bg-current-branch',
    '--index', '--level', '--depth'
  ];

  for (const t of canonical) {
    tokens.add(t);
  }

  let cssText = globalsCssContent;
  if (!cssText) {
    try {
      const gPath = path.resolve(process.cwd(), 'app/globals.css');
      if (fs.existsSync(gPath)) {
        cssText = fs.readFileSync(gPath, 'utf-8');
      }
    } catch {
      // ignore
    }
  }

  if (cssText) {
    const varDefRegex = /(--[a-zA-Z0-9_-]+)\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = varDefRegex.exec(cssText)) !== null) {
      tokens.add(m[1]);
    }
  }

  return tokens;
}

/**
 * Elimina comentarios conservando los saltos de línea para que los números de línea coincidan.
 */
export function stripCommentsPreservingLines(code: string): string {
  let result = '';
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        result += '  ';
        i += 2;
        continue;
      }
      result += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (c === '/' && next === '*') {
      inBlockComment = true;
      result += '  ';
      i += 2;
      continue;
    }

    if (c === '/' && next === '/') {
      inLineComment = true;
      result += '  ';
      i += 2;
      continue;
    }

    result += c;
    i++;
  }

  return result;
}

const VAR_USAGE_REGEX = /var\s*\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/g;
const TW_BRACKET_REGEX = /(?:[a-zA-Z0-9_\-\:\[\]\.]+:)?(?:text|bg|border|border-[trblxyse]|fill|stroke|ring|outline|shadow|accent|caret|decoration|from|to|via|divide|divide-[xy])-\[([^\]]+)\](?:\/[^\s"'`]+)?/g;

/**
 * Función pura que analiza el texto de un archivo (CSS o TSX) y devuelve
 * TODAS las apariciones de colores literales declarados que no provienen de un token de la paleta.
 *
 * DETECTA:
 * 1. Declaraciones CSS con literales (#hex, rgba, etc.) fuera de @theme.
 * 2. Clases Tailwind con corchetes que contengan literales (#hex, rgba, named colors, funciones de color compuestas).
 * 3. Hex y funciones de color en constantes, objetos JS, atributos style o funciones compuestas (`border: '1px solid #...'`).
 * 4. Respaldos literales en `var(--token, #literal)` o `var(--token, rgba(...))`.
 * 5. Referencias a tokens que no existen (`var(--token-inexistente)`).
 */
export function findOffPaletteDeclarations(
  fileContent: string,
  options: { isTsx?: boolean; isGlobalsCss?: boolean; declaredTokens?: Set<string> } = {}
): OffPaletteDeclaration[] {
  const violations: OffPaletteDeclaration[] = [];
  let content = fileContent;

  const validTokens = options.declaredTokens || getDeclaredTokens();

  // Si el archivo declara tokens locales (como OpenSpecDashboard.module.css), agregarlos
  const localTokens = new Set<string>();
  const localDefRegex = /(--[a-zA-Z0-9_-]+)\s*:/g;
  let lm: RegExpExecArray | null;
  while ((lm = localDefRegex.exec(content)) !== null) {
    localTokens.add(lm[1]);
  }

  // Si es globals.css, el bloque @theme define los tokens oficiales: se omiten sus definiciones
  if (options.isGlobalsCss) {
    const themeIdx = content.indexOf('@theme');
    if (themeIdx !== -1) {
      let braceDepth = 0;
      let endTheme = -1;
      for (let i = themeIdx; i < content.length; i++) {
        if (content[i] === '{') braceDepth++;
        else if (content[i] === '}') {
          braceDepth--;
          if (braceDepth === 0) {
            endTheme = i + 1;
            break;
          }
        }
      }
      if (endTheme !== -1) {
        content = content.slice(0, themeIdx) + content.slice(themeIdx, endTheme).replace(/[^\n]/g, ' ') + content.slice(endTheme);
      }
    }
  }

  const clean = stripCommentsPreservingLines(content);
  const lines = clean.split('\n');

  // Detección en CSS (o si no es explícitamente TSX)
  const isTsx = options.isTsx ?? (content.includes('import React') || content.includes('className=') || content.includes('export default') || content.includes('<div') || content.includes('<span') || content.includes('function ') || content.includes('const '));

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('@import')) continue;

    // 1. Verificación de var(...) para respaldos literales y tokens colgados
    let vm: RegExpExecArray | null;
    VAR_USAGE_REGEX.lastIndex = 0;
    while ((vm = VAR_USAGE_REGEX.exec(line)) !== null) {
      const tokenName = vm[1];
      const fallback = vm[2]?.trim();

      // (c) Referencia a token no declarado
      const isVendorOrAllowed = tokenName.startsWith('--xy-') || tokenName.startsWith('--radix-') || tokenName.startsWith('--tw-');
      if (!validTokens.has(tokenName) && !localTokens.has(tokenName) && !isVendorOrAllowed) {
        violations.push({
          line: lineIndex + 1,
          value: tokenName,
          raw: vm[0],
          source: 'dangling-token',
        });
      }

      // (b) Respaldo literal de color en var(...)
      if (fallback) {
        let fhm: RegExpExecArray | null;
        HEX_REGEX.lastIndex = 0;
        let foundFallbackColor = false;
        while ((fhm = HEX_REGEX.exec(fallback)) !== null) {
          violations.push({
            line: lineIndex + 1,
            value: fhm[0],
            raw: vm[0],
            source: 'fallback-literal',
          });
          foundFallbackColor = true;
        }

        let ffm: RegExpExecArray | null;
        FUNC_COLOR_REGEX.lastIndex = 0;
        while ((ffm = FUNC_COLOR_REGEX.exec(fallback)) !== null) {
          violations.push({
            line: lineIndex + 1,
            value: ffm[0],
            raw: vm[0],
            source: 'fallback-literal',
          });
          foundFallbackColor = true;
        }

        if (!foundFallbackColor && NAMED_COLORS.has(fallback.toLowerCase()) && !ALLOWED_CSS_KEYWORDS.has(fallback.toLowerCase())) {
          violations.push({
            line: lineIndex + 1,
            value: fallback.toLowerCase(),
            raw: vm[0],
            source: 'fallback-literal',
          });
        }
      }
    }

    if (!isTsx) {
      // 2. CSS: toda aparición de #hex o funciones de color fuera de var(...)
      const lineWithoutVars = line.replace(VAR_USAGE_REGEX, (m) => ' '.repeat(m.length));

      let m: RegExpExecArray | null;
      HEX_REGEX.lastIndex = 0;
      while ((m = HEX_REGEX.exec(lineWithoutVars)) !== null) {
        violations.push({
          line: lineIndex + 1,
          value: m[0],
          raw: m[0],
          source: 'css',
        });
      }

      FUNC_COLOR_REGEX.lastIndex = 0;
      while ((m = FUNC_COLOR_REGEX.exec(lineWithoutVars)) !== null) {
        violations.push({
          line: lineIndex + 1,
          value: m[0],
          raw: m[0],
          source: 'css',
        });
      }
    } else {
      // 3. TSX:
      // A. Clases de utilidad Tailwind con corchetes: captura toda aparición de color dentro del corchete
      let tm: RegExpExecArray | null;
      TW_BRACKET_REGEX.lastIndex = 0;
      while ((tm = TW_BRACKET_REGEX.exec(line)) !== null) {
        const bracketContent = tm[1].trim();
        let foundBracketColor = false;

        let bhm: RegExpExecArray | null;
        HEX_REGEX.lastIndex = 0;
        while ((bhm = HEX_REGEX.exec(bracketContent)) !== null) {
          violations.push({
            line: lineIndex + 1,
            value: bhm[0],
            raw: tm[0],
            source: 'tailwind',
          });
          foundBracketColor = true;
        }

        let bfm: RegExpExecArray | null;
        FUNC_COLOR_REGEX.lastIndex = 0;
        while ((bfm = FUNC_COLOR_REGEX.exec(bracketContent)) !== null) {
          violations.push({
            line: lineIndex + 1,
            value: bfm[0],
            raw: tm[0],
            source: 'tailwind',
          });
          foundBracketColor = true;
        }

        if (!foundBracketColor && NAMED_COLORS.has(bracketContent.toLowerCase()) && !ALLOWED_CSS_KEYWORDS.has(bracketContent.toLowerCase())) {
          violations.push({
            line: lineIndex + 1,
            value: bracketContent.toLowerCase(),
            raw: tm[0],
            source: 'tailwind',
          });
        }
      }

      // Ocultar brackets y vars para no duplicar detecciones en el escaneo general de JS/JSX
      const lineWithoutTwAndVars = line
        .replace(TW_BRACKET_REGEX, (m) => ' '.repeat(m.length))
        .replace(VAR_USAGE_REGEX, (m) => ' '.repeat(m.length));

      // B. Toda aparición de #hex en constantes, strings, props JSX o style objects
      let jhm: RegExpExecArray | null;
      HEX_REGEX.lastIndex = 0;
      while ((jhm = HEX_REGEX.exec(lineWithoutTwAndVars)) !== null) {
        violations.push({
          line: lineIndex + 1,
          value: jhm[0],
          raw: jhm[0],
          source: 'js-constant-hex',
        });
      }

      // C. Toda aparición de funciones de color (rgba, hsla, etc.) en constantes, strings o style objects
      let jfm: RegExpExecArray | null;
      FUNC_COLOR_REGEX.lastIndex = 0;
      while ((jfm = FUNC_COLOR_REGEX.exec(lineWithoutTwAndVars)) !== null) {
        violations.push({
          line: lineIndex + 1,
          value: jfm[0],
          raw: jfm[0],
          source: 'js-constant-func',
        });
      }
    }
  }

  return violations;
}

/**
 * Normaliza una estructura de línea de base que puede estar dividida en { pendiente, exento }
 * o en un mapa directo, devolviendo el mapa combinado completo y sus subdivisiones.
 */
export function extractBaselineEntries(
  baseline: BaselineFileStructure | BaselineRecord
): {
  combined: BaselineRecord;
  exento: BaselineRecord;
  pendiente: BaselineRecord;
} {
  if ('exento' in baseline || 'pendiente' in baseline) {
    const exento = (baseline.exento || {}) as BaselineRecord;
    const pendiente = (baseline.pendiente || {}) as BaselineRecord;
    const combined: BaselineRecord = {};
    for (const [file, map] of Object.entries(exento)) {
      combined[file] = { ...(combined[file] || {}), ...map };
    }
    for (const [file, map] of Object.entries(pendiente)) {
      combined[file] = { ...(combined[file] || {}), ...map };
    }
    return { combined, exento, pendiente };
  }
  return { combined: baseline as BaselineRecord, exento: {}, pendiente: baseline as BaselineRecord };
}

/**
 * Compara las violaciones reales detectadas contra una línea de base versionada.
 * Aplica la verificación estricta a TODOS los archivos escaneados (tanto pendientes como exentos).
 *
 * Falla en TRES casos:
 * 1. Violación nueva no declarada en la línea de base.
 * 2. Cantidad mayor que la declarada en la línea de base.
 * 3. Violación declarada en la línea de base que ya no aparece (poda pendiente).
 */
export function compareBaseline(
  actual: BaselineRecord,
  baseline: BaselineFileStructure | BaselineRecord,
  options?: { baselineName?: string } | string
): BaselineComparisonResult {
  const { combined } = extractBaselineEntries(baseline);
  const baselineLabel = typeof options === 'string'
    ? options
    : options?.baselineName ?? 'paleta de color';

  const newViolations: Array<{ file: string; value: string; count: number }> = [];
  const increasedViolations: Array<{ file: string; value: string; actual: number; expected: number }> = [];
  const missingViolations: Array<{ file: string; value: string; actual: number; expected: number }> = [];

  // 1 & 2. Chequear violaciones reales contra la línea de base
  for (const [file, actualMap] of Object.entries(actual)) {
    const baselineMap = combined[file] || {};
    for (const [val, actualCount] of Object.entries(actualMap)) {
      const baselineCount = baselineMap[val] || 0;
      if (baselineCount === 0) {
        newViolations.push({ file, value: val, count: actualCount });
      } else if (actualCount > baselineCount) {
        increasedViolations.push({ file, value: val, actual: actualCount, expected: baselineCount });
      }
    }
  }

  // 3. Chequear si alguna violación declarada en la línea de base desapareció o disminuyó
  for (const [file, baselineMap] of Object.entries(combined)) {
    const actualMap = actual[file] || {};
    for (const [val, baselineCount] of Object.entries(baselineMap)) {
      const actualCount = actualMap[val] || 0;
      if (actualCount < baselineCount) {
        missingViolations.push({ file, value: val, actual: actualCount, expected: baselineCount });
      }
    }
  }

  const passed = newViolations.length === 0 && increasedViolations.length === 0 && missingViolations.length === 0;

  if (passed) {
    return { passed: true, newViolations, increasedViolations, missingViolations };
  }

  const errorParts: string[] = [`Discrepancia contra la línea de base de ${baselineLabel}:`];

  if (newViolations.length > 0) {
    errorParts.push(`\n[CASO 1: VIOLACIÓN NUEVA NO DECLARADA EN LÍNEA DE BASE (${newViolations.length})]:`);
    for (const v of newViolations) {
      errorParts.push(`  ${v.file} -> ${v.value} (cantidad: ${v.count})`);
    }
  }

  if (increasedViolations.length > 0) {
    errorParts.push(`\n[CASO 2: CANTIDAD DE VIOLACIONES AUMENTÓ (${increasedViolations.length})]:`);
    for (const v of increasedViolations) {
      errorParts.push(`  ${v.file} -> ${v.value}: esperado ${v.expected}, encontrado ${v.actual}`);
    }
  }

  if (missingViolations.length > 0) {
    errorParts.push(`\n[CASO 3: VIOLACIÓN EN LÍNEA DE BASE YA NO APARECE - REQUIERE PODA (${missingViolations.length})]:`);
    for (const v of missingViolations) {
      errorParts.push(`  ${v.file} -> ${v.value}: declarado ${v.expected}, actual ${v.actual}`);
    }
  }

  return {
    passed: false,
    newViolations,
    increasedViolations,
    missingViolations,
    errorMessage: errorParts.join('\n'),
  };
}
