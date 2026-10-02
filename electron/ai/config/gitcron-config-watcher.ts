// electron/ai/config/gitcron-config-watcher.ts
//
// Observa el `gitcron.json` global y el de cada repositorio abierto (D3), para que
// un cambio guardado a mano llegue a la pantalla sin reiniciar (requisito «El
// archivo y la pantalla dicen lo mismo»).
//
// Se observa la CARPETA y no el archivo: el del repositorio puede no existir
// todavía y crearse después, y muchos editores guardan escribiendo un temporal y
// renombrándolo encima, cosa que una observación sobre el archivo pierde.

import * as fs from 'node:fs';
import * as path from 'node:path';

const CONFIG_FILE_NAME = 'gitcron.json';

export interface GitCronConfigWatcherOptions {
  /** Ruta del `gitcron.json` global. */
  globalPath: string;
  /** Cambió el archivo de ese repositorio, o el global si es `null`. */
  onChange: (repoPath: string | null) => void;
  /**
   * Un mismo guardado dispara varios avisos seguidos (escribir, renombrar,
   * cambiar atributos); se juntan en uno.
   */
  debounceMs?: number;
  /** Un error de observación no tira la app: se informa y se sigue sin observar esa carpeta. */
  onError?: (error: unknown) => void;
}

export interface GitCronConfigWatcher {
  /** Empieza a observar la carpeta del global, si existe. Repetirlo no duplica. */
  watchGlobal(): void;
  /** Empieza a observar la raíz de un repositorio. Repetirlo no duplica. */
  watchRepo(repoPath: string): void;
  unwatchRepo(repoPath: string): void;
  /** Repositorios observados ahora (para diagnóstico y pruebas). */
  watchedRepos(): string[];
  close(): void;
}

const keyOf = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

export function createGitCronConfigWatcher(options: GitCronConfigWatcherOptions): GitCronConfigWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const repoWatchers = new Map<string, { repoPath: string; watcher: fs.FSWatcher }>();
  let globalWatcher: fs.FSWatcher | null = null;

  const schedule = (key: string, repoPath: string | null) => {
    const previous = timers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      timers.delete(key);
      options.onChange(repoPath);
    }, debounceMs);
    timer.unref?.();
    timers.set(key, timer);
  };

  const watchDir = (dir: string, key: string, repoPath: string | null): fs.FSWatcher | null => {
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_event, fileName) => {
        // Algunas plataformas no dan el nombre: entonces puede haber sido el archivo.
        if (fileName && path.basename(String(fileName)).toLowerCase() !== CONFIG_FILE_NAME) return;
        schedule(key, repoPath);
      });
      watcher.on('error', (error) => {
        options.onError?.(error);
        watcher.close();
        if (repoPath === null) globalWatcher = null;
        else repoWatchers.delete(key);
      });
      return watcher;
    } catch (error) {
      options.onError?.(error);
      return null;
    }
  };

  return {
    watchGlobal() {
      if (globalWatcher) return;
      const dir = path.dirname(options.globalPath);
      // Sin la carpeta todavía no hay archivo que observar; se intenta de nuevo
      // la próxima vez que alguien pida la configuración.
      if (!fs.existsSync(dir)) return;
      globalWatcher = watchDir(dir, 'global', null);
    },
    watchRepo(repoPath) {
      const key = keyOf(repoPath);
      if (repoWatchers.has(key)) return;
      const watcher = watchDir(repoPath, key, repoPath);
      if (watcher) repoWatchers.set(key, { repoPath, watcher });
    },
    unwatchRepo(repoPath) {
      const key = keyOf(repoPath);
      repoWatchers.get(key)?.watcher.close();
      repoWatchers.delete(key);
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
    },
    watchedRepos() {
      return Array.from(repoWatchers.values()).map((entry) => entry.repoPath);
    },
    close() {
      globalWatcher?.close();
      globalWatcher = null;
      for (const entry of repoWatchers.values()) entry.watcher.close();
      repoWatchers.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
