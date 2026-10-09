import { simpleGit } from 'simple-git';
import type { BranchDivergence } from '../../types/pipeline';
import { withRepoLock } from '../git/repo-queue';

/**
 * Cuánto se aparta la rama actual de la base local.
 *
 * Existe porque `git checkout -b` no dice de dónde sale la rama. Este
 * repositorio tiene 35 ramas locales y varias están deliberadamente sin
 * fusionar: medido, `claude/jolly-khayyam-2be14c` está 501 commits detrás de
 * `main` y `fix/pipeline-launcher-empty-box` 107. Crear el cambio parado en
 * cualquiera de ellas hereda una base de meses atrás sin que nada lo declare.
 *
 * Son dos números y no uno porque separan tres situaciones con respuestas
 * distintas: al día, rama vieja ya fusionada, y rama con trabajo propio sin
 * fusionar —que puede ser exactamente donde se quiere estar—.
 */

/** La base es local a propósito: comparar con el remoto exigiría `git fetch`. */
export const DEFAULT_BASE_BRANCH = 'main';

/**
 * Lee la salida de `git rev-list --left-right --count <base>...HEAD`.
 *
 * Puro y aparte para poder probarlo con tablas. Devuelve `null` ante cualquier
 * forma que no sea exactamente dos enteros: una salida que no se entiende no se
 * interpreta como ceros.
 */
export function parseDivergenceCounts(raw: string): { behind: number; ahead: number } | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [behind, ahead] = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
  return { behind, ahead };
}

/**
 * Mide la divergencia contra la base local.
 *
 * Cualquier fallo devuelve `measured: false`. Un repositorio sin `main` —recién
 * iniciado, o con otra rama principal— es un caso normal, no un error que
 * merezca romper el resto de la evidencia.
 *
 * Cuesta lo que cuesta abrir el proceso y no lo que cuesta contar: medido en
 * este repositorio, 63–105 ms con cero commits de divergencia y 57–114 ms con
 * 501. Es del mismo orden que el `git status` que la aplicación ya corre en cada
 * refresco.
 */
export async function readBranchDivergence(
  repoPath: string,
  base: string = DEFAULT_BASE_BRANCH,
): Promise<BranchDivergence> {
  try {
    const raw = await withRepoLock(repoPath, () => (
      simpleGit(repoPath, { timeout: { block: 10_000 } })
        .raw(['rev-list', '--left-right', '--count', `${base}...HEAD`])
    ));
    const counts = parseDivergenceCounts(raw);
    return counts === null ? { measured: false } : { measured: true, base, ...counts };
  } catch {
    return { measured: false };
  }
}
