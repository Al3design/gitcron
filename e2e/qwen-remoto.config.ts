// Comprobación manual con el túnel existente. No integra la suite sin servidores.
import base from './e2e.config';
import { web } from '@e2e-dev/web';
import { gitcronProvider } from './gitcron-provider';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'jsonc-parser';

export function buildSanitizedOpenCodeConfig(source: Record<string, any>): Record<string, any> {
  const unslothpc = source?.provider?.unslothpc;
  if (!unslothpc) throw new Error('La prueba requiere el bloque provider.unslothpc en la configuración');

  const options = unslothpc.options ?? {};
  for (const value of [options.apiKey, ...Object.values(options.headers ?? {})]) {
    if (typeof value !== 'string' || !/^\{env:[A-Za-z0-9_]+\}$/.test(value)) {
      throw new Error('La prueba requiere referencias de entorno, no claves literales');
    }
  }

  const model = 'unsloth/Qwen3.8-27B-GGUF';
  const sanitized: Record<string, any> = {
    $schema: source?.$schema ?? 'https://opencode.ai/config.json',
    provider: {
      unslothpc: {
        name: unslothpc.name,
        npm: unslothpc.npm,
        options: {
          baseURL: options.baseURL,
          apiKey: options.apiKey,
          ...(options.headers ? { headers: options.headers } : {}),
        },
        models: {
          [model]: unslothpc.models?.[model] ?? { name: 'Qwen 3.8 27B GGUF' },
        },
      },
    },
  };

  if (source?.agent?.tanda) {
    sanitized.agent = {
      tanda: source.agent.tanda,
    };
  }

  return sanitized;
}

function fixture(homeDir: string) {
  const original = parse(fs.readFileSync(path.join(os.homedir(), '.config', 'opencode', 'opencode.json'), 'utf8'));
  const source = original.provider.unslothpc;
  const options = source.options;
  for (const value of [options.apiKey, ...Object.values(options.headers ?? {})]) {
    if (typeof value !== 'string' || !/^\{env:[A-Za-z0-9_]+\}$/.test(value)) throw new Error('La prueba requiere referencias de entorno, no claves literales');
  }
  const model = 'unsloth/Qwen3.8-27B-GGUF';
  const config = {
    provider: { unslothpc: { name: source.name, npm: source.npm, options, models: { [model]: source.models[model] } } },
    agent: { 'gitcron-sdd': { model: `unslothpc/${model}` } },
  };
  const configDir = path.join(homeDir, '.config', 'gitcron');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'gitcron.json'), JSON.stringify(config, null, 2));

  // Copia representativa de opencode.json para el perfil aislado (sólo bloques necesarios y saneados)
  const opencodeConfigDir = path.join(homeDir, '.config', 'opencode');
  fs.mkdirSync(opencodeConfigDir, { recursive: true });
  const representativeOpenCode = buildSanitizedOpenCodeConfig(original);
  fs.writeFileSync(path.join(opencodeConfigDir, 'opencode.json'), JSON.stringify(representativeOpenCode, null, 2), 'utf8');

  const repo = path.join(homeDir, 'qwen-remoto-repo');
  fs.mkdirSync(repo);
  for (const args of [['init'], ['-c', 'user.name=Auditoría', '-c', 'user.email=prueba@example.invalid', 'commit', '--allow-empty', '-m', 'Prueba remota aislada']]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_NOSYSTEM: '1' } });
    if (result.status !== 0) throw new Error('No se pudo preparar el repositorio temporal');
  }
  // V2 lee el proveedor del repositorio, sin escribir en la configuración personal.
  fs.writeFileSync(path.join(repo, 'opencode.json'), JSON.stringify({ provider: config.provider }, null, 2));
  fs.writeFileSync(path.join(repo, 'semilla.txt'), 'Código de la prueba: 762941\n');

  // Repositorio temporal para tanda 28
  const tandaRepo = path.join(homeDir, 'tanda28-repo');
  fs.mkdirSync(tandaRepo, { recursive: true });
  for (const args of [['init'], ['-c', 'user.name=Auditoría', '-c', 'user.email=prueba@example.invalid', 'commit', '--allow-empty', '-m', 'Commit base tanda 28']]) {
    const result = spawnSync('git', args, { cwd: tandaRepo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_NOSYSTEM: '1' } });
    if (result.status !== 0) throw new Error('No se pudo preparar el repositorio tanda28');
  }
  fs.writeFileSync(path.join(tandaRepo, 'cronometria.txt'), 'Cálculo de métricas de temporización y resumen cronométrico para GitCron.\n', 'utf8');
  spawnSync('git', ['add', 'cronometria.txt'], { cwd: tandaRepo, windowsHide: true });
  spawnSync('git', ['-c', 'user.name=Auditoría', '-c', 'user.email=prueba@example.invalid', 'commit', '-m', 'Base cronometría'], { cwd: tandaRepo, windowsHide: true });
  fs.appendFileSync(path.join(tandaRepo, 'cronometria.txt'), 'Agregado: soporte de telemetría de latencia en milisegundos y cálculo de percentiles p95 y p99.\n', 'utf8');
}

function installedOpenCode(): string {
  const shim=(process.env.PATH??process.env.Path??'').split(path.delimiter)
    .map(dir=>path.join(dir,'opencode.cmd')).find(file=>fs.existsSync(file));
  const relative=shim?fs.readFileSync(shim,'utf8').match(/"%~dp0([^"\r\n]+opencode\.exe)"/i)?.[1]:null;
  if(!shim||!relative)throw new Error('La comprobación manual requiere el CLI de OpenCode instalado con su shim de Windows');
  return fs.realpathSync(path.resolve(path.dirname(shim),relative.replace(/^[\\/]+/,'')));
}
const realCli=installedOpenCode();
const cliEnv={ HOME:os.homedir(), USERPROFILE:os.homedir(), APPDATA:process.env.APPDATA, LOCALAPPDATA:process.env.LOCALAPPDATA };
const serviceStatus=spawnSync(realCli,['service','status'],{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,...cliEnv}});
if(serviceStatus.status!==0||!/^https?:\/\/\S+$/m.test(serviceStatus.stdout??'')) {
  throw new Error('La comprobación manual requiere el servicio de OpenCode ya abierto; no lo inicia ni reinicia');
}
function bindExistingService(homeDir: string): Record<string,string> {
  const bin=path.join(homeDir,'runtime-bin');fs.mkdirSync(bin);
  const script=path.join(bin,'opencode-existing-service.cjs');
  fs.writeFileSync(script, `
const {spawn}=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='service'&&args[1]!=='status') { process.stderr.write('No se modifica el servicio existente'); process.exit(1); }
{
  const child=spawn(${JSON.stringify(realCli)},args,{stdio:'inherit',windowsHide:true,env:{...process.env,...${JSON.stringify(cliEnv)}}});
  child.on('error',()=>process.exit(1));child.on('close',code=>process.exit(code??1));
}
`, 'utf8');
  fs.writeFileSync(path.join(bin,'opencode.cmd'),`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return {PATH:`${bin}${path.delimiter}${process.env.PATH??''}`};
}

export default {
  ...base,
  tests: ['qwen-tests/**/*.e2e.ts'],
  timeout: 240_000,
  targets: [{ ...base.targets[0], name: 'qwen-remoto', engine: web({
    browser: gitcronProvider({ fixture, afterSeed:bindExistingService }), viewport: null,
    initScripts: [() => { const sheet = new CSSStyleSheet(); sheet.replaceSync('nextjs-portal { display:none !important }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }],
  }) }],
};
