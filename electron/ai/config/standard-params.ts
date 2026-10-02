// electron/ai/config/standard-params.ts
//
// Los valores de los parámetros que define la API de Chat Completions de OpenAI,
// contra el estándar (D11b, tarea 4.1b). Un valor que no cumple es una
// advertencia con el valor esperado: se envía tal como está escrito, y el archivo
// se corrige sólo si la persona lo acepta (requisito «Los proveedores por API
// hablan el estándar de la API de OpenAI»). Nunca se normaliza en silencio.
//
// Sólo se miran los parámetros del estándar. Los demás son los parámetros
// abiertos de D4 (los que un servidor agrega) y no tienen valores que validar acá.

export interface StandardParamIssue {
  /** Nombre del parámetro en el pedido (`reasoning_effort`, `temperature`…). */
  key: string;
  value: unknown;
  /** Lo que el estándar espera, para decirlo. */
  expected: string;
  /** El valor corregido, cuando hay uno evidente (`"High"` → `"high"`). */
  suggestion?: unknown;
}

const REASONING_EFFORT = ['minimal', 'low', 'medium', 'high'] as const;

const inRange = (value: unknown, min: number, max: number) => typeof value === 'number' && value >= min && value <= max;

/** El problema del valor de un parámetro del estándar, o `null` si cumple (o no es del estándar). */
export function checkStandardParam(key: string, value: unknown): StandardParamIssue | null {
  switch (key) {
    case 'reasoning_effort': {
      if (typeof value === 'string' && (REASONING_EFFORT as readonly string[]).includes(value)) return null;
      const lower = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
      const suggestion = lower && (REASONING_EFFORT as readonly string[]).includes(lower) ? lower : undefined;
      return { key, value, expected: REASONING_EFFORT.join(' | '), ...(suggestion ? { suggestion } : {}) };
    }
    case 'temperature':
      return inRange(value, 0, 2) ? null : { key, value, expected: 'un número entre 0 y 2' };
    case 'top_p':
      return inRange(value, 0, 1) ? null : { key, value, expected: 'un número entre 0 y 1' };
    case 'presence_penalty':
    case 'frequency_penalty':
      return inRange(value, -2, 2) ? null : { key, value, expected: 'un número entre -2 y 2' };
    case 'max_tokens':
    case 'max_completion_tokens':
    case 'n':
      return Number.isInteger(value) && (value as number) > 0 ? null : { key, value, expected: 'un entero mayor que 0' };
    case 'seed':
      return Number.isInteger(value) ? null : { key, value, expected: 'un entero' };
    case 'stop': {
      const ok = typeof value === 'string'
        || (Array.isArray(value) && value.length <= 4 && value.every((item) => typeof item === 'string'));
      return ok ? null : { key, value, expected: 'un texto o una lista de hasta 4 textos' };
    }
    default:
      return null;
  }
}
