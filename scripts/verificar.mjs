// Corre los chequeos del proyecto en el orden que importa y muestra un renglón por
// chequeo. La salida completa queda en tmp/verificacion.log (ignorado por git).
// Pensado para que la IA ejecutora pegue sólo el resumen en su reporte y para que
// la auditoría no repita la cadena a mano.
//
//   pnpm verificar                 build, test ×2, tsc, eslint (tocados), openspec validate,
//                                  git diff --check, trampas
//   pnpm verificar --rapido        sin build ni segunda pasada de test
//   pnpm verificar --change <id>   change a validar (por omisión: el de la rama change/<id>)
//
// El orden no es arbitrario: `pnpm build` va antes que `pnpm test` porque una prueba
// (font-size-as-color) lee de out/; y test corre dos veces porque los intermitentes
// bajo carga sólo se ven repitiendo la suite entera.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const rapido = args.includes('--rapido');
const changeArg = args.includes('--change') ? args[args.indexOf('--change') + 1] : null;

const CODIGOS_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Errores de eslint que ya estaban antes de cualquier tanda y nadie pidió
 * arreglar. Se restan del conteo; si uno desaparece o se corre de línea, se
 * actualiza acá con causa. Medidos el 2026-09-21.
 */
const ESLINT_PREEXISTENTES = [
  { archivo: 'components/pipeline/OpenSpecDashboard.tsx', linea: 1100 }, // corrido de 1104 al retirar attentionRef muerto y foco de decisiones en tanda 07
  { archivo: 'components/pipeline/OpenSpecInspector.tsx', linea: 162 }, // corrido de 135 al agregar efecto de atención/foco en tanda 07
  { archivo: 'components/pipeline/OpenSpecInspector.tsx', linea: 218 }, // corrido de 191 al agregar efecto de atención/foco en tanda 07
];

