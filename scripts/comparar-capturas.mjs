// Compara las capturas de una tanda, antes y después, píxel por píxel.
//
//   node scripts/comparar-capturas.mjs tmp/reportes/<tanda>
//
// Busca <carpeta>/antes/*.png y <carpeta>/despues/*.png con el mismo nombre. Por cada
// par informa el porcentaje de píxeles distintos y el rectángulo donde están, para no
// tener que mirarlas a ojo (en modularizar-03 una diferencia de 16 px entre dos fechas
// se encontró recién comparando las imágenes una al lado de la otra). Guarda una
// imagen con las diferencias en rojo en <carpeta>/diferencias/.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PNG } = require(require.resolve('pngjs', { paths: [path.resolve('node_modules/.pnpm/pngjs@7.0.0/node_modules')] }));

const carpeta = process.argv[2];
if (!carpeta || !existsSync(path.join(carpeta, 'antes')) || !existsSync(path.join(carpeta, 'despues'))) {
  console.error('Uso: node scripts/comparar-capturas.mjs <carpeta con antes/ y despues/>');
  process.exit(2);
}
/** Diferencia mínima por canal para contar un píxel como distinto (suaviza el antialiasing). */
const TOLERANCIA = 24;

function comparar(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { tamañoDistinto: true };
  const marca = new PNG({ width: a.width, height: a.height });
  let distintos = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const difiere = [0, 1, 2].some((c) => Math.abs(a.data[i + c] - b.data[i + c]) > TOLERANCIA);
      marca.data[i] = difiere ? 255 : a.data[i] >> 2;
      marca.data[i + 1] = difiere ? 0 : a.data[i + 1] >> 2;
      marca.data[i + 2] = difiere ? 0 : a.data[i + 2] >> 2;
      marca.data[i + 3] = 255;
      if (!difiere) continue;
      distintos++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { distintos, total: a.width * a.height, caja: distintos ? [x0, y0, x1, y1] : null, marca };
}

const salida = path.join(carpeta, 'diferencias');
mkdirSync(salida, { recursive: true });
let hayDiferencias = false;
for (const nombre of readdirSync(path.join(carpeta, 'antes')).filter((f) => f.endsWith('.png'))) {
  const despues = path.join(carpeta, 'despues', nombre);
  if (!existsSync(despues)) {
    console.log(`${nombre}: falta en despues/`);
    hayDiferencias = true;
    continue;
  }
  const r = comparar(PNG.sync.read(readFileSync(path.join(carpeta, 'antes', nombre))), PNG.sync.read(readFileSync(despues)));
  if (r.tamañoDistinto) {
    console.log(`${nombre}: tamaño distinto`);
    hayDiferencias = true;
    continue;
  }
  const pct = ((100 * r.distintos) / r.total).toFixed(2);
  console.log(`${nombre}: ${pct}% distinto${r.caja ? ` en x ${r.caja[0]}–${r.caja[2]}, y ${r.caja[1]}–${r.caja[3]}` : ''}`);
  if (r.distintos) {
    hayDiferencias = true;
    writeFileSync(path.join(salida, nombre), PNG.sync.write(r.marca));
  }
}
process.exit(hayDiferencias ? 1 : 0);
