import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Registro en el proceso principal de repositorios Git efectivamente abiertos y autorizados.
 *
 * Los file watchers NO confieren autoridad por sí solos.
 * process.cwd() NO confiere autoridad incidental por sí solo.
 * Rutas suministradas libremente por el renderer son RECHAZADAS salvo que coincidan
 * exactamente con una raíz registrada y validada en este almacén.
 *
 * La autorización es **idempotente por ruta canónica**: existe o no existe, sin
 * contador de referencias. El renderer garantiza una sola pestaña por ruta
 * canónica (`addOrActivateRepo` deduplica por path, y todo `RepoInfo` llega con
 * la ruta canónica que este proceso devolvió), así que abrir o restaurar el
 * mismo repo dos veces no acumula referencias huérfanas: la reapertura es un
 * no-op y cerrar la única pestaña revoca. Las comprobaciones que no abren
 * pestaña (sondas) deben usar un canal que no autorice (`git:check-repo-path`),
 * no `git:open-path`.
 */
class AuthorizedRepoStore {
  /** Clave normalizada → ruta canónica autorizada. Presencia = autorizado. */
  private readonly authorized = new Map<string, string>();
  /** Quienes necesitan enterarse de que se cerró la pestaña de un repositorio. */
  private readonly deauthorizeListeners = new Set<(canonicalPath: string) => void>();

  /**
   * Avisa cuando se revoca un repositorio (se cerró su pestaña). Devuelve la baja.
   * Existe para que lo que se abrió por ese repositorio —por ejemplo la
   * observación de su `gitcron.json`— se cierre con él, sin que este registro
   * tenga que conocer a cada interesado.
   */
  public onDeauthorize(listener: (canonicalPath: string) => void): () => void {
    this.deauthorizeListeners.add(listener);
    return () => this.deauthorizeListeners.delete(listener);
  }

  /**
   * Normaliza una clave de ruta según la plataforma (case-insensitive en Windows).
   */
  private toKey(canonicalPath: string): string {
    return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
  }

  /**
   * Registra y autoriza una raíz Git válida tras verificar su existencia en disco
   * y la presencia de `.git` (directorio o archivo de worktree). Idempotente:
   * autorizar una raíz ya autorizada devuelve su canónica sin acumular estado.
   */
  public authorizeRepo(repoPath: string): string | null {
    if (typeof repoPath !== 'string' || !repoPath.trim()) return null;
    const normalized = path.normalize(repoPath.trim());
    if (!path.isAbsolute(normalized) || normalized.includes('..')) return null;

    try {
      const realPath = fs.realpathSync(normalized);
      const st = fs.lstatSync(realPath);
      if (!st.isDirectory()) return null;

      // Verificar que contenga .git (directorio estándar o archivo de worktree)
      const gitPath = path.join(realPath, '.git');
      if (!fs.existsSync(gitPath)) return null;
      const gitSt = fs.lstatSync(gitPath);
      if (!gitSt.isDirectory() && !gitSt.isFile()) return null;

      const key = this.toKey(realPath);
      const existing = this.authorized.get(key);
      if (existing !== undefined) return existing;
      this.authorized.set(key, realPath);
      return realPath;
    } catch {
      return null;
    }
  }

  /**
   * Revoca la autorización de una raíz Git (cierre de su única pestaña).
   */
  public deauthorizeRepo(repoPath: string): void {
    if (typeof repoPath !== 'string' || !repoPath.trim()) return;
    let key: string;
    try {
      key = this.toKey(fs.realpathSync(repoPath.trim()));
    } catch {
      // La carpeta pudo desaparecer: revocar por la clave derivada de la ruta recibida.
      key = this.toKey(path.normalize(repoPath.trim()));
    }
    const canonical = this.authorized.get(key);
    this.authorized.delete(key);
    if (canonical === undefined) return;
    for (const listener of this.deauthorizeListeners) {
      try {
        listener(canonical);
      } catch {
        // Un interesado que falla no impide cerrar el repositorio.
      }
    }
  }

  /**
   * Comprueba si una ruta está debidamente autorizada y registrada.
   */
  public isAuthorized(targetPath: string): boolean {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    try {
      const realPath = fs.realpathSync(targetPath.trim());
      return this.authorized.has(this.toKey(realPath));
    } catch {
      return false;
    }
  }

  /**
   * Devuelve todas las raíces canónicas autorizadas actualmente.
   */
  public getAuthorizedRoots(): string[] {
    return Array.from(this.authorized.values());
  }

  /**
   * Limpia todas las autorizaciones (cierre de la aplicación o reseteo de pruebas).
   */
  public clear(): void {
    this.authorized.clear();
  }
}

export const authorizedRepoStore = new AuthorizedRepoStore();

/**
 * Comprueba de forma estricta y segura si `targetPath` está contenido dentro de `parentPath`,
 * respetando límites de separador y sin falsos positivos en prefijos hermanos
 * (ej. `C:\repo-externo` NO está dentro de `C:\repo`).
 */
export function isContainedWithin(parentPath: string, targetPath: string): boolean {
  if (!parentPath || !targetPath) return false;
  const rel = path.relative(parentPath, targetPath);
  if (!rel) return true; // Coincidencia exacta
  // Si empieza con '..' o es absoluta, está fuera del contenedor
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * La raíz canónica de un repositorio abierto, o `null`. El `gitcron.json` del
 * repositorio sólo se lee de una pestaña que la persona abrió: una ruta suelta
 * del renderer no alcanza (misma regla que los canales de OpenSpec).
 */
export function authorizedRepoRoot(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const real = fs.realpathSync(candidate.trim());
    return authorizedRepoStore.isAuthorized(real) ? real : null;
  } catch {
    return null;
  }
}
