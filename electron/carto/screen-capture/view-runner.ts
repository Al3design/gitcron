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

/** Un cambio de estado de una vista mientras corre la prueba (decisión 14). */
export interface ViewRunEvent {
  screenId: string;
  state: 'running' | 'done' | 'failed';
  detail?: string;
  /** La foto en PNG, si ya estaba en los artefactos al terminar la vista. */
  image?: Buffer;
}

type RecipeMarker =
  | { kind: 'start' | 'done'; screenId: string }
  | { kind: 'fail'; screenId: string; detail: string };

/** Lee una línea de la salida de la prueba temporal: START, DONE o FAIL de una pantalla. */
function parseRecipeMarker(line: string): RecipeMarker | null {
  const fail = line.match(/GITCRON_RECIPE_FAIL\s+(?:"([^"]+)"|(\S+))\s+(.*)$/);
  if (fail) {
    const screenId = fail[1] ?? fail[2];
    return screenId ? { kind: 'fail', screenId, detail: fail[3].trim() } : null;
  }
  const mark = line.match(/GITCRON_RECIPE_(START|DONE)\s+(?:"([^"]+)"|(\S+))/);
  if (mark) {
    const screenId = mark[2] ?? mark[3];
    if (!screenId) return null;
    return { kind: mark[1] === 'START' ? 'start' : 'done', screenId };
  }
  return null;
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
    rmSync?(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
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

/**
 * Mientras corre, la prueba temporal aparecía entre los cambios del repo (Alejandro la vio en
 * una captura de Historial de IA, en carto-05e). Se la ignora en `.git/info/exclude`, que es local
 * del repo: no se guarda en ningún commit ni toca el `.gitignore` del proyecto.
 */
function ignoreTempTestsLocally(root: string, testsDir: string): void {
  const excludePath = path.join(root, '.git', 'info', 'exclude');
  const pattern = `/${testsDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/zz-gitcron-capturas-*`;
  try {
    if (!fs.existsSync(path.join(root, '.git', 'info'))) return; // un worktree tiene `.git` como archivo
    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    if (current.split(/\r?\n/).includes(pattern)) return;
    const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(excludePath, `${prefix}# GitCron: pruebas temporales de capturas\n${pattern}\n`, 'utf8');
  } catch (err) {
    console.warn('[capturas] no se pudo marcar la prueba temporal como ignorada', err);
  }
}

/** Una corrida cortada de golpe (GitCron cerrado a la fuerza) no llega a su `finally`. */
const STALE_TEMP_TEST_MS = 60 * 60 * 1000;

/**
 * Borra las pruebas temporales de corridas que quedaron cortadas. Medido en la auditoría de
 * carto-05e: una quedó en e2e/tests y el tsc del proyecto falló por ella.
 */
function removeStaleTempTests(dir: string, fsImpl: NonNullable<ViewRunnerDeps['fs']>): void {
  try {
    if (!fsImpl.existsSync(dir)) return;
    const names = (fsImpl.readdirSync(dir) as (string | { name: string })[]).map((f) => (typeof f === 'string' ? f : f.name));
    for (const name of names) {
      if (!/^zz-gitcron-capturas-[a-f0-9]+\.e2e\.ts$/.test(name)) continue;
      const file = path.join(dir, name);
      if (Date.now() - fsImpl.statSync(file).mtimeMs > STALE_TEMP_TEST_MS) fsImpl.unlinkSync(file);
    }
  } catch (err) {
    console.warn('[capturas] no se pudieron limpiar pruebas temporales viejas', err);
  }
}

/** Traduce los errores conocidos del sistema de pruebas; si no, la última línea con un error. */
function runFailureReason(outcome: { outputLines: string[]; error: Error | null; exitCode: number | null }): string | null {
  const text = outcome.outputLines.join('\n');
  if (/LAUNCH_TIMEOUT|starting an attempt on engine \w+ timed out/.test(text)) {
    return 'la app tardó demasiado en abrirse (¿la máquina está muy ocupada?)';
  }
  if (/APP_UNREACHABLE/.test(text)) return 'el servidor de la app no respondió a tiempo';
  if (/INVALID_CONFIG/.test(text)) return 'la configuración de las pruebas del proyecto no es válida';
  if (outcome.error) return outcome.error.message;
  const last = [...outcome.outputLines].reverse().find((l) => /error|ERROR|FAIL|×/.test(l) && !/GITCRON_RECIPE/.test(l));
  return last ? last.trim().slice(0, 160) : null;
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
  launchArgs: { binJs: string; configAbs: string; testRel: string; configDir: string; outputDir: string; nodePath?: string },
  options: { signal?: AbortSignal; timeoutMs: number; onMarker?(marker: RecipeMarker): void },
  spawnImpl: typeof spawn,
): Promise<ProcessExecutionOutcome> {
  const outputLines: string[] = [];
  const failed: { screenId: string; detail: string }[] = [];
  const procState: { exitCode: number | null; error: Error | null } = { exitCode: null, error: null };

  const recordLine = (line: string) => {
    if (line.trim().length === 0) return;
    outputLines.push(line);
    const marker = parseRecipeMarker(line);
    if (!marker) return;
    if (marker.kind === 'fail') {
      if (failed.some((f) => f.screenId === marker.screenId)) return;
      failed.push({ screenId: marker.screenId, detail: marker.detail });
    }
    options.onMarker?.(marker);
  };

  // La salida llega en pedazos que pueden cortar una línea al medio: se junta en un buffer por
  // canal y se lee cada línea completa en el momento, para avisar el avance mientras corre.
  const createLineReader = () => {
    let pending = '';
    return {
      push(chunk: Buffer | string) {
        pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) recordLine(line);
      },
      flush() {
        if (pending.length > 0) recordLine(pending);
        pending = '';
      },
    };
  };
  const stdoutReader = createLineReader();
  const stderrReader = createLineReader();

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      stdoutReader.flush();
      stderrReader.flush();
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
      // Le avisa a la app del proyecto que la abre GitCron para sacar fotos: GitCron mismo se abre
      // fuera de la pantalla y sin tomar el foco (decisión 14).
      GITCRON_CAPTURE: '1',
      DO_NOT_TRACK: '1',
      FORCE_COLOR: '0',
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const nodeExecutable = launchArgs.nodePath ?? process.execPath;
    if (!launchArgs.nodePath) childEnv.ELECTRON_RUN_AS_NODE = '1';
    const child: ChildProcess = spawnImpl(
      nodeExecutable,
      // Carpeta de resultados propia: con la de omisión (.e2e), la corrida limpiaba los artefactos de
      // las pruebas del proyecto que estuvieran corriendo (medido en carto-05d y 05e: se perdían fotos).
      [launchArgs.binJs, 'run', '--config', launchArgs.configAbs, '--output', launchArgs.outputDir, launchArgs.testRel],
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

    child.stdout?.on('data', (c) => stdoutReader.push(c));
    child.stderr?.on('data', (c) => stderrReader.push(c));

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
  outputDir: string,
  testBaseName: string,
  shots: ShotMapping[],
  fsImpl: NonNullable<ViewRunnerDeps['fs']>,
): Map<string, Buffer> {
  const images = new Map<string, Buffer>();
  const artifactsRoot = path.join(outputDir, 'artifacts');
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
  options: {
    signal?: AbortSignal;
    timeoutMs?: number /* 1_800_000 */;
    onEvent?(e: ViewRunEvent): void;
  } = {},
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
  // Dentro del proyecto (el CLI rechaza una salida fuera, INVALID_CONFIG) y en una subcarpeta propia
  // de `.e2e`: así no limpia los artefactos de otras pruebas que estén corriendo.
  const outputDir = path.join(configDir, '.e2e', `gitcron-capturas-${randomHex}`);

  try {
    ignoreTempTestsLocally(root, recipes.runner.testsDir);
    removeStaleTempTests(tempTestDir, fsImpl);
    fsImpl.mkdirSync(tempTestDir, { recursive: true });
    fsImpl.writeFileSync(tempTestPath, code, 'utf8');

    const testBaseName = tempFileName.replace(/\.e2e\.ts$/, '');
    const onMarker = (marker: RecipeMarker) => {
      if (!options.onEvent) return;
      if (marker.kind === 'start') {
        options.onEvent({ screenId: marker.screenId, state: 'running' });
      } else if (marker.kind === 'fail') {
        options.onEvent({ screenId: marker.screenId, state: 'failed', detail: marker.detail });
      } else {
        // La foto puede no estar escrita todavía: si falta, se completa al final.
        const shot = shots.filter((s) => s.screenId === marker.screenId);
        const image = collectCapturedImages(outputDir, testBaseName, shot, fsImpl).get(marker.screenId);
        options.onEvent({ screenId: marker.screenId, state: 'done', ...(image ? { image } : {}) });
      }
    };

    const nodePath = await findSystemNode();
    const outcome = await executeRunnerProcess(
      { binJs, configAbs, testRel, configDir, outputDir, nodePath },
      { signal: options.signal, timeoutMs, onMarker },
      spawnImpl,
    );

    const images = collectCapturedImages(outputDir, testBaseName, shots, fsImpl);
    const failed = [...outcome.failed];

    // Si la prueba no llegó, el motivo va en la falla de cada pantalla: con una dirección capturada,
    // el error general no se mostraba y solo quedaba «la prueba no llegó» (Alejandro, carto-05e).
    const reason = runFailureReason(outcome);
    for (const screen of screens) {
      if (!images.has(screen.id) && !failed.some((f) => f.screenId === screen.id)) {
        failed.push({
          screenId: screen.id,
          detail: reason ? `la prueba no llegó a esta pantalla: ${reason}` : 'la prueba no llegó a esta pantalla',
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
    try {
      (fsImpl.rmSync ?? fs.rmSync)(outputDir, { recursive: true, force: true });
    } catch (err) {
      // La carpeta temporal de resultados queda en %TEMP%: no rompe nada, se avisa.
      console.warn('[capturas] no se pudo borrar la carpeta temporal de resultados', outputDir, err);
    }
  }
}
