// Toda clave que la interfaz pide con t('…') existe en las traducciones.
//
// Caso real (2026-10-06): la pantalla de inicio sin repositorios mostraba «sidebar.startRepo»,
// «start.openExisting», «start.initNew» y «start.cloneRemote» en crudo desde 887dfecc. Ninguna
// prueba abría esa pantalla; la vio la primera prueba e2e sobre un GitCron con perfil nuevo.
// `translate` cae al español y después a la clave misma: una clave que no está en español
// es la que aparece en crudo.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import { getScannedUiFiles } from '../scan-targets';

/** Las claves literales de `t('…')` / `t("…")` de un archivo (las armadas en tiempo de ejecución no cuentan). */
export function literalKeys(content: string): string[] {
  const keys: string[] = [];
  const pattern = /\bt\(\s*(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) keys.push(match[2]);
  return keys;
}

describe('i18n: claves usadas por la interfaz', () => {
  it('reconoce las claves literales y deja afuera las armadas', () => {
    expect(literalKeys(`{t('start.openExisting')} {t("a.b-c")} {t(\`x.\${y}\`)} {t(key)} {format('a.b')}`))
      .toEqual(['start.openExisting', 'a.b-c']);
  });

  it('toda clave literal de los .tsx de la interfaz existe en español', () => {
    const missing: string[] = [];
    for (const file of getScannedUiFiles().filter((f) => f.endsWith('.tsx'))) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
      for (const key of literalKeys(content)) {
        if (translate(key, 'es') === key) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
