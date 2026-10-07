// e2e/gitcron-provider.ts
//
// Proveedor de e2e que abre un GitCron nuevo y aislado por intento (D20 / tanda 26).
// - Perfil propio: GITCRON_PROFILE_DIR en una carpeta temporal (electron/profile.ts de GitCron).
// - Puerto de depuración libre por intento; e2e se engancha por CDP.
// - Al soltar el intento: se mata el árbol del proceso y se borra el perfil.
// - sweep: limpieza al final de la corrida para procesos o perfiles huérfanos.

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import { createRequire } from 'module';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(fileURLToPath(import.meta.url));
const ELECTRON = require('electron') as string;

const CONFIG_DIR = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const GITCRON_DIR = path.resolve(CONFIG_DIR, '..');
const RENDERER = process.env.GITCRON_RENDERER ?? 'http://localhost:3001';

interface Running {
  child: ChildProcess;
  profile: string;
  mockServer?: http.Server;
}
const running = new Map<string, Running>();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Prefijo de las carpetas de perfil y marca de los procesos de una corrida, para encontrarlos en `sweep`. */
function runTag(runId: string): string {
  return `gitcron-e2e-${runId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}`;
}

/**
 * Pids de los GitCron que lanzó una corrida, por la marca `--gitcron-e2e-run=<tag>` de su línea de
 * comandos (Chromium ignora un parámetro que no conoce). `sweep` corre en el proceso principal de
 * e2e, que no tiene el mapa `running` de los trabajadores: tiene que encontrarlos por fuera.
 */
function pidsWithTag(tag: string): number[] {
  const marker = `--gitcron-e2e-run=${tag}`;
  if (process.platform === 'win32') {
    const script = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`;
    const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).stdout ?? '';
    return out.split(/\s+/).filter(Boolean).map(Number).filter((pid) => pid > 0);
  }
  const out = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout ?? '';
  return out
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => pid > 0);
}

function killProcessTree(pid: number): void {
  // Un pid 0 o negativo no es un GitCron: en Linux y macOS `kill(-0)` mataría el grupo entero,
  // la corrida de e2e incluida.
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // proceso ya terminado
      }
    }
  }
}

/** Espera a que la ventana principal (la pantalla de GitCron, no el splash) sea la única página. */
async function waitForMainPage(port: number, signal: AbortSignal, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await res.json()) as Array<{ type: string; url: string }>;
      const pages = targets.filter((t) => t.type === 'page');
      if (pages.length === 1 && pages[0].url.startsWith(RENDERER)) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`GitCron no mostró su ventana principal en ${timeoutMs} ms (puerto ${port})`);
}

function seedDefaultTestConfig(homeDir: string, mockPort: number): void {
  const configDir = path.join(homeDir, '.config', 'gitcron');
  fs.mkdirSync(configDir, { recursive: true });
  const configFile = path.join(configDir, 'gitcron.json');
  if (fs.existsSync(configFile)) return;

  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'test-provider': {
        name: 'Servidor de prueba',
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: `http://127.0.0.1:${mockPort}/v1`,
        },
        models: {
          'test-model-1': {
            name: 'Modelo de prueba 1',
          },
        },
      },
    },
  };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
}

export function gitcronProvider(options: { fixture?: (homeDir: string) => void; afterSeed?: (homeDir: string) => Record<string, string> } = {}) {
  return {
    name: 'gitcron',
    scope: 'attempt' as const,
    async acquire(request: { runId: string; attemptId?: string; signal: AbortSignal; log: (line: string) => void }) {
      const tag = runTag(request.runId);
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), `${tag}-`));
      if (!profile || !fs.existsSync(profile)) {
        throw new Error('No se pudo crear la carpeta temporal para GITCRON_PROFILE_DIR');
      }

      const homeDir = path.join(profile, 'home');
      fs.mkdirSync(homeDir, { recursive: true });

      let mockServer: http.Server | undefined;
      if (options.fixture) {
        options.fixture(homeDir);
      } else {
        mockServer = http.createServer((req, res) => {
          if (req.url?.includes('/models')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              data: [{ id: 'test-model-1', object: 'model' }],
            }));
            return;
          }
          res.writeHead(404);
          res.end();
        });
        await new Promise<void>((resolve, reject) => {
          mockServer?.listen(0, '127.0.0.1', () => resolve());
          mockServer?.on('error', reject);
        });
        const mockPort = (mockServer.address() as net.AddressInfo).port;
        seedDefaultTestConfig(homeDir, mockPort);
      }

      let fixtureEnv: Record<string, string>;
      try {
        fixtureEnv = options.afterSeed?.(homeDir) ?? {};
      } catch (error) {
        mockServer?.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        throw error;
      }
      const port = await freePort();
      const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${port}`, `--gitcron-e2e-run=${tag}`], {
        cwd: GITCRON_DIR,
        env: { ...process.env, ...fixtureEnv, GITCRON_PROFILE_DIR: profile },
        stdio: 'ignore',
        detached: process.platform !== 'win32',
        windowsHide: false,
      });
      // Sin escuchador, un Electron que no arranca (ENOENT) tira la corrida entera.
      let spawnError: Error | undefined;
      child.on('error', (error) => {
        spawnError = error;
      });

      const cleanup = () => {
        mockServer?.close();
        if (child.pid !== undefined) killProcessTree(child.pid);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      };

      if (!child.pid) {
        cleanup();
        throw new Error('No se pudo iniciar el proceso de Electron para GitCron');
      }

      const id = `gitcron-${child.pid}`;
      request.log(`GitCron aislado pid ${child.pid}, puerto ${port}, perfil ${profile}`);
      try {
        await waitForMainPage(port, request.signal);
        if (spawnError) throw spawnError;
      } catch (error) {
        // e2e llama a `release` sólo para lo que `acquire` entregó: un arranque que falla o se
        // cancela se limpia acá, o queda un GitCron abierto con su perfil.
        cleanup();
        throw error;
      }
      running.set(id, { child, profile, mockServer });
      const endpoint = `http://127.0.0.1:${port}`;
      return { id, cdpEndpoint: endpoint, reconnectEndpoint: endpoint };
    },
    async release(lease: { id: string }) {
      const entry = running.get(lease.id);
      if (!entry) return;
      running.delete(lease.id);
      if (entry.mockServer) {
        entry.mockServer.close();
      }
      if (entry.child.pid !== undefined) {
        killProcessTree(entry.child.pid);
      }
      fs.rmSync(entry.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
    // Corre en el proceso principal de e2e al final de la corrida, después de que salieron los
    // trabajadores: encuentra lo que dejó un trabajador que murió por la marca de la corrida.
    async sweep(context: { runId: string }) {
      const tag = runTag(context.runId);
      const swept: string[] = [];
      for (const pid of pidsWithTag(tag)) {
        killProcessTree(pid);
        swept.push(`gitcron-${pid}`);
      }
      for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(`${tag}-`)) continue;
        try {
          fs.rmSync(path.join(os.tmpdir(), entry.name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          // mejor esfuerzo: una carpeta tomada se va en la próxima limpieza del sistema
        }
      }
      return swept;
    },
  };
}
