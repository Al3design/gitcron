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
//
// El orden no es arbitrario: `pnpm build` va antes que `pnpm test` porque una prueba
// (font-size-as-color) lee de out/; y test corre dos veces porque los intermitentes
// bajo carga sólo se ven repitiendo la suite entera. `e2e` corre después de build y test
// porque `next dev` y el build usan la misma carpeta `.next`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

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
const ES_CATALOGO_TEXTOS = (f) => f === 'lib/i18n.ts' || f.startsWith('lib/i18n/');
/** Pruebas que recorren los archivos de estilos por ruta (paleta, sintaxis, escala, tamaños). */
const PRUEBAS_ESTILOS = ['lib/__tests__/ui-color-scan.test.ts', 'lib/__tests__/css-syntax-scan.test.ts', 'lib/__tests__/visual-scale-scan.test.ts', 'lib/__tests__/target-size.test.ts', 'lib/__tests__/tailwind-token-classes.test.ts'];
const PRUEBAS_TEXTOS = ['lib/__tests__/i18n-claves-usadas.test.ts', 'components/pipeline/__tests__/pipeline-i18n.test.ts'];
const base = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : 'HEAD';

const CODIGOS_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Errores de eslint que la tanda agregó. Los que ya estaban en la base se
 * restan: por archivo y por regla, se cuentan los errores de la versión de la
 * base (`git show <base>:archivo` pasado por stdin) y sólo el excedente es
 * nuevo. Así una línea corrida no los vuelve nuevos. Antes era una lista a mano
 * de archivo y línea que había que corregir cada vez que algo se corría
 * (2026-09-21 a 2026-10-10); el 2026-10-11 dos entradas ya apuntaban a errores
 * arreglados.
 */
function erroresEslintNuevos(archivos) {
  const nuevos = [];
  let heredados = 0;
  for (const archivo of archivos) {
    const actual = erroresEslint(`pnpm exec eslint -f json "${archivo}"`);
    const enBase = actual.length > 0 && correr(`git cat-file -e ${base}:"${archivo}"`).status === 0
      ? erroresEslint(`git show ${base}:"${archivo}" | pnpm exec eslint -f json --stdin --stdin-filename "${archivo}"`)
      : [];
    const resto = restarHeredados(actual, enBase);
    heredados += actual.length - resto.length;
    nuevos.push(...resto.map((e) => ({ archivo, ...e })));
  }
  return { nuevos, heredados };
}

/** Errores (no avisos) de una corrida de eslint en formato json, con su regla y línea. */
function erroresEslint(comando) {
  let resultados = [];
  try {
    resultados = JSON.parse(correr(comando).salida.trim().split(/\r?\n/).find((l) => l.startsWith('[')) ?? '[]');
  } catch {
    resultados = []; // salida ilegible: en la base cuenta como «sin heredados», o sea todo nuevo
  }
  return resultados.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => ({ regla: m.ruleId ?? 'sintaxis', linea: m.line })));
}

/** Los errores de `actual` que exceden, regla por regla, a los que ya había en la base. */
function restarHeredados(actual, enBase) {
  const cupo = {};
  for (const e of enBase) cupo[e.regla] = (cupo[e.regla] ?? 0) + 1;
  return actual.filter((e) => {
    if (!cupo[e.regla]) return true;
    cupo[e.regla] -= 1;
    return false;
  });
}

