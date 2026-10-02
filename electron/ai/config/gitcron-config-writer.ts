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
import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser';
import { parseGitCronConfigText, type GitCronConfigParseError } from './gitcron-config';

const NEW_FILE_TEXT = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

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
 * Cambia el valor en `segments` (por segmentos: los ids de modelo llevan puntos y
 * barras). `value: undefined` quita la clave. Si el archivo no existe, lo crea con
 * `$schema`. Un archivo roto no se toca: se devuelve su error.
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
}): ConfigWriteResult {
  const fs: ConfigWriterFs = options.fs ?? nodeFs;
  const { filePath, segments, value } = options;

  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = fs.existsSync(filePath);
    let base: string;
    try {
      base = exists ? fs.readFileSync(filePath, 'utf8') : NEW_FILE_TEXT;
    } catch (error) {
      return { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) };
    }

    if (exists) {
      // Mismo lector que la lectura de la configuración: si para ella está roto,
      // para la escritura también. No se edita un texto que no se entiende.
      const parsed = parseGitCronConfigText(base, filePath);
      if (parsed.kind === 'error') return { ok: false, reason: 'broken', error: parsed.error };
    }

    const edits = modify(base, [...segments], value, { formattingOptions: detectFormatting(base) });
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
