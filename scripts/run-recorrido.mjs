#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'node_modules', 'e2e', 'dist', 'cli', 'bin.js');
const CONFIG_PATH = path.join(ROOT_DIR, 'e2e', 'qwen-remoto.config.ts');
const REPORT_DIR = path.join(ROOT_DIR, 'tmp', 'reportes', process.env.TANDA_REPORT_DIR || 'tanda-29d');
fs.mkdirSync(REPORT_DIR, { recursive: true });

function fileSha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

const grepArg = process.argv[2]; // e.g. "Recorrido 1" or "Recorrido 7"
const isRecorrido7 = Boolean(grepArg && grepArg.includes('7'));
const targetTestRel = isRecorrido7 ? 'e2e/qwen-tests/tanda-29-recorrido-7.e2e.ts' : 'e2e/qwen-tests/tanda-29.e2e.ts';
const targetTestAbs = path.join(ROOT_DIR, targetTestRel);

const testSha = fileSha256(targetTestAbs);
const configSha = fileSha256(CONFIG_PATH);

const logName = process.argv[3] || (grepArg ? `${grepArg.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.log` : 'suite-29d.log');
const logPath = path.join(REPORT_DIR, logName);
const logStream = fs.createWriteStream(logPath, { encoding: 'utf8' });

const shaHeader = `[Runner 29d] SHA-256 ${targetTestRel}: ${testSha}\n[Runner 29d] SHA-256 e2e/qwen-remoto.config.ts: ${configSha}\n`;
process.stdout.write(shaHeader);
logStream.write(shaHeader);

console.log(`[Runner 29d] Ejecutando e2e con config: ${CONFIG_PATH}`);
console.log(`[Runner 29d] Archivo de prueba: ${targetTestRel}`);
if (grepArg) console.log(`[Runner 29d] Filtro grep: "${grepArg}"`);
console.log(`[Runner 29d] Guardando log UTF-8 en: ${logPath}`);

const testCliArg = isRecorrido7 ? 'qwen-tests/tanda-29-recorrido-7.e2e.ts' : 'qwen-tests/tanda-29.e2e.ts';
const cliArgs = ['run', testCliArg, '--config', CONFIG_PATH];
if (grepArg) {
  cliArgs.push('--grep', grepArg);
}

const child = spawn(process.execPath, [CLI_PATH, ...cliArgs], {
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    E2E_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  },
});

child.stdout.on('data', (data) => {
  process.stdout.write(data);
  logStream.write(data);
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

child.on('close', (code) => {
  const exitMsg = `\n[Runner 29c] Proceso finalizado con código: ${code}\n`;
  process.stdout.write(exitMsg);
  logStream.write(exitMsg);
  logStream.end();
  process.exit(code ?? 0);
});
