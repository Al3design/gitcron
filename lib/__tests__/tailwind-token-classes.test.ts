import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getScannedUiFiles } from '../scan-targets';

const COLOR_UTILITY_PREFIXES = [
  'bg-',
  'text-',
  'border-',
  'border-t-',
  'border-r-',
  'border-b-',
  'border-l-',
  'border-x-',
  'border-y-',
  'ring-',
  'ring-offset-',
  'divide-',
  'divide-x-',
  'divide-y-',
  'outline-',
  'fill-',
  'stroke-',
  'from-',
  'via-',
  'to-',
  'placeholder-',
  'decoration-',
  'caret-',
  'accent-',
];

export interface InvalidTokenClassViolation {
  raw: string;
  className: string;
  candidateToken: string;
  segment: string;
  file?: string;
}

/**
 * Lee los nombres de token `--color-*` declarados en el bloque `@theme` de `app/globals.css`,
 * y calcula los primeros segmentos de sus nombres de color (bg, border, text, primary, etc.).
 */
export function getThemeColorTokens(cssContent?: string) {
  const content = cssContent ?? fs.readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf-8');
  const themeMatch = content.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!themeMatch) {
    throw new Error('No se encontró el bloque @theme en app/globals.css');
  }

  const tokenRegex = /--color-([a-zA-Z0-9-]+):/g;
  const tokens = new Set<string>();
  const firstSegments = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(themeMatch[1])) !== null) {
    const tokenName = m[1];
    tokens.add(tokenName);
    const seg = tokenName.split('-')[0];
    firstSegments.add(seg);
  }

  return { tokens, firstSegments };
}

/**
 * Escanea un texto (JSX/TSX) buscando clases de utilidad de color cuyo nombre empiece
 * por alguno de los primeros segmentos de tokens (--color-*) pero que no correspondan
 * a ningún token real generado por Tailwind.
 */
export function findInvalidTokenClasses(
  content: string,
  tokens: Set<string>,
  firstSegments: Set<string>,
  filePath?: string
): InvalidTokenClassViolation[] {
  const violations: InvalidTokenClassViolation[] = [];
  const words = content.match(/[a-zA-Z0-9_:\-\/\[\].]+/g) || [];

  for (const rawWord of words) {
    const parts = rawWord.split(':');
    const word = parts[parts.length - 1];
    const withoutOpacity = word.replace(/\/.*$/, '');

    for (const prefix of COLOR_UTILITY_PREFIXES) {
      if (withoutOpacity.startsWith(prefix)) {
        const candidate = withoutOpacity.slice(prefix.length);
        const seg = candidate.split('-')[0];
        if (firstSegments.has(seg)) {
          if (!tokens.has(candidate)) {
            violations.push({
              raw: rawWord,
              className: withoutOpacity,
              candidateToken: candidate,
              segment: seg,
              file: filePath,
            });
          }
        }
      }
    }
  }

  return violations;
}

describe('tailwind-token-classes - Verificación de clases que nombran tokens existentes', () => {
  const { tokens, firstSegments } = getThemeColorTokens();
  const scannedFiles = getScannedUiFiles().filter((f) => f.endsWith('.tsx'));

  it('los primeros segmentos esperados existen en el bloque @theme', () => {
    const expectedSegments = ['bg', 'border', 'text', 'primary', 'git', 'ai', 'carto', 'graph'];
    for (const seg of expectedSegments) {
      expect(firstSegments.has(seg)).toBe(true);
    }
  });

  it('ningún archivo .tsx de interfaz utiliza clases de utilidad con tokens inexistentes', () => {
    const allViolations: InvalidTokenClassViolation[] = [];

    for (const relPath of scannedFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const violations = findInvalidTokenClasses(content, tokens, firstSegments, relPath);
      for (const v of violations) {
        allViolations.push(v);
      }
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .map((v) => `  - [${v.file}] ${v.raw} -> candidato '--color-${v.candidateToken}' no existe en @theme`)
        .join('\n');
      expect.fail(
        `Se encontraron ${allViolations.length} usos de utilidades con tokens inexistentes:\n${summary}`
      );
    }

    expect(allViolations.length).toBe(0);
  });

  it('falla ante clases con tokens inexistentes a propósito (border-border, text-text-muted, etc.)', () => {
    const sampleInvalid = `
      <div className="border border-border bg-bg-secondary/40 text-text-muted hover:border-border/80">
        <span className="bg-bg-primary text-xs border-2" />
      </div>
    `;

    const violations = findInvalidTokenClasses(sampleInvalid, tokens, firstSegments);
    const candidateTokens = violations.map((v) => v.candidateToken);

    // border-border falla porque --color-border no existe
    expect(candidateTokens).toContain('border');
    // bg-bg-secondary falla porque --color-bg-secondary no existe
    expect(candidateTokens).toContain('bg-secondary');
    // text-text-muted falla porque --color-text-muted no existe
    expect(candidateTokens).toContain('text-muted');
    // bg-bg-primary falla porque --color-bg-primary no existe
    expect(candidateTokens).toContain('bg-primary');

    // No son colores: text-xs, border-2
    expect(candidateTokens).not.toContain('xs');
    expect(candidateTokens).not.toContain('2');
  });
});
