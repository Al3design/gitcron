// electron/ai/config/config-diff.ts
//
// Qué cambia entre dos bloques de configuración, campo por campo. Lo usan las
// importaciones (desde OpenCode, Cursor, LM Studio) para mostrar la vista previa
// antes de escribir: un bloque que ya existe no se pisa sin decir qué cambia
// (requisito «Importar desde la configuración de OpenCode», escenario «Reimportar»).

export interface FieldChange {
  /** Ruta por segmentos dentro del bloque (los ids de modelo llevan puntos y barras). */
  segments: string[];
  /** `undefined` si el campo no existía. */
  before: unknown;
  /** `undefined` si el campo deja de existir. */
  after: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Los campos hoja que difieren entre `before` y `after`. Las listas se comparan enteras. */
export function diffValues(before: unknown, after: unknown, prefix: string[] = []): FieldChange[] {
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => diffValues(before[key], after[key], [...prefix, key]));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ segments: prefix, before, after }];
}

/**
 * Un cambio de un bloque que aparece o desaparece entero, abierto en sus campos
 * hoja: la vista previa decide campo por campo qué valores puede mostrar (una
 * clave escrita a mano dentro de `options` no viaja aunque cambie `options` entero).
 */
export function leafChanges(change: FieldChange): FieldChange[] {
  const { before, after, segments } = change;
  const opened =
    isObject(before) && after === undefined ? diffValues(before, {}, segments)
    : before === undefined && isObject(after) ? diffValues({}, after, segments)
    : null;
  return opened && opened.length > 0 ? opened.flatMap(leafChanges) : [change];
}

/** Los nombres de las variables `{env:NOMBRE}` y `${env:NOMBRE}` que usa un valor. */
export function referencedVariables(value: unknown): string[] {
  const names = new Set<string>();
  const walk = (current: unknown) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/\$?\{env:([A-Za-z0-9_]+)\}/g)) names.add(match[1]);
    } else if (Array.isArray(current)) {
      current.forEach(walk);
    } else if (isObject(current)) {
      Object.values(current).forEach(walk);
    }
  };
  walk(value);
  return [...names].sort();
}