/** Archivos con errores en la salida de eslint (formato stylish). */
function archivosConErrores(salida) {
  const archivos = new Set();
  let archivoActual = null;
  for (const linea of salida.split(/\r?\n/)) {
    if (/^([A-Za-z]:\\|\/)?\S+\.(ts|tsx|mjs|js)$/.test(linea)) {
      archivoActual = linea.trim().replace(/\\/g, '/').replace(/^.*?gitCronos\//, '');
      continue;
    }
    if (archivoActual && /^\s+\d+:\d+\s+error\s/.test(linea)) archivos.add(archivoActual);
  }
  return [...archivos];
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
    return salida.match(/Totals: \d+ passed, \d+ failed \(\d+ items\)/)?.[0] ?? '';
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

/**
 * El diff de un archivo contra la base, con los archivos nuevos sin seguimiento
 * como si se hubieran agregado enteros: `git diff` no los muestra, y por ese
 * hueco las trampas no vieron un eslint-disable y dos catch vacíos en los
 * módulos nuevos de modularizar-sdd (los encontró recién la completa).
 */
function diffAgregado(archivo) {
  const nuevo = git(`ls-files --others --exclude-standard -- "${archivo}"`).trim() !== '';
  if (!nuevo) return git(`diff -U0 ${base} -- "${archivo}"`);
  const contenido = existsSync(archivo) ? readFileSync(archivo, 'utf8') : '';
  return contenido.split(/\r?\n/).map((l) => `+${l}`).join('\n');
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
    const diff = diffAgregado(archivo);
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
    // Estilos fuera de los módulos CSS (regla de openspec/config.yaml). Medido en
    // estilos-02: `className="w-full"` en cuatro lugares y un `style={{ flexBasis }}`.
    if (archivo.endsWith('.tsx')) {
      const literales = texto.match(/className="[^"]+"/g) ?? [];
      if (literales.length > 0) {
        avisos.push(`${archivo}: className con texto literal (${literales.slice(0, 3).join(', ')}) → los estilos van en el módulo CSS del componente (\`className={styles.x}\`)`);
      }
      if (/style=\{\{/.test(texto)) {
        avisos.push(`${archivo}: estilo en línea (style={{…}}) → pasarlo al módulo CSS; sólo se admite un valor que se calcula al dibujar`);
      }
    }
  }

  // Clases que el componente usa y su módulo no define: dan `undefined` sin
  // ningún error. Medido en estilos-02: `styles.offer` quedó después de borrar `.offer`.
  for (const archivo of tocados.filter((f) => f.endsWith('.tsx') && existsSync(f))) {
    const codigo = readFileSync(archivo, 'utf8');
    const modulo = codigo.match(/import\s+styles\s+from\s+['"](\.{1,2}\/[^'"]+\.module\.css)['"]/)?.[1];
    if (!modulo) continue;
    const rutaModulo = `${archivo.replace(/[^/]+$/, '')}${modulo}`.replace(/\/\.\//g, '/');
    const normalizada = rutaModulo.split('/').reduce((acc, parte) => (parte === '..' ? acc.slice(0, -1) : [...acc, parte]), []).join('/');
    if (!existsSync(normalizada)) continue;
    const css = readFileSync(normalizada, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const definidas = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
    const usadas = new Set([...codigo.matchAll(/styles\.([A-Za-z_]\w*)|styles\[['"]([\w-]+)['"]\]/g)].map((m) => m[1] ?? m[2]));
    const faltan = [...usadas].filter((c) => !definidas.has(c));
    if (faltan.length > 0) {
      avisos.push(`${archivo}: usa ${faltan.map((c) => `styles.${c}`).join(', ')} y ${normalizada} no las define → borrar la referencia o definir la clase en ese módulo`);
    }
  }

  // Pruebas que se ablandan para pasar.
  const pruebas = tocados.filter((f) => /__tests__|\.test\.|\.e2e\./.test(f));
  for (const archivo of pruebas) {
    const agregado = diffAgregado(archivo).split(/\r?\n/)
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

  avisos.push(...pruebasQueNoCorren(tocados));

  // Capturas de la tanda más viejas que el código que dicen mostrar. Medido el
  // 2026-10-09: una captura de las 18:30 se entregó como evidencia de código que
  // siguió cambiando hasta las 19:04.
  avisos.push(...capturasViejas(tocados));
  for (const archivo of tocados.filter((f) => f.endsWith('.css'))) {
    const diff = diffAgregado(archivo);
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

/**
 * Pruebas tocadas que Vitest no corre porque su carpeta no está en el `include`
 * de vitest.config.ts: todo da verde y nadie se entera. Medido en retomar-07:
 * electron/assist/__tests__ no estaba incluida y la ejecutora lo vio de casualidad.
 */
function pruebasQueNoCorren(tocados) {
  const pruebas = tocados.filter((f) => /\.test\.tsx?$/.test(f) && !/\.e2e\./.test(f) && existsSync(f));
  if (pruebas.length === 0) return [];
  const { salida } = correr(`pnpm exec vitest list --filesOnly ${pruebas.map((f) => `"${f}"`).join(' ')}`);
  const listadas = new Set(salida.split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')));
  return pruebas
    .filter((f) => !listadas.has(f))
    .map((f) => `${f}: Vitest no corre esta prueba → sumar su carpeta al \`include\` de vitest.config.ts`);
}

/**
 * Cuánta auditoría pide la tanda, según lo que tocó. Los niveles y qué hace el
 * auditor en cada uno están en openspec/config.yaml; acá sólo se calculan, para
 * no decidirlo a ojo en cada tanda. Ante la duda, sube.
 */
function nivelDeRiesgo(tocados, avisos) {
  const SENSIBLE = /^(electron|scripts|\.github)\/|^lib\/(git|db|sqlite|persist|secure|security|ipc)|preload|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|next\.config\.[a-z]+)$/;
  const sensibles = tocados.filter((f) => SENSIBLE.test(f));
  const alto = [
    sensibles.length > 0 && `toca ${listaCorta(sensibles)}`,
    avisos.length > 0 && `${avisos.length} aviso(s) de trampas`,
  ].filter(Boolean);
  if (alto.length > 0) return { nivel: 'alto', motivos: alto };
  const logica = archivosConLogica(tocados);
  if (logica.length > 0) return { nivel: 'medio', motivos: [`lógica en ${listaCorta(logica)}`] };
  return { nivel: 'bajo', motivos: ['sólo estilos, marcado, textos, documentos o pruebas'] };
}

function listaCorta(archivos) {
  return `${archivos.slice(0, 3).join(', ')}${archivos.length > 3 ? '…' : ''}`;
}

/**
 * Lógica tocada: un .ts/.mjs de producción, o en un .tsx líneas cambiadas que no
 * son marcado, clases ni imports (estado, efectos, condiciones, funciones).
 */
function archivosConLogica(tocados) {
  const LOGICA = /\b(useState|useEffect|useMemo|useCallback|useRef|if\s*\(|await|return\s+[^(<]|function|=>|switch|throw|new\s+[A-Z])\b|\?\?|&&\s*[a-z]/;
  const codigo = tocados.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !ES_PRUEBA.test(f) && !ES_CATALOGO_TEXTOS(f));
  return codigo.filter((archivo) => {
    if (!archivo.endsWith('.tsx')) return true;
    return diffAgregado(archivo).split(/\r?\n/)
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
      .map((l) => l.slice(1).trim())
      .some((l) => l !== '' && !/^(import\s|\/\/|\/?\*|\{\/\*)/.test(l) && LOGICA.test(l));
  });
}

function main() {
  mkdirSync('tmp', { recursive: true });
  const registro = [];
  const renglones = [];
  const fallidos = [];
  const inicioTotal = Date.now();
  const tocados = archivosTocados();
  const tocadosTs = tocados.filter((f) => /\.(ts|tsx)$/.test(f));
  // Para `vitest related`: código y estilos que siguen existiendo (un archivo
  // borrado no tiene pruebas que dependan de él).
  const tocadosCodigoTodos = tocados.filter((f) => /\.(ts|tsx|mjs|js|css)$/.test(f) && existsSync(f));
  // lib/i18n.ts (y lib/i18n/) es el catálogo de textos y casi toda la interfaz lo importa: pasarlo
  // a `vitest related` arrastra unas 110 pruebas por agregar una palabra. Un texto
  // nuevo no cambia lógica; lo que puede romper (claves faltantes o sin usar) lo
  // cubren sus pruebas propias, y los componentes que usan el texto nuevo ya están
  // entre los tocados. Con --completa y --todo corre la suite entera igual.
  const tocaTextos = tocadosCodigoTodos.some(ES_CATALOGO_TEXTOS);
  const conTextos = tocaTextos
    ? [...tocadosCodigoTodos.filter((f) => !ES_CATALOGO_TEXTOS(f)), ...PRUEBAS_TEXTOS.filter((f) => existsSync(f))]
    : tocadosCodigoTodos;
  // Las pruebas de estilos leen los .css por ruta, sin importarlos: «vitest related»
  // no las encuentra. En modularizar-sdd sólo las corrió la completa.
  const tocaEstilos = tocadosCodigoTodos.some((f) => f.endsWith(".css"));
  const tocadosCodigo = tocaEstilos
    ? [...conTextos, ...PRUEBAS_ESTILOS.filter((f) => existsSync(f) && !conTextos.includes(f))]
    : conTextos;
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
      // Todas las specs y changes, no sólo el de la rama: dos segundos. Hasta el
      // 2026-10-11 validaba sólo el change y 28 specs llevaban meses con el
      // propósito «TBD» que deja `openspec archive` al crear una capacidad nueva.
      // Si vuelve a aparecer, se escribe el propósito real en la spec principal.
      nombre: 'openspec validate',
      comando: 'pnpm exec openspec validate --all --strict',
      cuando: true,
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
    // eslint: los heredados de la base se restan; falla sólo con errores nuevos.
    if (chequeo.nombre === 'eslint' && status !== 0) {
      const { nuevos, heredados } = erroresEslintNuevos(archivosConErrores(salida));
      if (nuevos.length === 0 && heredados > 0) {
        renglones.push(`OK ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  ${heredados} heredado(s) de ${base}, 0 nuevos (no son de esta tanda: no se arreglan salvo que el prompt lo pida)`);
        continue;
      }
      fallidos.push(chequeo.nombre);
      if (nuevos.length === 0) {
        renglones.push(`XX ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  exit ${status}`);
        renglones.push(ultimasLineas(salida, 25).replace(/^/gm, '    '));
        continue;
      }
      renglones.push(`XX ${chequeo.nombre.padEnd(18)} ${segundos.padStart(6)} s  ${nuevos.length} error(es) nuevos${heredados ? `, ${heredados} heredado(s)` : ''}`);
      for (const e of nuevos) renglones.push(`    ${e.archivo}:${e.linea} ${e.regla}`);
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
  if (avisos.length > 0) renglones.push('  Cada aviso se corrige o se explica en «Dudas» del reporte; no se esconde.');
  const riesgo = nivelDeRiesgo(tocados, avisos);
  renglones.push(`riesgo: ${riesgo.nivel} — ${riesgo.motivos.join('; ')} (qué audita cada nivel: openspec/config.yaml)`);

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
