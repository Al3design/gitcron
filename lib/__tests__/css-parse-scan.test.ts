/**
 * Cada hoja de estilos de la app se tiene que poder leer entera con PostCSS (el mismo
 * lector que usa Next al compilar).
 *
 * Por qué: en carto-05c una llave de más en ScreenCatalog.module.css rompió la compilación
 * de las pantallas y la app no abría; las pruebas unitarias pasaban y css-syntax-scan solo
 * mira paréntesis dentro de cada declaración. Se vio recién en la captura, a los 3 minutos.
 * Esta prueba recorre todas las hojas (no una lista a mano), así que una nueva queda
 * cubierta sola.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const RAICES = ['app', 'components', 'styles'];

function hojas(dir: string): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return []; // la carpeta no existe en este repo (por ejemplo styles/)
  }
  return entradas.flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (nombre === 'node_modules' || nombre.startsWith('.')) return [];
    if (statSync(ruta).isDirectory()) return hojas(ruta);
    return nombre.endsWith('.css') ? [ruta] : [];
  });
}

describe('css-parse-scan', () => {
  it('todas las hojas de estilos se leen sin errores de sintaxis', () => {
    const errores: string[] = [];
    for (const archivo of RAICES.flatMap(hojas)) {
      try {
        postcss.parse(readFileSync(archivo, 'utf8'), { from: archivo });
      } catch (err) {
        const e = err as { line?: number; reason?: string; message?: string };
        errores.push(`${archivo.replace(/\\/g, '/')}:${e.line ?? '?'} ${e.reason ?? e.message}`);
      }
    }
    expect(errores, `Hojas de estilos que no compilan:\n${errores.join('\n')}`).toEqual([]);
  });
});
