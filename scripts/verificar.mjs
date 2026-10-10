// Corre los chequeos del proyecto en el orden que importa y muestra un renglón por
// chequeo. La salida completa queda en tmp/verificacion.log (ignorado por git).
// Pensado para que la IA ejecutora pegue sólo el resumen en su reporte y para que
// la auditoría no repita la cadena a mano.
//
// Tres escalones, de menor a mayor (Ale, 2026-10-01: «si la herramienta va
// creciendo, cada vez se hace eterno esto»). Lo lento queda para cuando importa:
//
//   pnpm verificar                 por omisión, igual que --tocados: mientras se trabaja y para cerrar una tanda. Sólo
//                                  las pruebas que dependen de los archivos tocados
//                                  (vitest related), tsc, eslint, openspec validate,
//                                  diff --check, trampas. Crece con el cambio, no con la
//                                  app: 17 s por un panel, 75 s si se tocan los textos
//                                  (lib/i18n.ts lo importa casi todo).
//   pnpm verificar --rapido        cierre de la IA ejecutora y arreglos que tocan piezas
//                                  centrales: toda la suite una vez, sin build (~2 min).
//   pnpm verificar --completa      cuando se juntaron varias tandas, antes de fusionar: toda la suite una vez,
//                                  una segunda pasada sólo de las pruebas que dependen de lo
//                                  tocado, e2e y todo lo demás. El build de las pantallas
//                                  (`pnpm build`) se saltea si no se tocó nada que lo afecte.
//                                  Abre ventanas reales de GitCron unos segundos para las e2e.
//                                  Ale, 2026-10-09: tardaba ~5 min y se repetía en cada vuelta
//                                  de corrección; la segunda pasada entera y el build sin
//                                  pantallas tocadas eran casi la mitad.
//                                  Ale, 2026-10-09 (más tarde): una tanda por un color de CSS tardó
//                                  más de 30 min de reloj repitiendo la completa; desde entonces una
//                                  tanda cierra con la de lo tocado y la completa no es la de omisión.
//   pnpm verificar --todo          antes de fusionar a main o de sacar versión: build siempre
//                                  y la suite entera dos veces (~5 min), como era antes.
//
//   --desde <ref>                  compara contra <ref> en vez de HEAD (p. ej. `--desde main`
//                                  para todo el change, o `--desde HEAD~2` después de commitear)
//   --change <id>                  change a validar (por omisión: el de la rama change/<id>)
//
// El orden no es arbitrario: `pnpm build` va antes que `pnpm test` porque una prueba
// (font-size-as-color) lee de out/; y test corre dos veces porque los intermitentes
// bajo carga sólo se ven repitiendo la suite entera. `e2e` corre después de build y test
// porque `next dev` y el build usan la misma carpeta `.next`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const todo = args.includes('--todo');
const completa = args.includes('--completa') || todo;
const rapidoPedido = args.includes('--rapido');
// Sin indicación, sólo lo tocado: la completa se pide con --completa o --todo.
const tocadosSolo = !completa && !rapidoPedido;
const rapido = rapidoPedido || tocadosSolo;

/**
 * Lo que puede cambiar el build de las pantallas. Si nada de esto se tocó, el
 * `out/` anterior sigue valiendo y `pnpm build` se saltea (a menos que falte,
 * porque font-size-as-color lo lee).
 */
