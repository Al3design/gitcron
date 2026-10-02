// electron/ai/config/gitcron-config-writer.ts
//
// Cambia UN valor de un gitcron.json sin tocar el resto del texto (D3, tarea 3.3).
//
// El archivo es de la persona: tiene comentarios, su orden, su sangría y campos que
// GitCron no conoce (un bloque `mcp`, opciones de OpenCode). Reescribirlo entero
// desde un objeto los perdería. Por eso se edita el TEXTO con `modify` + `applyEdits`
// de jsonc-parser, que sólo reemplaza el tramo del valor tocado.
//
// Todavía no hay pantalla que lo use: llega con la elección de modelos (4.5) y la
// sección de ajustes (6.1).

import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { applyEdits, findNodeAtLocation, modify, parseTree, type Edit, type FormattingOptions } from 'jsonc-parser';
import { parseGitCronConfigText, type GitCronConfigParseError } from './gitcron-config';

/** Texto de un gitcron.json nuevo. Otro archivo (mcp.json) pasa el suyo. */
export const NEW_GITCRON_FILE_TEXT = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

/** Lo que toca el disco, inyectable para poder simular otro proceso escribiendo a la vez. */
export interface ConfigWriterFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: 'utf8'): string;
  writeFileSync(p: string, data: string, encoding: 'utf8'): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
}

export type ConfigWriteResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'broken'; error: GitCronConfigParseError }
  | { ok: false; reason: 'changed-while-writing' }
  | { ok: false; reason: 'io'; message: string };

/** Sangría y fin de línea del propio archivo, para que lo agregado se vea igual que lo escrito a mano. */
export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indented = text.split(/\r?\n/).find((line) => /^[ \t]+\S/.test(line));
  if (indented?.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol };
  const spaces = indented ? indented.match(/^ +/)?.[0].length ?? 2 : 2;
  return { insertSpaces: true, tabSize: spaces, eol };
}

/**
 * El tramo de texto que pone `value` en `segments`, sin tocar nada más.
 *
 * `modify` de jsonc-parser con formato vuelve a formatear las líneas donde cae la
 * edición: al agregar una clave después de `"mcp": { "x": {…} }` escrito en una
 * línea, lo desplegaba entero (medido el 2026-10-02 con «usar lo que tenías»). Acá
 * el texto nuevo se arma con la sangría de la línea donde va, y el resto queda
 * byte a byte. Devuelve `null` si no puede (la raíz no es un objeto, se quita una
 * clave…), y entonces se usa `modify`.
 */
export function pointEdits(base: string, segments: readonly string[], value: unknown, fmt: FormattingOptions): Edit[] | null {
  if (value === undefined || segments.length === 0) return null;
  const root = parseTree(base);
  if (!root || root.type !== 'object') return null;
  const eol = fmt.eol ?? '\n';
  const unit = fmt.insertSpaces === false ? '\t' : ' '.repeat(fmt.tabSize ?? 2);
  const lineIndent = (offset: number) => {
    const start = base.lastIndexOf('\n', offset - 1) + 1;
    return /^[ \t]*/.exec(base.slice(start))?.[0] ?? '';
  };
  const render = (v: unknown, indent: string) => (JSON.stringify(v, null, unit) ?? 'null').split('\n').join(eol + indent);

  // Si ya está, se reemplaza sólo su valor.
  const existing = findNodeAtLocation(root, [...segments]);
  if (existing) {
    return [{ offset: existing.offset, length: existing.length, content: render(value, lineIndent(existing.offset)) }];
  }

  // Si no, se agrega bajo el objeto más profundo que ya existe, anidando lo que falte.
  let depth = segments.length - 1;
  let parent = depth === 0 ? root : findNodeAtLocation(root, segments.slice(0, depth));
  while (!parent && depth > 0) {
    depth -= 1;
    parent = depth === 0 ? root : findNodeAtLocation(root, segments.slice(0, depth));
  }
  if (!parent || parent.type !== 'object') return null;
  let nested: unknown = value;
  for (let i = segments.length - 1; i > depth; i -= 1) nested = { [segments[i]]: nested };

  const props = parent.children ?? [];
  const parentIndent = lineIndent(parent.offset);
  const indent = props.length > 0 ? lineIndent(props[props.length - 1].offset) : parentIndent + unit;
  const property = `${JSON.stringify(segments[depth])}: ${render(nested, indent)}`;
  if (props.length > 0) {
    const last = props[props.length - 1];
    return [{ offset: last.offset + last.length, length: 0, content: `,${eol}${indent}${property}` }];
  }
  return [{ offset: parent.offset + 1, length: parent.length - 2, content: `${eol}${indent}${property}${eol}${parentIndent}` }];
}

/**
 * Cambia el valor en `segments` (por segmentos: los ids de modelo llevan puntos y
 * barras). `value: undefined` quita la clave. Si el archivo no existe, lo crea con
 * `newFileText` (por omisión, un gitcron.json con `$schema`). Un archivo roto no se
 * toca: se devuelve su error. Sirve igual para mcp.json (D12).
 *
 * Escritura atómica: temporal en la misma carpeta y renombrar encima. Justo antes
 * de renombrar se relee el archivo; si alguien lo cambió mientras tanto, la
 * edición se vuelve a aplicar sobre el texto nuevo (hasta tres intentos).
 */
export function updateGitCronConfigValue(options: {
  filePath: string;
  segments: readonly string[];
  value: unknown;
  fs?: ConfigWriterFs;
  /** Contenido de partida si el archivo no existe (por omisión, un gitcron.json con `$schema`). */
  newFileText?: string;
}): ConfigWriteResult {
  const fs: ConfigWriterFs = options.fs ?? nodeFs;
  const { filePath, segments, value } = options;
  const newFileText = options.newFileText ?? NEW_GITCRON_FILE_TEXT;

  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = fs.existsSync(filePath);
    let base: string;
    try {
      base = exists ? fs.readFileSync(filePath, 'utf8') : newFileText;
    } catch (error) {
      return { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) };
    }

    if (exists) {
      // Mismo lector que la lectura de la configuración: si para ella está roto,
      // para la escritura también. No se edita un texto que no se entiende.
      const parsed = parseGitCronConfigText(base, filePath);
      if (parsed.kind === 'error') return { ok: false, reason: 'broken', error: parsed.error };
    }

    const formatting = detectFormatting(base);
    const edits = pointEdits(base, segments, value, formatting)
      ?? modify(base, [...segments], value, { formattingOptions: formatting });
    const next = applyEdits(base, edits);

    // ¿Cambió en disco mientras se editaba? Entonces se edita de nuevo sobre lo nuevo.
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if ((exists ? base : null) !== current) continue;

    const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmp, next, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        // El temporal se queda; no tapa el error de escritura.
      }
      return { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, created: !exists };
  }
  return { ok: false, reason: 'changed-while-writing' };
}
