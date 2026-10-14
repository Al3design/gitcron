// lib/assist/usage-format.ts
//
// Formateo puro del uso de cada respuesta de asistencia contextual (tarea 2.9).
// Entrada, caché, salida, razonamiento, duración, velocidad y porcentaje de contexto.

import type { AssistMessageUsage } from '@/types/assist-context';

export interface UsageLine {
  /** «14 oct 2026, 09:36» con el idioma de la app. */
  when: string;
  /** Cada dato ya armado; un dato sin valor no aparece, y si no hay ninguno, `parts` queda vacío. */
  parts: string[];
}

function formatWhen(createdAt: string, locale: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${datePart}, ${timePart}`;
}

export function formatUsageLine(
  createdAt: string,
  usage: AssistMessageUsage | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
  locale: string,
): UsageLine {
  const when = formatWhen(createdAt, locale);
  if (!usage) {
    return { when, parts: [] };
  }

  const numFmt = new Intl.NumberFormat(locale);
  const parts: string[] = [];

  // 1. Entrada (con caché opcional)
  if (usage.promptTokens !== null && usage.promptTokens !== undefined) {
    if (usage.cachedPromptTokens !== null && usage.cachedPromptTokens !== undefined) {
      parts.push(
        t('assist.usage.inCached', {
          n: numFmt.format(usage.promptTokens),
          cached: numFmt.format(usage.cachedPromptTokens),
        }),
      );
    } else {
      parts.push(t('assist.usage.in', { n: numFmt.format(usage.promptTokens) }));
    }
  }

  // 2. Salida
  if (usage.completionTokens !== null && usage.completionTokens !== undefined) {
    parts.push(t('assist.usage.out', { n: numFmt.format(usage.completionTokens) }));
  }

  // 3. Razonamiento
  if (usage.reasoningTokens !== null && usage.reasoningTokens !== undefined) {
    parts.push(t('assist.usage.reasoning', { n: numFmt.format(usage.reasoningTokens) }));
  }

  // 4. Tiempo
  if (usage.durationMs !== null && usage.durationMs !== undefined) {
    const seconds = (usage.durationMs / 1000).toFixed(1);
    parts.push(t('assist.usage.time', { s: seconds }));
  }

  // 5. Velocidad (solo si completionTokens y durationMs existen y durationMs > 0)
  if (
    usage.completionTokens !== null &&
    usage.completionTokens !== undefined &&
    usage.durationMs !== null &&
    usage.durationMs !== undefined &&
    usage.durationMs > 0
  ) {
    const speed = Math.round(usage.completionTokens / (usage.durationMs / 1000));
    parts.push(t('assist.usage.speed', { n: numFmt.format(speed) }));
  }

  // 6. Contexto (solo si promptTokens y contextLength existen y contextLength > 0)
  if (
    usage.promptTokens !== null &&
    usage.promptTokens !== undefined &&
    usage.contextLength !== null &&
    usage.contextLength !== undefined &&
    usage.contextLength > 0
  ) {
    const pct = Math.round((usage.promptTokens / usage.contextLength) * 100);
    parts.push(
      t('assist.usage.context', {
        pct,
        used: numFmt.format(usage.promptTokens),
        limit: numFmt.format(usage.contextLength),
      }),
    );
  }

  return { when, parts };
}

export function sumUsage(usages: (AssistMessageUsage | null)[]): {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  durationMs: number | null;
} {
  let hasPrompt = false;
  let sumPrompt = 0;
  let hasCompletion = false;
  let sumCompletion = 0;
  let hasReasoning = false;
  let sumReasoning = 0;
  let hasDuration = false;
  let sumDuration = 0;

  for (const u of usages) {
    if (!u) continue;
    if (u.promptTokens !== null && u.promptTokens !== undefined) {
      hasPrompt = true;
      sumPrompt += u.promptTokens;
    }
    if (u.completionTokens !== null && u.completionTokens !== undefined) {
      hasCompletion = true;
      sumCompletion += u.completionTokens;
    }
    if (u.reasoningTokens !== null && u.reasoningTokens !== undefined) {
      hasReasoning = true;
      sumReasoning += u.reasoningTokens;
    }
    if (u.durationMs !== null && u.durationMs !== undefined) {
      hasDuration = true;
      sumDuration += u.durationMs;
    }
  }

  return {
    promptTokens: hasPrompt ? sumPrompt : null,
    completionTokens: hasCompletion ? sumCompletion : null,
    reasoningTokens: hasReasoning ? sumReasoning : null,
    durationMs: hasDuration ? sumDuration : null,
  };
}
