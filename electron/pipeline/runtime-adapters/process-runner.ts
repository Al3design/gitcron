import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const MAX_STDIN_BYTES = 64 * 1024;

const BASE_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'ComSpec',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
] as const;

export interface RuntimeProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  expectedCanonicalCwd: string;
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  killGraceMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

export interface RuntimeProcessResult {
  processId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimit: 'stdout' | 'stderr' | null;
}

export interface RuntimeProcessHandle {
  processId: string;
  result: Promise<RuntimeProcessResult>;
  terminate(): boolean;
}

type OwnedProcess = {
  child: ChildProcessWithoutNullStreams;
  terminate: (reason: 'timeout' | 'abort' | 'output_limit') => void;
};

const SHELL_SPECIAL = /[\s&|<>^()]/;

/**
 * Con `shell: true` Node une el comando y los argumentos con espacios sin
 * entrecomillar nada: una carpeta con espacio parte el argumento en dos y un `&`
 * en su nombre empieza otro comando. Para un `.cmd`/`.bat` se entrecomilla lo que
 * lo necesita. `"` y `%` no se pueden proteger dentro de comillas (el shell aún
 * expande `%VAR%`): un argumento con alguno no se pasa.
 */
export function quoteForShell(value: string): string {
  if (value.includes('"') || value.includes('%')) throw new Error('Runtime arg is not safe for the shell');
  return value === '' || SHELL_SPECIAL.test(value) ? `"${value}"` : value;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function minimalEnvironment(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of BASE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!key || key.includes('\0') || value.includes('\0')) throw new Error('Invalid runtime environment entry');
    env[key] = value;
  }
  return env;
}

async function assertCanonicalCwd(cwd: string, expected: string): Promise<string> {
  const [actualPath, expectedPath] = await Promise.all([fs.realpath(cwd), fs.realpath(expected)]);
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(actualPath) !== normalize(expectedPath)) throw new Error('Runtime cwd does not match the bound repository');
  return actualPath;
}

