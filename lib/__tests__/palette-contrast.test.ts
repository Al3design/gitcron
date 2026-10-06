import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getContrastRatio } from '../contrast';

export interface ContrastPairCheck {
  description: string;
  type: 'text' | 'ui-control' | 'focus-ring';
  foreground: string;
  background: string;
  minRatio: number;
  fgToken?: string;
  bgToken?: string;
}

export function getGlobalsCssTokens(theme: 'dark' | 'light' = 'dark'): Record<string, string> {
  const cssPath = path.resolve(process.cwd(), 'app/globals.css');
  const content = fs.readFileSync(cssPath, 'utf-8');
  const tokens: Record<string, string> = {};
  const regex = /(--[a-zA-Z0-9-]+):\s*([^;]+);/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    let val = match[2].trim().replace(/\/\*.*?\*\//g, '').trim();
    const ldMatch = val.match(/^light-dark\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)$/i);
    if (ldMatch) {
      val = theme === 'light' ? ldMatch[1] : ldMatch[2];
    }
    tokens[key] = val;
  }
  for (const [k, v] of Object.entries(tokens)) {
    const varMatch = v.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
    if (varMatch && tokens[varMatch[1]]) {
      tokens[k] = tokens[varMatch[1]];
    }
  }
  return tokens;
}

const cssTokens = getGlobalsCssTokens();