/** Errores de eslint de la salida, menos los preexistentes. */
function erroresEslintNuevos(salida) {
  const errores = [];
  let archivoActual = null;
  for (const linea of salida.split(/\r?\n/)) {
    const cabecera = linea.match(/^([A-Za-z]:\\|\/)?\S+\.(ts|tsx|mjs|js)$/);
    if (cabecera) {
      archivoActual = linea.trim().replace(/\\/g, '/').replace(/^.*?gitCronos\//, '');
      continue;
    }
    const error = linea.match(/^\s+(\d+):\d+\s+error\s/);
    if (error && archivoActual) errores.push({ archivo: archivoActual, linea: Number(error[1]) });
  }
  return errores.filter(
    (e) => !ESLINT_PREEXISTENTES.some((p) => p.archivo === e.archivo && p.linea === e.linea),
  );
}

function correr(comando) {
  const resultado = spawnSync(comando, {
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const salida = `${resultado.stdout ?? ''}\n${resultado.stderr ?? ''}`.replace(CODIGOS_ANSI, '');
  return { salida, status: resultado.status ?? 1 };
}

function git(argumentos) {
  return correr(`git ${argumentos}`).salida.trim();
}

/** Archivos tocados respecto de HEAD, más los nuevos sin seguimiento. */
function archivosTocados() {
  const modificados = git('diff --name-only HEAD').split(/\r?\n/);
  const nuevos = git('ls-files --others --exclude-standard').split(/\r?\n/);
  return [...new Set([...modificados, ...nuevos])].filter((f) => f.trim() !== '');
}

function changeDeLaRama() {
  if (changeArg) return changeArg;
  const rama = git('rev-parse --abbrev-ref HEAD');
  const m = rama.match(/^change\/(.+)$/);
  return m ? m[1] : null;
}

/** Cifras útiles para el renglón, sin volcar la salida entera. */
function extraerResumen(nombre, salida) {
  if (nombre.startsWith('test')) {
    const archivos = salida.match(/Test Files\s+(\d+ passed \(\d+\))/);
    const pruebas = salida.match(/Tests\s+(\d+ passed \(\d+\))/);
    return [archivos?.[1] && `archivos ${archivos[1]}`, pruebas?.[1] && `pruebas ${pruebas[1]}`]
      .filter(Boolean)
      .join(' · ');
  }
  if (nombre === 'build') {
    const ruta = salida.match(/○ \/\s+([\d.]+ k?B)\s+([\d.]+ k?B)/);
    return ruta ? `/ ${ruta[1]} · primera carga ${ruta[2]}` : '';
  }
  if (nombre === 'eslint') {
    const problemas = salida.match(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
    return problemas ? `${problemas[2]} errores, ${problemas[3]} avisos` : 'sin problemas';
  }
  if (nombre === 'openspec validate') {
    return salida.match(/is valid/) ? 'is valid' : '';
  }
  return 'sin problemas';
}

function ultimasLineas(texto, cantidad) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lineas.slice(-cantidad).join('\n');
}

/**
 * Trampas medidas del ejecutor. No reemplazan la lectura del diff: avisan de lo
 * que ya pasó más de una vez.
 */
function trampas() {
  const avisos = [];
  const tocados = archivosTocados();

  // Auditorías o notas ajenas en los artefactos del change.
  const diffTasks = git('diff -U0 HEAD -- openspec/changes/*/tasks.md openspec/changes/*/task-log.md');
  // El patrón medido: un ítem o título propio que arranca con «Auditoría de …»
  // imitando las del auditor. Las notas del auditor van dentro de una casilla y
  // no empiezan así.
  if (/^\+\s*(?:[-*]|#+)?\s*\**\s*Auditor[ií]a de\b/im.test(diffTasks)) {
    avisos.push('«Auditoría de …» escrita en tasks.md o task-log.md');
  }

  // Ramas «si estoy en pruebas» en código de producción.
  const produccion = tocados.filter(
    (f) => /\.(ts|tsx|mjs)$/.test(f) && !/__tests__|\.test\.|fixtures|scripts\//.test(f),
  );
  for (const archivo of produccion) {
    const diff = git(`diff -U0 HEAD -- "${archivo}"`);
    const agregado = diff.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const texto = agregado.join('\n');
    if (/NODE_ENV|\.mock\b|vi\.fn|import\.meta\.vitest/.test(texto)) {
      avisos.push(`${archivo}: rama de pruebas en código de producción (NODE_ENV / .mock / vi.fn)`);
    }
    if (/!important/.test(texto)) avisos.push(`${archivo}: !important agregado`);
    // Silenciar una regla de lint es tapar un error, no arreglarlo. Medido en
    // la tanda 4d: dos disables para esconder setState en efecto y deps faltantes.
    if (/eslint-disable/.test(texto)) avisos.push(`${archivo}: eslint-disable agregado`);
  }
  for (const archivo of tocados.filter((f) => f.endsWith('.css'))) {
    const diff = git(`diff -U0 HEAD -- "${archivo}"`);
    const agregado = diff.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    if (/!important/.test(agregado)) avisos.push(`${archivo}: !important agregado`);
    if (/max-width:\s*0\b/.test(agregado)) avisos.push(`${archivo}: max-width: 0 agregado`);
    // Colores fuera de la paleta: literales hex, rgb() o nombres de color en
    // una declaración de color. Todo color sale de un token `--color-*`.
    // Medido en la tanda 4d: `color: white` en un hover.
    const declaraciones = agregado.match(/(?:^|\s)(?:background|background-color|color|border-color|border|outline|fill|stroke)\s*:[^;]*;/gm) ?? [];
    const NOMBRES = /\b(?:white|black|red|blue|green|gray|grey|yellow|orange|purple|pink|cyan|magenta|silver|navy|teal|olive|maroon|lime|aqua|fuchsia)\b/i;
    for (const decl of declaraciones) {
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(decl) || NOMBRES.test(decl)) {
        avisos.push(`${archivo}: color literal fuera de la paleta → ${decl.trim()}`);
      }
    }
  }

  // Archivos reescritos enteros (más del 80 % de las líneas cambiadas): hay que
  // leerlos como nuevos.
  const stat = git('diff --numstat HEAD');
  for (const linea of stat.split(/\r?\n/)) {
    const [agregadas, borradas, archivo] = linea.split('\t');
    if (!archivo || !/\.(ts|tsx)$/.test(archivo)) continue;
    const contenido = correr(`git show HEAD:"${archivo}"`);
    const total = contenido.status === 0 ? contenido.salida.split(/\r?\n/).length : 0;
    if (total > 80 && Number(borradas) > total * 0.8) {
      avisos.push(`${archivo}: reescrito casi entero (${borradas} de ${total} líneas borradas)`);
    }
  }
  return avisos;
}

function main() {
  mkdirSync('tmp', { recursive: true });
  const registro = [];
  const renglones = [];
  const fallidos = [];
  const inicioTotal = Date.now();
  const tocados = archivosTocados();
  const tocadosTs = tocados.filter((f) => /\.(ts|tsx)$/.test(f));
  const change = changeDeLaRama();

  const chequeos = [
    { nombre: 'build', comando: 'pnpm build', cuando: !rapido, motivoSalto: '--rapido' },
    { nombre: 'test (1)', comando: 'pnpm test', cuando: true },
    { nombre: 'test (2)', comando: 'pnpm test', cuando: !rapido, motivoSalto: '--rapido' },
    { nombre: 'tsc', comando: 'pnpm exec tsc --noEmit', cuando: true },
    {
      nombre: 'eslint',
      comando: `pnpm exec eslint ${tocadosTs.map((f) => `"${f}"`).join(' ')}`,
      cuando: tocadosTs.length > 0,
      motivoSalto: 'ningún .ts/.tsx tocado',
    },
    {
      nombre: 'openspec validate',
      comando: `pnpm exec openspec validate ${change} --strict`,
      cuando: change !== null,
      motivoSalto: 'la rama no es change/<id>; usar --change',
    },
    { nombre: 'git diff --check', comando: 'git diff --check', cuando: true },
  ];

  for (const chequeo of chequeos) {
    if (!chequeo.cuando) {
      renglones.push(`-- ${chequeo.nombre.padEnd(18)} saltado (${chequeo.motivoSalto ?? ''})`);
      continue;
    }
    const inicio = Date.now();
    const { salida, status } = correr(chequeo.comando);
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    registro.push(`\n===== ${chequeo.nombre} (${chequeo.comando}) — exit ${status} =====\n${salida}`);
    // eslint: los preexistentes se restan; falla sólo con errores nuevos.
    if (chequeo.nombre === 'eslint' && status !== 0) {
      const nuevos = erroresEslintNuevos(salida);
      if (nuevos.length === 0) {
        const total = (salida.match(/^\s+\d+:\d+\s+error\s/gm) ?? []).length;
        renglones.push(`OK ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  ${total} preexistente(s), 0 nuevos`);
        continue;
      }
      fallidos.push(chequeo.nombre);
      renglones.push(`XX ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  ${nuevos.length} error(es) nuevos`);
      for (const e of nuevos) renglones.push(`    ${e.archivo}:${e.linea}`);
      continue;
    }
    if (status === 0) {
      renglones.push(`OK ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  ${extraerResumen(chequeo.nombre, salida)}`);
    } else {
      fallidos.push(chequeo.nombre);
      renglones.push(`XX ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  exit ${status}`);
      renglones.push(ultimasLineas(salida, 25).replace(/^/gm, '    '));
    }
  }

  const avisos = trampas();
  renglones.push('');
  renglones.push(avisos.length === 0 ? 'trampas: ninguna detectada' : `trampas (${avisos.length}):`);
  for (const aviso of avisos) renglones.push(`  !! ${aviso}`);

  writeFileSync('tmp/verificacion.log', registro.join('\n'), 'utf8');
  const total = ((Date.now() - inicioTotal) / 1000).toFixed(0);
  const resultadoFinal =
    fallidos.length === 0
      ? `RESULTADO: OK (${total} s)${avisos.length ? ' — con avisos' : ''}`
      : `RESULTADO: FALLÓ ${fallidos.join(', ')} (${total} s) — detalle en tmp/verificacion.log`;
  console.warn(
    ['', `VERIFICACIÓN  rama ${git('rev-parse --abbrev-ref HEAD')} · HEAD ${git('rev-parse --short HEAD')} · ${tocados.length} archivos tocados`, ...renglones, '', resultadoFinal].join('\n'),
  );
  process.exitCode = fallidos.length === 0 ? 0 : 1;
}

main();
