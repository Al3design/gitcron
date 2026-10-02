// lib/gitcron-config-messages.ts
//
// Cómo se le cuenta a la persona lo que pasa con su gitcron.json: que está roto
// (D3) o que trae campos que el formato de OpenCode no conoce (D4, tarea 3.5).
//
// El proceso principal manda el error con datos —archivo, línea, columna y el
// código de jsonc-parser— y el texto se arma acá, en el idioma de la interfaz.
// Antes llegaba armado y crudo: «Error de sintaxis en la línea 27: CommaExpected».

import type { CommitAiConfigFileStatus, CommitAiConfigParseError, CommitAiConfigWarning } from '@/types/commit-message-ai';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * El motivo en palabras de la persona («falta una coma»). Un código que no tiene
 * texto propio se muestra tal cual: inventarle una explicación sería peor.
 */
export function describeConfigParseCode(code: string, t: Translate): string {
  const key = `pipeline.openspec.prepare.configParseCode.${code}`;
  const text = t(key);
  return text === key ? code : text;
}

/** «Error en <archivo>, línea 27, columna 5: falta una coma.» */
export function formatConfigParseError(error: CommitAiConfigParseError, t: Translate): string {
  return t('pipeline.openspec.prepare.aiConfigParseError', {
    file: error.file,
    line: error.line,
    column: error.column,
    reason: describeConfigParseCode(error.code, t),
  });
}

/**
 * Los avisos de archivos rotos que no bloquean: se sigue con su última versión
 * válida y se dice (requisito «El archivo y la pantalla dicen lo mismo»).
 */
export function lastValidNotices(files: CommitAiConfigFileStatus[] | undefined, t: Translate): string[] {
  return (files ?? [])
    .filter((file) => file.error && file.usingLastValid)
    .map((file) =>
      t('pipeline.openspec.prepare.aiConfigUsingLastValid', {
        file: file.path,
        line: file.error!.line,
        reason: describeConfigParseCode(file.error!.code, t),
      }),
    );
}

/**
 * Las advertencias del esquema (D4, tarea 3.5), en palabras de la persona. Se
 * muestran pocas: con más, se dice cuántas faltan en vez de llenar la caja.
 */
export function configWarningLines(
  warnings: CommitAiConfigWarning[] | undefined,
  t: Translate,
  max = 3,
): string[] {
  const list = warnings ?? [];
  const lines = list.slice(0, max).map((warning) => {
    const vars = { path: warning.segments.join('.') };
    if (warning.kind === 'model-temperature-number') {
      return t('pipeline.openspec.prepare.aiConfigWarnModelTemperature', vars);
    }
    if (warning.kind === 'wrong-type' && warning.expected) {
      return t('pipeline.openspec.prepare.aiConfigWarnType', {
        ...vars,
        expected: t(`pipeline.openspec.prepare.configType.${warning.expected}`),
      });
    }
    return t('pipeline.openspec.prepare.aiConfigWarnUnknown', vars);
  });
  if (list.length > max) lines.push(t('pipeline.openspec.prepare.aiConfigWarnMore', { count: list.length - max }));
  return lines;
}

/**
 * Los archivos que aportan a la configuración en uso, para la línea «según …»:
 * los que existen y se leyeron, o se siguen usando en su última versión válida.
 */
export function contributingConfigFiles(files: CommitAiConfigFileStatus[] | undefined): string[] {
  return (files ?? []).filter((file) => file.exists && (!file.error || file.usingLastValid)).map((file) => file.path);
}
