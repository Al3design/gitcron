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

export async function detectStartCommand(
  root: string,
  deps: { readFile(rel: string): Promise<string | null>; exists(rel: string): Promise<boolean> },
): Promise<DetectStartCommandResult> {
  const pkgRaw = await deps.readFile('package.json');
  if (!pkgRaw) {
    return { unsupported: 'no-package' };
  }

  let pkg: any;
  try {
    pkg = JSON.parse(pkgRaw);
    if (!pkg || typeof pkg !== 'object') {
      return { unsupported: 'no-package' };
    }
  } catch {
    return { unsupported: 'no-package' };
  }

  const depsObj = typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {};
  const devDepsObj = typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null ? pkg.devDependencies : {};

  const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  const knownPorts = declaredPorts(scripts);

  // 2. next en dependencies o devDependencies
  if ('next' in depsObj || 'next' in devDepsObj) {
    const hasNext = await deps.exists('node_modules/.bin/next');
    if (!hasNext) {
      return { unsupported: 'not-installed' };
    }
    return {
      executable: path.join(root, 'node_modules', '.bin', 'next'),
      args: ['dev', '-p', '{port}'],
      portViaEnv: false,
      display: 'next dev -p <puerto libre>',
      knownPorts,
    };
  }

  // 3. vite en dependencies o devDependencies
  if ('vite' in depsObj || 'vite' in devDepsObj) {
    const hasVite = await deps.exists('node_modules/.bin/vite');
    if (!hasVite) {
      return { unsupported: 'not-installed' };
    }
    return {
      executable: path.join(root, 'node_modules', '.bin', 'vite'),
      args: ['--port', '{port}', '--strictPort'],
      portViaEnv: false,
      display: 'vite --port <puerto libre>',
      knownPorts,
    };
  }

  // 4. Script dev (si no, start)
  const scriptName = typeof scripts.dev === 'string' ? 'dev' : typeof scripts.start === 'string' ? 'start' : null;

  if (scriptName) {
    let manager = 'npm';
    if (await deps.exists('pnpm-lock.yaml')) {
      manager = 'pnpm';
    } else if (await deps.exists('yarn.lock')) {
      manager = 'yarn';
    } else if ((await deps.exists('bun.lockb')) || (await deps.exists('bun.lock'))) {
      manager = 'bun';
    }

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

  // 5. Sin comando
  return { unsupported: 'no-start-command' };
}
