#!/usr/bin/env node
// scripts/captura.mjs
//
// `pnpm captura <tanda>`: saca las capturas de una tanda con la prueba de pantalla que
// escribió el orquestador en tmp/prompts/<tanda>.captura.e2e.ts, una sola vez.
//
// Por qué (2026-10-17, Ale): desde el 2026-10-16 las capturas las sacaba el orquestador
// escribiendo y corriendo una prueba temporal en cada auditoría; le costaba tiempo y
// tokens. Antes de eso las sacaba la ejecutora a mano y a veces entregó maquetas como
// «captura real». Ahora la prueba la escribe el orquestador en el prompt, la corre la
// ejecutora con este script, y el script deja las imágenes junto con un manifiesto
// (huella del código, fecha, resultado) que el auditor compara sin volver a correr nada.
//
// Pasos: si se tocó electron/ desde HEAD, `pnpm build:electron`; copia la prueba a
// e2e/tests/zz-<tanda>.e2e.ts; la corre; copia las capturas a
// tmp/reportes/<tanda>/capturas/ (sin el prefijo 001-); escribe manifiesto.json; borra
// la prueba temporal. Si la prueba falla, igual copia lo que haya y la ruta de screen.txt.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { huellaDelCodigo } from './huella.mjs';

const tanda = process.argv[2];
if (!tanda || tanda.startsWith('-')) {
  console.warn('Uso: pnpm captura <tanda>   (la prueba va en tmp/prompts/<tanda>.captura.e2e.ts)');
  process.exit(2);
}

const ORIGEN = `tmp/prompts/${tanda}.captura.e2e.ts`;
const PRUEBA = `e2e/tests/zz-${tanda}.e2e.ts`;
const DESTINO = `tmp/reportes/${tanda}/capturas`;
const ARTEFACTOS = 'e2e/.e2e/artifacts/gitcron';

function correr(comando, opciones = {}) {
  const r = spawnSync(comando, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opciones });
  return { salida: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, status: r.status ?? 1 };
}

/** La misma huella que `pnpm verificar --tanda`. */
const huella = () => huellaDelCodigo('HEAD');

if (!existsSync(ORIGEN)) {
  console.warn(`No está ${ORIGEN}: la prueba de captura la escribe el orquestador en el prompt.`);
  process.exit(2);
}

const huellaAntes = huella();
const tocaElectron = correr('git diff --name-only HEAD').salida.split(/\r?\n/).some((f) => f.startsWith('electron/'))
  || correr('git ls-files --others --exclude-standard electron').salida.trim() !== '';
if (tocaElectron) {
  console.warn('Se tocó electron/: pnpm build:electron…');
  const b = correr('pnpm build:electron');
  if (b.status !== 0) {
    console.warn(`XX build:electron falló:\n${b.salida.split(/\r?\n/).slice(-20).join('\n')}`);
    process.exit(1);
  }
}

copyFileSync(ORIGEN, PRUEBA);
const inicio = Date.now();
let r;
try {
  console.warn(`Corriendo ${PRUEBA} (una vez)…`);
  r = correr(`node scripts/e2e.mjs run tests/zz-${tanda}.e2e.ts`, {
    env: { ...process.env, FORCE_COLOR: '0', E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
  });
} finally {
  rmSync(PRUEBA, { force: true });
}
const segundos = Math.round((Date.now() - inicio) / 1000);
const paso = r.status === 0;

// La carpeta de artefactos de esta corrida: la más nueva cuyo nombre lleva zz-<tanda>.
const carpetas = existsSync(ARTEFACTOS)
  ? readdirSync(ARTEFACTOS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.includes(`zz-${tanda}`))
      .map((d) => path.join(ARTEFACTOS, d.name))
      .filter((d) => statSync(d).mtimeMs >= inicio - 5_000)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  : [];
const intento = carpetas[0] ? path.join(carpetas[0], 'default', 'attempt-0') : null;
const capturasDir = intento ? path.join(intento, 'screenshots') : null;

rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });
const copiadas = [];
if (capturasDir && existsSync(capturasDir)) {
  for (const f of readdirSync(capturasDir).filter((n) => n.endsWith('.png')).sort()) {
    const nombre = f.replace(/^\d{3}-/, '');
    copyFileSync(path.join(capturasDir, f), path.join(DESTINO, nombre));
    copiadas.push(nombre);
  }
}
const screenTxt = intento && existsSync(path.join(intento, 'failure', 'screen.txt')) ? path.join(intento, 'failure', 'screen.txt') : null;
const consola = r.salida.split(/\r?\n/).filter((l) => /^(stdout|RESUMEN|DATO)\b|^\s*(✓|×|FAIL)/.test(l.trim()) || /RESUMEN|DATO/.test(l)).slice(0, 40);

const manifiesto = {
  tanda,
  paso,
  segundos,
  fecha: new Date().toISOString(),
  huella: huellaAntes,
  // Si el código cambió mientras corría la prueba, las capturas no valen.
  huellaCambioDurante: huella() !== huellaAntes,
  capturas: copiadas,
  screenTxt,
  consola,
};
writeFileSync(path.join(DESTINO, 'manifiesto.json'), `${JSON.stringify(manifiesto, null, 2)}\n`, 'utf8');

console.warn([
  '',
  `CAPTURA ${tanda}: ${paso ? 'OK' : 'FALLÓ'} (${segundos} s) · ${copiadas.length} imagen(es) en ${DESTINO}`,
  ...copiadas.map((c) => `  ${c}`),
  screenTxt ? `  pantalla al fallar: ${screenTxt}` : '',
  `Manifiesto: ${DESTINO}/manifiesto.json (huella ${huellaAntes})`,
  paso ? '' : 'No se repite: anotalo en «Dudas» y entregá (AGENTS.md §4).',
].filter(Boolean).join('\n'));
process.exitCode = paso ? 0 : 1;
