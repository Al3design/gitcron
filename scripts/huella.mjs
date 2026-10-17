// scripts/huella.mjs
//
// Huella del código que se entrega: el commit base, el diff contra él y el contenido de
// los archivos nuevos sin seguimiento. La usan `pnpm verificar --tanda` y `pnpm captura`
// para que el auditor sepa, sin volver a correr nada, si lo verificado o capturado es el
// código de ahora (2026-10-17).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

function gitSalida(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.stdout ?? '';
}

export function huellaDelCodigo(base = 'HEAD') {
  const hash = createHash('sha1');
  hash.update(gitSalida(['rev-parse', base]).trim());
  hash.update(gitSalida(['diff', base, '--no-color']));
  const nuevos = gitSalida(['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter((f) => f.trim() !== '')
    .sort();
  for (const f of nuevos) {
    hash.update(`\n${f}\n`);
    if (existsSync(f) && statSync(f).isFile()) hash.update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, 16);
}