export interface RuntimeExecutableResolution {
  file: string;
  viaShell: boolean;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
const DIRECT_EXTENSIONS = new Set(['.com', '.exe']);
const SHELL_EXTENSIONS = new Set(['.bat', '.cmd']);

function fileExtension(name: string): string {
  const base = name.toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

// Resuelve un ejecutable con la misma semántica que cmd.exe recorre PATH por
// directorio y PATHEXT, pero declarando el entorno usado. Node/libuv solo
// intenta `.com`/`.exe` para nombres sin extensión (src/win/process.c), así
// que un shim `codex.cmd` o `opencode.CMD` nunca se encuentra solo; y
// CreateProcess rechaza lanzar batch files directamente (Node lo mapea a
// EINVAL en src/process_wrap.cc), por eso los candidatos `.bat`/`.cmd` se
// marcan para pasar por el shell.
// El parámetro es un mapa de variables (no NodeJS.ProcessEnv) porque solo se leen PATH/Path/PATHEXT.
export async function resolveRuntimeExecutable(
  name: string,
  env: Record<string, string | undefined>,
): Promise<RuntimeExecutableResolution> {
  if (name.includes('\\') || name.includes('/')) {
    return { file: name, viaShell: SHELL_EXTENSIONS.has(fileExtension(name)) };
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  const directories = pathValue.split(';').filter((entry) => entry.trim() !== '');
  const rawPathExt = (env.PATHEXT ?? '').trim();
  const extensions = (rawPathExt || DEFAULT_PATHEXT)
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const hasExtension = fileExtension(name) !== '';
  let bareCandidate: string | null = null;

  for (const directory of directories) {
    const base = path.join(directory, name);
    const candidates = hasExtension ? [base] : extensions.map((extension) => `${base}${extension}`);
    for (const candidate of candidates) {
      try {
        if (!(await fs.stat(candidate)).isFile()) continue;
      } catch {
        continue;
      }
      const extension = fileExtension(candidate);
      if (DIRECT_EXTENSIONS.has(extension)) return { file: candidate, viaShell: false };
      if (SHELL_EXTENSIONS.has(extension)) return { file: candidate, viaShell: true };
      throw new Error(
        `Runtime executable '${name}' resolved to ${candidate} in the application environment PATH, which this application cannot launch`,
      );
    }
    if (!hasExtension && bareCandidate === null) {
      try {
        if ((await fs.stat(base)).isFile()) bareCandidate = base;
      } catch {
        // Sin candidato sin extensión en este directorio.
      }
    }
  }

  if (bareCandidate !== null) {
    throw new Error(
      `Runtime executable '${name}' was found as ${bareCandidate} in the application environment PATH, but it has no launchable Windows form (.exe, .com, .bat or .cmd)`,
    );
  }
  throw new Error(
    `Runtime executable '${name}' was not found in the application environment PATH (${directories.length} directories, PATHEXT: ${rawPathExt || DEFAULT_PATHEXT})`,
  );
}

export class RuntimeProcessRunner {
  private readonly owned = new Map<string, OwnedProcess>();

  ownedProcessCount(): number {
    return this.owned.size;
  }

  async run(spec: RuntimeProcessSpec): Promise<RuntimeProcessResult> {
    const handle = await this.start(spec);
    return handle.result;
  }

  async start(spec: RuntimeProcessSpec): Promise<RuntimeProcessHandle> {
    if (!spec.executable.trim() || spec.executable.includes('\0')) throw new Error('Runtime executable is required');
    if (spec.args.some((arg) => arg.includes('\0'))) throw new Error('Runtime args contain a null byte');
    if (spec.stdin && Buffer.byteLength(spec.stdin) > MAX_STDIN_BYTES) throw new Error('Runtime stdin exceeds limit');
    if (spec.signal?.aborted) throw new Error('Runtime execution aborted before start');

    const cwd = await assertCanonicalCwd(spec.cwd, spec.expectedCanonicalCwd);
    const timeoutMs = positiveLimit(spec.timeoutMs, DEFAULT_TIMEOUT_MS);
    const killGraceMs = positiveLimit(spec.killGraceMs, DEFAULT_KILL_GRACE_MS);
    const maxStdoutBytes = positiveLimit(spec.maxStdoutBytes, DEFAULT_MAX_BYTES);
    const maxStderrBytes = positiveLimit(spec.maxStderrBytes, DEFAULT_MAX_BYTES);
    const processId = randomUUID();
    const startedAt = Date.now();

    let resolveResult!: (result: RuntimeProcessResult) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<RuntimeProcessResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    let child: ChildProcessWithoutNullStreams;
    let viaShell = false;
    try {
      const env = minimalEnvironment(spec.env);
      const resolution = await resolveRuntimeExecutable(spec.executable, env);
      // `viaShell` solo para batch files: Node no puede CreateProcess un
      // `.cmd`/`.bat` directo (EINVAL), y el shell aplica su quoting estándar.
      const file = resolution.viaShell ? quoteForShell(resolution.file) : resolution.file;
      const args = resolution.viaShell ? spec.args.map(quoteForShell) : [...spec.args];
      viaShell = resolution.viaShell;
      child = spawn(file, args, {
        cwd,
        env,
        shell: resolution.viaShell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectResult(error);
      return { processId, result, terminate: () => false };
    }

    {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let aborted = false;
      let outputLimit: 'stdout' | 'stderr' | null = null;
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | null = null;
      let treeKillPending = false;
      let forceWaitingTreeKill = false;

      const force = () => {
        // Matar la consola antes de que `taskkill` recorra el árbol deja al programa sin padre:
        // `taskkill` ya no lo encuentra y sigue vivo. Con la máquina cargada, `taskkill` tarda en
        // arrancar más que el margen, así que el golpe final espera a que termine.
        if (treeKillPending) {
          forceWaitingTreeKill = true;
          return;
        }
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        // Un nieto que se escapó del árbol (lanzado justo mientras se mataba la consola)
        // hereda las salidas y las mantiene abiertas: sin cerrarlas, 'close' no llega nunca
        // y la corrida queda colgada. Pasado el margen, se cierran desde este lado.
        child.stdout.destroy();
        child.stderr.destroy();
      };

      const terminate = (reason: 'timeout' | 'abort' | 'output_limit') => {
        if (reason === 'timeout') timedOut = true;
        if (reason === 'abort') aborted = true;
        if (viaShell && process.platform === 'win32' && child.pid !== undefined && child.exitCode === null) {
          // El proceso de Node es la consola (`cmd`) que lanzó el programa de verdad: matarla
          // con `kill` deja al programa vivo y trabajando (un agente con `--auto` seguiría
          // escribiendo en el repositorio después de «Detener»). `taskkill /T` mata el árbol.
          if (!treeKillPending) {
            treeKillPending = true;
            const treeKill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            const done = (failed: boolean) => {
              if (!treeKillPending) return;
              treeKillPending = false;
              if (failed) child.kill('SIGTERM');
              if (forceWaitingTreeKill) force();
            };
            treeKill.once('error', () => done(true));
            treeKill.once('close', () => done(false));
          }
        } else if (!child.killed) {
          child.kill('SIGTERM');
        }
        if (!forceTimer) {
          forceTimer = setTimeout(force, killGraceMs);
          forceTimer.unref?.();
        }
      };

      this.owned.set(processId, { child, terminate });
      const timeout = setTimeout(() => terminate('timeout'), timeoutMs);
      timeout.unref?.();
      const onAbort = () => terminate('abort');
      spec.signal?.addEventListener('abort', onAbort, { once: true });

      const collect = (target: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const current = stream === 'stdout' ? stdoutBytes : stderrBytes;
        const maximum = stream === 'stdout' ? maxStdoutBytes : maxStderrBytes;
        const remaining = Math.max(0, maximum - current);
        if (remaining > 0) target.push(chunk.subarray(0, remaining));
        if (stream === 'stdout') {
          stdoutBytes += Math.min(chunk.length, remaining);
          spec.onStdout?.(chunk.subarray(0, remaining));
        } else {
          stderrBytes += Math.min(chunk.length, remaining);
          spec.onStderr?.(chunk.subarray(0, remaining));
        }
        if (chunk.length > remaining && !outputLimit) {
          outputLimit = stream;
          terminate('output_limit');
        }
      };

      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk, 'stdout'));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk, 'stderr'));

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        spec.signal?.removeEventListener('abort', onAbort);
        this.owned.delete(processId);
        rejectResult(error);
      });

      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        spec.signal?.removeEventListener('abort', onAbort);
        this.owned.delete(processId);
        resolveResult({
          processId,
          exitCode,
          signal,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          durationMs: Date.now() - startedAt,
          timedOut,
          aborted,
          outputLimit,
        });
      });

      if (spec.stdin !== undefined) child.stdin.end(spec.stdin);
      else child.stdin.end();
    }

    return {
      processId,
      result,
      terminate: () => this.terminateOwned(processId),
    };
  }

  terminateOwned(processId: string): boolean {
    const owned = this.owned.get(processId);
    if (!owned) return false;
    owned.terminate('abort');
    return true;
  }
}
