// electron/carto/screen-capture/start-command.ts
//
// Detección del comando de arranque de un proyecto para la captura de pantallas (decisión 11).

import * as path from 'node:path';

export interface StartCommand {
  /** Ejecutable a resolver: ruta absoluta a node_modules/.bin/<x> o el gestor (pnpm/npm/yarn/bun). */
  executable: string;
  /** Argumentos; `{port}` se reemplaza por el puerto libre. */
  args: string[];
  /** Si el puerto va por la variable PORT (scripts genéricos). */
  portViaEnv: boolean;
  /** Lo que ve la persona en el permiso, sin el puerto concreto. Es la clave del permiso. */
  display: string;
  /**
   * Puertos que declaran los scripts del proyecto (`-p 3001`, `--port 5173`, `PORT=4000`). Si el
   * proyecto ya está corriendo ahí, se usa ese servidor: arrancar otro `next dev` sobre la misma
   * carpeta rompe el que está corriendo (medido en carto-05b).
   */
  knownPorts?: number[];
  viewsRunner?: string;
}

/** Lee los puertos que declaran los scripts `dev` y `start`. */
function declaredPorts(scripts: Record<string, unknown>): number[] {
  const ports = new Set<number>();
  for (const name of ['dev', 'start']) {
    const text = scripts[name];
    if (typeof text !== 'string') continue;
    for (const m of text.matchAll(/(?:-p|--port)[\s=]+(\d{2,5})|PORT=(\d{2,5})/g)) {
      const n = Number(m[1] ?? m[2]);
      if (n > 0 && n < 65536) ports.add(n);
    }
  }
  return [...ports];
}

export type DetectStartCommandResult =
  | StartCommand
  | { unsupported: 'no-package' | 'no-start-command' | 'not-installed' };

function parsePackage(pkgRaw: string | null): Record<string, any> | null {
  if (!pkgRaw) return null;
  try {
    const pkg = JSON.parse(pkgRaw);
    return pkg && typeof pkg === 'object' ? pkg : null;
  } catch {
    return null;
  }
}

async function detectNext(
  root: string,
  depsObj: Record<string, unknown>,
  devDepsObj: Record<string, unknown>,
  knownPorts: number[],
  exists: (rel: string) => Promise<boolean>,
): Promise<StartCommand | { unsupported: 'not-installed' } | null> {
  if (!('next' in depsObj || 'next' in devDepsObj)) return null;
  const hasNext = await exists('node_modules/.bin/next');
  if (!hasNext) return { unsupported: 'not-installed' };
  return {
    executable: path.join(root, 'node_modules', '.bin', 'next'),
    args: ['dev', '-p', '{port}'],
    portViaEnv: false,
    display: 'next dev -p <puerto libre>',
    knownPorts,
  };
}

async function detectVite(
  root: string,
  depsObj: Record<string, unknown>,
  devDepsObj: Record<string, unknown>,
  knownPorts: number[],
  exists: (rel: string) => Promise<boolean>,
): Promise<StartCommand | { unsupported: 'not-installed' } | null> {
  if (!('vite' in depsObj || 'vite' in devDepsObj)) return null;
  const hasVite = await exists('node_modules/.bin/vite');
  if (!hasVite) return { unsupported: 'not-installed' };
  return {
    executable: path.join(root, 'node_modules', '.bin', 'vite'),
    args: ['--port', '{port}', '--strictPort'],
    portViaEnv: false,
    display: 'vite --port <puerto libre>',
    knownPorts,
  };
}

async function detectPackageManager(exists: (rel: string) => Promise<boolean>): Promise<string> {
  if (await exists('pnpm-lock.yaml')) return 'pnpm';
  if (await exists('yarn.lock')) return 'yarn';
  if ((await exists('bun.lockb')) || (await exists('bun.lock'))) return 'bun';
  return 'npm';
}

async function detectScript(
  scripts: Record<string, unknown>,
  knownPorts: number[],
  exists: (rel: string) => Promise<boolean>,
): Promise<StartCommand | null> {
  const scriptName = typeof scripts.dev === 'string' ? 'dev' : typeof scripts.start === 'string' ? 'start' : null;
  if (!scriptName) return null;

  const manager = await detectPackageManager(exists);
  return {
    executable: manager,
    args: ['run', scriptName],
    portViaEnv: true,
    // El texto del script va en la orden: el permiso queda atado a lo que se ejecuta de
    // verdad, y si alguien cambia el script se vuelve a pedir (decisión 11).
    display: `${manager} run ${scriptName} (${String(scripts[scriptName]).trim()})`,
    knownPorts,
  };
}

export async function detectStartCommand(
  root: string,
  deps: { readFile(rel: string): Promise<string | null>; exists(rel: string): Promise<boolean> },
): Promise<DetectStartCommandResult> {
  const pkgRaw = await deps.readFile('package.json');
  const pkg = parsePackage(pkgRaw);
  if (!pkg) {
    return { unsupported: 'no-package' };
  }

  const depsObj = typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {};
  const devDepsObj = typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null ? pkg.devDependencies : {};
  const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  const knownPorts = declaredPorts(scripts);

  const nextResult = await detectNext(root, depsObj, devDepsObj, knownPorts, deps.exists);
  if (nextResult) return nextResult;

  const viteResult = await detectVite(root, depsObj, devDepsObj, knownPorts, deps.exists);
  if (viteResult) return viteResult;

  const scriptResult = await detectScript(scripts, knownPorts, deps.exists);
  if (scriptResult) return scriptResult;

  return { unsupported: 'no-start-command' };
}
