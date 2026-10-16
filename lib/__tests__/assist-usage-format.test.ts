import { describe, expect, it } from 'vitest';
import { formatUsageLine, sumUsage } from '../assist/usage-format';
import type { AssistMessageUsage } from '@/types/assist-context';

const DICT: Record<string, string> = {
  'assist.usage.in': '{{n}} de entrada',
  'assist.usage.inCached': '{{n}} de entrada ({{cached}} de caché)',
  'assist.usage.out': '{{n}} de salida',
  'assist.usage.reasoning': '{{n}} de razonamiento',
  'assist.usage.time': '{{s}} s',
  'assist.usage.speed': '{{n}} fichas/s',
  'assist.usage.context': '{{pct}} % del contexto ({{used}} de {{limit}})',
  'assist.usage.none': 'Sin datos de uso del servidor',
  'assist.usage.total': 'Total de la conversación: {{parts}}',
};

function mockT(key: string, vars?: Record<string, string | number>): string {
  const template = DICT[key] ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
    template,
  );
}

describe('assist-usage-format', () => {
  const createdAt = '2026-10-14T09:36:00.000Z';

  it('línea completa con todos los datos (incluyendo caché, velocidad y contexto)', () => {
    const usage: AssistMessageUsage = {
      promptTokens: 1200,
      cachedPromptTokens: 800,
      completionTokens: 400,
      reasoningTokens: 150,
      durationMs: 2500,
      contextLength: 128000,
    };

    const numFmt = new Intl.NumberFormat('es-ES');
    const res = formatUsageLine(createdAt, usage, mockT, 'es-ES');
    expect(res.when).toBeTruthy();
    expect(res.parts).toEqual([
      `${numFmt.format(1200)} de entrada (${numFmt.format(800)} de caché)`,
      `${numFmt.format(400)} de salida`,
      `${numFmt.format(150)} de razonamiento`,
      '2.5 s',
      '160 fichas/s',
      `1 % del contexto (${numFmt.format(1200)} de ${numFmt.format(128000)})`,
    ]);
  });

  it('sin caché formatea entrada sin paréntesis de caché', () => {
    const usage: AssistMessageUsage = {
      promptTokens: 500,
      cachedPromptTokens: null,
      completionTokens: 100,
      reasoningTokens: null,
      durationMs: 1000,
      contextLength: null,
    };

    const res = formatUsageLine(createdAt, usage, mockT, 'es-ES');
    expect(res.parts).toContain('500 de entrada');
    expect(res.parts).not.toContain('de caché');
  });

  it('sin contextLength no muestra porcentaje de contexto', () => {
    const usage: AssistMessageUsage = {
      promptTokens: 500,
      cachedPromptTokens: null,
      completionTokens: 100,
      reasoningTokens: null,
      durationMs: 1000,
      contextLength: null,
    };

    const res = formatUsageLine(createdAt, usage, mockT, 'es-ES');
    const hasContext = res.parts.some((p) => p.includes('contexto'));
    expect(hasContext).toBe(false);
  });

  it('usage null devuelve parts vacío', () => {
    const res = formatUsageLine(createdAt, null, mockT, 'es-ES');
    expect(res.when).toBeTruthy();
    expect(res.parts).toEqual([]);
  });

  it('velocidad se incluye solo cuando durationMs > 0 y completionTokens existe', () => {
    const zeroDuration: AssistMessageUsage = {
      promptTokens: 100,
      cachedPromptTokens: null,
      completionTokens: 50,
      reasoningTokens: null,
      durationMs: 0,
      contextLength: null,
    };

    const resZero = formatUsageLine(createdAt, zeroDuration, mockT, 'es-ES');
    expect(resZero.parts.some((p) => p.includes('fichas/s'))).toBe(false);

    const positiveDuration: AssistMessageUsage = {
      promptTokens: 100,
      cachedPromptTokens: null,
      completionTokens: 50,
      reasoningTokens: null,
      durationMs: 500,
      contextLength: null,
    };

    const resPos = formatUsageLine(createdAt, positiveDuration, mockT, 'es-ES');
    expect(resPos.parts).toContain('100 fichas/s');
  });

  describe('sumUsage', () => {
    it('devuelve null si un campo es null en todas las respuestas (no cero)', () => {
      const u1: AssistMessageUsage = {
        promptTokens: 100,
        cachedPromptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        durationMs: 500,
        contextLength: null,
      };
      const u2: AssistMessageUsage = {
        promptTokens: 200,
        cachedPromptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        durationMs: 700,
        contextLength: null,
      };

      const sum = sumUsage([u1, u2]);
      expect(sum.promptTokens).toBe(300);
      expect(sum.durationMs).toBe(1200);
      expect(sum.completionTokens).toBeNull();
      expect(sum.reasoningTokens).toBeNull();
    });

    it('suma correctamente con mezcla de valores y nulls', () => {
      const u1: AssistMessageUsage = {
        promptTokens: 100,
        cachedPromptTokens: 50,
        completionTokens: 40,
        reasoningTokens: 10,
        durationMs: 1000,
        contextLength: 4000,
      };
      const u2: AssistMessageUsage = {
        promptTokens: null,
        cachedPromptTokens: null,
        completionTokens: 60,
        reasoningTokens: null,
        durationMs: 1500,
        contextLength: null,
      };

      const sum = sumUsage([u1, null, u2]);
      expect(sum.promptTokens).toBe(100);
      expect(sum.completionTokens).toBe(100);
      expect(sum.reasoningTokens).toBe(10);
      expect(sum.durationMs).toBe(2500);
    });

    it('con lista vacía o todos null da todo null', () => {
      const sum = sumUsage([null, null]);
      expect(sum.promptTokens).toBeNull();
      expect(sum.completionTokens).toBeNull();
      expect(sum.reasoningTokens).toBeNull();
      expect(sum.durationMs).toBeNull();
    });
  });
});
