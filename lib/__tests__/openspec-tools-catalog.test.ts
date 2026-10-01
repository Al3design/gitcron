import { describe, expect, it } from 'vitest';
import snapshot from '@/electron/pipeline/openspec-tools-snapshot.json';
import { translate } from '@/lib/i18n';
import { OPENSPEC_CYCLE_TARGET_VERSION } from '@/lib/openspec-version';
import {
  formatToolVersionNumber,
  OPENSPEC_TOOLS_CATALOG,
  resolveToolDescription,
  resolveToolVersionText,
} from '@/lib/openspec-tools-catalog';

describe('Catálogo de descripciones de herramientas OpenSpec (D4)', () => {
  it('no contiene ningún id ausente de la lista propia (openspec-tools-snapshot.json)', () => {
    const snapshotIds = new Set(snapshot.tools.map((t) => t.id));
    const catalogIds = Object.keys(OPENSPEC_TOOLS_CATALOG);

    const ausentes = catalogIds.filter((id) => !snapshotIds.has(id));
    expect(ausentes).toEqual([]);
  });

  it('cubre las 50 herramientas de OpenSpec 1.14.0 con descripciones no vacías en es, en y zh', () => {
    const catalogEntries = Object.entries(OPENSPEC_TOOLS_CATALOG);
    expect(catalogEntries.length).toBe(50);

    for (const [id, entry] of catalogEntries) {
      expect(entry.es, `Falta descripción en español para ${id}`).toBeTruthy();
      expect(entry.en, `Falta descripción en inglés para ${id}`).toBeTruthy();
      expect(entry.zh, `Falta descripción en chino para ${id}`).toBeTruthy();
    }
  });

  it('normaliza números de versión recortando el .0 final', () => {
    expect(formatToolVersionNumber('1.14.0')).toBe('1.14');
    expect(formatToolVersionNumber('1.0.0')).toBe('1.0');
    expect(formatToolVersionNumber('1.14.1')).toBe('1.14.1');
  });

  describe('resolveToolDescription', () => {
    it('devuelve la descripción exacta según el idioma pedido para herramientas conocidas', () => {
      const t = (key: string, vars?: Record<string, string | number>) => translate(key, 'es', vars);
      const descEs = resolveToolDescription('codex', 'es', t);
      expect(descEs).toBe('Codex, el agente de programación de OpenAI para la terminal y el editor.');

      const descEn = resolveToolDescription('codex', 'en', (key, vars) => translate(key, 'en', vars));
      expect(descEn).toBe("Codex, OpenAI's coding agent for the terminal and the editor.");

      const descZh = resolveToolDescription('codex', 'zh', (key, vars) => translate(key, 'zh', vars));
      expect(descZh).toBe('Codex，OpenAI 面向终端和编辑器的编程智能体。');
    });

    it('devuelve «sin descripción todavía» para herramientas que no están en el catálogo', () => {
      const tEs = (key: string, vars?: Record<string, string | number>) => translate(key, 'es', vars);
      expect(resolveToolDescription('herramienta-futura', 'es', tEs)).toBe('sin descripción todavía');

      const tEn = (key: string, vars?: Record<string, string | number>) => translate(key, 'en', vars);
      expect(resolveToolDescription('herramienta-futura', 'en', tEn)).toBe('no description yet');

      const tZh = (key: string, vars?: Record<string, string | number>) => translate(key, 'zh', vars);
      expect(resolveToolDescription('herramienta-futura', 'zh', tZh)).toBe('暂无描述');
    });
  });

  describe('resolveToolVersionText', () => {
    it('herramienta con addedInOrEarlier dice «desde OpenSpec 1.0 o antes»', () => {
      const tEs = (key: string, vars?: Record<string, string | number>) => translate(key, 'es', vars);
      expect(resolveToolVersionText('codex', tEs)).toBe('desde OpenSpec 1.0 o antes');

      const tEn = (key: string, vars?: Record<string, string | number>) => translate(key, 'en', vars);
      expect(resolveToolVersionText('codex', tEn)).toBe('since OpenSpec 1.0 or earlier');

      const tZh = (key: string, vars?: Record<string, string | number>) => translate(key, 'zh', vars);
      expect(resolveToolVersionText('codex', tZh)).toBe('自 OpenSpec 1.0 或更早版本起');
    });

    it('herramienta incorporada en 1.14.0 dice «desde OpenSpec 1.14»', () => {
      const tEs = (key: string, vars?: Record<string, string | number>) => translate(key, 'es', vars);
      expect(resolveToolVersionText('amp', tEs)).toBe('desde OpenSpec 1.14');

      const tEn = (key: string, vars?: Record<string, string | number>) => translate(key, 'en', vars);
      expect(resolveToolVersionText('amp', tEn)).toBe('since OpenSpec 1.14');

      const tZh = (key: string, vars?: Record<string, string | number>) => translate(key, 'zh', vars);
      expect(resolveToolVersionText('amp', tZh)).toBe('自 OpenSpec 1.14 起');
    });

    it('herramienta reconocida por el motor pero ausente del snapshot dice «posterior a OpenSpec 1.14»', () => {
      const tEs = (key: string, vars?: Record<string, string | number>) => translate(key, 'es', vars);
      expect(resolveToolVersionText('herramienta-nueva-de-1-15', tEs, OPENSPEC_CYCLE_TARGET_VERSION)).toBe(
        'posterior a OpenSpec 1.14',
      );

      const tEn = (key: string, vars?: Record<string, string | number>) => translate(key, 'en', vars);
      expect(resolveToolVersionText('herramienta-nueva-de-1-15', tEn, OPENSPEC_CYCLE_TARGET_VERSION)).toBe(
        'later than OpenSpec 1.14',
      );

      const tZh = (key: string, vars?: Record<string, string | number>) => translate(key, 'zh', vars);
      expect(resolveToolVersionText('herramienta-nueva-de-1-15', tZh, OPENSPEC_CYCLE_TARGET_VERSION)).toBe(
        '晚于 OpenSpec 1.14',
      );
    });
  });
});
