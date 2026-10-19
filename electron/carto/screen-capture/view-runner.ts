// electron/carto/screen-capture/view-runner.ts
//
// Ejecución de capturas de vistas usando el sistema de pruebas e2e del proyecto (decisión 13).

import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultKillTree } from '../../ai/cli-text-client';
import { resolveRuntimeExecutable } from '../../pipeline/runtime-adapters/process-runner';
import type { CaptureRecipes } from './recipes';
import { buildRecipeTest, type ShotMapping } from './recipe-test';

export interface ViewRunResult {
  images: Map<string, Buffer /* PNG */>;
  failed: { screenId: string; detail: string }[];
  error?: string;
}

export interface ViewRunnerDeps {
  spawn?: typeof spawn;
  fs?: {
    existsSync(p: string): boolean;
    mkdirSync(p: string, opts?: { recursive?: boolean }): unknown;
    writeFileSync(p: string, data: string | Buffer, enc?: BufferEncoding): void;
    unlinkSync(p: string): void;
    readdirSync(p: string, opts?: { withFileTypes?: boolean }): any[];
    statSync(p: string): { mtimeMs: number; isDirectory(): boolean };
    readFileSync(p: string): Buffer;
  };
}

export function viewRunnerAvailable(
  root: string,
  recipes: CaptureRecipes,
  deps?: ViewRunnerDeps,
): boolean {
  const fsImpl = deps?.fs ?? fs;
  const binJs = path.join(root, 'node_modules', 'e2e', 'dist', 'cli', 'bin.js');
  const config = path.join(root, recipes.runner.config);
  return fsImpl.existsSync(binJs) && fsImpl.existsSync(config);
}

function findArtifactScreenshotsDir(
  artifactsRoot: string,
  testBaseName: string,
  fsImpl: NonNullable<ViewRunnerDeps['fs']>,
): string | null {
  if (!fsImpl.existsSync(artifactsRoot)) return null;

  const candidateDirs: string[] = [];

  function scanDir(dir: string, depth = 0) {
    if (!fsImpl.existsSync(dir)) return;
    try {
      const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : fsImpl.statSync(path.join(dir, entry.name ?? entry)).isDirectory();
        const entryName = entry.name ?? entry;
        const fullPath = path.join(dir, entryName);
        if (isDir) {
          if (entryName.includes(testBaseName)) {
            candidateDirs.push(fullPath);
          } else if (depth < 2) {
            scanDir(fullPath, depth + 1);
          }
        }
      }
    } catch {
      // Ignorar error al leer directorios
    }
  }

  scanDir(artifactsRoot);

  if (candidateDirs.length === 0) return null;

  candidateDirs.sort((a, b) => {
    try {
      return fsImpl.statSync(b).mtimeMs - fsImpl.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  for (const dir of candidateDirs) {
    const screenshotsDir = path.join(dir, 'default', 'attempt-0', 'screenshots');
    if (fsImpl.existsSync(screenshotsDir)) {
      return screenshotsDir;
    }
  }

  return null;
}

interface ProcessExecutionOutcome {
  outputLines: string[];
  failed: { screenId: string; detail: string }[];
  exitCode: number | null;
  error: Error | null;
}

/** El `node` del sistema, si está en el PATH y se puede lanzar directo (un .exe, no un .cmd). */
async function findSystemNode(): Promise<string | undefined> {
  try {
    const resolution = await resolveRuntimeExecutable('node', process.env);
    return resolution.viaShell ? undefined : resolution.file;
  } catch {
    // Sin node en el PATH: se usa el ejecutable de GitCron como Node.
    return undefined;
  }
}

async function executeRunnerProcess(
  launchArgs: { binJs: string; configAbs: string; testRel: string; configDir: string; nodePath?: string },
  options: { signal?: AbortSignal; timeoutMs: number },
  spawnImpl: typeof spawn,
): Promise<ProcessExecutionOutcome> {
  const outputLines: string[] = [];
  const failed: { screenId: string; detail: string }[] = [];
  const procState: { exitCode: number | null; error: Error | null } = { exitCode: null, error: null };

  const recordOutput = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        outputLines.push(line);
        const match = line.match(/GITCRON_RECIPE_FAIL\s+(?:"([^"]+)"|(\S+))\s+(.*)$/);
        if (match) {
          const screenId = match[1] ?? match[2];
          const detail = match[3].trim();
          if (screenId && !failed.some((f) => f.screenId === screenId)) {
            failed.push({ screenId, detail });
          }
        }
      }
    }
  };

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      resolve();
    };

    // Con el `node` del sistema y sin ELECTRON_RUN_AS_NODE en el entorno: las pruebas del proyecto
    // heredan ese entorno al abrir la app, y con esa variable un Electron arranca como consola, sin
    // ventana («starting an attempt on engine web timed out»). Medido en la auditoría de carto-05d:
    // las 12 recetas fallaban por eso. Sin `node` en el PATH, queda el ejecutable de GitCron como Node.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      E2E_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      FORCE_COLOR: '0',
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const nodeExecutable = launchArgs.nodePath ?? process.execPath;
    if (!launchArgs.nodePath) childEnv.ELECTRON_RUN_AS_NODE = '1';
    const child: ChildProcess = spawnImpl(
      nodeExecutable,
      [launchArgs.binJs, 'run', '--config', launchArgs.configAbs, launchArgs.testRel],
      {
        cwd: launchArgs.configDir,
        windowsHide: true,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const onAbort = () => {
      defaultKillTree(child);
      finish();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        defaultKillTree(child);
        finish();
        return;
      }
      options.signal.addEventListener('abort', onAbort);
    }

    timer = setTimeout(() => {
      defaultKillTree(child);
      procState.error = new Error(`Tiempo de espera agotado en pruebas de captura (${Math.round(options.timeoutMs / 1000)}s)`);
      finish();
    }, options.timeoutMs);

    child.stdout?.on('data', (c) => recordOutput(c));
    child.stderr?.on('data', (c) => recordOutput(c));

    child.on('error', (err) => {
      procState.error = err;
      finish();
    });

    child.on('close', (code) => {
      procState.exitCode = code;
      finish();
    });
  });

  return {
    outputLines,
    failed,
    exitCode: procState.exitCode,
    error: procState.error,
  };
}

