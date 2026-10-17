// electron/carto/screen-capture/dev-server.ts
//
// Control del servidor de desarrollo temporal para captura de pantallas (decisión 11).

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { resolveRuntimeExecutable, quoteForShell } from '../../pipeline/runtime-adapters/process-runner';
import { defaultKillTree } from '../../ai/cli-text-client';
import type { StartCommand } from './start-command';

export interface DevServerHandle {
  url: string;
  stop(): void;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('No se pudo obtener un puerto libre')));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Si el proyecto ya está corriendo en uno de los puertos que declaran sus scripts, devuelve ese
 * servidor con un `stop` que no hace nada: no es de GitCron y no se apaga. Arrancar otro servidor
 * de desarrollo sobre la misma carpeta rompe el que está corriendo (medido en carto-05b).
 */
export async function findRunningServer(ports: number[]): Promise<DevServerHandle | null> {
  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      await fetch(`${url}/`, { signal: controller.signal });
      return { url, stop() { /* No es de GitCron: queda corriendo. */ } };
    } catch {
      // Nadie contesta en ese puerto: se prueba el siguiente.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const URL_REGEX =/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/i;

export async function startDevServer(
  root: string,
  cmd: StartCommand,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DevServerHandle> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (options.signal?.aborted) {
    throw new Error('Inicio del servidor cancelado');
  }

  const port = await getFreePort();
  const portStr = String(port);

  let targetExecutable = cmd.executable;
  if (
    process.platform === 'win32' &&
    (targetExecutable.includes('\\') || targetExecutable.includes('/')) &&
    !targetExecutable.toLowerCase().endsWith('.cmd') &&
    !targetExecutable.toLowerCase().endsWith('.bat') &&
    !targetExecutable.toLowerCase().endsWith('.exe')
  ) {
    if (fs.existsSync(`${targetExecutable}.cmd`)) {
      targetExecutable = `${targetExecutable}.cmd`;
    }
  }

  const resolution = await resolveRuntimeExecutable(targetExecutable, process.env as Record<string, string | undefined>);
  const rawArgs = cmd.args.map((arg) => arg.replace('{port}', portStr));

  const launchFile = resolution.viaShell ? quoteForShell(resolution.file) : resolution.file;
  const launchArgs = resolution.viaShell ? rawArgs.map(quoteForShell) : rawArgs;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BROWSER: 'none',
    PORT: portStr,
  };

  const child: ChildProcess = spawn(launchFile, launchArgs, {
    cwd: root,
    shell: resolution.viaShell,
    windowsHide: true,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const outputLines: string[] = [];
  function recordOutput(chunk: Buffer | string) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        outputLines.push(line);
        if (outputLines.length > 20) {
          outputLines.shift();
        }
      }
    }
  }

  return await new Promise<DevServerHandle>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      defaultKillTree(child);
      const trail = outputLines.length > 0 ? `\n\nÚltimas líneas de salida:\n${outputLines.join('\n')}` : '';
      reject(new Error(`${reason}${trail}`));
    };

    const succeed = (serverUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        url: serverUrl,
        stop() {
          defaultKillTree(child);
        },
      });
    };

    const onAbort = () => {
      fail('Inicio del servidor cancelado');
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort);
    }

    timeoutTimer = setTimeout(() => {
      fail(`Tiempo de espera agotado al iniciar el servidor de desarrollo (${Math.round(timeoutMs / 1000)}s)`);
    }, timeoutMs);

    const checkChunk = (chunk: Buffer) => {
      recordOutput(chunk);
      const text = chunk.toString('utf8');
      const match = text.match(URL_REGEX);
      if (match) {
        succeed(match[0]);
      }
    };

    child.stdout?.on('data', checkChunk);
    child.stderr?.on('data', checkChunk);

    child.on('error', (err) => {
      fail(`Error al ejecutar el servidor de desarrollo: ${err.message}`);
    });

    child.on('close', (code, signal) => {
      const exitInfo = code !== null ? `código ${code}` : `señal ${signal}`;
      fail(`El servidor de desarrollo terminó antes de responder (${exitInfo})`);
    });

    // Sondeo periódico cada 500 ms con fetch
    pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const testUrl = `http://127.0.0.1:${portStr}/`;
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 400);
        try {
          await fetch(testUrl, { signal: controller.signal });
          clearTimeout(fetchTimeout);
          succeed(`http://127.0.0.1:${portStr}`);
        } catch {
          clearTimeout(fetchTimeout);
        }
      } catch {
        // En espera de que el servidor acepte conexiones
      }
    }, 500);
  });
}
