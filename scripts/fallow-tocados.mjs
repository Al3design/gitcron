// Lo que Fallow encuentra en las líneas que agregó lo tocado: exports y archivos
// sin uso, funciones demasiado complejas y ciclos de dependencias. Lo heredado no
// cuenta. Lo usa scripts/verificar.mjs; también se puede correr solo:
//
//   node scripts/fallow-tocados.mjs [--desde <ref>]
//
// No usa `fallow audit` porque compara commits y una tanda trabaja sobre cambios
// todavía sin commit (medido el 2026-10-09: no veía un export nuevo sin uso que
// `fallow dead-code` sí encontraba). El análisis completo tarda un par de segundos.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : 'HEAD';
const CODIGO = /\.(ts|tsx|mjs|js)$/;
/** Ciclos que ya existían el 2026-10-09; tocar esos archivos no los vuelve nuevos. */
const CICLOS_CONOCIDOS = new Set([
  'electron/ipc/pipeline-openspec.ts|electron/pipeline/openspec-install.ts',
  'electron/ipc/pipeline-openspec.ts|electron/pipeline/openspec-legacy-skills.ts',
]);

function git(argumentos) {
  return spawnSync('git', argumentos, { encoding: 'utf8', windowsHide: true }).stdout ?? '';
}

function fallow(argumentos) {
  const r = spawnSync('pnpm', ['exec', 'fallow', ...argumentos, '--format', 'json'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const texto = r.stdout ?? '';
  const inicio = texto.indexOf('{');
  if (inicio < 0) throw new Error(`fallow ${argumentos[0]} no devolvió JSON: ${(r.stderr ?? '').slice(-300)}`);
  return JSON.parse(texto.slice(inicio));
}

/** Números de línea que agrega un encabezado de tramo `@@ -a,b +c,d @@`. */
function lineasDelTramo(encabezado) {
  const tramo = encabezado.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (!tramo) return [];
  const desde = Number(tramo[1]);
  const cantidad = tramo[2] === undefined ? 1 : Number(tramo[2]);
  return Array.from({ length: cantidad }, (_, i) => desde + i);
}

/** Líneas agregadas por archivo según `git diff -U0`. */
function lineasDelDiff(diff) {
  const porArchivo = new Map();
  let actual = null;
  for (const linea of diff.split(/\r?\n/)) {
    const archivo = linea.match(/^\+\+\+ b\/(.+)$/);
    if (archivo) {
      actual = new Set();
      porArchivo.set(archivo[1], actual);
    } else if (actual) {
      for (const n of lineasDelTramo(linea)) actual.add(n);
    }
  }
  return porArchivo;
}

/** Líneas agregadas por archivo de código; un archivo nuevo cuenta entero. */
function lineasAgregadas() {
  const porArchivo = lineasDelDiff(git(['diff', '-U0', base, '--', '.']));
  const nuevos = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/);
  for (const nuevo of nuevos.filter((f) => f && existsSync(f))) porArchivo.set(nuevo, 'todo');
  return new Map([...porArchivo].filter(([archivo]) => CODIGO.test(archivo)));
}

const normalizar = (p) => String(p).replace(/\\/g, '/').replace(/^.*?gitCronos\//, '');
const agregadas = lineasAgregadas();
const esNuevo = (path, line) => {
  const lineas = agregadas.get(normalizar(path));
  return lineas === 'todo' || (lineas instanceof Set && lineas.has(line));
};

if (agregadas.size === 0) {
  console.log('nada de código agregado');
  process.exit(0);
}

const muerto = fallow(['dead-code']);
const salud = fallow(['health', '--complexity']);
const hallazgos = [];

for (const e of muerto.unused_exports ?? []) {
  if (esNuevo(e.path, e.line)) hallazgos.push(`${normalizar(e.path)}:${e.line} export sin uso «${e.export_name}»`);
}
for (const f of muerto.unused_files ?? []) {
  if (agregadas.get(normalizar(f.path ?? f)) === 'todo') hallazgos.push(`${normalizar(f.path ?? f)} archivo nuevo que nadie usa`);
}
for (const c of muerto.circular_dependencies ?? []) {
  const archivos = (c.files ?? c.cycle ?? []).map(normalizar);
  const clave = archivos.slice().sort().join('|');
  if (archivos.some((a) => agregadas.has(a)) && !CICLOS_CONOCIDOS.has(clave)) {
    hallazgos.push(`ciclo de dependencias: ${archivos.join(' → ')}`);
  }
}
for (const f of salud.findings ?? []) {
  if ((f.severity === 'critical' || f.severity === 'high') && esNuevo(f.path, f.line)) {
    hallazgos.push(`${normalizar(f.path)}:${f.line} «${f.name}» demasiado compleja (ciclomática ${f.cyclomatic}, cognitiva ${f.cognitive})`);
  }
}

if (hallazgos.length === 0) {
  console.log(`sin hallazgos nuevos en ${agregadas.size} archivo(s)`);
  process.exit(0);
}
for (const h of hallazgos) console.log(`  ${h}`);
console.log(`${hallazgos.length} hallazgo(s) nuevo(s)`);
process.exit(1);