function collectCapturedImages(
  configDir: string,
  testBaseName: string,
  shots: ShotMapping[],
  fsImpl: NonNullable<ViewRunnerDeps['fs']>,
): Map<string, Buffer> {
  const images = new Map<string, Buffer>();
  const artifactsRoot = path.join(configDir, '.e2e', 'artifacts');
  const screenshotsDir = findArtifactScreenshotsDir(artifactsRoot, testBaseName, fsImpl);

  if (screenshotsDir && fsImpl.existsSync(screenshotsDir)) {
    try {
      const files = fsImpl.readdirSync(screenshotsDir) as (string | { name: string })[];
      const fileNames: string[] = files
        .map((f) => (typeof f === 'string' ? f : f.name))
        .filter((n) => n.endsWith('.png'));

      for (const { shot, screenId } of shots) {
        const targetFile = fileNames.find((f) => {
          const clean = f.replace(/^\d+-/, '').replace(/\.png$/, '');
          return clean === shot;
        });
        if (targetFile) {
          const buf = fsImpl.readFileSync(path.join(screenshotsDir, targetFile));
          images.set(screenId, buf);
        }
      }
    } catch {
      // Ignorar error al leer capturas
    }
  }

  return images;
}

export async function runViewCaptures(
  root: string,
  recipes: CaptureRecipes,
  screens: { id: string; name: string }[],
  options: { signal?: AbortSignal; timeoutMs?: number /* 1_800_000 */ } = {},
  deps?: ViewRunnerDeps,
): Promise<ViewRunResult> {
  const fsImpl = deps?.fs ?? fs;
  const spawnImpl = deps?.spawn ?? spawn;
  const timeoutMs = options.timeoutMs ?? 1_800_000;

  if (screens.length === 0) {
    return { images: new Map(), failed: [] };
  }

  const { code, shots } = buildRecipeTest(recipes, screens, root);
  const randomHex = crypto.randomBytes(4).toString('hex');
  const tempFileName = `zz-gitcron-capturas-${randomHex}.e2e.ts`;
  const tempTestDir = path.resolve(root, recipes.runner.testsDir);
  const tempTestPath = path.join(tempTestDir, tempFileName);

  const binJs = path.join(root, 'node_modules', 'e2e', 'dist', 'cli', 'bin.js');
  const configAbs = path.resolve(root, recipes.runner.config);
  const configDir = path.dirname(configAbs);
  const testRel = path.relative(configDir, tempTestPath);

  try {
    fsImpl.mkdirSync(tempTestDir, { recursive: true });
    fsImpl.writeFileSync(tempTestPath, code, 'utf8');

    const nodePath = await findSystemNode();
    const outcome = await executeRunnerProcess(
      { binJs, configAbs, testRel, configDir, nodePath },
      { signal: options.signal, timeoutMs },
      spawnImpl,
    );

    const testBaseName = tempFileName.replace(/\.e2e\.ts$/, '');
    const images = collectCapturedImages(configDir, testBaseName, shots, fsImpl);
    const failed = [...outcome.failed];

    for (const screen of screens) {
      if (!images.has(screen.id) && !failed.some((f) => f.screenId === screen.id)) {
        failed.push({
          screenId: screen.id,
          detail: 'la prueba no llegó a esta pantalla',
        });
      }
    }

    let error: string | undefined;
    if (images.size === 0 && (outcome.exitCode !== 0 || outcome.error !== null || options.signal?.aborted)) {
      const tail = outcome.outputLines.slice(-15);
      if (tail.length > 0) {
        error = tail.join('\n');
      } else if (outcome.error) {
        error = outcome.error.message;
      } else if (options.signal?.aborted) {
        error = 'Ejecución cancelada';
      } else {
        error = `El proceso de pruebas falló con código ${outcome.exitCode}`;
      }
    }

    return { images, failed, error };
  } finally {
    try {
      if (fsImpl.existsSync(tempTestPath)) {
        fsImpl.unlinkSync(tempTestPath);
      }
    } catch {
      // Borrado garantizado en finally
    }
  }
}