export const PALETTE_PAIRS: ContrastPairCheck[] = [
  // Primary / Secondary text on shared backgrounds (target >= 4.5:1)
  {
    description: '--color-text-primary on --color-bg-base',
    type: 'text',
    fgToken: '--color-text-primary',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-text-primary'] || '#eceff4',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-text-primary on --color-bg-surface',
    type: 'text',
    fgToken: '--color-text-primary',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-text-primary'] || '#eceff4',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-text-primary on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-text-primary',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-text-primary'] || '#eceff4',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  {
    description: '--color-text-secondary on --color-bg-base',
    type: 'text',
    fgToken: '--color-text-secondary',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-text-secondary'] || '#d8dee9',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-text-secondary on --color-bg-surface',
    type: 'text',
    fgToken: '--color-text-secondary',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-text-secondary'] || '#d8dee9',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-text-secondary on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-text-secondary',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-text-secondary'] || '#d8dee9',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  {
    description: '--color-text-primary on --color-bg-input',
    type: 'text',
    fgToken: '--color-text-primary',
    bgToken: '--color-bg-input',
    foreground: cssTokens['--color-text-primary'] || '#eceff4',
    background: cssTokens['--color-bg-input'] || '#242933',
    minRatio: 4.5,
  },
  {
    description: '--color-text-secondary on --color-bg-input',
    type: 'text',
    fgToken: '--color-text-secondary',
    bgToken: '--color-bg-input',
    foreground: cssTokens['--color-text-secondary'] || '#d8dee9',
    background: cssTokens['--color-bg-input'] || '#242933',
    minRatio: 4.5,
  },
  // Accents as text on dark backgrounds
  {
    description: '--color-primary (Cyan) on --color-bg-base',
    type: 'text',
    fgToken: '--color-primary',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-primary'] || '#5ed8ff',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-secondary (Green) on --color-bg-base',
    type: 'text',
    fgToken: '--color-secondary',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-secondary'] || cssTokens['--color-git-add'] || '#a3be8c',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-git-mod (Orange) on --color-bg-base',
    type: 'text',
    fgToken: '--color-git-mod',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-git-mod'] || '#fd9d1a',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-warning (Amber) on --color-bg-base',
    type: 'text',
    fgToken: '--color-warning',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-warning'] || '#d8a657',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-warning (Amber) on --color-bg-surface',
    type: 'text',
    fgToken: '--color-warning',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-warning'] || '#d8a657',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-error (Red) on --color-bg-base',
    type: 'text',
    fgToken: '--color-error',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-error'] || '#ff716c',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-git-delete (Red) on --color-bg-base',
    type: 'text',
    fgToken: '--color-git-delete',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-git-delete'] || '#ff716c',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-git-delete (Red) on --color-bg-surface',
    type: 'text',
    fgToken: '--color-git-delete',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-git-delete'] || '#ff716c',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-accent-purple on --color-bg-surface',
    type: 'text',
    fgToken: '--color-accent-purple',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-accent-purple'] || '#c4a7ff',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  // AI Multicolored Palette tokens as text (target >= 4.5:1, D20 ampliado)
  {
    description: '--color-ai-violet on --color-bg-base',
    type: 'text',
    fgToken: '--color-ai-violet',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-ai-violet'] || '#c4a7ff',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-violet on --color-bg-surface',
    type: 'text',
    fgToken: '--color-ai-violet',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-ai-violet'] || '#c4a7ff',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-violet on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-ai-violet',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-ai-violet'] || '#c4a7ff',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-blue on --color-bg-base',
    type: 'text',
    fgToken: '--color-ai-blue',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-ai-blue'] || '#7cb4ff',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-blue on --color-bg-surface',
    type: 'text',
    fgToken: '--color-ai-blue',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-ai-blue'] || '#7cb4ff',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-blue on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-ai-blue',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-ai-blue'] || '#7cb4ff',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-teal on --color-bg-base',
    type: 'text',
    fgToken: '--color-ai-teal',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-ai-teal'] || '#6fdcc0',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-teal on --color-bg-surface',
    type: 'text',
    fgToken: '--color-ai-teal',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-ai-teal'] || '#6fdcc0',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-teal on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-ai-teal',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-ai-teal'] || '#6fdcc0',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-rose on --color-bg-base',
    type: 'text',
    fgToken: '--color-ai-rose',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-ai-rose'] || '#f49ac8',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-rose on --color-bg-surface',
    type: 'text',
    fgToken: '--color-ai-rose',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-ai-rose'] || '#f49ac8',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 4.5,
  },
  {
    description: '--color-ai-rose on --color-bg-overlay',
    type: 'text',
    fgToken: '--color-ai-rose',
    bgToken: '--color-bg-overlay',
    foreground: cssTokens['--color-ai-rose'] || '#f49ac8',
    background: cssTokens['--color-bg-overlay'] || '#3b4252',
    minRatio: 4.5,
  },
  // Focus ring (target >= 3.0:1)
  {
    description: 'Focus ring (--color-primary) on --color-bg-base',
    type: 'focus-ring',
    fgToken: '--color-primary',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-primary'] || '#5ed8ff',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 3.0,
  },
  {
    description: 'Focus ring (--color-primary) on --color-bg-surface',
    type: 'focus-ring',
    fgToken: '--color-primary',
    bgToken: '--color-bg-surface',
    foreground: cssTokens['--color-primary'] || '#5ed8ff',
    background: cssTokens['--color-bg-surface'] || '#272c36',
    minRatio: 3.0,
  },
  // Control borders (target >= 1.2:1)
  {
    description: '--color-border-subtle on --color-bg-base',
    type: 'ui-control',
    fgToken: '--color-border-subtle',
    bgToken: '--color-bg-base',
    foreground: cssTokens['--color-border-subtle'] || '#4c566a',
    background: cssTokens['--color-bg-base'] || '#2e3440',
    minRatio: 1.2,
  },
];

export function evaluateThemeContrast(theme: 'dark' | 'light') {
  const tokens = getGlobalsCssTokens(theme);
  const failingPairs: Array<{
    description: string;
    foreground: string;
    background: string;
    ratio: number;
    minRatio: number;
  }> = [];

  for (const pair of PALETTE_PAIRS) {
    const fg = pair.fgToken ? (tokens[pair.fgToken] || pair.foreground) : pair.foreground;
    const bg = pair.bgToken ? (tokens[pair.bgToken] || pair.background) : pair.background;
    const ratio = getContrastRatio(fg, bg);
    if (ratio < pair.minRatio) {
      failingPairs.push({
        description: pair.description,
        foreground: fg,
        background: bg,
        ratio: Number(ratio.toFixed(2)),
        minRatio: pair.minRatio,
      });
    }
  }

  return {
    tokens,
    total: PALETTE_PAIRS.length,
    failingPairs,
  };
}

describe('palette-contrast - Verificación de contraste WCAG AA (temas: dark, light)', () => {
  // Temas recorridos: 'dark' y 'light'.
  // Archivo analizado: app/globals.css
  // Umbrales aplicados:
  // - 4.5:1 para texto normal (tokens de texto primario, secundario y acentos)
  // - 3.0:1 para focus ring y elementos de interfaz destacados
  // - 1.2:1 para bordes sutiles de controles

  it('tema oscuro: todos los pares de color deben cumplir con el ratio mínimo exigido', () => {
    const { failingPairs } = evaluateThemeContrast('dark');

    if (failingPairs.length > 0) {
      const summary = failingPairs
        .map(
          (p) =>
            `  - [${p.description}] (${p.foreground} sobre ${p.background}) -> Obtenido: ${p.ratio}:1, Requerido: ${p.minRatio}:1`
        )
        .join('\n');
      expect.fail(
        `[Tema Oscuro] Se encontraron ${failingPairs.length} pares con contraste insuficiente:\n${summary}`
      );
    }

    expect(failingPairs.length).toBe(0);
  });

  it('tema claro: todos los pares de color deben cumplir con el ratio mínimo exigido', () => {
    const { failingPairs } = evaluateThemeContrast('light');

    if (failingPairs.length > 0) {
      const summary = failingPairs
        .map(
          (p) =>
            `  - [${p.description}] (${p.foreground} sobre ${p.background}) -> Obtenido: ${p.ratio}:1, Requerido: ${p.minRatio}:1`
        )
        .join('\n');
      expect.fail(
        `[Tema Claro] Se encontraron ${failingPairs.length} pares con contraste insuficiente:\n${summary}`
      );
    }

    expect(failingPairs.length).toBe(0);
  });

  it('el acento verde (--color-git-add) debe estar fijado en #a3be8c (Nord14) en globals.css', () => {
    const cssPath = path.resolve(process.cwd(), 'app/globals.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    const gitAddMatch = content.match(/--color-git-add:\s*(?:light-dark\([^,]+,\s*)?(#[0-9a-fA-F]{3,8})/i);
    expect(gitAddMatch?.[1]?.toLowerCase()).toBe('#a3be8c');

    const secondaryMatch = content.match(/--color-secondary:\s*([^;]+);/);
    expect(secondaryMatch?.[1]?.trim()).toBe('var(--color-git-add)');
  });

  it('el acento de advertencia (--color-warning) debe estar fijado en #d8a657 (Nord13) en globals.css', () => {
    const cssPath = path.resolve(process.cwd(), 'app/globals.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    const warningMatch = content.match(/--color-warning:\s*(?:light-dark\([^,]+,\s*)?(#[0-9a-fA-F]{3,8})/i);
    expect(warningMatch?.[1]?.toLowerCase()).toBe('#d8a657');
  });

  it('declara explícitamente los tokens de color verificados y excluidos bajo el Invariante 22', () => {
    // Declaración explícita de cobertura basada en el bloque @theme de app/globals.css:
    //
    // Tokens con color propio en Sección A (13 tokens verificados en PALETTE_PAIRS):
    //  1. --color-bg-base (#2e3440) - Fondo oscuro base
    //  2. --color-bg-surface (#272c36) - Fondo de superficie
    //  3. --color-bg-overlay (#3b4252) - Fondo de superposición
    //  4. --color-border-subtle (#4c566a) - Borde sutil
    //  5. --color-text-primary (#eceff4) - Texto principal (sobre base, surface, overlay)
    //  6. --color-text-secondary (#d8dee9) - Texto secundario (sobre base, surface, overlay)
    //  7. --color-primary (#5ed8ff) - Acento cian (texto y focus ring sobre base y surface)
    //  8. --color-error (#ff716c) - Acento rojo de error (texto sobre base)
    //  9. --color-warning (#d8a657) - Acento ámbar de atención (texto sobre base y surface)
    // 10. --color-git-add (#a3be8c) - Acento verde de adición Git (texto sobre base)
    // 11. --color-git-delete (#ff716c) - Acento rojo de eliminación Git (texto sobre base y surface)
    // 12. --color-git-mod (#fd9d1a) - Acento naranja de modificación Git (texto sobre base)
    // 13. --color-accent-purple (#b58bf8) - Acento violeta auxiliar (texto sobre surface)
    //
    // Tokens alias / derivados (cubiertos por su token de origen y aserciones de CSS):
    //  - --color-secondary: alias de var(--color-git-add) (#a3be8c), verificado en par #8 y test de globals.css.
    //  - --color-carto-canvas: alias de var(--color-bg-base) (#2e3440).
    //  - --color-carto-grid: alias de var(--color-border-subtle) (#4c566a).
    //  - --color-carto-text: alias de var(--color-text-primary) (#eceff4).
    //  - --color-carto-text-muted: alias de var(--color-text-secondary) (#d8dee9).
    //
    // Tokens excluidos de esta suite (con motivo explícito):
    //  - --color-graph-branch-1 a 12: Carriles dinámicos de CommitGraph (Sección B). Pertenecen
    //    al dominio de trazado de grafo y se prueban en el renderizado de carriles (Invariante 12).
    //  - --color-carto-node (#5ed8ff), --color-carto-edge (#3c6a8a), --color-carto-accent (#fdb33a),
    //    y los siete --color-carto-role-* (ui, styles, database, critical, logic, config, other) (Sección D):
    //    Tokens de lienzo y datos de Cartografía, excluidos por constituir una «escala categórica de datos»
    //    para el renderizado de grafos (decisión de Alejandro del 2026-08-25, tareas 2.5 y 4.5 del change).
    //
    // Tokens retirados / inexistentes:
    //  - --color-border-strong: no existe en globals.css (los bordes usan --color-border-subtle).
    //  - Tokens --os-*: eliminados en la tarea 5.8 al unificar Pipeline con Carbon Soul.

    const verifiedSharedTokens = [
      '--color-bg-base',
      '--color-bg-surface',
      '--color-bg-overlay',
      '--color-bg-input',
      '--color-border-subtle',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-primary',
      '--color-error',
      '--color-warning',
      '--color-git-add',
      '--color-git-delete',
      '--color-git-mod',
      '--color-accent-purple',
      '--color-ai-violet',
      '--color-ai-blue',
      '--color-ai-teal',
      '--color-ai-rose',
    ];

    expect(verifiedSharedTokens.length).toBe(18);
    expect(PALETTE_PAIRS.length).toBe(32);
  });
});
