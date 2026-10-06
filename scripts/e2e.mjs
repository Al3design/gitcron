#!/usr/bin/env node
// scripts/e2e.mjs
//
// Lanza el CLI de e2e apuntando a la configuración e2e/e2e.config.ts
// con la telemetría apagada siempre (E2E_TELEMETRY_DISABLED=1, DO_NOT_TRACK=1).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'node_modules', 'e2e', 'dist', 'cli', 'bin.js');
const CONFIG_PATH = path.join(ROOT_DIR, 'e2e', 'e2e.config.ts');

const args = process.argv.slice(2);
const hasConfig = args.includes('--config');
const finalArgs = hasConfig ? args : [...args, '--config', CONFIG_PATH];

const child = spawn(process.execPath, [CLI_PATH, ...finalArgs], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  },
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