const AFECTA_BUILD = /^(app|components|hooks|lib|public|styles|types)\/|^(next\.config\.[a-z]+|postcss\.config\.[a-z]+|tailwind\.config\.[a-z]+|tsconfig\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;
/** Una prueba no cambia el build aunque viva en components/ o lib/. */
const ES_PRUEBA = /(^|\/)__tests__\/|\.test\.(ts|tsx)$/;
/** El catálogo de textos y las pruebas que lo cuidan (ver el filtro de `vitest related`). */
const CATALOGO_TEXTOS = 'lib/i18n.ts';
const PRUEBAS_TEXTOS = ['lib/__tests__/i18n-claves-usadas.test.ts', 'components/pipeline/__tests__/pipeline-i18n.test.ts'];
const changeArg = args.includes('--change') ? args[args.indexOf('--change') + 1] : null;
const base = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : 'HEAD';

const CODIGOS_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Errores de eslint que ya estaban antes de cualquier tanda y nadie pidió
 * arreglar. Se restan del conteo; si uno desaparece o se corre de línea, se
 * actualiza acá con causa. Medidos el 2026-09-21.
 */
const ESLINT_PREEXISTENTES = [
  { archivo: 'components/pipeline/OpenSpecDashboard.tsx', linea: 894 }, // corrido de 1031 en modularizar-02: extracción de preparación de commit (antes de 1133 en modularizar-01)
  { archivo: 'components/pipeline/OpenSpecInspector.tsx', linea: 175 }, // corrido de 162 en modelos-en-casa 27: import de PipelineSessionResume y formatSessionOption (antes de 135 en 07)
  { archivo: 'components/pipeline/OpenSpecInspector.tsx', linea: 231 }, // corrido de 218 en modelos-en-casa 27: import de PipelineSessionResume y formatSessionOption (antes de 191 en 07)
  { archivo: 'components/cartography/CartoAskBox.tsx', linea: 65 }, // preexistente (linea 63 en becb354) expuesto al agregar AiUseLine y AiSentDetails en tanda 14
  { archivo: 'components/cartography/CartoNodeDetail.tsx', linea: 60 }, // preexistente (linea 58 en becb354) expuesto al agregar AiUseLine y AiSentDetails en tanda 14
  { archivo: 'components/cartography/CartoPanoramaHeader.tsx', linea: 42 }, // preexistente (linea 24 en becb354) expuesto al agregar AiUseLine y AiSentDetails en tanda 14
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

/** Archivos tocados respecto de la base (HEAD o --desde), más los nuevos sin seguimiento. */
function archivosTocados() {
  const modificados = git(`diff --name-only ${base}`).split(/\r?\n/);
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
    if (/No test files found/.test(salida)) return 'ninguna prueba depende de lo tocado';
    const archivos = salida.match(/Test Files\s+(\d+ passed \(\d+\))/);
    const pruebas = salida.match(/Tests\s+(\d+ passed \(\d+\))/);
    return [archivos?.[1] && `archivos ${archivos[1]}`, pruebas?.[1] && `pruebas ${pruebas[1]}`]
      .filter(Boolean)
      .join(' · ');
  }
  if (nombre === 'fallow') {
    return salida.trim().split(/\r?\n/).pop() ?? '';
  }
  if (nombre === 'build:electron') {
    return 'dist/main.js · dist/preload.js';
  }
  if (nombre === 'build') {
    const ruta = salida.match(/○ \/\s+([\d.]+ k?B)\s+([\d.]+ k?B)/);
    return ruta ? `/ ${ruta[1]} · primera carga ${ruta[2]}` : '';
  }
  if (nombre === 'eslint') {
    const problemas = salida.match(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
    return problemas ? `${problemas[2]} errores, ${problemas[3]} avisos` : 'sin problemas';
  }
  if (nombre === 'e2e') {
    const pruebas = salida.match(/Tests\s+(\d+)\s+passed/);
    return pruebas ? `${pruebas[1]} pruebas pasaron` : 'pruebas pasaron';
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
/**
 * Capturas en la carpeta de reportes más reciente que son anteriores al último
 * cambio de código tocado: no muestran el código que se entrega.
 */
function capturasViejas(tocados) {
  const raiz = 'tmp/reportes';
  if (!existsSync(raiz)) return [];
  const carpetas = readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${raiz}/${d.name}`)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const carpeta = carpetas[0];
  if (!carpeta) return [];
  const capturas = readdirSync(carpeta).filter((f) => f.endsWith('.png')).map((f) => `${carpeta}/${f}`);
  const codigo = tocados.filter((f) => /.(tsx?|css)$/.test(f) && !/__tests__|.test./.test(f) && existsSync(f));
  if (capturas.length === 0 || codigo.length === 0) return [];
  const ultimoCodigo = Math.max(...codigo.map((f) => statSync(f).mtimeMs));
  const viejas = capturas.filter((f) => statSync(f).mtimeMs < ultimoCodigo);
  return viejas.length > 0 ? [`${carpeta}: ${viejas.length} captura(s) anteriores al último cambio de código`] : [];
}

function trampas() {
  const avisos = [];
  const tocados = archivosTocados();

  // Auditorías o notas ajenas en los artefactos del change.
  const diffTasks = git(`diff -U0 ${base} -- openspec/changes/*/tasks.md openspec/changes/*/task-log.md`);
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
    const diff = git(`diff -U0 ${base} -- "${archivo}"`);
    const agregado = diff.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const texto = agregado.join('\n');
    if (/NODE_ENV|\.mock\b|vi\.fn|import\.meta\.vitest/.test(texto)) {
      avisos.push(`${archivo}: rama de pruebas en código de producción (NODE_ENV / .mock / vi.fn)`);
    }
    if (/!important/.test(texto)) avisos.push(`${archivo}: !important agregado`);
    // Silenciar una regla de lint es tapar un error, no arreglarlo. Medido en
    // la tanda 4d: dos disables para esconder setState en efecto y deps faltantes.
    if (/eslint-disable/.test(texto)) avisos.push(`${archivo}: eslint-disable agregado`);
    // Aflojar una protección para que algo pase. Medido el 2026-10-09: para que pasara
    // una prueba de submódulos se habilitó file:// en el programa (protocol.file.allow
    // con allowUnsafeProtocolOverride), lo que git bloquea desde 2022.
    if (/allowUnsafe|protocol\.[a-z]+\.allow|dangerously|--no-verify/.test(texto)) {
      avisos.push(`${archivo}: protección aflojada (allowUnsafe / protocol.*.allow / dangerously): revisar si hace falta en el programa`);
    }
    // Un error tragado sin decir nada esconde el próximo fallo.
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(texto)) {
      avisos.push(`${archivo}: catch vacío agregado`);
    }
  }

  // Pruebas que se ablandan para pasar.
  const pruebas = tocados.filter((f) => /__tests__|\.test\.|\.e2e\./.test(f));
  for (const archivo of pruebas) {
    const agregado = git(`diff -U0 ${base} -- "${archivo}"`).split(/\r?\n/)
      .filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    if (/\.(skip|only)\(/.test(agregado)) avisos.push(`${archivo}: .skip / .only agregado`);
    // Subir el límite de tiempo de una prueba tapa lentitud real o una espera mal
    // hecha; a veces es legítimo (git real en Windows), pero se mira.
    if (/\},\s*\d[\d_]{3,}\s*\)|testTimeout|timeout:\s*\d[\d_]{4,}/.test(agregado)) {
      avisos.push(`${archivo}: límite de tiempo de prueba subido`);
    }
    // En e2e, elegir por posición (.first / .nth) en vez de por nombre o región se
    // rompe en cuanto cambia el orden. Medido en la tanda 29b.
    if (/\.e2e\./.test(archivo) && /\.(first|nth)\(/.test(agregado)) {
      avisos.push(`${archivo}: localizador por posición (.first / .nth) en e2e`);
    }
  }

  // Capturas de la tanda más viejas que el código que dicen mostrar. Medido el
  // 2026-10-09: una captura de las 18:30 se entregó como evidencia de código que
  // siguió cambiando hasta las 19:04.
  avisos.push(...capturasViejas(tocados));
  for (const archivo of tocados.filter((f) => f.endsWith('.css'))) {
    const diff = git(`diff -U0 ${base} -- "${archivo}"`);
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
  const stat = git(`diff --numstat ${base}`);
  for (const linea of stat.split(/\r?\n/)) {
    const [agregadas, borradas, archivo] = linea.split('\t');
    if (!archivo || !/\.(ts|tsx)$/.test(archivo)) continue;
    const contenido = correr(`git show ${base}:"${archivo}"`);
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
  // Para `vitest related`: código y estilos que siguen existiendo (un archivo
  // borrado no tiene pruebas que dependan de él).
  const tocadosCodigoTodos = tocados.filter((f) => /\.(ts|tsx|mjs|js|css)$/.test(f) && existsSync(f));
  // lib/i18n.ts es el catálogo de textos y casi toda la interfaz lo importa: pasarlo
  // a `vitest related` arrastra unas 110 pruebas por agregar una palabra. Un texto
  // nuevo no cambia lógica; lo que puede romper (claves faltantes o sin usar) lo
  // cubren sus pruebas propias, y los componentes que usan el texto nuevo ya están
  // entre los tocados. Con --completa y --todo corre la suite entera igual.
  const tocaTextos = tocadosCodigoTodos.includes(CATALOGO_TEXTOS);
  const tocadosCodigo = tocaTextos
    ? [...tocadosCodigoTodos.filter((f) => f !== CATALOGO_TEXTOS), ...PRUEBAS_TEXTOS.filter((f) => existsSync(f))]
    : tocadosCodigoTodos;
  const buildNecesario =
    todo || !existsSync('out/_next/static/css') || tocados.some((f) => AFECTA_BUILD.test(f) && !ES_PRUEBA.test(f));
  const relacionadas = tocadosCodigo.map((f) => `"${f}"`).join(' ');

  const chequeos = [
    {
      nombre: 'build',
      comando: 'pnpm build',
      cuando: !rapido && buildNecesario,
      motivoSalto: rapido ? (tocadosSolo ? '--tocados' : '--rapido') : 'no se tocó nada de las pantallas',
    },
    {
      nombre: 'build:electron',
      comando: 'pnpm build:electron',
      cuando: !rapido,
      motivoSalto: tocadosSolo ? '--tocados' : '--rapido',
    },
    tocadosSolo
      ? {
          nombre: 'test (tocados)',
          comando: `pnpm exec vitest related --run ${tocadosCodigo.map((f) => `"${f}"`).join(' ')}`,
          cuando: tocadosCodigo.length > 0,
          motivoSalto: 'ningún archivo de código tocado',
        }
      : { nombre: 'test (1)', comando: 'pnpm test', cuando: true },
    todo
      ? { nombre: 'test (2)', comando: 'pnpm test', cuando: true }
      : {
          // La segunda pasada busca pruebas que fallan de a ratos bajo carga. La
          // tanda responde por las que dependen de lo que tocó; la suite entera
          // dos veces queda para --todo.
          nombre: 'test (2, tocados)',
          comando: `pnpm exec vitest related --run --passWithNoTests ${relacionadas}`,
          cuando: !rapido && tocadosCodigo.length > 0,
          motivoSalto: rapido ? (tocadosSolo ? '--tocados' : '--rapido') : 'ningún archivo de código tocado',
        },
    {
      nombre: 'e2e',
      comando: 'pnpm e2e',
      cuando: !rapido,
      motivoSalto: tocadosSolo ? '--tocados' : '--rapido',
    },
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
    {
      // Código muerto, complejidad y duplicación que agregó lo tocado (no lo que ya
      // estaba): segundos para lo que a la auditoría le lleva leer archivo por archivo.
      nombre: 'fallow',
      comando: `node scripts/fallow-tocados.mjs --desde ${base}`,
      cuando: tocadosCodigoTodos.some((f) => /\.(ts|tsx|mjs|js)$/.test(f)),
      motivoSalto: 'ningún archivo de código tocado',
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
      if (chequeo.nombre === 'e2e') {
        const testFallido = salida.match(/FAIL\s+\S+\s+([^\r\n]+)/)?.[1];
        const screenTxt = salida.match(/(?:❯\s+screen\s+|\b)([\S]+screen\.txt)/)?.[1];
        if (testFallido || screenTxt) {
          if (testFallido) renglones.push(`    prueba: ${testFallido.trim()}`);
          if (screenTxt) renglones.push(`    screen: ${screenTxt.trim()}`);
        } else {
          renglones.push(ultimasLineas(salida, 25).replace(/^/gm, '    '));
        }
      } else {
        renglones.push(ultimasLineas(salida, 25).replace(/^/gm, '    '));
      }
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
    ['', `VERIFICACIÓN  rama ${git('rev-parse --abbrev-ref HEAD')} · HEAD ${git('rev-parse --short HEAD')} · ${tocados.length} archivos tocados${base === 'HEAD' ? '' : ` desde ${base}`}${tocadosSolo ? ' · modo --tocados' : ''}`, ...renglones, '', resultadoFinal].join('\n'),
  );
  process.exitCode = fallidos.length === 0 ? 0 : 1;
}

main();
